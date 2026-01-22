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
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

type Role = "pledge" | "active" | "admin";

type Profile = {
  uid: string;
  role: Role;
  cycleId: string;
  displayName: string;
  photoURL: string;

  q1_personality?: string;
  q2_humor?: string;
  q3_hangout?: string;
  q4_groupRole?: string;
  q5_values?: string;
  q6_about?: string;

  wantsLittle?: boolean | null;
  maxLittles?: number | null;
  maxBigs?: number | null;
};

type PrefDoc = {
  uid: string;
  role: Role;
  cycleId: string;
  first?: string | null;
  second?: string | null;
  third?: string | null;
};

type PairSuggestion = {
  pledgeUid: string;
  pledgeName: string;
  pledgePhoto: string;

  activeUid: string;
  activeName: string;
  activePhoto: string;

  score: number; // 1–10
  label: "Similar" | "Complementary";

  pledgeRank: number | null; // 1..3
  activeRank: number | null; // 1..3
};

type PledgeAssignment = {
  pledgeUid: string;
  pledgeName: string;
  pledgePhoto: string;
  requestedBigs: number; // 1–2
  assigned: PairSuggestion[]; // 1–2 items
};

type BigGroupRow = {
  activeUid: string;
  activeName: string;
  activePhoto: string;
  capacity: number; // 1–2
  assigned: Array<{
    pledgeUid: string;
    pledgeName: string;
    pledgePhoto: string;
    asBigNumberForPledge: 1 | 2; // whether this pledge got them as Big #1 or #2
    score: number;
    label: "Similar" | "Complementary";
    pledgeRank: number | null;
    activeRank: number | null;
  }>;
};

function rankOf(pref: PrefDoc | undefined, targetUid: string): number | null {
  if (!pref) return null;
  if (pref.first === targetUid) return 1;
  if (pref.second === targetUid) return 2;
  if (pref.third === targetUid) return 3;
  return null;
}

function scorePair(p: Profile, a: Profile): { score: number; label: "Similar" | "Complementary" } {
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

  // Similarity
  if (pQ.personality && pQ.personality === aQ.personality) similarity += 2;
  if (pQ.humor && pQ.humor === aQ.humor) similarity += 2;
  if (pQ.hangout && pQ.hangout === aQ.hangout) similarity += 1;
  if (pQ.groupRole && pQ.groupRole === aQ.groupRole) similarity += 1;
  if (pQ.values && pQ.values === aQ.values) similarity += 2;

  // Complement (lightweight rules)
  const personalityCombo =
    (pQ.personality === "Introvert" && aQ.personality === "Extrovert") ||
    (pQ.personality === "Extrovert" && aQ.personality === "Introvert");
  if (personalityCombo) complement += 2;

  const groupRoleCombo =
    (pQ.groupRole === "Leader + organizer" &&
      (aQ.groupRole === "Supportive + chill" || aQ.groupRole === "Connector + brings people together")) ||
    (aQ.groupRole === "Leader + organizer" &&
      (pQ.groupRole === "Supportive + chill" || pQ.groupRole === "Connector + brings people together"));
  if (groupRoleCombo) complement += 2;

  const partyQuietCombo =
    (pQ.groupRole === "Life of the party" && aQ.groupRole === "Quiet observer") ||
    (aQ.groupRole === "Life of the party" && pQ.groupRole === "Quiet observer");
  if (partyQuietCombo) complement += 1;

  const hangoutMixCombo =
    (pQ.hangout === "Chill nights in" && aQ.hangout === "Going out + social") ||
    (aQ.hangout === "Chill nights in" && pQ.hangout === "Going out + social");
  if (hangoutMixCombo) complement += 1;

  // Convert to 1–10
  const base = similarity + complement; // ~0..10
  const score = Math.max(1, Math.min(10, base + 3));
  const label: "Similar" | "Complementary" = complement > similarity ? "Complementary" : "Similar";
  return { score, label };
}

function preferenceBonus(pledgeRank: number | null, activeRank: number | null): number {
  // Mutual
  if (pledgeRank && activeRank) {
    if (pledgeRank === 1 && activeRank === 1) return 6;
    if (pledgeRank <= 2 && activeRank <= 2) return 5;
    return 4;
  }
  // One-sided
  if (pledgeRank === 1 || activeRank === 1) return 3;
  if (pledgeRank || activeRank) return 2;
  return 0;
}

