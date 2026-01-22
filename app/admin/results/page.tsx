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

type Role = "pledge" | "active" | "admin";

type Profile = {
  uid: string;
  role: Role;
  cycleId: string;
  displayName: string;
  photoURL: string;

  // Q1-6
  q1_personality?: string;
  q2_humor?: string;
  q3_hangout?: string;
  q4_groupRole?: string;
  q5_values?: string;
  q6_about?: string;

  // actives gate (optional)
  wantsLittle?: boolean | null;
  maxLittles?: number | null;
};

type PrefDoc = {
  uid: string;
  role: Role;
  cycleId: string;
  first?: string | null;
  second?: string | null;
  third?: string | null;
};

type PairRow = {
  pledge: Profile;
  active: Profile;
  score: number; // 1-10
  label: "Similar" | "Complementary";
  why: string[];
  prefNote: string; // "Pledge ranked Active: #1; Active ranked Pledge: none"
};

function rankOf(pref: PrefDoc | undefined, targetUid: string): number | null {
  if (!pref) return null;
  if (pref.first === targetUid) return 1;
  if (pref.second === targetUid) return 2;
  if (pref.third === targetUid) return 3;
  return null;
}

/**
 * Balanced similarity + complement rules:
 * - Similar points: same Q answers (personality/humor/hangout/groupRole/values)
 * - Complement points: known “pair well” combos (introvert+extrovert, leader+supportive, etc.)
 * We keep it simple and stable.
 */
function scorePair(p: Profile, a: Profile): { score: number; label: "Similar" | "Complementary"; why: string[] } {
  const why: string[] = [];
  let similarity = 0;
  let complement = 0;

  const pQ = {
    personality: p.q1_personality ?? "",
    humor: p.q2_humor ?? "",
    hangout: p.q3_hangout ?? "",
    groupRole: p.q4_groupRole ?? "",
    values: p.q5_values ?? "",
  };
  const aQ = {
    personality: a.q1_personality ?? "",
    humor: a.q2_humor ?? "",
    hangout: a.q3_hangout ?? "",
    groupRole: a.q4_groupRole ?? "",
    values: a.q5_values ?? "",
  };

  // Similarity rules
  if (pQ.personality && pQ.personality === aQ.personality) { similarity += 2; why.push("Same personality style"); }
  if (pQ.humor && pQ.humor === aQ.humor) { similarity += 2; why.push("Same humor vibe"); }
  if (pQ.hangout && pQ.hangout === aQ.hangout) { similarity += 1; why.push("Same hangout style"); }
  if (pQ.groupRole && pQ.groupRole === aQ.groupRole) { similarity += 1; why.push("Similar group energy"); }
  if (pQ.values && pQ.values === aQ.values) { similarity += 2; why.push("Shared core value"); }

  // Complement rules (lightweight + realistic)
  const personalityCombo =
    (pQ.personality === "Introvert" && aQ.personality === "Extrovert") ||
    (pQ.personality === "Extrovert" && aQ.personality === "Introvert");
  if (personalityCombo) { complement += 2; why.push("Introvert + Extrovert balance"); }

  const groupRoleCombo =
    (pQ.groupRole === "Leader/Organizer" && (aQ.groupRole === "Supportive/Chill" || aQ.groupRole === "Connector / brings people together")) ||
    (aQ.groupRole === "Leader/Organizer" && (pQ.groupRole === "Supportive/Chill" || pQ.groupRole === "Connector / brings people together"));
  if (groupRoleCombo) { complement += 2; why.push("Leader + supporter/connector balance"); }

  const partyQuietCombo =
    (pQ.groupRole === "Life of the party" && aQ.groupRole === "Quiet observer") ||
    (aQ.groupRole === "Life of the party" && pQ.groupRole === "Quiet observer");
  if (partyQuietCombo) { complement += 1; why.push("Hype + grounded pairing"); }

  const hangoutMixCombo =
    (pQ.hangout === "Chill nights in" && aQ.hangout === "Going out / social") ||
    (aQ.hangout === "Chill nights in" && pQ.hangout === "Going out / social");
  if (hangoutMixCombo) { complement += 1; why.push("Chill + social mix"); }

  // Base score from traits
  let base = similarity + complement;

  // Normalize to 1–10 (simple + stable)
  // base range approx 0..10. We'll clamp and then shift.
  let score = Math.max(1, Math.min(10, base + 3));

  const label: "Similar" | "Complementary" =
    complement > similarity ? "Complementary" : "Similar";

  return { score, label, why: why.slice(0, 3) };
}

