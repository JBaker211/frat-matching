"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function ensureUserDoc(uid: string, email: string) {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);

    // First login/signup creates a basic user doc.
    if (!snap.exists()) {
      await setDoc(ref, {
        email,
        role: "member", // we will change this to pledge/active/admin later
        profileComplete: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  async function handleContinue() {
    setError(null);
    setLoading(true);

    try {
      if (!email || !password) {
        setError("Please enter email and password.");
        return;
      }

      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await ensureUserDoc(cred.user.uid, cred.user.email || email);
      } else {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        await ensureUserDoc(cred.user.uid, cred.user.email || email);
      }

      // Next page: onboarding profile form
      router.push("/role");
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-md w-full rounded-2xl border p-8 shadow-sm">
        <h1 className="text-2xl font-bold">{mode === "signup" ? "Create account" : "Sign in"}</h1>
        <p className="mt-2 text-gray-600">Fraternity members only</p>

        <div className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium">Email</label>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@school.edu"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-sm font-medium">Password</label>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <button
            onClick={handleContinue}
            disabled={loading}
            className="w-full rounded-lg bg-black text-white py-2 font-medium disabled:opacity-60"
          >
            {loading ? "Please wait..." : "Continue"}
          </button>

          <button
            type="button"
            className="w-full rounded-lg border py-2 font-medium"
            onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
          >
            {mode === "signup" ? "I already have an account" : "Create an account"}
          </button>
        </div>
      </div>
    </main>
  );
}
