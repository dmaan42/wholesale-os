"use client";

import { useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <p className="text-slate-500">Loading…</p>
      </div>
    );
  }

  if (!user) return null;

  const displayName =
    (user.user_metadata?.full_name as string) ||
    user.email?.split("@")[0] ||
    "Account";

  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar />
      <main className="ml-64 min-h-screen p-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Subscription & Settings</h1>
          <p className="text-sm text-slate-400">Manage your plan and account</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-emerald-500/40 bg-slate-900 p-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="text-xl">⚡</span>
              <h2 className="text-lg font-semibold">Current Plan</h2>
            </div>
            <div className="mb-1 text-3xl font-bold text-white">
              Pro <span className="text-lg font-normal text-slate-400">$197/mo</span>
            </div>
            <p className="mb-4 text-sm text-slate-400">Billed monthly · Cancel anytime</p>
            <ul className="mb-6 space-y-2 text-sm">
              {[
                "Unlimited leads & deals",
                "Full pipeline CRM",
                "Deal analyzer",
                "Cash buyer database",
                "Contract templates",
                "All future features",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2 text-slate-300">
                  <span className="text-emerald-400">✓</span>
                  {item}
                </li>
              ))}
            </ul>
            <button className="w-full rounded-lg border border-slate-600 py-2.5 text-sm text-slate-300 hover:bg-slate-800">
              Manage Billing
            </button>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="text-xl">💳</span>
              <h2 className="text-lg font-semibold">Account</h2>
            </div>
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-slate-500">Name</p>
                <p className="font-medium text-white">{displayName}</p>
              </div>
              <div>
                <p className="text-slate-500">Email</p>
                <p className="font-medium text-white">{user.email}</p>
              </div>
              <div>
                <p className="text-slate-500">Plan</p>
                <p className="font-medium text-emerald-400">Pro</p>
              </div>
            </div>
            <button
              onClick={async () => {
                await signOut();
                router.push("/");
              }}
              className="mt-6 w-full rounded-lg border border-red-500/40 py-2.5 text-sm text-red-400 hover:bg-red-500/10"
            >
              Sign Out
            </button>
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="mb-2 font-semibold">Your Data</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Your leads, buyers, and call history are stored securely in your Supabase
            database with row-level security — each account only ever sees its own data.
            Billing is handled by Stripe.
          </p>
        </div>
      </main>
    </div>
  );
}
