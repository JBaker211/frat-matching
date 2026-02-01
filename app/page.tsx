"use client";

import { useEffect } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", u.uid));
        const data = snap.exists() ? (snap.data() as any) : null;

        if (!data || !data.roleLocked) router.replace("/role");
        else router.replace("/onboarding");
      } catch {
        router.replace("/role");
      }
    });

    return () => unsub();
  }, [router]);

  return <div className="p-8">Loading…</div>;
}
