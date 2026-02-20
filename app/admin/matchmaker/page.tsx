"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGate from "../../components/AuthGate";
import { auth, db } from "../../../lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/navigation";

type Role = "pledge" | "active" | "admin";

type Profile = {
  uid: string;
  role: Role;
  cycleId: string;
  displayName: string;
  photoURL: string;

  // profile questions (may be "N/A" for some actives)
  q1_personality?: string;
  q2_humor?: string;
  q3_hangout?: string;
  q4_groupRole?: string;
  q5_values?: string;
  q6_about?: string;

  // actives only
  wantsLittle?: boolean | null;
  maxLittles?: number | null;
};

type PreferencesDoc = {
  uid: string;
  role: Role;
  cycleId: string;

  // top 3 ranked choices by uid
  top1?: string | null;
  top2?: string | null;
  top3?: string | null;

  createdAt?: any;
};

type PairSuggestion = {
  pledgeUid: string;
  pledgeName: string;
  activeUid: string;
  activeName: string;

  score: number;
  relationshipTag: "similar" | "complementary" | "mixed";

  // preference details (who ranked whom, and how)
  prefDetail: string[];
};

export default function MatchmakerPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [cycleId, setCycleId] = useState<string | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [myUid, setMyUid] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [prefsByUid, setPrefsByUid] = useState<Record<string, PreferencesDoc>>(
    {}
  );

  const [error, setError] = useState<string | null>(null);

  // Load auth + admin flag + cycle + data
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setLoading(false);
        router.push("/login");
        return;
      }

      setMyUid(u.uid);

      try {
        // 1) load cycleId
        const settingsSnap = await getDoc(doc(db, "settings", "global"));
        const cid = settingsSnap.exists()
          ? (settingsSnap.data()?.currentCycleId as string | undefined)
          : undefined;

        if (!cid) {
          setCycleId(null);
          setError(
            "No current cycleId set. Go to /admin and set settings/global.currentCycleId."
          );
          setLoading(false);
          return;
        }
        setCycleId(cid);

        // 2) check admin
        const userSnap = await getDoc(doc(db, "users", u.uid));
        const ud = userSnap.exists() ? (userSnap.data() as any) : {};
        const admin = !!ud?.isAdmin;
        setIsAdmin(admin);

        if (!admin) {
          setError("You are not an admin. Only admins can view Matchmaker.");
          setLoading(false);
          return;
        }

        // 3) load profiles for this cycle
        const profSnap = await getDocs(
          query(
            collection(db, "cycles", cid, "profiles"),
            where("cycleId", "==", cid)
          )
        );

        const profList: Profile[] = profSnap.docs.map((d) => {
          const data = d.data() as any;
          return {
            uid: data.uid ?? d.id,
            role: data.role as Role,
            cycleId: data.cycleId ?? cid,
            displayName: data.displayName ?? "Unknown",
            photoURL: data.photoURL ?? "",

            q1_personality: data.q1_personality,
            q2_humor: data.q2_humor,
            q3_hangout: data.q3_hangout,
            q4_groupRole: data.q4_groupRole,
            q5_values: data.q5_values,
            q6_about: data.q6_about,

            wantsLittle: data.wantsLittle ?? null,
            maxLittles: data.maxLittles ?? null,
          };
        });

        // 4) load preferences for this cycle
        const prefSnap = await getDocs(collection(db, "cycles", cid, "preferences"));
        const prefMap: Record<string, PreferencesDoc> = {};

        prefSnap.docs.forEach((d) => {
          const data = d.data() as any;
          const uid = data.uid ?? d.id;
          prefMap[uid] = {
            uid,
            role: (data.role as Role) ?? "pledge",
            cycleId: data.cycleId ?? cid,
            top1: data.top1 ?? null,
            top2: data.top2 ?? null,
            top3: data.top3 ?? null,
            createdAt: data.createdAt,
          };
        });

        setProfiles(profList);
        setPrefsByUid(prefMap);

        setLoading(false);
      } catch (e: any) {
        console.error(e);
        setError(e?.message ?? "Failed to load matchmaker data.");
        setLoading(false);
      }
    });

    return () => unsub();
  }, [router]);

  // Split by role
  const pledges = useMemo(
    () => profiles.filter((p) => p.role === "pledge"),
    [profiles]
  );

  const actives = useMemo(
    () => profiles.filter((p) => p.role === "active" || p.role === "admin"),
    [profiles]
  );

  const profileByUid = useMemo(() => {
    const m: Record<string, Profile> = {};
    profiles.forEach((p) => (m[p.uid] = p));
    return m;
  }, [profiles]);

  // ---- scoring helpers ----
  function similarityScore(a: Profile, b: Profile): number {
    // compares Q1-Q5 (categorical matches)
    const keys: (keyof Profile)[] = [
      "q1_personality",
      "q2_humor",
      "q3_hangout",
      "q4_groupRole",
      "q5_values",
    ];

    let score = 0;
    for (const k of keys) {
      const av = (a[k] ?? "").toString();
      const bv = (b[k] ?? "").toString();
      if (!av || !bv) continue;
      if (av === "N/A" || bv === "N/A") continue;
      if (av === bv) score += 2;
    }
    return score;
  }

  function complementaryScore(pledge: Profile, active: Profile): number {
    // a simple “works-well-together” heuristic:
    // Introvert + Extrovert, Leader + Supportive, etc.
    // You can expand this later.
    let score = 0;

    const pPers = pledge.q1_personality;
    const aPers = active.q1_personality;
    if (
      (pPers === "Introvert" && aPers === "Extrovert") ||
      (pPers === "Extrovert" && aPers === "Introvert")
    ) {
      score += 2;
    }

    const pGroup = pledge.q4_groupRole;
    const aGroup = active.q4_groupRole;
    if (
      (pGroup?.includes("Leader") && aGroup?.includes("Supportive")) ||
      (pGroup?.includes("Supportive") && aGroup?.includes("Leader"))
    ) {
      score += 2;
    }

    // Humor: "Dry + sarcastic" pairs well with "Chaotic + silly" often
    const pHumor = pledge.q2_humor;
    const aHumor = active.q2_humor;
    if (
      (pHumor === "Dry + sarcastic" && aHumor === "Chaotic + silly") ||
      (pHumor === "Chaotic + silly" && aHumor === "Dry + sarcastic")
    ) {
      score += 1;
    }

    // Hangout: "Chill nights in" with "Going out + social" can be complementary
    const pHang = pledge.q3_hangout;
    const aHang = active.q3_hangout;
    if (
      (pHang === "Chill nights in" && aHang === "Going out + social") ||
      (pHang === "Going out + social" && aHang === "Chill nights in")
    ) {
      score += 1;
    }

    return score;
  }

  function preferencePoints(fromUid: string, toUid: string): number {
    const pref = prefsByUid[fromUid];
    if (!pref) return 0;
    if (pref.top1 === toUid) return 6;
    if (pref.top2 === toUid) return 3;
    if (pref.top3 === toUid) return 1;
    return 0;
  }

  function preferenceDetail(fromUid: string, toUid: string): string | null {
    const pref = prefsByUid[fromUid];
    if (!pref) return null;

    if (pref.top1 === toUid) return `${profileByUid[fromUid]?.displayName ?? "Someone"} ranked ${profileByUid[toUid]?.displayName ?? "them"} as #1`;
    if (pref.top2 === toUid) return `${profileByUid[fromUid]?.displayName ?? "Someone"} ranked ${profileByUid[toUid]?.displayName ?? "them"} as #2`;
    if (pref.top3 === toUid) return `${profileByUid[fromUid]?.displayName ?? "Someone"} ranked ${profileByUid[toUid]?.displayName ?? "them"} as #3`;

    return null;
  }

  const suggestions: PairSuggestion[] = useMemo(() => {
    if (!cycleId) return [];

    const out: PairSuggestion[] = [];

    for (const pledge of pledges) {
      for (const active of actives) {
        // If active is not picking up, still allow matchmaker to show them (your preference).
        // If you want to hide them, add:
        // if (active.wantsLittle === false) continue;

        const sim = similarityScore(pledge, active);
        const comp = complementaryScore(pledge, active);

        const prefPtoA = preferencePoints(pledge.uid, active.uid);
        const prefAtoP = preferencePoints(active.uid, pledge.uid);

        const score = sim + comp + prefPtoA + prefAtoP;

        let relationshipTag: "similar" | "complementary" | "mixed" = "mixed";
        if (sim >= comp + 2) relationshipTag = "similar";
        else if (comp >= sim + 2) relationshipTag = "complementary";

        const details: string[] = [];
        const d1 = preferenceDetail(pledge.uid, active.uid);
        const d2 = preferenceDetail(active.uid, pledge.uid);

        if (d1) details.push(d1);
        else details.push(`${pledge.displayName} gave no ranked preference for ${active.displayName}`);

        if (d2) details.push(d2);
        else details.push(`${active.displayName} gave no ranked preference for ${pledge.displayName}`);

        out.push({
          pledgeUid: pledge.uid,
          pledgeName: pledge.displayName,
          activeUid: active.uid,
          activeName: active.displayName,
          score,
          relationshipTag,
          prefDetail: details,
        });
      }
    }

    // sort best first
    out.sort((a, b) => b.score - a.score);
    return out;
  }, [actives, pledges, prefsByUid, profileByUid, cycleId]);

  async function writeSuggestionsToFirestore() {
    if (!cycleId) return;
    setError(null);

    try {
      // Save top suggestions list (admin-only page; admin has write)
      await setDoc(
        doc(db, "matches", cycleId),
        {
          cycleId,
          updatedAt: serverTimestamp(),
          suggestions: suggestions.slice(0, 200), // cap
        },
        { merge: true }
      );
      alert("Saved suggestions to /matches/" + cycleId);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Failed to save suggestions.");
    }
  }

  if (loading) {
    return (
      <AuthGate>
        <div className="p-8">Loading matchmaker…</div>
      </AuthGate>
    );
  }

  if (error) {
    return (
      <AuthGate>
        <div className="p-8">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
            {error}
          </div>
          <button
            onClick={() => router.push("/admin")}
            className="mt-4 rounded-lg border px-4 py-2"
          >
            Back to Admin
          </button>
        </div>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <main className="min-h-screen p-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Matchmaker</h1>
              <p className="mt-2 text-gray-600">
                Cycle: <span className="font-medium">{cycleId}</span>
              </p>
              <p className="mt-1 text-gray-500 text-sm">
                Pledges: {pledges.length} • Actives/Admin: {actives.length} • Suggestions:{" "}
                {suggestions.length}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => router.push("/admin")}
                className="rounded-lg border px-4 py-2"
              >
                Back
              </button>
              <button
                onClick={writeSuggestionsToFirestore}
                className="rounded-lg bg-black text-white px-4 py-2 font-medium"
              >
                Save suggestions
              </button>
            </div>
          </div>

          {suggestions.length === 0 ? (
            <div className="mt-8 rounded-2xl border p-8">
              <div className="text-lg font-semibold">No matches found.</div>
              <p className="mt-2 text-gray-600">
                This usually means profiles or preferences weren’t loaded for the current cycle.
              </p>
            </div>
          ) : (
            <div className="mt-8 space-y-4">
              {suggestions.slice(0, 50).map((s, i) => (
                <div key={`${s.pledgeUid}-${s.activeUid}`} className="rounded-2xl border p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="font-semibold">
                      #{i + 1} — {s.pledgeName} ↔ {s.activeName}
                    </div>
                    <div className="text-sm text-gray-700">
                      Score: <span className="font-semibold">{s.score}</span>{" "}
                      <span className="ml-2 rounded-full border px-2 py-0.5 text-xs capitalize">
                        {s.relationshipTag}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 text-sm text-gray-700 space-y-1">
                    {s.prefDetail.map((line, idx) => (
                      <div key={idx}>• {line}</div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </AuthGate>
  );
}
