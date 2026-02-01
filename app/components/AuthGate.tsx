"use client";

import { ReactNode, useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import { usePathname, useRouter } from "next/navigation";

export default function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => {
      // If not signed in, send to login (but allow login page itself)
      if (!u && pathname !== "/login") {
        router.replace("/login");
        return;
      }
      setChecking(false);
    });

    return () => unsub();
  }, [router, pathname]);

  if (checking) return <div className="p-8">Loading…</div>;
  return <>{children}</>;
}
