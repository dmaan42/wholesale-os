"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";
import {
  getProfile,
  updateVapiKeys,
  vapiConnected,
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

  // Vapi form state
  const [apiKey, setApiKey] = useState("");
  const [assistantId, setAssistantId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [vapiMsg, setVapiMsg] = useState("");
  const [vapiSaving, setVapiSaving] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);

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
          setApiKey(p?.vapiApiKey ?? "");
          setAssistantId(p?.vapiAssistantId ?? "");
          setPhoneNumberId(p?.vapiPhoneNumberId ?? "");
        })
        .catch(() => {});
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

  const connected = vapiConnected(profile);
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

  const saveVapi = async () => {
    setVapiMsg("");
    if (!apiKey.trim() || !assistantId.trim() || !phoneNumberId.trim()) {
      setVapiMsg("Fill in all three fields.");
      return;
    }
    setVapiSaving(true);
    try {
      await updateVapiKeys({
        apiKey: apiKey.trim(),
        assistantId: assistantId.trim(),
        phoneNumberId: phoneNumberId.trim(),
      });
      const p = await getProfile();
      setProfile(p);
      setVapiMsg("✓ Vapi account connected.");
    } catch (e: any) {
      setVapiMsg(e.message || "Save failed");
    } finally {
      setVapiSaving(false);
    }
  };

  const disconnectVapi = async () => {
    if (!window.confirm("Disconnect your Vapi account? The dialer and campaigns will stop working until you reconnect.")) return;
    setVapiSaving(true);
    try {
      await updateVapiKeys({ apiKey: null, assistantId: null, phoneNumberId: null });
      setApiKey("");
      setAssistantId("");
      setPhoneNumberId("");
      const p = await getProfile();
      setProfile(p);
      setVapiMsg("Vapi account disconnected.");
    } catch (e: any) {
      setVapiMsg(e.message || "Disconnect failed");
    } finally {
      setVapiSaving(false);
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
              <h2 className="text-lg font-semibold">AI Calling (Vapi)</h2>
            </div>
            <p className="mb-4 text-sm text-slate-400">
              Connect your own Vapi account to power the AI dialer and call
              campaigns. Calls are billed to{" "}
              <span className="font-semibold text-white">your</span> Vapi
              account — never shared with other users.{" "}
              <span
                className={`font-semibold ${connected ? "text-emerald-400" : "text-amber-400"}`}
              >
                {connected ? "● Connected" : "○ Not connected"}
              </span>
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500">Vapi API key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Private API key from vapi.ai → API Keys"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Assistant ID</label>
                <input
                  value={assistantId}
                  onChange={(e) => setAssistantId(e.target.value)}
                  placeholder="Assistant → your assistant → ID"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Phone Number ID</label>
                <input
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value)}
                  placeholder="Phone Numbers → your number → ID"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm"
                />
              </div>
            </div>
            {vapiMsg && <p className="mt-3 text-sm text-slate-300">{vapiMsg}</p>}
            <div className="mt-4 flex gap-3">
              <button
                onClick={saveVapi}
                disabled={vapiSaving}
                className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {vapiSaving ? "Saving…" : connected ? "Update connection" : "Connect Vapi"}
              </button>
              {connected && (
                <button
                  onClick={disconnectVapi}
                  disabled={vapiSaving}
                  className="rounded-lg border border-red-500/40 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                >
                  Disconnect
                </button>
              )}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              New to Vapi? Sign up at vapi.ai, create an assistant and a phone
              number (paid numbers only for campaigns), then paste the three
              values above.
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
