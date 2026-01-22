"use client";

import { useEffect, useState } from "react";
import AuthGate from "@/app/components/AuthGate";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [notAuthorized, setNotAuthorized] = useState(false);

  const [currentCycleId, setCurrentCycleId] = useState<string>("");
  const [draftCycleId, setDraftCycleId] = useState<string>("");

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (!u) {
        setLoading(false);
        return;
      }

      try {
        // Must be admin
        const meSnap = await getDoc(doc(db, "users", u.uid));
        const isAdmin = !!meSnap.data()?.isAdmin;
        if (!isAdmin) {
          setNotAuthorized(true);
          setLoading(false);
          return;
        }

        // Load settings/global
        const settingsSnap = await getDoc(doc(db, "settings", "global"));
        const cid = settingsSnap.exists() ? (settingsSnap.data()?.currentCycleId as string | undefined) : undefined;

        setCurrentCycleId(cid ?? "");
        setDraftCycleId(cid ?? "");
        setLoading(false);
      } catch (e: any) {
        console.error(e);
        setMsg(e?.message ?? "Failed to load admin settings.");
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  async function saveCycle() {
    setMsg(null);

    const u = auth.currentUser;
    if (!u) return;

    const next = draftCycleId.trim();
    if (!next) {
      setMsg("Please enter a cycleId, like spring-2026 or fall-2026.");
      return;
    }

    // Keep it simple/consistent: lowercase, no spaces
    const normalized = next.toLowerCase().replace(/\s+/g, "");
    setSaving(true);

    try {
      await setDoc(
        doc(db, "settings", "global"),
        {
          currentCycleId: normalized,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setCurrentCycleId(normalized);
      setDraftCycleId(normalized);
      setMsg(`Saved ✅ Current cycle is now: ${normalized}`);
    } catch (e: any) {
      console.error(e);
      setMsg(e?.message ?? "Failed to save cycle.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AuthGate>
        <div className="p-8">Loading admin…</div>
      </AuthGate>
    );
  }

  if (notAuthorized) {
    return (
      <AuthGate>
        <div className="p-8">
          <div className="text-xl font-bold">Not authorized</div>
          <p className="mt-2 text-gray-600">This page is admin-only.</p>
        </div>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-2xl border p-8 shadow-sm">
          <h1 className="text-3xl font-bold">Admin</h1>
          <p className="mt-2 text-gray-600">Manage the current cycle inside the app.</p>

          <div className="mt-6 rounded-xl border p-4">
            <div className="text-sm text-gray-700">
              Current cycle:{" "}
              <span className="font-mono font-semibold">{currentCycleId || "(not set)"}</span>
            </div>

            <div className="mt-4">
              <label className="text-sm font-medium text-gray-700">Set new cycleId</label>
              <input
                value={draftCycleId}
                onChange={(e) => setDraftCycleId(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2"
                placeholder="e.g., fall-2026"
              />
              <p className="mt-2 text-xs text-gray-500">
                Tip: use a consistent format like <span className="font-mono">spring-2026</span>,{" "}
                <span className="font-mono">fall-2026</span>.
              </p>
            </div>

            <button
              onClick={saveCycle}
              disabled={saving}
              className="mt-4 w-full rounded-lg bg-black text-white py-2 font-semibold disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save cycle"}
            </button>

            {msg && <div className="mt-4 rounded-lg border p-3 text-sm text-gray-700">{msg}</div>}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3">
            <a className="rounded-lg border px-4 py-2 font-medium" href="/admin/matchmaker">
              Go to Matchmaker
            </a>
          </div>
        </div>
      </main>
    </AuthGate>
  );
}
