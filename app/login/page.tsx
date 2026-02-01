"use client";

import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (!u) return;

      // If user is logged in already, go to role (role gate) or onboarding depending on roleLocked
      try {
        const snap = await getDoc(doc(db, "users", u.uid));
        const data = snap.exists() ? (snap.data() as any) : null;

        if (!data || !data.roleLocked) {
          router.replace("/role");
        } else {
          router.replace("/onboarding");
        }
      } catch {
        router.replace("/role");
      }
    });

    return () => unsub();
  }, [router]);

  async function ensureUserDoc(uid: string, email: string) {
    const userRef = doc(db, "users", uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      await setDoc(
        userRef,
        {
          uid,
          email: email.toLowerCase(),
          // role gate
          role: null,
          roleLocked: false,

          // admin flag (admin is set later on /role)
          isAdmin: false,

          // profile gate
          profileComplete: false,

          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: false }
      );
    }
  }

  async function handleSubmit() {
    setMsg(null);
    setLoading(true);

    try {
      if (!email.trim() || !password.trim()) {
        setMsg("Enter email + password.");
        return;
      }

      if (mode === "signin") {
        await signInWithEmailAndPassword(auth, email.trim(), password);
        // redirect handled by onAuthStateChanged
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await ensureUserDoc(cred.user.uid, email.trim());
        router.replace("/role");
      }
    } catch (e: any) {
      console.error(e);
      setMsg(e?.message ?? "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Fraternity Big–Little</h1>
        <p className="mt-2 text-gray-600">
          {mode === "signin" ? "Sign in to continue." : "Create an account to begin."}
        </p>

        <div className="mt-6 space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700">Email</label>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Password</label>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {msg && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {msg}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full rounded-lg bg-black text-white py-2 font-semibold disabled:opacity-50"
          >
            {loading ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>

          <button
            type="button"
            onClick={() => setMode((m) => (m === "signin" ? "signup" : "signin"))}
            className="w-full rounded-lg border py-2 font-medium"
          >
            {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </main>
  );
}
