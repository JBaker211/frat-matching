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
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useRouter } from "next/navigation";

type Role = "pledge" | "active" | "admin";

type ProfileOption = {
  uid: string;
  displayName: string;
  role: Role;
  cycleId: string;
};

export default function PreferencesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [cycleId, setCycleId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<Role | null>(null);

  const [options, setOptions] = useState<ProfileOption[]>([]);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);

  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [third, setThird] = useState("");

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // IMPORTANT: Wait for Firebase to finish restoring auth
    const unsub = auth.onAuthStateChanged(async (u) => {
      setErrorMsg(null);

      if (!u) {
        setLoading(false);
        return;
      }

      try {
        // 1) Load settings/global
        const settingsSnap = await getDoc(doc(db, "settings", "global"));
        const settings = settingsSnap.exists() ? (settingsSnap.data() as any) : {};

        const prefEnabled = !!settings?.preferencesEnabled;
        const cid = (settings?.currentCycleId as string | undefined) ?? null;

        setEnabled(prefEnabled);
        setCycleId(cid);

        // If prefs not enabled, stop here (but still finish loading)
        if (!prefEnabled) {
          setLoading(false);
          return;
        }

        if (!cid) {
          setErrorMsg("Admin hasn’t set a current cycle yet (settings/global.currentCycleId).");
          setLoading(false);
          return;
        }

        // 2) Load my role
        const meSnap = await getDoc(doc(db, "users", u.uid));
        const me = meSnap.exists() ? (meSnap.data() as any) : {};
        const role = (me?.role as Role | undefined) ?? null;

        setMyRole(role);

        if (!role) {
          setErrorMsg("Your role is not set. Please go to /role first.");
          setLoading(false);
          return;
        }

        // 3) Check if I already submitted preferences
        const prefSnap = await getDoc(doc(db, "preferences", u.uid));
        if (prefSnap.exists()) {
          setAlreadySubmitted(true);
          setLoading(false);
          return;
        }

        // 4) Determine target role (pledges pick actives; actives pick pledges)
        const targetRole: Role = role === "pledge" ? "active" : "pledge";

        // 5) Fetch eligible profiles (opposite role + same cycle)
        const qRef = query(
          collection(db, "profiles"),
          where("cycleId", "==", cid),
          where("role", "==", targetRole)
        );

        const snap = await getDocs(qRef);

        const list = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            uid: data.uid,
            displayName: data.displayName ?? "(No name)",
            role: data.role,
            cycleId: data.cycleId,
          } as ProfileOption;
        });

        // Sort by name so dropdown is nice
        list.sort((a, b) => a.displayName.localeCompare(b.displayName));

        setOptions(list);
        setLoading(false);
      } catch (e: any) {
        console.error(e);
        setErrorMsg(e?.message ?? "Failed to load preferences.");
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const canSubmit = useMemo(() => {
    // You can submit with 0-3 picks, but duplicates are not allowed
    const picks = [first, second, third].filter(Boolean);
    return new Set(picks).size === picks.length;
  }, [first, second, third]);

  async function submit() {
    setErrorMsg(null);

    const u = auth.currentUser;
    if (!u) {
      setErrorMsg("Not signed in.");
      return;
    }

    if (!enabled) {
      setErrorMsg("Preferences are not open yet.");
      return;
    }

    if (!cycleId) {
      setErrorMsg("No cycle is set.");
      return;
    }

    if (!myRole) {
      setErrorMsg("Your role is missing.");
      return;
    }

    if (!canSubmit) {
      setErrorMsg("You can’t pick the same person more than once.");
      return;
    }

    setSubmitting(true);

    try {
      await setDoc(doc(db, "preferences", u.uid), {
        uid: u.uid,
        role: myRole,
        cycleId,
        first: first || null,
        second: second || null,
        third: third || null,
        createdAt: serverTimestamp(),
      });

      router.push("/browse");
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message ?? "Failed to submit preferences.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <AuthGate>
        <div className="p-8">Loading preferences…</div>
      </AuthGate>
    );
  }

  // If admin hasn't opened it yet
  if (!enabled) {
    return (
      <AuthGate>
        <div className="p-8">
          Preferences are not open yet. Check back later.
        </div>
      </AuthGate>
    );
  }

  if (alreadySubmitted) {
    return (
      <AuthGate>
        <div className="p-8">
          You’ve already submitted your preferences. Thank you!
        </div>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-2xl border p-8 shadow-sm">
          <h1 className="text-2xl font-bold">Top 3 Preferences</h1>
          <p className="mt-2 text-gray-600">
            Rank up to three people you’d most like to be paired with.
          </p>

          <div className="mt-2 text-xs text-gray-500">
            Cycle: <span className="font-mono">{cycleId}</span>
          </div>

          {options.length === 0 ? (
            <div className="mt-6 rounded-xl border p-4">
              <div className="font-semibold">No options yet</div>
              <p className="mt-1 text-sm text-gray-600">
                The opposite role hasn’t created profiles for this cycle yet.
              </p>
            </div>
          ) : (
            <>
              <Select label="1st choice" value={first} setValue={setFirst} options={options} />
              <Select label="2nd choice" value={second} setValue={setSecond} options={options} />
              <Select label="3rd choice" value={third} setValue={setThird} options={options} />

              {!canSubmit && (
                <div className="mt-4 text-sm text-red-600">
                  You can’t pick the same person more than once.
                </div>
              )}

              <button
                onClick={submit}
                disabled={!canSubmit || submitting}
                className="mt-6 w-full rounded-lg bg-black text-white py-3 font-semibold disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "Submit Preferences"}
              </button>
            </>
          )}

          {errorMsg && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {errorMsg}
            </div>
          )}

          <div className="mt-4 text-xs text-gray-500">
            After submitting, you’ll be returned to <span className="font-mono">/browse</span>.
          </div>
        </div>
      </main>
    </AuthGate>
  );
}

function Select({
  label,
  value,
  setValue,
  options,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  options: { uid: string; displayName: string }[];
}) {
  return (
    <div className="mt-4">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="mt-1 w-full rounded-lg border px-3 py-2"
      >
        <option value="">None</option>
        {options.map((o) => (
          <option key={o.uid} value={o.uid}>
            {o.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
