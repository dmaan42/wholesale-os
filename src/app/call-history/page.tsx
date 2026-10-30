"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import SubscriptionGate from "@/components/SubscriptionGate";
import { useAuth } from "@/lib/auth";
import { getCallLogs, getLeads, type CallLog } from "@/lib/db";
import type { Lead } from "@/lib/types";

const OUTCOME_STYLES: Record<string, string> = {
  hot: "bg-red-500/15 text-red-400",
  follow_up: "bg-amber-500/15 text-amber-400",
  not_interested: "bg-slate-600/20 text-slate-300",
  dnc: "bg-purple-500/15 text-purple-400",
};

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-red-500/15 text-red-400",
  dialing: "bg-blue-500/15 text-blue-400",
  initiated: "bg-slate-600/20 text-slate-300",
};

function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function CallHistoryPage() {
  const router = useRouter();
  const { user, session, loading: authLoading } = useAuth();
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Recording playback via the authenticated proxy (see LeadModal):
  // raw provider URLs are not playable directly from a browser.
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFor, setAudioFor] = useState<string | null>(null);
  const [audioError, setAudioError] = useState("");

  const playRecording = async (providerCallId: string) => {
    if (audioFor === providerCallId && audioUrl) {
      setAudioFor(null);
      setAudioUrl(null);
      return;
    }
    setAudioError("");
    try {
      const res = await fetch(
        `/api/call-logs/recording?providerCallId=${encodeURIComponent(providerCallId)}`,
        {
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {},
        }
      );
      if (!res.ok) throw new Error("Recording unavailable");
      const blob = await res.blob();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(URL.createObjectURL(blob));
      setAudioFor(providerCallId);
    } catch {
      setAudioError("Recording unavailable for this call.");
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
      return;
    }
    if (user) {
      Promise.all([getCallLogs(), getLeads()])
        .then(([c, l]) => {
          setCalls(c);
          setLeads(l);
        })
        .finally(() => setLoading(false));
    }
  }, [user, authLoading, router]);

  const leadById = useMemo(() => {
    const map = new Map<string, Lead>();
    for (const l of leads) map.set(l.id, l);
    return map;
  }, [leads]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return calls.filter((c) => {
      if (outcomeFilter !== "all" && (c.outcome ?? "") !== outcomeFilter) return false;
      if (!q) return true;
      const lead = c.leadId ? leadById.get(c.leadId) : undefined;
      const hay = `${c.phone} ${lead?.ownerName ?? ""} ${lead?.address ?? ""} ${c.summary ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [calls, query, outcomeFilter, leadById]);

  return (
    <SubscriptionGate>
      <div className="flex min-h-screen bg-slate-950 text-slate-100">
        <Sidebar />
        <main className="ml-64 flex-1 p-8">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Call History</h1>
              <p className="text-sm text-slate-400">
                Every AI call, transcript, and outcome in one place.
              </p>
            </div>
          </div>

          <div className="mb-4 flex gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by phone, name, address, or summary…"
              className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none placeholder:text-slate-500 focus:border-emerald-500"
            />
            <select
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
            >
              <option value="all">All outcomes</option>
              <option value="hot">🔥 Hot</option>
              <option value="follow_up">📋 Follow-up</option>
              <option value="not_interested">🚫 Not interested</option>
              <option value="dnc">⛔ DNC</option>
            </select>
          </div>

          {loading ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-400">
              Loading calls…
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center text-slate-400">
              {calls.length === 0
                ? "No calls yet. Launch a campaign to start dialing."
                : "No calls match your filters."}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((c) => {
                const lead = c.leadId ? leadById.get(c.leadId) : undefined;
                const expanded = expandedId === c.id;
                return (
                  <div
                    key={c.id}
                    className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
                  >
                    <button
                      onClick={() => setExpandedId(expanded ? null : c.id)}
                      className="flex w-full items-center gap-4 text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {lead ? `${lead.ownerName} — ${lead.address}` : c.phone}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDate(c.createdAt)} · {formatDuration(c.durationSeconds)} · {c.phone}
                        </p>
                      </div>
                      {c.outcome && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${OUTCOME_STYLES[c.outcome] ?? "bg-slate-600/20 text-slate-300"}`}
                        >
                          {c.outcome.replace("_", " ")}
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[c.status] ?? "bg-slate-600/20 text-slate-300"}`}
                      >
                        {c.status}
                      </span>
                      <span className="text-slate-500">{expanded ? "▾" : "▸"}</span>
                    </button>
                    {expanded && (
                      <div className="mt-3 space-y-2 border-t border-slate-800 pt-3 text-sm">
                        {c.summary && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</p>
                            <p className="text-slate-300">{c.summary}</p>
                          </div>
                        )}
                        {c.recordingUrl && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recording</p>
                            {c.providerCallId ? (
                              <>
                                <button
                                  onClick={() => playRecording(c.providerCallId as string)}
                                  className="mt-1 text-sm text-emerald-400 hover:underline"
                                >
                                  ▶ Play recording
                                </button>
                                {audioFor === c.providerCallId && audioUrl && (
                                  <audio controls src={audioUrl} className="mt-1 w-full" />
                                )}
                                {audioError && (
                                  <p className="mt-1 text-xs text-red-400">{audioError}</p>
                                )}
                              </>
                            ) : (
                              <audio controls src={c.recordingUrl} className="mt-1 w-full" />
                            )}
                          </div>
                        )}
                        {!c.summary && !c.recordingUrl && (
                          <p className="text-slate-500">No transcript or recording available for this call.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </SubscriptionGate>
  );
}