function downloadTextFile(filename: string, contents: string) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Standard CSV (edges)
function toCsv(assignments: PledgeAssignment[], cycleId: string) {
  const header = [
    "cycleId",
    "pledgeName",
    "pledgeUid",
    "requestedBigs",
    "assignedBigIndex",
    "activeName",
    "activeUid",
    "score",
    "label",
    "pledgeRank",
    "activeRank",
  ];
  const rows: string[] = [];
  rows.push(header.join(","));

  for (const a of assignments) {
    if (a.assigned.length === 0) {
      rows.push(
        [
          cycleId,
          `"${a.pledgeName.replaceAll('"', '""')}"`,
          a.pledgeUid,
          a.requestedBigs,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ].join(",")
      );
      continue;
    }

    a.assigned.forEach((s, idx) => {
      rows.push(
        [
          cycleId,
          `"${a.pledgeName.replaceAll('"', '""')}"`,
          a.pledgeUid,
          a.requestedBigs,
          idx + 1,
          `"${s.activeName.replaceAll('"', '""')}"`,
          s.activeUid,
          s.score,
          s.label,
          s.pledgeRank ? `#${s.pledgeRank}` : "",
          s.activeRank ? `#${s.activeRank}` : "",
        ].join(",")
      );
    });
  }
  return rows.join("\n");
}

function preferenceNote(pledgeRank: number | null, activeRank: number | null) {
  const pr = pledgeRank ? `Pledge→Big #${pledgeRank}` : "Pledge→Big none";
  const ar = activeRank ? `Big→Pledge #${activeRank}` : "Big→Pledge none";
  return `${pr}; ${ar}`;
}

// Ceremony CSV (one row per pledge)
function ceremonyCsv(assignments: PledgeAssignment[], cycleId: string) {
  const header = [
    "cycleId",
    "pledgeName",
    "pledgeUid",
    "requestedBigs",
    "big1Name",
    "big1Uid",
    "big1Score",
    "big1Type",
    "big1PreferenceNotes",
    "big2Name",
    "big2Uid",
    "big2Score",
    "big2Type",
    "big2PreferenceNotes",
  ];

  const rows: string[] = [];
  rows.push(header.join(","));

  for (const a of assignments) {
    const b1 = a.assigned[0] ?? null;
    const b2 = a.assigned[1] ?? null;

    const safe = (s: string) => `"${(s ?? "").replaceAll('"', '""')}"`;

    rows.push(
      [
        cycleId,
        safe(a.pledgeName),
        a.pledgeUid,
        a.requestedBigs,

        b1 ? safe(b1.activeName) : "",
        b1 ? b1.activeUid : "",
        b1 ? b1.score : "",
        b1 ? b1.label : "",
        b1 ? safe(preferenceNote(b1.pledgeRank, b1.activeRank)) : "",

        b2 ? safe(b2.activeName) : "",
        b2 ? b2.activeUid : "",
        b2 ? b2.score : "",
        b2 ? b2.label : "",
        b2 ? safe(preferenceNote(b2.pledgeRank, b2.activeRank)) : "",
      ].join(",")
    );
  }

  return rows.join("\n");
}

/**
 * 2-pass assignment:
 * Pass 1: ensure every pledge gets 1 big (if possible)
 * Pass 2: assign 2nd bigs to pledges who requested 2 (if capacity allows)
 */
