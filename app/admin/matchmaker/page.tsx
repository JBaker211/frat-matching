"use client";

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";

type Profile = {
  uid: string;
  name: string;
  role: "pledge" | "active";
  wantsLittle?: boolean;
};

type Preference = {
  rankedUids: string[];
};

type MatchSuggestion = {
  pledge: Profile;
  active: Profile;
  score: number;
};

export default function MatchmakerPage() {
  const [matches, setMatches] = useState<MatchSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    generateMatches();
  }, []);

  async function generateMatches() {
    setLoading(true);

    const cycleId = "current"; // MUST match admin-selected cycle

    // ------------------------
    // LOAD PROFILES
    // ------------------------
    const profileSnap = await getDocs(
      collection(db, "cycles", cycleId, "profiles")
    );

    const profiles: Profile[] = profileSnap.docs.map((doc) => ({
      uid: doc.id,
      ...(doc.data() as Omit<Profile, "uid">),
    }));

    const pledges = profiles.filter((p) => p.role === "pledge");
    const actives = profiles.filter(
      (p) => p.role === "active" && p.wantsLittle !== false
    );

    // ------------------------
    // LOAD PREFERENCES
    // ------------------------
    const prefSnap = await getDocs(
      collection(db, "cycles", cycleId, "preferences")
    );

    const preferences: Record<string, Preference> = {};
    prefSnap.forEach((doc) => {
      preferences[doc.id] = doc.data() as Preference;
    });

    // ------------------------
    // GENERATE MATCH SCORES
    // ------------------------
    const suggestions: MatchSuggestion[] = [];

    for (const pledge of pledges) {
      for (const active of actives) {
        let score = 0;

        const pledgePrefs = preferences[pledge.uid]?.rankedUids ?? [];
        const activePrefs = preferences[active.uid]?.rankedUids ?? [];

        // Mutual preference boosts
        if (pledgePrefs.includes(active.uid)) {
          score += 10 - pledgePrefs.indexOf(active.uid);
        }

        if (activePrefs.includes(pledge.uid)) {
          score += 10 - activePrefs.indexOf(pledge.uid);
        }

        suggestions.push({
          pledge,
          active,
          score,
        });
      }
    }

    // Sort best matches first
    suggestions.sort((a, b) => b.score - a.score);

    setMatches(suggestions);
    setLoading(false);
  }

  if (loading) {
    return <p className="p-6">Loading match suggestions…</p>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Matchmaker Suggestions</h1>

      {matches.length === 0 && (
        <p>No matches found (this should not happen anymore).</p>
      )}

      <ul className="space-y-3">
        {matches.map((m, i) => (
          <li key={i} className="border rounded p-3">
            <strong>{m.pledge.name}</strong> ↔{" "}
            <strong>{m.active.name}</strong>
            <div className="text-sm text-gray-500">
              Score: {m.score}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}