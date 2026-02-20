"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";

type Profile = {
  uid: string;
  role: "pledge" | "active" | "admin";
  displayName: string;
};

type Preference = {
  uid: string;
  preferredUids?: string[];
};

type Match = {
  pledge: Profile;
  active: Profile;
  score: number;
};

export default function MatchmakerPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    runMatchmaker();
  }, []);

  async function runMatchmaker() {
    setLoading(true);

    try {
      // 1️⃣ Get current cycle
      const settingsSnap = await getDoc(doc(db, "settings", "global"));
      const cycleId = settingsSnap.data()?.currentCycleId;
      if (!cycleId) {
        console.error("No cycleId set");
        setLoading(false);
        return;
      }

      // 2️⃣ Load ALL profiles (this is where your data actually is)
      const profilesSnap = await getDocs(collection(db, "profiles"));
      const profiles: Profile[] = profilesSnap.docs.map((d) => d.data() as Profile);

      const pledges = profiles.filter((p) => p.role === "pledge");
      const actives = profiles.filter(
        (p) => p.role === "active" || p.role === "admin"
      );

      // 3️⃣ Load preferences for this cycle
      const prefsSnap = await getDocs(
        collection(db, "cycles", cycleId, "preferences")
      );

      const preferences: Record<string, Preference> = {};
      prefsSnap.forEach((doc) => {
        preferences[doc.id] = doc.data() as Preference;
      });

      // 4️⃣ Compute matches
      const computedMatches: Match[] = [];

      for (const pledge of pledges) {
        for (const active of actives) {
          let score = 0;

          const pledgePrefs = preferences[pledge.uid];
          const activePrefs = preferences[active.uid];

          if (pledgePrefs?.preferredUids?.includes(active.uid)) {
            score += 1;
          }

          if (activePrefs?.preferredUids?.includes(pledge.uid)) {
            score += 1;
          }

          computedMatches.push({
            pledge,
            active,
            score,
          });
        }
      }

      // 5️⃣ Sort by score
      computedMatches.sort((a, b) => b.score - a.score);

      setMatches(computedMatches);
    } catch (err) {
      console.error("Matchmaker error:", err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="p-6">Loading matches…</div>;

  if (matches.length === 0) {
    return <div className="p-6">No matches found.</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Matchmaker</h1>

      {matches.map((m, i) => (
        <div
          key={i}
          className="border rounded-lg p-4 flex justify-between"
        >
          <div>
            <strong>Pledge:</strong> {m.pledge.displayName}
          </div>
          <div>
            <strong>Active:</strong> {m.active.displayName}
          </div>
          <div>
            <strong>Score:</strong> {m.score}
          </div>
        </div>
      ))}
    </div>
  );
}
