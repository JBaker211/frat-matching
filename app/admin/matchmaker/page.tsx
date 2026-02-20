"use client";

import { useEffect, useState } from "react";
import { auth, db } from "../../../lib/firebase";
import {
  collection,
  getDocs,
  doc,
  getDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

type Profile = {
  uid: string;
  role: "pledge" | "active";
  displayName: string;
};

type Preference = {
  uid: string;
  rankings: string[];
};

export default function MatchmakerPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<any[]>([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return;

      try {
        // Check admin
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (!userSnap.data()?.isAdmin) {
          setError("Admin only.");
          setLoading(false);
          return;
        }

        // Get cycle
        const settingsSnap = await getDoc(doc(db, "settings", "global"));
        const cycleId = settingsSnap.data()?.currentCycleId;
        if (!cycleId) throw new Error("No active cycle");

        // Load profiles
        const profileSnap = await getDocs(
          collection(db, "cycles", cycleId, "profiles")
        );

        const profiles: Profile[] = profileSnap.docs.map((d) => d.data() as Profile);

        const pledges = profiles.filter((p) => p.role === "pledge");
        const actives = profiles.filter((p) => p.role === "active");

        // Load preferences
        const prefSnap = await getDocs(
          collection(db, "cycles", cycleId, "preferences")
        );

        const preferences: Preference[] = prefSnap.docs.map(
          (d) => d.data() as Preference
        );

        // Build lookup
        const prefMap = new Map<string, string[]>();
        preferences.forEach((p) => prefMap.set(p.uid, p.rankings));

        // Generate matches
        const results = [];

        for (const pledge of pledges) {
          const pledgePrefs = prefMap.get(pledge.uid) || [];

          for (const active of actives) {
            const activePrefs = prefMap.get(active.uid) || [];

            let score = 0;
            if (pledgePrefs.includes(active.uid)) score += 1;
            if (activePrefs.includes(pledge.uid)) score += 1;

            if (score > 0) {
              results.push({
                pledge: pledge.displayName,
                active: active.displayName,
                score,
              });
            }
          }
        }

        setMatches(results);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  if (loading) return <div className="p-6">Loading matchmaker…</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Matchmaker</h1>

      {matches.length === 0 ? (
        <p>No matches found.</p>
      ) : (
        <table className="w-full border">
          <thead>
            <tr className="border-b">
              <th className="p-2 text-left">Pledge</th>
              <th className="p-2 text-left">Active</th>
              <th className="p-2 text-left">Score</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m, i) => (
              <tr key={i} className="border-b">
                <td className="p-2">{m.pledge}</td>
                <td className="p-2">{m.active}</td>
                <td className="p-2">{m.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
