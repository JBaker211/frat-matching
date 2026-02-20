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
  orderBy,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/navigation";

type Role = "pledge" | "active" | "admin";

type CycleProfile = {
  uid: string;
  role: Role;
  cycleId: string;
  displayName: string;
  photoURL?: string;
};

export default function PreferencesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [cycleId, setCycleId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<Role | null>(null);

  const [options, setOptions] = useState<CycleProfile[]>([]);
  const [rank1, setRank1] = useState<string>("");
  const [rank2, setRank2] = useState<string>("");
  const [rank3, setRank3] = useState<string>("");

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Prevent duplicate selections by filtering available options per dropdown
  const selected = useMemo(() => [rank1, rank2, rank3].filter(Boolean), [rank1, rank2, rank3]);

  const rankings = useMemo(() => {
    // Preserve order, remove blanks, remove duplicates
    const raw = [rank1, rank2, rank3].filter(Boolean);
    const unique: string[] = [];
    for (const uid of raw) {
      if (!unique.includes(uid)) unique.push(uid);
    }
    return unique;
  }, [rank1, rank2, rank3]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setLoading(false);
        return;
      }

      try {
        setErrorMsg(null);
        setStatusMsg(null);

        // 1) Load current cycleId
        const settingsSnap = await getDoc(doc(db, "settings", "global"));
        const currentCycleId = settingsSnap.exists()
          ? (settingsSnap.data()?.currentCycleId as string | undefined)
          : undefined;

        if (!currentCycleId) {
          setCycleId(null);
          setErrorMsg("Admin has not set the current cycle yet.");
          setLoading(false);
          return;
        }

        setCycleId(currentCycleId);

        // 2) Load my cycle profile to determine role
        const myProfileRef = doc(db, "cycles", currentCycleId, "profiles", u.uid);
        const myProfileSnap = await getDoc(myProfileRef);

        if (!myProfileSnap.exists()) {
          setErrorMsg("You must complete onboarding before submitting preferences.");
          setLoading(false);
          return;
        }

        const myProfile = myProfileSnap.data() as CycleProfile;
        const role = myProfile.role;
        setMyRole(role);

        // 3) Determine target role (who you should rank)
        // Pledges rank actives; Actives/Admin rank pledges
        const targetRole: Role = role === "pledge" ? "active" : "pledge";

        // 4) Fetch target profiles for this cycle
        const profilesRef = collection(db, "cycles", currentCycleId, "profiles");
        const qRef = query(profilesRef, where("role", "==", targetRole), orderBy("displayName"));

        const snap = await getDocs(qRef);
        const list = snap.docs.map((d) => d.data() as CycleProfile);

        setOptions(list);

        // 5) If they've already submitted preferences, prefill (optional but helpful)
        const prefRef = doc(db, "cycles", currentCycleId, "preferences", u.uid);
        const prefSnap = await getDoc(prefRef);
        if (prefSnap.exists()) {
          const data = prefSnap.data() as any;
          const existing: string[] = Array.isArray(data.rankings) ? data.rankings : [];
          setRank1(existing[0] ?? "");
          setRank2(existing[1] ?? "");
          setRank3(existing[2] ?? "");
          setStatusMsg("Loaded your saved preferences.");
        }

        setLoading(false);
      } catch (e: any) {
        console.error(e);
        setErrorMsg(e?.message ?? "Failed to load preferences.");
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  function nameFor(uid: string) {
    const p = options.find((x) => x.uid === uid);
    return p ? p.displayName : uid;
  }

  async function handleSubmit() {
    setErrorMsg(null);
    setStatusMsg(null);

    const u = auth.currentUser;
    if (!u) {
      setErrorMsg("Not signed in.");
      return;
    }
    if (!cycleId) {
      setErrorMsg("No current cycle set.");
      return;
    }
    if (!myRole) {
      setErrorMsg("Could not determine your role.");
      return;
    }

    // Allow fewer than 3, but require at least 1
    if (rankings.length === 0) {
      setErrorMsg("Please choose at least 1 preference.");
      return;
    }

    setSaving(true);
    try {
      const prefRef = doc(db, "cycles", cycleId, "preferences", u.uid);

      // Keep Firestore shape stable: rankings is UID array.
      await setDoc(
        prefRef,
        {
          uid: u.uid,
          role: myRole,
          cycleId,
          rankings, // <-- UIDs (matchmaker stays happy)
          // Optional: store readable names too (doesn't break anything)
          rankingNames: rankings.map((id) => nameFor(id)),
          submittedAt: serverTimestamp(),
        },
        { merge: true } // allows resubmission if your rules permit it
      );

      setStatusMsg("Saved ✅");
      router.push("/results");
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message ?? "Failed to save preferences.");
    } finally {
      setSaving(false);
    }
  }

  // options filtered so you can't pick the same person twice
  function filteredOptions(exceptUid: string) {
    const used = new Set(selected.filter((x) => x !== exceptUid));
    return options.filter((p) => !used.has(p.uid));
  }

  if (loading) {
    return (
      <AuthGate>
        <div className="p-8">Loading preferences…</div>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-2xl border p-8 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Preferences</h1>
              <p className="mt-2 text-gray-600">
                Pick up to <span className="font-semibold">3</span> people in order (1st → 3rd).
              </p>
              <p className="mt-1 text-sm text-gray-500">
                Current cycle: <span className="font-medium">{cycleId ?? "Not set"}</span>
              </p>
            </div>
            <div className="rounded-xl border px-3 py-2 text-xs text-gray-700">
              Role: <span className="font-semibold">{myRole ?? "?"}</span>
            </div>
          </div>

          {options.length === 0 ? (
            <div className="mt-6 rounded-xl border p-4">
              <div className="font-semibold">No one to choose yet</div>
              <p className="mt-1 text-sm text-gray-600">
                Once the other group completes onboarding, they’ll show up here.
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              <RankSelect
                label="1st choice"
                value={rank1}
                onChange={setRank1}
                options={filteredOptions(rank1)}
              />
              <RankSelect
                label="2nd choice"
                value={rank2}
                onChange={setRank2}
                options={filteredOptions(rank2)}
              />
              <RankSelect
                label="3rd choice"
                value={rank3}
                onChange={setRank3}
                options={filteredOptions(rank3)}
              />
            </div>
          )}

          {statusMsg && (
            <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              {statusMsg}
            </div>
          )}

          {errorMsg && (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {errorMsg}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={saving || options.length === 0}
            className="mt-6 w-full rounded-lg bg-black text-white py-3 font-semibold disabled:opacity-50"
          >
            {saving ? "Saving…" : "Submit Preferences"}
          </button>

          <p className="mt-3 text-xs text-gray-500">
            Your selections are saved as internal IDs, but you only see names here.
          </p>
        </div>
      </main>
    </AuthGate>
  );
}

function RankSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: CycleProfile[];
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border px-3 py-2"
      >
        <option value="">(No selection)</option>
        {options.map((p) => (
          <option value={p.uid} key={p.uid}>
            {p.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