function generateAssignments(
  pledges: Profile[],
  actives: Profile[],
  prefsByUid: Record<string, PrefDoc>
): PledgeAssignment[] {
  const capacity: Record<string, number> = {};
  for (const a of actives) {
    const cap = typeof a.maxLittles === "number" ? a.maxLittles : 1;
    capacity[a.uid] = Math.max(1, Math.min(2, cap));
  }

  const pledgeNeed: Record<string, number> = {};
  pledges.forEach((p) => {
    const need = typeof p.maxBigs === "number" ? p.maxBigs : 1;
    pledgeNeed[p.uid] = Math.max(1, Math.min(2, need));
  });

  const edges: Array<{
    pledge: Profile;
    active: Profile;
    total: number;
    score: number;
    label: "Similar" | "Complementary";
    pr: number | null;
    ar: number | null;
  }> = [];

  for (const p of pledges) {
    for (const a of actives) {
      const scored = scorePair(p, a);
      const pPref = prefsByUid[p.uid];
      const aPref = prefsByUid[a.uid];
      const pr = rankOf(pPref, a.uid);
      const ar = rankOf(aPref, p.uid);
      const bonus = preferenceBonus(pr, ar);
      edges.push({
        pledge: p,
        active: a,
        total: scored.score + bonus,
        score: scored.score,
        label: scored.label,
        pr,
        ar,
      });
    }
  }

  edges.sort((x, y) => y.total - x.total);

  const assignments: Record<string, PledgeAssignment> = {};
  pledges.forEach((p) => {
    assignments[p.uid] = {
      pledgeUid: p.uid,
      pledgeName: p.displayName,
      pledgePhoto: p.photoURL,
      requestedBigs: pledgeNeed[p.uid],
      assigned: [],
    };
  });

  const alreadyPaired = new Set<string>(); // `${pledgeUid}:${activeUid}`

  function canAssign(pUid: string, aUid: string) {
    if ((capacity[aUid] ?? 0) <= 0) return false;
    const a = assignments[pUid];
    if (!a) return false;
    if (a.assigned.length >= pledgeNeed[pUid]) return false;
    if (alreadyPaired.has(`${pUid}:${aUid}`)) return false;
    return true;
  }

  // PASS 1
  for (const e of edges) {
    const pUid = e.pledge.uid;
    const aUid = e.active.uid;
    const a = assignments[pUid];
    if (!a) continue;
    if (a.assigned.length >= 1) continue;
    if (!canAssign(pUid, aUid)) continue;

    assignments[pUid].assigned.push({
      pledgeUid: e.pledge.uid,
      pledgeName: e.pledge.displayName,
      pledgePhoto: e.pledge.photoURL,
      activeUid: e.active.uid,
      activeName: e.active.displayName,
      activePhoto: e.active.photoURL,
      score: e.score,
      label: e.label,
      pledgeRank: e.pr,
      activeRank: e.ar,
    });

    capacity[aUid] -= 1;
    alreadyPaired.add(`${pUid}:${aUid}`);
  }

  // PASS 2
  for (const e of edges) {
    const pUid = e.pledge.uid;
    const aUid = e.active.uid;
    const a = assignments[pUid];
    if (!a) continue;
    if (pledgeNeed[pUid] < 2) continue;
    if (a.assigned.length >= 2) continue;
    if (!canAssign(pUid, aUid)) continue;

    assignments[pUid].assigned.push({
      pledgeUid: e.pledge.uid,
      pledgeName: e.pledge.displayName,
      pledgePhoto: e.pledge.photoURL,
      activeUid: e.active.uid,
      activeName: e.active.displayName,
      activePhoto: e.active.photoURL,
      score: e.score,
      label: e.label,
      pledgeRank: e.pr,
      activeRank: e.ar,
    });

    capacity[aUid] -= 1;
    alreadyPaired.add(`${pUid}:${aUid}`);
  }

  return Object.values(assignments);
}

function buildGroupedByBig(
  activesPickingUp: Profile[],
  assignments: PledgeAssignment[]
): BigGroupRow[] {
  const bigMap: Record<string, BigGroupRow> = {};

  // init groups
  for (const a of activesPickingUp) {
    bigMap[a.uid] = {
      activeUid: a.uid,
      activeName: a.displayName,
      activePhoto: a.photoURL,
      capacity: typeof a.maxLittles === "number" ? Math.max(1, Math.min(2, a.maxLittles)) : 1,
      assigned: [],
    };
  }

  // fill from pledge assignments
  for (const pa of assignments) {
    pa.assigned.forEach((s, idx) => {
      const group = bigMap[s.activeUid];
      if (!group) return;
      group.assigned.push({
        pledgeUid: s.pledgeUid,
        pledgeName: s.pledgeName,
        pledgePhoto: s.pledgePhoto,
        asBigNumberForPledge: (idx + 1) as 1 | 2,
        score: s.score,
        label: s.label,
        pledgeRank: s.pledgeRank,
        activeRank: s.activeRank,
      });
    });
  }

  // sort by load then name
  const groups = Object.values(bigMap);
  groups.sort((a, b) => {
    const d = b.assigned.length - a.assigned.length;
    if (d !== 0) return d;
    return a.activeName.localeCompare(b.activeName);
  });

  // sort each group's pledges by score desc
  groups.forEach((g) => g.assigned.sort((x, y) => y.score - x.score));

  return groups;
}

