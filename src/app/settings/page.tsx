"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";
import {
  getProfile,
  updateBlandKeys,
  updateBatchDataKey,
  getSkipTraceUsageThisMonth,
  blandConnected,
  batchdataConnected,
  hasActiveAccess,
  type Profile,
} from "@/lib/db";

const TRIAL_DAYS = 14;

function trialDaysLeft(p: Profile | null): number | null {
  if (!p) return null;
  const s = (p.subscriptionStatus || "").toLowerCase();
  if (s === "active" || s === "trialing") return null;
  const ageDays = Math.floor(
    (Date.now() - new Date(p.createdAt).getTime()) / (24 * 3600 * 1000)
  );
  return Math.max(0, TRIAL_DAYS - ageDays);
}

function statusLabel(p: Profile | null): string {
  if (!p) return "Unknown";
  const s = (p.subscriptionStatus || "").toLowerCase();
  if (s === "active") return "Active";
  if (s === "trialing") return "Trialing";
  if (s === "canceled" || s === "cancelled") return "Canceled";
  if (s === "past_due") return "Past due";
  const left = trialDaysLeft(p);
  if (left !== null && left > 0) return `Free trial (${left} day${left === 1 ? "" : "s"} left)`;
  return "Trial ended";
}

export default function SettingsPage() {
  const { user, session, loading, signOut } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  // Bland form state
  const [apiKey, setApiKey] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [blandMsg, setBlandMsg] = useState("");
  const [blandSaving, setBlandSaving] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  // BatchData form state
  const [batchKey, setBatchKey] = useState("");
  const [batchMsg, setBatchMsg] = useState("");
  const [batchSaving, setBatchSaving] = useState(false);
  const [usage, setUsage] = useState<{ traces: number; costCents: number } | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("upgrade=1")) {
      setShowUpgrade(true);
    }
  }, []);

  useEffect(() => {
    if (user) {
      getProfile()
        .then((p) => {
          setProfile(p);
          setApiKey(p?.blandApiKey ?? "");
          setFromNumber(p?.blandFromNumber ?? "");
          setBatchKey(p?.batchdataApiKey ?? "");
        })
        .catch(() => {});
      getSkipTraceUsageThisMonth().then(setUsage).catch(() => {});
    }
  }, [user]);

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

  const connected = blandConnected(profile);
  const batchConnected = batchdataConnected(profile);
  const access = hasActiveAccess(profile);

  const startCheckout = async () => {
    setCheckoutLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "Checkout failed");
      window.location.href = data.url;
    } catch (e: any) {
      alert(e.message || "Could not start checkout");
      setCheckoutLoading(false);
    }
  };

  const saveBland = async () => {
    setBlandMsg("");
    if (!apiKey.trim() || !fromNumber.trim()) {
      setBlandMsg("Fill in both fields.");
      return;
    }
    setBlandSaving(true);
    try {
      await updateBlandKeys({
        apiKey: apiKey.trim(),
        fromNumber: fromNumber.trim(),
      });
      const p = await getProfile();
      setProfile(p);
      setBlandMsg("✓ Bland AI account connected.");
    } catch (e: any) {
      setBlandMsg(e.message || "Save failed");
    } finally {
      setBlandSaving(false);
    }
  };

  const saveBatchData = async () => {
    setBatchMsg("");
    if (!batchKey.trim()) {
      setBatchMsg("Paste your BatchData API key first.");
      return;
    }
    setBatchSaving(true);
    try {
      await updateBatchDataKey(batchKey.trim());
      const p = await getProfile();
      setProfile(p);
      setBatchMsg("✓ BatchData account connected.");
    } catch (e: any) {
      setBatchMsg(e.message || "Save failed");
    } finally {
      setBatchSaving(false);
    }
  };

  const disconnectBatchData = async () => {
    if (!window.confirm("Disconnect your BatchData account? Skip tracing will stop working until you reconnect.")) return;
    setBatchSaving(true);
    try {
      await updateBatchDataKey(null);
      setBatchKey("");
      const p = await getProfile();
      setProfile(p);
      setBatchMsg("BatchData account disconnected.");
    } catch (e: any) {
      setBatchMsg(e.message || "Disconnect failed");
    } finally {
      setBatchSaving(false);
    }
  };

  const disconnectBland = async () => {
    if (!window.confirm("Disconnect your Bland AI account? The dialer and campaigns will stop working until you reconnect.")) return;
    setBlandSaving(true);
    try {
      await updateBlandKeys({ apiKey: null, fromNumber: null });
      setApiKey("");
      setFromNumber("");
      const p = await getProfile();
      setProfile(p);
      setBlandMsg("Bland AI account disconnected.");
    } catch (e: any) {
      setBlandMsg(e.message || "Disconnect failed");
    } finally {
      setBlandSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar />
      <main className="ml-64 min-h-screen p-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Subscription & Settings</h1>
          <p className="text-sm text-slate-400">Manage your plan and account</p>
        </div>

        {showUpgrade && !access && (
          <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-5">
            <h2 className="font-semibold text-amber-200">Your free trial has ended</h2>
            <p className="mt-1 text-sm text-amber-200/80">
              Subscribe to Pro to keep using your CRM, pipeline, and AI dialer.
            </p>
            <button
              onClick={startCheckout}
              disabled={checkoutLoading}
              className="mt-4 rounded-lg bg-emerald-600 px-6 py-2.5 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {checkoutLoading ? "Loading…" : "Subscribe — $197/mo"}
            </button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-emerald-500/40 bg-slate-900 p-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="text-xl">⚡</span>
              <h2 className="text-lg font-semibold">Current Plan</h2>
            </div>
            <div className="mb-1 text-3xl font-bold text-white">
              Pro <span className="text-lg font-normal text-slate-400">$197/mo</span>
            </div>
            <p className="mb-4 text-sm text-slate-400">
              Status:{" "}
              <span className={access ? "text-emerald-400" : "text-amber-400"}>
                {statusLabel(profile)}
              </span>
            </p>
            <ul className="mb-6 space-y-2 text-sm">
              {[
                "Unlimited leads & deals",
                "Full pipeline CRM",
                "Deal analyzer",
                "Cash buyer database",
                "Contract templates",
                "AI call campaigns",
                "All future features",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2 text-slate-300">
                  <span className="text-emerald-400">✓</span>
                  {item}
                </li>
              ))}
            </ul>
            {!access && (
              <button
                onClick={startCheckout}
                disabled={checkoutLoading}
                className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {checkoutLoading ? "Loading…" : "Subscribe now"}
              </button>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="text-xl">📞</span>
              <h2 className="text-lg font-semibold">AI Calling (Bland AI)</h2>
            </div>
            <p className="mb-4 text-sm text-slate-400">
              Connect your own Bland AI account to power the AI dialer and call
              campaigns. Calls are billed to{" "}
              <span className="font-semibold text-white">your</span> Bland
              account — never shared with other users.{" "}
              <span
                className={`font-semibold ${connected ? "text-emerald-400" : "text-amber-400"}`}
              >
                {connected ? "● Connected" : "○ Not connected"}
              </span>
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500">Bland API key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="API key from app.bland.ai dashboard"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Caller ID number</label>
                <input
                  value={fromNumber}
                  onChange={(e) => setFromNumber(e.target.value)}
                  placeholder="+14785518838 (a number on your Bland account)"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm"
                />
              </div>
            </div>
            {blandMsg && <p className="mt-3 text-sm text-slate-300">{blandMsg}</p>}
            <div className="mt-4 flex gap-3">
              <button
                onClick={saveBland}
                disabled={blandSaving}
                className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {blandSaving ? "Saving…" : connected ? "Update connection" : "Connect Bland AI"}
              </button>
              {connected && (
                <button
                  onClick={disconnectBland}
                  disabled={blandSaving}
                  className="rounded-lg border border-red-500/40 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                >
                  Disconnect
                </button>
              )}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              New to Bland AI? Sign up at bland.ai, grab a phone number, then
              paste your API key and caller ID number above.
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
            <div className="mb-4 flex items-center gap-2">
              <span className="text-xl">🔍</span>
              <h2 className="text-lg font-semibold">Data & Skip Tracing (BatchData)</h2>
            </div>
            <p className="mb-4 text-sm text-slate-400">
              Connect your own BatchData account to skip trace leads right from
              the CRM. Lookups are billed to{" "}
              <span className="font-semibold text-white">your</span> BatchData
              account — never shared with other users.{" "}
              <span
                className={`font-semibold ${batchConnected ? "text-emerald-400" : "text-amber-400"}`}
              >
                {batchConnected ? "● Connected" : "○ Not connected"}
              </span>
            </p>
            {usage && (
              <p className="mb-4 text-sm text-slate-400">
                This month:{" "}
                <span className="font-semibold text-white">{usage.traces}</span>{" "}
                traces ·{" "}
                <span className="font-semibold text-white">
                  ${(usage.costCents / 100).toFixed(2)}
                </span>{" "}
                estimated
              </p>
            )}
            <div>
              <label className="text-xs text-slate-500">BatchData API key</label>
              <input
                type="password"
                value={batchKey}
                onChange={(e) => setBatchKey(e.target.value)}
                placeholder="API key from batchdata.com dashboard"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm"
              />
            </div>
            {batchMsg && <p className="mt-3 text-sm text-slate-300">{batchMsg}</p>}
            <div className="mt-4 flex gap-3">
              <button
                onClick={saveBatchData}
                disabled={batchSaving}
                className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {batchSaving ? "Saving…" : batchConnected ? "Update connection" : "Connect BatchData"}
              </button>
              {batchConnected && (
                <button
                  onClick={disconnectBatchData}
                  disabled={batchSaving}
                  className="rounded-lg border border-red-500/40 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                >
                  Disconnect
                </button>
              )}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              New to BatchData? Sign up at batchdata.com, grab an API key, then
              paste it above. Each skip trace bills your BatchData account
              per matched record.
            </p>
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
