"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setLoading(false);

      if (!u) {
        router.replace("/login");
        return;
      }

      // ✅ Admin bootstrap: if this user email matches, set isAdmin on their user doc
      const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
      const email = (u.email || "").trim();

      if (adminEmail && email && email === adminEmail) {
        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);
        const data = snap.data();

        if (!data?.isAdmin) {
          await updateDoc(ref, {
            isAdmin: true,
            role: "admin",
            updatedAt: serverTimestamp(),
          });
        }
      }
    });

    return () => unsub();
  }, [router]);

  if (loading) return <div className="p-8">Loading...</div>;
  if (!user) return null;

  return <>{children}</>;
}
