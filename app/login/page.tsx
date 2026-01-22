"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
} from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

type UserDoc = {
  uid: string;
  email: string;
  isAdmin?: boolean;
  role?: "pledge" | "active" | "admin";
  roleLocked?: boolean;
  profileComplete?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adminEmail = (process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "").trim().toLowerCase();

  // Route signed-in users automatically
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setLoading(false);
        return;
      }

      try {
        const userRef = doc(db, "users", u.uid);
        const snap = await getDoc(userRef);
        const data = (snap.exists() ? (snap.data() as UserDoc) : null);

        // If user doc doesn't exist (edge case), create it
        if (!data) {
          const isAdmin = adminEmail && u.email?.toLowerCase() === adminEmail;
          await setDoc(
            userRef,
            {
              uid: u.uid,
              email: u.email ?? "",
              isAdmin: !!isAdmin,
              updatedAt: serverTimestamp(),
              createdAt: serverTimestamp(),
            },
            { merge: true }
          );
          router.replace("/role");
          return;
        }

        // If this email is admin, ensure isAdmin is true (so you don't get stuck)
        if (adminEmail && u.email?.toLowerCase() === adminEmail && data.isAdmin !== true) {
          await setDoc(userRef, { isAdmin: true, updatedAt: serverTimestamp() }, { merge: true });
        }

        const roleLocked = !!data.roleLocked;
        const profileComplete = !!data.profileComplete;

        if (!roleLocked) router.replace("/role");
        else if (!profileComplete) router.replace("/onboarding");
        else router.replace("/browse");
      } catch (e: any) {
        console.error(e);
        setError(e?.message ?? "Failed to load account.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ensureUserDoc(u: { uid: string; email?: string | null }) {
    const userRef = doc(db, "users", u.uid);
    const snap = await getDoc(userRef);
    const isAdmin = adminEmail && (u.email ?? "").toLowerCase() === adminEmail;

    if (!snap.exists()) {
      const payload: UserDoc = {
        uid: u.uid,
        email: u.email ?? "",
        isAdmin: !!isAdmin,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(userRef, payload, { merge: true });
    } else {
      // Keep doc up to date; also flip isAdmin on if needed
      const updates: Partial<UserDoc> = {
        email: u.email ?? "",
        updatedAt: serverTimestamp(),
      };
      if (isAdmin) updates.isAdmin = true;
      await setDoc(userRef, updates, { merge: true });
    }
  }

  async function handleSubmit() {
    setError(null);
    setWorking(true);

    try {
      const em = email.trim();
      if (!em) throw new Error("Enter your email.");
      if (!password) throw new Error("Enter your password.");

      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, em, password);
        await ensureUserDoc({ uid: cred.user.uid, email: cred.user.email });
        router.replace("/role");
      } else {
        const cred = await signInWithEmailAndPassword(auth, em, password);
        await ensureUserDoc({ uid: cred.user.uid, email: cred.user.email });
        // routing handled by onAuthStateChanged, but we can be explicit:
        router.replace("/onboarding");
      }
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Login failed.");
    } finally {
      setWorking(false);
    }
  }

  async function handleResetPassword() {
    setError(null);
    try {
      const em = email.trim();
      if (!em) {
        setError("Type your email first, then click 'Forgot password?'.");
        return;
      }
      await sendPasswordResetEmail(auth, em);
      setError("Password reset email sent. Check your inbox (and spam).");
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Could not send reset email.");
    }
  }

  if (loading) {
    return <div className="p-8">Loading…</div>;
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-md rounded-2xl border p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Frat Matching</h1>
        <p className="mt-2 text-gray-600">
          {mode === "login" ? "Sign in to continue." : "Create an account to continue."}
        </p>

        <div className="mt-6 space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700">Password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
              placeholder="••••••••"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={working}
            className="w-full rounded-lg bg-black text-white py-2 font-semibold disabled:opacity-60"
          >
            {working ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>

          <button
            type="button"
            onClick={handleResetPassword}
            className="w-full rounded-lg border py-2 font-medium"
          >
            Forgot password?
          </button>

          <div className="pt-2 text-sm text-gray-700">
            {mode === "login" ? (
              <>
                Don’t have an account?{" "}
                <button className="font-semibold underline" onClick={() => setMode("signup")}>
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button className="font-semibold underline" onClick={() => setMode("login")}>
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
