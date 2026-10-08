"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import SubscriptionGate from "@/components/SubscriptionGate";
import { useAuth } from "@/lib/auth";
import { getLeads, getCampaigns, type Campaign } from "@/lib/db";
import type { Lead } from "@/lib/types";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-600/20 text-slate-300",
  running: "bg-emerald-500/15 text-emerald-400",
  cancelled: "bg-amber-500/15 text-amber-400",
  completed: "bg-blue-500/15 text-blue-400",
  failed: "bg-red-500/15 text-red-400",
};

function authHeaders(session: any): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {}),
  };
}

export default function CampaignsPage() {
  const router = useRouter();
  const { user, session, loading: authLoading } = useAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  // Create-modal state
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [concurrency, setConcurrency] = useState(1);
  const [startMode, setStartMode] = useState<"now" | "later">("now");
  const [startAt, setStartAt] = useState("");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const [c, l] = await Promise.all([getCampaigns(), getLeads()]);
      setCampaigns(c);
      setLeads(l);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
      return;
    }
    if (user) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, router]);

  const dialableLeads = useMemo(
    () => leads.filter((l) => (l.phone || "").replace(/\D/g, "").length >= 10),
    [leads]
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return dialableLeads;
    return dialableLeads.filter((l) =>
      `${l.ownerName} ${l.address} ${l.city} ${l.phone}`.toLowerCase().includes(q)
    );
  }, [dialableLeads, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const launch = async () => {
    setError("");
    if (selected.size === 0) {
      setError("Select at least one lead.");
      return;
    }
    let earliestAt: string | undefined;
    if (startMode === "later") {
      if (!startAt) {
        setError("Pick a start date and time.");
        return;
      }
      const d = new Date(startAt);
      if (isNaN(d.getTime()) || d.getTime() <= Date.now()) {
        setError("Start time must be in the future.");
        return;
      }
      earliestAt = d.toISOString();
    }
    const sample = dialableLeads
      .filter((l) => selected.has(l.id))
      .slice(0, 3)
      .map((l) => `${l.ownerName || "Unknown"} (${l.phone})`)
      .join(", ");
    const ok = window.confirm(
      `Launch "${name || "Untitled campaign"}"?\n\n` +
        `${selected.size} lead${selected.size === 1 ? "" : "s"} will be called ` +
        `(${concurrency} at a time)${earliestAt ? ` starting ${new Date(earliestAt).toLocaleString()}` : " right away"}.\n` +
        `Including: ${sample}${selected.size > 3 ? ", …" : ""}\n\n` +
        `This places real, chargeable calls. Only include leads you are allowed to auto-dial.`
    );
    if (!ok) return;

    setLaunching(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: authHeaders(session),
        body: JSON.stringify({
          name: name || "Untitled campaign",
          leadIds: [...selected],
          maxConcurrency: concurrency,
          ...(earliestAt ? { earliestAt } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Launch failed");
      setModalOpen(false);
      setName("");
      setSelected(new Set());
      setQuery("");
      router.push(`/campaigns/${data.campaignId}`);
    } catch (e: any) {
      setError(e.message || "Launch failed");
    } finally {
      setLaunching(false);
    }
  };

  return (
    <SubscriptionGate>
    <div className="min-h-screen bg-slate-950 text-white">
      <Sidebar />
      <main className="ml-64 p-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">AI Call Campaigns</h1>
            <p className="mt-1 text-slate-400">
              Dial a whole group of leads automatically — outcomes, recordings
              and summaries land back in your CRM.
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 font-semibold hover:bg-emerald-500"
          >
            + New campaign
          </button>
        </div>

        {loading ? (
          <p className="text-slate-400">Loading…</p>
        ) : campaigns.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center">
            <p className="text-4xl">📞</p>
            <p className="mt-3 text-lg font-semibold">No campaigns yet</p>
            <p className="mt-1 text-slate-400">
              Create your first batch campaign and let the AI dial the list for
              you.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map((c) => (
              <Link
                key={c.id}
                href={`/campaigns/${c.id}`}
                className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-5 py-4 hover:border-slate-600"
              >
                <div>
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-sm text-slate-400">
                    {c.totalContacts} contact{c.totalContacts === 1 ? "" : "s"} ·{" "}
                    {new Date(c.createdAt).toLocaleString()}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[c.status] ?? STATUS_STYLES.draft}`}
                >
                  {c.status}
                </span>
              </Link>
            ))}
          </div>
        )}

        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6">
              <h2 className="text-xl font-bold">New call campaign</h2>

              <label className="mt-4 block text-sm text-slate-400">
                Campaign name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Memphis 38118 — October batch"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5"
              />

              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400">
                    Simultaneous calls
                  </label>
                  <select
                    value={concurrency}
                    onChange={(e) => setConcurrency(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5"
                  >
                    <option value={1}>1 at a time (safest)</option>
                    <option value={2}>2 at a time</option>
                    <option value={3}>3 at a time</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate-400">Start</label>
                  <select
                    value={startMode}
                    onChange={(e) =>
                      setStartMode(e.target.value as "now" | "later")
                    }
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5"
                  >
                    <option value="now">Start right away</option>
                    <option value="later">Schedule for later</option>
                  </select>
                </div>
              </div>
              {startMode === "later" && (
                <input
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5"
                />
              )}

              <label className="mt-4 block text-sm text-slate-400">
                Leads to call ({selected.size} selected)
              </label>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, address, or phone…"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5"
              />
              <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-800">
                {filtered.map((l) => (
                  <label
                    key={l.id}
                    className="flex cursor-pointer items-center gap-3 border-b border-slate-800/60 px-4 py-2.5 hover:bg-slate-800/60"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={() => toggle(l.id)}
                      className="h-4 w-4 accent-emerald-500"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {l.ownerName || "Unknown"} · {l.phone}
                      </p>
                      <p className="truncate text-xs text-slate-400">
                        {l.address}, {l.city}, {l.state}
                      </p>
                    </div>
                  </label>
                ))}
                {filtered.length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-slate-500">
                    No leads with phone numbers found.
                  </p>
                )}
              </div>

              <p className="mt-3 text-xs text-slate-500">
                Only include leads you are allowed to auto-dial. You are
                responsible for consent, do-not-call, and calling-hour rules.
                Note: Vapi free numbers can&apos;t run campaigns — use a paid
                Vapi number.
              </p>

              {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

              <div className="mt-5 flex justify-end gap-3">
                <button
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-700 px-5 py-2.5 text-slate-300 hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  onClick={launch}
                  disabled={launching}
                  className="rounded-lg bg-emerald-600 px-5 py-2.5 font-semibold hover:bg-emerald-500 disabled:opacity-50"
                >
                  {launching ? "Launching…" : "🚀 Launch campaign"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
    </SubscriptionGate>
  );
}
