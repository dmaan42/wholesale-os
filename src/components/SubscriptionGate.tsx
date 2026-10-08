"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getProfile, hasActiveAccess } from "@/lib/db";

/**
 * Wraps app pages that require an active subscription (or trial).
 * Users without access are sent to Settings to subscribe. The login
 * redirect stays the responsibility of each page's own auth guard.
 */
export default function SubscriptionGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) return; // page-level guard handles the login redirect
    let cancelled = false;
    getProfile()
      .then((p) => {
        if (!cancelled) setAllowed(hasActiveAccess(p));
      })
      .catch(() => {
        if (!cancelled) setAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  useEffect(() => {
    if (allowed === false) router.push("/settings?upgrade=1");
  }, [allowed, router]);

  if (!user || loading) return <>{children}</>;
  if (allowed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <p className="text-slate-500">Checking subscription…</p>
      </div>
    );
  }
  if (!allowed) return null; // redirecting to /settings
  return <>{children}</>;
}