export default function AdminResultsPage() {
  const [loading, setLoading] = useState(true);
  const [notAuthorized, setNotAuthorized] = useState(false);

  const [cycleId, setCycleId] = useState<string | null>(null);

  const [pledges, setPledges] = useState<Profile[]>([]);
  const [actives, setActives] = useState<Profile[]>([]);
  const [prefsByUid, setPrefsByUid] = useState<Record<string, PrefDoc>>({});

  // filters
  const [minScore, setMinScore] = useState(7);
  const [onlyMutual, setOnlyMutual] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (!u) {
        setLoading(false);
        return;
      }

      try {
        // confirm admin
        const meSnap = await getDoc(doc(db, "users", u.uid));
        if (!meSnap.data()?.isAdmin) {
          setNotAuthorized(true);
          setLoading(false);
          return;
        }

        // load cycleId
        const settingsSnap = await getDoc(doc(db, "settings", "global"));
        const cid = settingsSnap.exists()
          ? (settingsSnap.data()?.currentCycleId as string | undefined)
          : undefined;
        if (!cid) {
          setCycleId(null);
          setLoading(false);
          return;
        }
        setCycleId(cid);

        // load profiles for this cycle
        const profQ = query(collection(db, "profiles"), where("cycleId", "==", cid));
        const profSnap = await getDocs(profQ);
        const allProfiles = profSnap.docs.map((d) => d.data() as Profile);

        const p = allProfiles.filter((x) => x.role === "pledge");
        const a = allProfiles.filter((x) => x.role === "active" || x.role === "admin");

        // load preferences for this cycle
        const prefQ = query(collection(db, "preferences"), where("cycleId", "==", cid));
        const prefSnap = await getDocs(prefQ);
        const prefMap: Record<string, PrefDoc> = {};
        prefSnap.docs.forEach((d) => {
          const pd = d.data() as PrefDoc;
          prefMap[pd.uid] = pd;
        });

        setPledges(p);
        setActives(a);
        setPrefsByUid(prefMap);

        setLoading(false);
      } catch (e) {
        console.error(e);
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const rows: PairRow[] = useMemo(() => {
    const list: PairRow[] = [];

    const s = search.trim().toLowerCase();

    for (const pledge of pledges) {
      for (const active of actives) {
        // optional search filter early
        if (s) {
          const hay = `${pledge.displayName} ${active.displayName}`.toLowerCase();
          if (!hay.includes(s)) continue;
        }

        const scored = scorePair(pledge, active);

        const pledgePref = prefsByUid[pledge.uid];
        const activePref = prefsByUid[active.uid];

        const pledgeRank = rankOf(pledgePref, active.uid);
        const activeRank = rankOf(activePref, pledge.uid);

        // preference note with "who said what"
        const pledgeNote = pledgeRank ? `Pledge ranked Active: #${pledgeRank}` : `Pledge ranked Active: none`;
        const activeNote = activeRank ? `Active ranked Pledge: #${activeRank}` : `Active ranked Pledge: none`;
        const prefNote = `${pledgeNote}; ${activeNote}`;

        const mutual = !!pledgeRank && !!activeRank;

        if (onlyMutual && !mutual) continue;
        if (scored.score < minScore) continue;

        list.push({
          pledge,
          active,
          score: scored.score,
          label: scored.label,
          why: scored.why,
          prefNote,
        });
      }
    }

    // Sort: mutual-ish first (by sum of ranks), then score desc
    list.sort((r1, r2) => r2.score - r1.score);

    return list;
  }, [pledges, actives, prefsByUid, minScore, onlyMutual, search]);

  if (loading) {
    return (
      <AuthGate>
        <div className="p-8">Loading results…</div>
      </AuthGate>
    );
  }

  if (notAuthorized) {
    return (
      <AuthGate>
        <div className="p-8">
          <div className="text-xl font-bold">Not authorized</div>
          <p className="mt-2 text-gray-600">This page is admin-only.</p>
        </div>
      </AuthGate>
    );
  }

  if (!cycleId) {
    return (
      <AuthGate>
        <div className="p-8">
          <div className="text-xl font-bold">No cycle set</div>
          <p className="mt-2 text-gray-600">
            Set <span className="font-mono">settings/global.currentCycleId</span> in /admin first.
          </p>
        </div>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <main className="min-h-screen p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold">Admin Results</h1>
              <p className="mt-2 text-gray-600">
                Cycle: <span className="font-mono">{cycleId}</span>
              </p>
              <p className="mt-1 text-sm text-gray-500">
                Showing scored pledge ↔ active pairs. You decide final matches.
              </p>
            </div>
            <div className="rounded-xl border px-3 py-2 text-xs text-gray-700">Admin</div>
          </div>

          {/* Filters */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-3 rounded-2xl border p-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Min score</label>
              <select
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border px-3 py-2"
              >
                {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n}+
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={onlyMutual}
                  onChange={(e) => setOnlyMutual(e.target.checked)}
                />
                Only mutual preferences
              </label>
            </div>

            <div className="md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Search</label>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2"
                placeholder="Search by name…"
              />
            </div>
          </div>

          {/* Results */}
          <div className="mt-6 space-y-4">
            {rows.length === 0 ? (
              <div className="rounded-2xl border p-6 text-gray-700">
                No pairs match your filters yet.
              </div>
            ) : (
              rows.slice(0, 60).map((r) => (
                <div key={`${r.pledge.uid}-${r.active.uid}`} className="rounded-2xl border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <img
                        src={r.pledge.photoURL}
                        className="h-14 w-14 rounded-xl object-cover border"
                        alt={r.pledge.displayName}
                      />
                      <div>
                        <div className="font-semibold">{r.pledge.displayName} (Pledge)</div>
                        <div className="text-xs text-gray-600">{r.pledge.uid}</div>
                      </div>
                    </div>

                    <div className="text-2xl font-bold">{r.score}/10</div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-semibold">{r.active.displayName} (Active)</div>
                        <div className="text-xs text-gray-600">{r.active.uid}</div>
                      </div>
                      <img
                        src={r.active.photoURL}
                        className="h-14 w-14 rounded-xl object-cover border"
                        alt={r.active.displayName}
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full border px-3 py-1 text-sm">
                      {r.label}
                    </span>
                    {r.why.map((w) => (
                      <span key={w} className="rounded-full border px-3 py-1 text-sm text-gray-700">
                        {w}
                      </span>
                    ))}
                  </div>

                  <div className="mt-3 text-sm text-gray-700">
                    <span className="font-medium">Preferences:</span> {r.prefNote}
                  </div>
                </div>
              ))
            )}
          </div>

          {rows.length > 60 && (
            <div className="mt-4 text-xs text-gray-500">
              Showing first 60 rows for speed. Tighten filters to narrow down.
            </div>
          )}
        </div>
      </main>
    </AuthGate>
  );
}
