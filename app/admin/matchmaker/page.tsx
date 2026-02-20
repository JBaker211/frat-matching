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
      console.log("🟡 Matchmaker starting…");

      // 1️⃣ Get cycle
      const settingsSnap = await getDoc(doc(db, "settings", "global"));
      const cycleId = settingsSnap.data()?.currentCycleId;
      console.log("🟢 cycleId:", cycleId);

      if (!cycleId) {
        console.error("❌ No cycleId set");
        return;
      }

      // 2️⃣ Load profiles
      const profilesSnap = await getDocs(collection(db, "profiles"));
      console.log("🟢 profiles count:", profilesSnap.size);

      const profiles = profilesSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      console.log("🟢 profiles sample:", profiles.slice(0, 3));

      const pledges = profiles.filter((p) => p.role === "pledge");
      const actives = profiles.filter(
        (p) => p.role === "active" || p.role === "admin"
      );

      console.log("🟢 pledges:", pledges.length);
      console.log("🟢 actives:", actives.length);

      // 3️⃣ Load preferences
      const prefsSnap = await getDocs(
        collection(db, "cycles", cycleId, "preferences")
      );

      console.log("🟢 preferences count:", prefsSnap.size);

      const preferences: Record<string, any> = {};
      prefsSnap.forEach((d) => {
        preferences[d.id] = d.data();
      });

      console.log("🟢 preferences sample:", Object.entries(preferences).slice(0, 3));

      // 4️⃣ Match
      const computedMatches = [];

      for (const pledge of pledges) {
        for (const active of actives) {
          let score = 0;

          if (
            preferences[pledge.uid]?.preferredUids?.includes(active.uid)
          ) {
            score += 1;
          }

          if (
            preferences[active.uid]?.preferredUids?.includes(pledge.uid)
          ) {
            score += 1;
          }

          computedMatches.push({ pledge, active, score });
        }
      }

      console.log("🟢 computed matches:", computedMatches.length);

      setMatches(computedMatches);
    } catch (err) {
      console.error("❌ Matchmaker error:", err);
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