export default function AdminMatchmakerPage() {
  const [loading, setLoading] = useState(true);
  const [notAuthorized, setNotAuthorized] = useState(false);

  const [cycleId, setCycleId] = useState<string | null>(null);
  const [pledges, setPledges] = useState<Profile[]>([]);
  const [activesPickingUp, setActivesPickingUp] = useState<Profile[]>([]);
  const [prefsByUid, setPrefsByUid] = useState<Record<string, PrefDoc>>({});

  const [assignments, setAssignments] = useState<PledgeAssignment[]>([]);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [view, setView] = useState<"pledge" | "big">("pledge");

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (!u) {
        setLoading(false);
        return;
      }

      try {
        const meSnap = await getDoc(doc(db, "users", u.uid));
        if (!meSnap.data()?.isAdmin) {
          setNotAuthorized(true);
          setLoading(false);
          return;
        }

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

        const profQ = query(collection(db, "profiles"), where("cycleId", "==", cid));
        const profSnap = await getDocs(profQ);
        const allProfiles = profSnap.docs.map((d) => d.data() as Profile);

        const p = allProfiles.filter((x) => x.role === "pledge");
        const a = allProfiles.filter(
          (x) => (x.role === "active" || x.role === "admin") && x.wantsLittle === true
        );

        const prefQ = query(collection(db, "preferences"), where("cycleId", "==", cid));
        const prefSnap = await getDocs(prefQ);
        const prefMap: Record<string, PrefDoc> = {};
        prefSnap.docs.forEach((d) => {
          const pd = d.data() as PrefDoc;
          prefMap[pd.uid] = pd;
        });

        setPledges(p);
        setActivesPickingUp(a);
        setPrefsByUid(prefMap);

        setLoading(false);
      } catch (e) {
        console.error(e);
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const totals = useMemo(() => {
    const totalSlots = activesPickingUp.reduce(
      (sum, a) => sum + (typeof a.maxLittles === "number" ? a.maxLittles : 1),
      0
    );
    const requestedBigSlots = pledges.reduce(
      (sum, p) => sum + (typeof p.maxBigs === "number" ? Math.max(1, Math.min(2, p.maxBigs)) : 1),
      0
    );
    return { totalSlots, pledgeCount: pledges.length, requestedBigSlots };
  }, [activesPickingUp, pledges]);

  const groupedByBig = useMemo(() => {
    if (assignments.length === 0) return [];
    return buildGroupedByBig(activesPickingUp, assignments);
  }, [activesPickingUp, assignments]);

  function build() {
    setMsg(null);
    const a = generateAssignments(pledges, activesPickingUp, prefsByUid);
    setAssignments(a);

    const assignedEdges = a.reduce((sum, x) => sum + x.assigned.length, 0);
    setMsg(`Generated ${assignedEdges} total big→little links across ${a.length} pledges.`);
  }

  async function saveSuggestedToFirestore() {
    if (!cycleId) return;
    if (assignments.length === 0) return;

    setSaving(true);
    setMsg(null);
    try {
      await setDoc(doc(db, "matches", cycleId), {
        cycleId,
        generatedAt: serverTimestamp(),
        assignments,
      });

      setMsg("Saved suggestions to Firestore ✅ (matches/{cycleId})");
    } catch (e: any) {
      console.error(e);
      setMsg(e?.message ?? "Failed to save to Firestore.");
    } finally {
      setSaving(false);
    }
  }

  async function finalizeMatches() {
    if (!cycleId) return;
    if (assignments.length === 0) {
      setMsg("Generate suggestions first.");
      return;
    }

    const ok = window.confirm(
      "Finalize these matches?\n\nThis will write finalMatches/{cycleId} as the official results."
    );
    if (!ok) return;

    setFinalizing(true);
    setMsg(null);

    try {
      await setDoc(doc(db, "finalMatches", cycleId), {
        cycleId,
        finalizedAt: serverTimestamp(),
        assignments,
      });

      setMsg("Finalized ✅ Saved to finalMatches/{cycleId}.");
    } catch (e: any) {
      console.error(e);
      setMsg(e?.message ?? "Failed to finalize.");
    } finally {
      setFinalizing(false);
    }
  }

  function exportEdgesCsv() {
    if (!cycleId) return;
    const csv = toCsv(assignments, cycleId);
    downloadTextFile(`matches_edges_${cycleId}.csv`, csv);
  }

  function exportCeremonyRoster() {
    if (!cycleId) return;
    const csv = ceremonyCsv(assignments, cycleId);
    downloadTextFile(`ceremony_roster_${cycleId}.csv`, csv);
  }

  if (loading) {
    return (
      <AuthGate>
        <div className="p-8">Loading matchmaker…</div>
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
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Matchmaker</h1>
              <p className="mt-2 text-gray-600">
                Cycle: <span className="font-mono">{cycleId}</span>
              </p>
              <p className="mt-1 text-sm text-gray-500">
                Supports 1–2 bigs per pledge + 1–2 littles per big.
              </p>
            </div>
            <div className="rounded-xl border px-3 py-2 text-xs text-gray-700">Admin</div>
          </div>

          <div className="mt-6 rounded-2xl border p-4 space-y-1">
            <div className="text-sm text-gray-700">
              Pledges: <span className="font-semibold">{totals.pledgeCount}</span>
            </div>
            <div className="text-sm text-gray-700">
              Total active pickup slots (capacity): <span className="font-semibold">{totals.totalSlots}</span>
            </div>
            <div className="text-sm text-gray-700">
              Total requested big slots (from pledges): <span className="font-semibold">{totals.requestedBigSlots}</span>
            </div>
            {totals.totalSlots < totals.pledgeCount && (
              <div className="text-sm text-amber-700">⚠ Not enough actives to give every pledge even 1 big.</div>
            )}
            {totals.totalSlots < totals.requestedBigSlots && totals.totalSlots >= totals.pledgeCount && (
              <div className="text-sm text-amber-700">
                ⚠ Enough for everyone to get 1 big, but not enough for all requested second bigs.
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={build} className="rounded-lg bg-black text-white px-4 py-2 font-medium">
              Generate suggestions
            </button>

            <button
              onClick={saveSuggestedToFirestore}
              disabled={saving || assignments.length === 0}
              className="rounded-lg border px-4 py-2 font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save suggestions"}
            </button>

            <button
              onClick={exportEdgesCsv}
              disabled={assignments.length === 0}
              className="rounded-lg border px-4 py-2 font-medium disabled:opacity-50"
            >
              Export edges CSV
            </button>

            <button
              onClick={exportCeremonyRoster}
              disabled={assignments.length === 0}
              className="rounded-lg border px-4 py-2 font-medium disabled:opacity-50"
            >
              Download ceremony roster (CSV)
            </button>

            <button
              onClick={finalizeMatches}
              disabled={finalizing || assignments.length === 0}
              className="rounded-lg bg-emerald-600 text-white px-4 py-2 font-medium disabled:opacity-50"
            >
              {finalizing ? "Finalizing…" : "Finalize Matches"}
            </button>
          </div>

          {msg && <div className="mt-4 rounded-xl border p-3 text-sm text-gray-700">{msg}</div>}

          <div className="mt-6 flex gap-2">
            <button
              onClick={() => setView("pledge")}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                view === "pledge" ? "bg-black text-white" : ""
              }`}
            >
              View by pledge
            </button>
            <button
              onClick={() => setView("big")}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                view === "big" ? "bg-black text-white" : ""
              }`}
              disabled={assignments.length === 0}
              title={assignments.length === 0 ? "Generate suggestions first" : ""}
            >
              View by big
            </button>
          </div>

          <div className="mt-6 space-y-4">
            {assignments.length === 0 ? (
              <div className="rounded-2xl border p-6 text-gray-700">
                Click <span className="font-semibold">Generate suggestions</span>.
              </div>
            ) : view === "pledge" ? (
              assignments.map((a) => (
                <div key={a.pledgeUid} className="rounded-2xl border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={a.pledgePhoto}
                        className="h-12 w-12 rounded-xl object-cover border"
                        alt={a.pledgeName}
                      />
                      <div>
                        <div className="font-semibold">
                          {a.pledgeName} (Pledge)
                          <span className="ml-2 text-xs text-gray-600">
                            wants {a.requestedBigs} big{a.requestedBigs === 2 ? "s" : ""}
                          </span>
                        </div>
                        <div className="text-xs text-gray-600">{a.pledgeUid}</div>
                      </div>
                    </div>

                    <div className="text-xs text-gray-500">
                      Assigned: {a.assigned.length}/{a.requestedBigs}
                    </div>
                  </div>

                  {a.assigned.length === 0 ? (
                    <div className="mt-3 text-sm text-amber-700">No big assigned (capacity shortage or no profiles).</div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {a.assigned.map((s, idx) => (
                        <div key={`${s.activeUid}-${idx}`} className="rounded-xl border p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold">Big #{idx + 1}</div>
                            <div className="text-sm">
                              <span className="font-bold">{s.score}/10</span> • {s.label}
                            </div>
                          </div>

                          <div className="mt-2 flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                              <img
                                src={s.activePhoto}
                                className="h-10 w-10 rounded-xl object-cover border"
                                alt={s.activeName}
                              />
                              <div>
                                <div className="font-semibold">{s.activeName} (Active)</div>
                                <div className="text-xs text-gray-600">{s.activeUid}</div>
                              </div>
                            </div>

                            <div className="text-xs text-gray-600 text-right">
                              Pledge→Active: {s.pledgeRank ? `#${s.pledgeRank}` : "none"} <br />
                              Active→Pledge: {s.activeRank ? `#${s.activeRank}` : "none"}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            ) : (
              // VIEW BY BIG
              groupedByBig.map((g) => (
                <div key={g.activeUid} className="rounded-2xl border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <img
                        src={g.activePhoto}
                        className="h-12 w-12 rounded-xl object-cover border"
                        alt={g.activeName}
                      />
                      <div>
                        <div className="font-semibold">
                          {g.activeName} (Active)
                          <span className="ml-2 text-xs text-gray-600">
                            capacity {g.capacity} • assigned {g.assigned.length}
                          </span>
                        </div>
                        <div className="text-xs text-gray-600">{g.activeUid}</div>
                      </div>
                    </div>

                    <div className="text-xs text-gray-600">
                      {g.assigned.length > g.capacity ? (
                        <span className="text-red-700 font-semibold">Over capacity</span>
                      ) : (
                        <span className="text-green-700 font-semibold">OK</span>
                      )}
                    </div>
                  </div>

                  {g.assigned.length === 0 ? (
                    <div className="mt-3 text-sm text-gray-600">No pledges assigned.</div>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {g.assigned.map((p) => (
                        <div key={`${g.activeUid}-${p.pledgeUid}`} className="rounded-xl border p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <img
                                src={p.pledgePhoto}
                                className="h-10 w-10 rounded-xl object-cover border"
                                alt={p.pledgeName}
                              />
                              <div>
                                <div className="font-semibold">
                                  {p.pledgeName} (Pledge){" "}
                                  <span className="text-xs text-gray-600">
                                    — you are their Big #{p.asBigNumberForPledge}
                                  </span>
                                </div>
                                <div className="text-xs text-gray-600">{p.pledgeUid}</div>
                              </div>
                            </div>

                            <div className="text-xs text-gray-700 text-right">
                              <div>
                                <span className="font-bold">{p.score}/10</span> • {p.label}
                              </div>
                              <div className="text-gray-600">
                                {preferenceNote(p.pledgeRank, p.activeRank)}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="mt-6 text-xs text-gray-500">
            Suggested output: <span className="font-mono">matches/{cycleId}</span> • Final output:{" "}
            <span className="font-mono">finalMatches/{cycleId}</span>
          </div>
        </div>
      </main>
    </AuthGate>
  );
}
