"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

type Role = "pledge" | "active" | "admin";

export default function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      try {
        if (!u) {
          router.replace("/login");
          return;
        }

        // Always allow login page if already authed? (optional)
        // if (pathname === "/login") return;

        const userSnap = await getDoc(doc(db, "users", u.uid));
        const user = userSnap.exists() ? (userSnap.data() as any) : null;

        const role: Role | null = (user?.role as Role | undefined) ?? null;
        const roleLocked = !!user?.roleLocked;
        const profileComplete = !!user?.profileComplete;
        const isAdmin = !!user?.isAdmin;

        const isAdminRoute = pathname?.startsWith("/admin");

        // ✅ Admins can always access /admin even without profileComplete
        if (isAdmin && isAdminRoute) {
          setLoading(false);
          return;
        }

        // If role isn't locked yet, send to /role
        if (!roleLocked && pathname !== "/role") {
          router.replace("/role");
          return;
        }

        // If role is locked but profile not complete, send to /onboarding
        // (Admins are allowed into /admin without profileComplete, but other pages still require it)
        if (roleLocked && !profileComplete && pathname !== "/onboarding" && !isAdminRoute) {
          router.replace("/onboarding");
          return;
        }

        // If fully onboarded, allow
        setLoading(false);
      } catch (e) {
        console.error("AuthGate error:", e);
        // If something goes wrong, safest fallback is login
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (loading) return <div className="p-8">Loading…</div>;

  return <>{children}</>;
}
