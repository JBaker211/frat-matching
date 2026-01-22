"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import AuthGate from "@/app/components/AuthGate";

export default function RolePage() {
  const router = useRouter();
  const [role, setRole] = useState<"pledge" | "active" | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const u = auth.currentUser;
      if (!u) return;

      const snap = await getDoc(doc(db, "users", u.uid));
      const data = snap.data();
      if (data?.roleLocked) {
        setLocked(true);
        // If already chosen, send to onboarding
        router.replace("/onboarding");
      }
      setLoading(false);
    }
    load();
  }, [router]);

  async function handleContinue() {
    const u = auth.currentUser;
    if (!u || !role) return;

    await updateDoc(doc(db, "users", u.uid), {
      role,
      roleLocked: true,
      updatedAt: serverTimestamp(),
    });

    router.push("/onboarding");
  }

  return (
    <AuthGate>
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md w-full rounded-2xl border p-8 shadow-sm">
          <h1 className="text-2xl font-bold">Select your role</h1>
          <p className="mt-2 text-gray-600">
            This can’t be changed later.
          </p>

          {loading ? (
            <div className="mt-6">Loading...</div>
          ) : (
            <>
              <div className="mt-6 space-y-3">
                <button
                  className={`w-full rounded-lg border py-3 font-medium ${
                    role === "pledge" ? "bg-black text-white" : ""
                  }`}
                  onClick={() => setRole("pledge")}
                  disabled={locked}
                >
                  I am a Pledge
                </button>

                <button
                  className={`w-full rounded-lg border py-3 font-medium ${
                    role === "active" ? "bg-black text-white" : ""
                  }`}
                  onClick={() => setRole("active")}
                  disabled={locked}
                >
                  I am an Active Member
                </button>
              </div>

              <button
                disabled={!role || locked}
                onClick={handleContinue}
                className="mt-6 w-full rounded-lg bg-black text-white py-2 font-medium disabled:opacity-50"
              >
                Continue
              </button>
            </>
          )}
        </div>
      </main>
    </AuthGate>
  );
}
