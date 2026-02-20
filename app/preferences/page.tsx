
"use client";

import { useEffect, useState } from "react";
import { collection, doc, getDocs, setDoc } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";

type Profile = {
  uid: string;
  name: string;
  role: "pledge" | "active";
};

export default function PreferencesPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [ranked, setRanked] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const user = auth.currentUser;

  useEffect(() => {
    loadProfiles();
  }, []);

  async function loadProfiles() {
    if (!user) return;

    const cycleId = "current";

    const snap = await getDocs(
      collection(db, "cycles", cycleId, "profiles")
    );

    const allProfiles = snap.docs.map((doc) => ({
      uid: doc.id,
      ...(doc.data() as Omit<Profile, "uid">),
    }));

    const me = allProfiles.find((p) => p.uid === user.uid);
    if (!me) return;

    const oppositeRole =
      me.role === "pledge" ? "active" : "pledge";

    setProfiles(allProfiles.filter((p) => p.role === oppositeRole));
    setLoading(false);
  }

  async function savePreferences() {
    if (!user) return;

    const cycleId = "current";

    await setDoc(
      doc(db, "cycles", cycleId, "preferences", user.uid),
      { rankedUids: ranked },
      { merge: true }
    );

    alert("Preferences saved!");
  }

  if (loading) return <p className="p-6">Loading profiles…</p>;

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Rank Your Preferences</h1>

      <ul className="space-y-2">
        {profiles.map((p) => (
          <li key={p.uid}>
            <label>
              <input
                type="checkbox"
                checked={ranked.includes(p.uid)}
                onChange={() =>
                  setRanked((prev) =>
                    prev.includes(p.uid)
                      ? prev.filter((id) => id !== p.uid)
                      : [...prev, p.uid]
                  )
                }
              />{" "}
              {p.name}
            </label>
          </li>
        ))}
      </ul>

      <button
        onClick={savePreferences}
        className="mt-4 px-4 py-2 bg-black text-white rounded"
      >
        Save Preferences
      </button>
    </div>
  );
}