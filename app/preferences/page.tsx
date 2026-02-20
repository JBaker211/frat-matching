"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGate from "@/app/components/AuthGate";
import { auth, db } from "@/lib/firebase";

import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";

import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/navigation";


type Role = "pledge" | "active" | "admin";

type Profile = {
  uid: string;
  displayName: string;
  role: Role;
};

export default function PreferencesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [cycleId, setCycleId] = useState<string | null>(null);

  const [myRole, setMyRole] = useState<Role | null>(null);

  const [profiles, setProfiles] = useState<Profile[]>([]);

  const [choices, setChoices] = useState<string[]>([]);

  const [error, setError] = useState<string | null>(null);

  const [saved, setSaved] = useState(false);


  // Load everything
  useEffect(() => {

    const unsub = onAuthStateChanged(auth, async (user) => {

      if (!user) {
        router.push("/login");
        return;
      }

      try {

        // Load current cycle
        const settingsSnap = await getDoc(doc(db, "settings", "global"));

        if (!settingsSnap.exists()) {
          setError("No cycle configured.");
          setLoading(false);
          return;
        }

        const cycle = settingsSnap.data().currentCycleId;

        if (!cycle) {
          setError("No current cycle set.");
          setLoading(false);
          return;
        }

        setCycleId(cycle);


        // Load my profile
        const myProfileSnap = await getDoc(
          doc(db, "cycles", cycle, "profiles", user.uid)
        );

        if (!myProfileSnap.exists()) {
          setError("Complete onboarding first.");
          setLoading(false);
          return;
        }

        const myProfile = myProfileSnap.data() as Profile;

        setMyRole(myProfile.role);


        // Load all profiles
        const profilesSnap = await getDocs(
          collection(db, "cycles", cycle, "profiles")
        );

        const allProfiles: Profile[] = profilesSnap.docs.map(doc => doc.data() as Profile);

        setProfiles(allProfiles);


        // Load existing preferences if exist
        const prefSnap = await getDoc(
          doc(db, "cycles", cycle, "preferences", user.uid)
        );

        if (prefSnap.exists()) {

          const data = prefSnap.data();

          setChoices(data.choices || []);
          setSaved(true);
        }


        setLoading(false);

      } catch (err: any) {

        console.error(err);
        setError(err.message);
        setLoading(false);
      }
    });

    return () => unsub();

  }, [router]);


  // Filter opposite role
  const availableProfiles = useMemo(() => {

    if (!myRole) return [];

    if (myRole === "pledge") {
      return profiles.filter(p => p.role === "active" || p.role === "admin");
    }

    if (myRole === "active" || myRole === "admin") {
      return profiles.filter(p => p.role === "pledge");
    }

    return [];

  }, [profiles, myRole]);


  function toggleChoice(uid: string) {

    setChoices(prev => {

      if (prev.includes(uid)) {
        return prev.filter(x => x !== uid);
      }

      if (prev.length >= 3) {
        return prev;
      }

      return [...prev, uid];

    });

  }


  async function savePreferences() {

    if (!cycleId) return;

    const user = auth.currentUser;

    if (!user) return;

    if (choices.length === 0) {
      setError("Pick at least 1.");
      return;
    }

    setSaving(true);

    try {

      await setDoc(
        doc(db, "cycles", cycleId, "preferences", user.uid),
        {
          uid: user.uid,
          choices,
          role: myRole,
          cycleId,
          createdAt: serverTimestamp(),
        }
      );

      setSaved(true);

    } catch (err: any) {

      console.error(err);
      setError(err.message);

    }

    setSaving(false);

  }


  if (loading) {
    return (
      <AuthGate>
        <main className="p-10 text-center">
          Loading profiles...
        </main>
      </AuthGate>
    );
  }


  return (
    <AuthGate>

      <main className="min-h-screen flex items-center justify-center p-6">

        <div className="w-full max-w-xl border rounded-xl p-6">

          <h1 className="text-2xl font-bold mb-4">
            Preferences
          </h1>

          <p className="mb-4 text-gray-600">
            Pick up to 3 people.
          </p>


          {availableProfiles.length === 0 && (
            <div>No one available.</div>
          )}


          {availableProfiles.map(profile => (

            <div
              key={profile.uid}
              className="flex items-center justify-between border p-3 rounded mb-2"
            >

              <div>{profile.displayName}</div>

              <input
                type="checkbox"
                checked={choices.includes(profile.uid)}
                onChange={() => toggleChoice(profile.uid)}
              />

            </div>

          ))}


          {error && (
            <div className="text-red-600 mt-4">
              {error}
            </div>
          )}


          <button
            onClick={savePreferences}
            disabled={saving || saved}
            className="mt-6 w-full bg-black text-white py-2 rounded"
          >
            {saved ? "Saved" : saving ? "Saving..." : "Submit Preferences"}
          </button>


        </div>

      </main>

    </AuthGate>
  );
}
