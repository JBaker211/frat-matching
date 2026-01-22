"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGate from "@/app/components/AuthGate";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, collection, getDocs, query, where } from "firebase/firestore";

type Profile = {
  uid: string;
  role: string; // pledge | active | admin
  cycleId: string;
  displayName: string;
  photoURL: string;

  wantsLittle?: boolean | null;
  maxLittles?: number | null;
  maxBigs?: number | null;

  q1_personality: string;
  q2_humor: string;
  q3_hangout: string;
  q4_groupRole: string;
  q5_values: string;
  q6_about: string;
};

export default function BrowsePage() {
  const [myRole, setMyRole] = useState<string | null>(null);
  const [cycleId, setCycleId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [idx, setIdx] = useState(0);

  const current = useMemo(() => profiles[idx] ?? null, [profiles, idx]);

  useEffect(() => {
    async function load() {
      const u = auth.currentUser;
      if (!u) return;

      // cycle
      const settingsSnap = await getDoc(doc(db, "settings", "global"));
      const cid = settingsSnap.exists() ? (settingsSnap.data()?.currentCycleId as string | undefined) : undefined;
      if (!cid) {
        setCycleId(null);
        setProfiles([]);
        setLoading(false);
        return;
      }
      setCycleId(cid);

      // my role
      const meSnap = await getDoc(doc(db, "users", u.uid));
      const me = meSnap.data();
      const role = me?.role ?? null;
      setMyRole(role);

      // target role
      let targetRole: string = "active";
      if (role === "active" || role === "admin") targetRole = "pledge";
      if (role === "pledge") targetRole = "active";

      // cycles/{cid}/profiles
      const baseCol = collection(db, "cycles", cid, "profiles");

      let qRef = query(baseCol, where("role", "==", targetRole));

      // pledges browsing actives: only show actives who want a little
      if (targetRole === "active") {
        qRef = query(baseCol, where("role", "==", "active"), where("wantsLittle", "==", true));
      }

      const snap = await getDocs(qRef);
      const list: Profile[] = snap.docs.map((d) => d.data() as Profile);

      setProfiles(list);
      setIdx(0);
      setLoading(false);
    }

    load().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, []);

  function prev() {
    setIdx((i) => Math.max(0, i - 1));
  }
  function next() {
    setIdx((i) => Math.min(profiles.length - 1, i + 1));
  }

  if (loading) {
    return (
      <AuthGate>
        <div className="p-8">Loading profiles…</div>
      </AuthGate>
    );
  }

  if (!cycleId) {
    return (
      <AuthGate>
        <div className="p-8">
          <div className="text-xl font-bold">No cycle set</div>
          <p className="mt-2 text-gray-600">Ask an admin to set a cycle in /admin.</p>
        </div>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="w-full max-w-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-gray-600">
              Cycle: <span className="font-mono font-medium">{cycleId}</span>
              {" • "}Signed in as: <span className="font-medium">{myRole}</span>
            </div>
            <div className="text-sm text-gray-600">
              {profiles.length === 0 ? "0" : idx + 1}/{profiles.length}
            </div>
          </div>

          {profiles.length === 0 ? (
            <div className="rounded-2xl border p-8 shadow-sm">
              <h1 className="text-xl font-bold">No profiles yet</h1>
              <p className="mt-2 text-gray-600">Once people complete onboarding for this cycle, they’ll show up here.</p>
            </div>
          ) : current ? (
            <ProfileCard p={current} />
          ) : null}

          <div className="mt-4 flex gap-3">
            <button
              onClick={prev}
              disabled={idx === 0 || profiles.length === 0}
              className="flex-1 rounded-lg border py-2 font-medium disabled:opacity-50"
            >
              ◀ Prev
            </button>
            <button
              onClick={next}
              disabled={idx >= profiles.length - 1 || profiles.length === 0}
              className="flex-1 rounded-lg border py-2 font-medium disabled:opacity-50"
            >
              Next ▶
            </button>
          </div>
        </div>
      </main>
    </AuthGate>
  );
}

function ProfileCard({ p }: { p: Profile }) {
  return (
    <div className="rounded-2xl border shadow-sm overflow-hidden">
      <div className="relative">
        <img src={p.photoURL} alt={p.displayName} className="w-full h-80 object-cover" />
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/70 to-transparent">
          <div className="text-white text-2xl font-bold">{p.displayName}</div>
          <div className="text-white/80 text-sm capitalize">{p.role}</div>
        </div>
      </div>

      <div className="p-6 space-y-3">
        <TagLine label="Personality" value={p.q1_personality} />
        <TagLine label="Humor" value={p.q2_humor} />
        <TagLine label="Hangout" value={p.q3_hangout} />
        <TagLine label="In a group" value={p.q4_groupRole} />
        <TagLine label="Values" value={p.q5_values} />

        <div className="pt-2">
          <div className="text-sm font-medium text-gray-700">About</div>
          <div className="mt-1 text-gray-800">{p.q6_about}</div>
        </div>
      </div>
    </div>
  );
}

function TagLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="text-sm font-medium text-gray-700">{label}</div>
      <div className="text-sm text-gray-900 text-right">{value}</div>
    </div>
  );
}
