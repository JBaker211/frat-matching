"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGate from "@/app/components/AuthGate";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { useRouter } from "next/navigation";

type Role = "pledge" | "active" | "admin";

type Profile = {
  uid: string;
  role: "pledge" | "active" | "admin";
  displayName: string;
  photoURL: string;
  q1_personality: string;
  q2_humor: string;
  q3_hangout: string;
  q4_groupRole: string;
  q5_values: string;
  q6_about: string;
  wantsLittle?: boolean;
  maxLittles?: number;
};

type PrefDoc = {
  uid: string;
  role: Role | null;
  targetRole: "pledge" | "active";
  firstUid: string | null;
  secondUid: string | null;
  thirdUid: string | null;
};

type Row = {
  pledge: Profile;
  active: Profile;
  score: number; // 1..10
  type: "Similar" | "Complementary";
  preferenceText: string; // "Pledge → Active: #1 | Active → Pledge: none"
  notes: string[];
};

function rankPicked(pref: PrefDoc | null | undefined, otherUid: string): number | null {
  if (!pref) return null;
  if (pref.firstUid === otherUid) return 1;
  if (pref.secondUid === otherUid) return 2;
  if (pref.thirdUid === otherUid) return 3;
  return null;
}

function prefLine(aName: string, aRank: number | null, bName: string, bRank: number | null) {
  const left = `${aName} → ${bName}: ${aRank ? `#${aRank}` : "no preference"}`;
  const right = `${bName} → ${aName}: ${bRank ? `#${bRank}` : "no preference"}`;
  return `${left} | ${right}`;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

export default function ResultsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [adminOk, setAdminOk] = useState(false);

  const [pledges, setPledges] = useState<Profile[]>([]);
  const [actives, setActives] = useState<Profile[]>([]);
  const [prefsByUid, setPrefsByUid] = useState<Record<string, PrefDoc>>({});

  const [minScore, setMinScore] = useState(7);
  const [sortMode, setSortMode] = useState<"scoreDesc" | "pledgeName" | "activeName">("scoreDesc");

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (!u) {
        setLoading(false);
        setAdminOk(false);
        return;
      }

      try {
        // verify admin
        const meSnap = await getDoc(doc(db, "users", u.uid));
        const me = meSnap.data() as any;
        const isAdmin = !!me?.isAdmin;

        if (!isAdmin) {
          setAdminOk(false);
          setLoading(false);
          return;
        }

        setAdminOk(true);

        // load profiles
        const pledgeSnap = await getDocs(
          query(collection(db, "profiles"), where("role", "==", "pledge"))
        );
        const activeSnap = await getDocs(
          query(collection(db, "profiles"), where("role", "==", "active"))
        );

        const pledgeList = pledgeSnap.docs.map((d) => d.data() as Profile);
        const activeList = activeSnap.docs.map((d) => d.data() as Profile);

        // load preferences
        const prefSnap = await getDocs(collection(db, "preferences"));
        const prefMap: Record<string, PrefDoc> = {};
        prefSnap.docs.forEach((d) => {
          prefMap[d.id] = d.data() as PrefDoc;
        });

        setPledges(pledgeList);
        setActives(activeList);
        setPrefsByUid(prefMap);

        setLoading(false);
      } catch (e) {
        console.error(e);
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const rows = useMemo<Row[]>(() => {
    // Compatibility scoring (simple + explainable, can evolve later)
    // Base score starts at 5, then add:
    // - Similarities on humor/hangout/values (+0.8 each)
    // - Complementary combos on personality/groupRole (+0.8 each)
    // - Preference boosts (directional + mutual)
    //
    // Then clamp to 1..10

    function scorePair(p: Profile, a: Profile): { score: number; type: "Similar" | "Complementary"; notes: string[] } {
      let s = 5;
      const notes: string[] = [];

      // Similarity boosts
      if (p.q2_humor && a.q2_humor && p.q2_humor === a.q2_humor) {
        s += 0.8;
        notes.push("Same humor style");
      }
      if (p.q3_hangout && a.q3_hangout && p.q3_hangout === a.q3_hangout) {
        s += 0.8;
        notes.push("Same hangout vibe");
      }
      if (p.q5_values && a.q5_values && p.q5_values === a.q5_values) {
        s += 0.8;
        notes.push("Aligned values");
      }

      // Complementary boosts (simple rules you asked for: not identical, but good pairings)
      // You can expand this later easily.
      const complementaryHits: string[] = [];

      // Example: Introvert/Extrovert pairing (only if your q1 has those exact options)
      const intro = "Introvert";
      const extro = "Extrovert";
      if (
        (p.q1_personality === intro && a.q1_personality === extro) ||
        (p.q1_personality === extro && a.q1_personality === intro)
      ) {
        s += 0.8;
        complementaryHits.push("Introvert ↔ Extrovert balance");
      }

      // Group role complementary examples (if your q4 options match these)
      const leader = "Leader/Organizer";
      const supporter = "Supportive/Chill";
      if (
        (p.q4_groupRole === leader && a.q4_groupRole === supporter) ||
        (p.q4_groupRole === supporter && a.q4_groupRole === leader)
      ) {
        s += 0.8;
        complementaryHits.push("Leader ↔ Supportive pairing");
      }

      // Decide Similar vs Complementary label
      const similarHits =
        (p.q2_humor === a.q2_humor ? 1 : 0) +
        (p.q3_hangout === a.q3_hangout ? 1 : 0) +
        (p.q5_values === a.q5_values ? 1 : 0);

      let type: "Similar" | "Complementary" = "Similar";
      if (complementaryHits.length > similarHits) type = "Complementary";

      complementaryHits.forEach((t) => notes.push(t));

      // Preference weighting (directional)
      const pPref = prefsByUid[p.uid];
      const aPref = prefsByUid[a.uid];

      const pRank = rankPicked(pPref, a.uid);
      const aRank = rankPicked(aPref, p.uid);

      if (pRank) {
        const boost = pRank === 1 ? 2.0 : pRank === 2 ? 1.2 : 0.6;
        s += boost;
        notes.push(`Pledge ranked Active #${pRank}`);
      }
      if (aRank) {
        const boost = aRank === 1 ? 2.0 : aRank === 2 ? 1.2 : 0.6;
        s += boost;
        notes.push(`Active ranked Pledge #${aRank}`);
      }

      // Mutual bonus
      if (pRank && aRank) {
        s += 0.8;
        notes.push("Mutual preference bonus");
      }

      s = clamp(s, 1, 10);
      return { score: Math.round(s * 10) / 10, type, notes };
    }

    const list: Row[] = [];

    for (const p of pledges) {
      for (const a of actives) {
        const { score, type, notes } = scorePair(p, a);

        const pPref = prefsByUid[p.uid];
        const aPref = prefsByUid[a.uid];
        const pRank = rankPicked(pPref, a.uid);
        const aRank = rankPicked(aPref, p.uid);

        list.push({
          pledge: p,
          active: a,
          score,
          type,
          preferenceText: prefLine(p.displayName, pRank, a.displayName, aRank),
          notes,
        });
      }
    }

    // Filter by minScore
    const filtered = list.filter((r) => r.score >= minScore);

    // Sort
    filtered.sort((x, y) => {
      if (sortMode === "scoreDesc") return y.score - x.score;
      if (sortMode === "pledgeName") return x.pledge.displayName.localeCompare(y.pledge.displayName);
      return x.active.displayName.localeCompare(y.active.displayName);
    });

    return filtered;
  }, [pledges, actives, prefsByUid, minScore, sortMode]);

  if (loading) {
    return (
      <AuthGate>
        <div className="p-8">Loading results…</div>
      </AuthGate>
    );
  }

  if (!adminOk) {
    return (
      <AuthGate>
        <main className="min-h-screen flex items-center justify-center p-8">
          <div className="w-full max-w-xl rounded-2xl border p-8 shadow-sm">
            <h1 className="text-2xl font-bold">Not authorized</h1>
            <p className="mt-2 text-gray-600">Only admins can view match results.</p>
            <button
              onClick={() => router.push("/")}
              className="mt-6 w-full rounded-lg bg-black text-white py-2 font-medium"
            >
              Go Home
            </button>
          </div>
        </main>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <main className="min-h-screen p-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Admin Results</h1>
              <p className="mt-2 text-gray-600">
                Scores are 1–10. Preference lines show exactly who ranked whom.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <div className="rounded-xl border p-3">
                <div className="text-xs text-gray-500">Min score</div>
                <input
                  type="number"
                  min={1}
                  max={10}
                  step={0.1}
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  className="mt-1 w-24 rounded-md border px-2 py-1"
                />
              </div>

              <div className="rounded-xl border p-3">
                <div className="text-xs text-gray-500">Sort</div>
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as any)}
                  className="mt-1 rounded-md border px-2 py-1"
                >
                  <option value="scoreDesc">Score (high → low)</option>
                  <option value="pledgeName">Pledge name</option>
                  <option value="activeName">Active name</option>
                </select>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border overflow-hidden">
            <div className="grid grid-cols-12 gap-0 bg-gray-50 text-xs font-semibold text-gray-600 px-4 py-3">
              <div className="col-span-3">Pledge</div>
              <div className="col-span-3">Active</div>
              <div className="col-span-1">Score</div>
              <div className="col-span-2">Type</div>
              <div className="col-span-3">Preferences</div>
            </div>

            {rows.length === 0 ? (
              <div className="p-6 text-gray-700">No matches meet your current filter.</div>
            ) : (
              rows.map((r, i) => (
                <div
                  key={`${r.pledge.uid}-${r.active.uid}-${i}`}
                  className="grid grid-cols-12 gap-0 px-4 py-3 border-t text-sm items-center"
                >
                  <div className="col-span-3">
                    <div className="font-medium">{r.pledge.displayName}</div>
                  </div>
                  <div className="col-span-3">
                    <div className="font-medium">{r.active.displayName}</div>
                  </div>
                  <div className="col-span-1">
                    <div className="font-semibold">{r.score}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="rounded-full border px-3 py-1 inline-block">
                      {r.type}
                    </div>
                  </div>
                  <div className="col-span-3">
                    <div className="text-xs text-gray-700">{r.preferenceText}</div>
                    {r.notes.length > 0 && (
                      <div className="mt-1 text-[11px] text-gray-500">
                        {r.notes.slice(0, 3).join(" • ")}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 text-sm text-gray-600">
            Next upgrade: a “Build Final Pairings” button that respects 1–2 littles per big and outputs your final list.
          </div>
        </div>
      </main>
    </AuthGate>
  );
}
