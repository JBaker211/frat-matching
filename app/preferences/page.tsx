"use client";

import { useEffect, useState } from "react";
import { auth, db } from "../../lib/firebase";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/navigation";

export default function PreferencesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cycleId, setCycleId] = useState<string | null>(null);

  const [rankings, setRankings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        // Load current cycle
        const settingsSnap = await getDoc(doc(db, "settings", "global"));
        const cid = settingsSnap.data()?.currentCycleId;
        if (!cid) {
          setError("No active cycle set by admin.");
          setLoading(false);
          return;
        }
        setCycleId(cid);

        // Check if already submitted
        const prefRef = doc(db, "cycles", cid, "preferences", user.uid);
        const prefSnap = await getDoc(prefRef);
        if (prefSnap.exists()) {
          router.push("/browse");
          return;
        }

        setLoading(false);
      } catch (e: any) {
        setError(e.message);
        setLoading(false);
      }
    });

    return () => unsub();
  }, [router]);

  async function handleSubmit() {
    if (!cycleId) return;
    if (rankings.length === 0) {
      setError("Please rank at least one person.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not signed in");

      await setDoc(
        doc(db, "cycles", cycleId, "preferences", user.uid),
        {
          uid: user.uid,
          rankings,
          submittedAt: serverTimestamp(),
        }
      );

      router.push("/browse");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6">Loading preferences…</div>;

  return (
    <main className="max-w-xl mx-auto p-6">
      <h1 className="text-3xl font-bold">Preferences</h1>
      <p className="text-gray-600 mt-2">
        Rank people you’d prefer to be matched with.
      </p>

      {/* TEMP INPUT (simple but works) */}
      <textarea
        className="mt-4 w-full border rounded p-2"
        rows={6}
        placeholder="Enter UIDs separated by commas"
        onChange={(e) =>
          setRankings(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          )
        }
      />

      {error && (
        <div className="mt-4 text-red-600 text-sm">{error}</div>
      )}

      <button
        onClick={handleSubmit}
        disabled={saving}
        className="mt-6 w-full bg-black text-white py-3 rounded font-semibold"
      >
        {saving ? "Submitting…" : "Submit Preferences"}
      </button>
    </main>
  );
}
