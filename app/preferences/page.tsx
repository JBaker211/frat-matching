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
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { useRouter } from "next/navigation";

type Role = "pledge" | "active" | "admin";

type Profile = {
  uid: string;
  role: Role;
  cycleId: string;
  displayName: string;
  photoURL: string;
};

export default function PreferencesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [currentCycleId, setCurrentCycleId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<Role | null>(null);

  const [options, setOptions] = useState<Profile[]>([]);

  // ranked top 3
  const [pick1, setPick1] = useState<string>("");
  const [pick2, setPick2] = useState<string>("");
  const [pick3, setPick3] = useState<string>("");

  const pickSet = useMemo(() => new Set([pick1, pick2, pick3].filter(Boolean)), [pick1, pick2, pick3]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      const u = auth.currentUser;
      if (!u) {
        setLoading(false);
        return;
      }

      try {
        // 1) cycle id
        const settingsSnap = await getDoc(doc(db, "settings", "global"));
        const cid = settingsSnap.exists()
          ? (settingsSnap.data()?.currentCycleId as string | undefined)
          : undefined;

        const cycleId = cid ?? null;
        if (!cycleId) {
          throw new Error("Admin has not set settings/global.currentCycleId yet.");
        }
        if (cancelled) return;
        setCurrentCycleId(cycleId);

        // 2) my role from users/{uid}
        const meSnap = await getDoc(doc(db, "users", u.uid));
        const me = meSnap.exists() ? (meSnap.data() as any) : null;
        const role: Role | null = (me?.role as Role | undefined) ?? null;
        if (!role) throw new Error("Your role is missing. Go to /role and select your role.");
        if (cancelled) return;
        setMyRole(role);

        // 3) confirm my profile exists in this cycle (this also satisfies your rules logic)
        const myProfileRef = doc(db, "cycles", cycleId, "profiles", u.uid);
        const myProfileSnap = await getDoc(myProfileRef);
        if (!myProfileSnap.exists()) {
          // if they haven't completed onboarding for this cycle, they shouldn't be here
          router.push("/onboarding");
          return;
        }

        // 4) decide who they can pick
        // pledges pick actives; actives pick pledges
        // admin: treat like active (picks pledges) unless you want otherwise
        let targetRole: Role = "active";
        if (role === "pledge") targetRole = "active";
        if (role === "active" || role === "admin") targetRole = "pledge";

        // 5) query profiles from the *cycle* collection
        const profilesRef = collection(db, "cycles", cycleId, "profiles");
        const qRef = query(profilesRef, where("role", "==", targetRole));
        const snap = await getDocs(qRef);

        const list: Profile[] = snap.docs.map((d) => d.data() as Profile);

        if (cancelled) return;
        setOptions(list);
        setLoading(false);
      } catch (e: any) {
        console.error(e);
        if (cancelled) return;
        setErrorMsg(e?.message ?? "Failed to load preferences options.");
        setLoading(false);
      }
    }

    const unsub = auth.onAuthStateChanged(() => load());

    return () => {
      cancelled = true;
      unsub();
    };
  }, [router]);

  function validate() {
    if (!pick1 && !pick2 && !pick3) {
      return "Pick at least one preference.";
    }
    if (pickSet.size !== [pick1, pick2, pick3].filter(Boolean).length) {
      return "Don’t pick the same person more than once.";
    }
    return null;
  }

  async function handleSubmit() {
    setErrorMsg(null);
    setSuccessMsg(null);

    const u = auth.currentUser;
    if (!u) {
      setErrorMsg("Not signed in.");
      return;
    }
    if (!currentCycleId) {
      setErrorMsg("Current cycle not set.");
      return;
    }

    const v = validate();
    if (v) {
      setErrorMsg(v);
      return;
    }

    setSaving(true);
    try {
      const prefRef = doc(db, "cycles", currentCycleId, "preferences", u.uid);

      await setDoc(
        prefRef,
        {
          uid: u.uid,
          cycleId: currentCycleId,
          role: myRole,
          top3: [pick1 || null, pick2 || null, pick3 || null],
          createdAt: serverTimestamp(),
        },
        { merge: false } // submit-once model
      );

      setSuccessMsg("Preferences submitted ✅");
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message ?? "Failed to submit preferences.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AuthGate>
        <div className="p-8">Loading profiles…</div>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-2xl border p-8 shadow-sm">
          <h1 className="text-3xl font-bold">Preferences</h1>
          <p className="mt-2 text-gray-600">
            Rank up to 3 people. (1st = strongest preference)
          </p>

          <div className="mt-4 text-sm text-gray-600">
            Cycle: <span className="font-medium">{currentCycleId}</span>
            {" • "}
            You: <span className="font-medium">{myRole}</span>
          </div>

          {errorMsg && (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              {successMsg}
            </div>
          )}

          <div className="mt-6 space-y-4">
            <RankSelect
              label="1st choice"
              value={pick1}
              setValue={setPick1}
              options={options}
              disabledUids={new Set([pick2, pick3].filter(Boolean))}
            />
            <RankSelect
              label="2nd choice"
              value={pick2}
              setValue={setPick2}
              options={options}
              disabledUids={new Set([pick1, pick3].filter(Boolean))}
            />
            <RankSelect
              label="3rd choice"
              value={pick3}
              setValue={setPick3}
              options={options}
              disabledUids={new Set([pick1, pick2].filter(Boolean))}
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={saving}
            className="mt-8 w-full rounded-lg bg-black text-white py-3 font-semibold disabled:opacity-50"
          >
            {saving ? "Submitting…" : "Submit preferences"}
          </button>

          <p className="mt-3 text-xs text-gray-500">
            If you don’t see anyone, confirm you completed onboarding for this cycle and that others have too.
          </p>
        </div>
      </main>
    </AuthGate>
  );
}

function RankSelect({
  label,
  value,
  setValue,
  options,
  disabledUids,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  options: Profile[];
  disabledUids: Set<string>;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="mt-1 w-full rounded-lg border px-3 py-2"
      >
        <option value="">(none)</option>
        {options.map((p) => (
          <option key={p.uid} value={p.uid} disabled={disabledUids.has(p.uid)}>
            {p.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
