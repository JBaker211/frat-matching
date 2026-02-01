"use client";

import AuthGate from "@/app/components/AuthGate";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Role = "pledge" | "active" | "admin";

export default function RolePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [roleLocked, setRoleLocked] = useState(false);
  const [currentRole, setCurrentRole] = useState<Role | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const adminEmail = (process.env.NEXT_PUBLIC_ADMIN_EMAIL || "").toLowerCase().trim();

  useEffect(() => {
    (async () => {
      const u = auth.currentUser;
      if (!u) {
        setLoading(false);
        return;
      }

      const userRef = doc(db, "users", u.uid);
      const snap = await getDoc(userRef);

      if (!snap.exists()) {
        await setDoc(
          userRef,
          {
            uid: u.uid,
            email: (u.email || "").toLowerCase(),
            role: null,
            roleLocked: false,
            isAdmin: false,
            profileComplete: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: false }
        );
      }

      const snap2 = await getDoc(userRef);
      const data = snap2.data() as any;

      setRoleLocked(!!data?.roleLocked);
      setCurrentRole((data?.role as Role | null) ?? null);

      // If already locked, go to onboarding
      if (data?.roleLocked) {
        router.replace("/onboarding");
        return;
      }

      setLoading(false);
    })().catch((e) => {
      console.error(e);
      setMsg("Failed to load role page.");
      setLoading(false);
    });
  }, [router]);

  async function chooseRole(role: "pledge" | "active") {
    setMsg(null);

    const u = auth.currentUser;
    if (!u) {
      setMsg("Not signed in.");
      return;
    }

    const userRef = doc(db, "users", u.uid);

    // Admin email override
    const isAdmin = adminEmail && (u.email || "").toLowerCase() === adminEmail;

    const finalRole: Role = isAdmin ? "admin" : role;

    try {
      await setDoc(
        userRef,
        {
          role: finalRole,
          roleLocked: true,
          isAdmin: isAdmin,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      router.replace("/onboarding");
    } catch (e: any) {
      console.error(e);
      setMsg(e?.message ?? "Failed to save role.");
    }
  }

  if (loading) {
    return (
      <AuthGate>
        <div className="p-8">Loading role…</div>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-2xl border p-8 shadow-sm">
          <h1 className="text-2xl font-bold">Choose your role</h1>
          <p className="mt-2 text-gray-600">
            You can only select this once.
          </p>

          {msg && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {msg}
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 gap-3">
            <button
              onClick={() => chooseRole("pledge")}
              disabled={roleLocked}
              className="rounded-lg border py-3 font-semibold disabled:opacity-50"
            >
              I am a pledge
            </button>

            <button
              onClick={() => chooseRole("active")}
              disabled={roleLocked}
              className="rounded-lg border py-3 font-semibold disabled:opacity-50"
            >
              I am an active
            </button>
          </div>

          {currentRole && (
            <div className="mt-6 text-sm text-gray-600">
              Current role: <span className="font-semibold">{currentRole}</span>
            </div>
          )}
        </div>
      </main>
    </AuthGate>
  );
}
