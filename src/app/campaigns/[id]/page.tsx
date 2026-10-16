"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import SubscriptionGate from "@/components/SubscriptionGate";
import { useAuth } from "@/lib/auth";

function authHeaders(session: any): HeadersInit {
  return {
    ...(session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {}),
  };
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, session, loading: authLoading } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFor, setAudioFor] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);

  const playRecording = useCallback(
    async (providerCallId: string) => {
      // Toggle off if already playing this one.
      if (audioFor === providerCallId && audioUrl) {
        setAudioFor(null);
        setAudioUrl(null);
        return;
      }
      setAudioLoading(true);
      try {
        const res = await fetch(
          `/api/call-logs/recording?providerCallId=${encodeURIComponent(providerCallId)}`,
          { headers: authHeaders(session) }
        );
        if (!res.ok) throw new Error("Recording unavailable");
        const blob = await res.blob();
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setAudioUrl(URL.createObjectURL(blob));
        setAudioFor(providerCallId);
      } catch (e: any) {
        setError(e.message || "Recording failed");
      } finally {
        setAudioLoading(false);
      }
    },
    [session, audioFor, audioUrl]
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        headers: authHeaders(session),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load campaign");
      setData(json);
      setError(json.liveError || "");
    } catch (e: any) {
      setError(e.message || "Failed to load campaign");
    } finally {
      setLoading(false);
    }
  }, [id, session]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
      return;
    }
    if (user) load();
  }, [user, authLoading, router, load]);

  // Display refresh while the campaign is running. Dispatch is driven
  // server-side by the Vercel Cron sweeper (/api/campaigns/pump-all, every
  // minute) — this page only reloads data, so the campaign keeps dialing
  // even if you close this tab.
  useEffect(() => {
    if (data?.campaign?.status !== "running") return;
    const t = setInterval(() => {
      load().catch(() => null);
    }, 15000);
    return () => clearInterval(t);
  }, [data?.campaign?.status, load]);

  const resume = async () => {
    if (
      !window.confirm(
        "Resume this campaign? Queued contacts will be dialed and stale in-flight contacts reconciled with ElevenLabs."
      )
    )
      return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders(session) },
        body: JSON.stringify({ action: "resume" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Resume failed");
      await load();
    } catch (e: any) {
      setError(e.message || "Resume failed");
    } finally {
      setCancelling(false);
    }
  };

  const retryFailed = async () => {
    if (
      !window.confirm(
        "Retry all failed calls in this campaign? They will be re-queued for dialing."
      )
    )
      return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders(session) },
        body: JSON.stringify({ action: "retry_failed" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Retry failed");
      await load();
    } catch (e: any) {
      setError(e.message || "Retry failed");
    } finally {
      setCancelling(false);
    }
  };

  const cancel = async () => {
    if (!window.confirm("Stop this campaign? Calls already in progress may finish.")) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders(session) },
        body: JSON.stringify({ action: "cancel" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Cancel failed");
      await load();
    } catch (e: any) {
      setError(e.message || "Cancel failed");
    } finally {
      setCancelling(false);
    }
  };

  const campaign = data?.campaign;
  const live = data?.live;
  const counters = live?.contactCounters ?? {};
  const metrics = live?.callMetrics ?? {};
  const contacts: any[] = Array.isArray(live?.contacts) ? live.contacts : [];

  const total = campaign?.total_contacts ?? 0;
  // DB contact statuses: queued | dispatching | dialing | completed |
  // failed | busy | no-answer | cancelled
  const dialingCount =
    (counters.dialing ?? 0) + (counters.dispatching ?? 0);
  const done =
    (counters.completed ?? 0) +
    (counters.failed ?? 0) +
    (counters.busy ?? 0) +
    (counters["no-answer"] ?? 0) +
    (counters.cancelled ?? 0);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const statusTiles: [string, number][] = [
    ["Pending", counters.queued ?? 0],
    ["Dialing", dialingCount],
    ["Completed", counters.completed ?? 0],
    ["No answer", counters["no-answer"] ?? 0],
    ["Busy", counters.busy ?? 0],
    ["Failed", counters.failed ?? 0],
    ["Cancelled", counters.cancelled ?? 0],
  ];

  return (
    <SubscriptionGate>
    <div className="min-h-screen bg-slate-950 text-white">
      <Sidebar />
      <main className="ml-64 p-8">
        <Link href="/campaigns" className="text-sm text-slate-400 hover:text-white">
          ← All campaigns
        </Link>

        {loading ? (
          <p className="mt-6 text-slate-400">Loading…</p>
        ) : !campaign ? (
          <p className="mt-6 text-red-400">{error || "Campaign not found."}</p>
        ) : (
          <>
            <div className="mt-4 flex items-start justify-between">
              <div>
                <h1 className="text-3xl font-bold">{campaign.name}</h1>
                <p className="mt-1 text-slate-400">
                  Status:{" "}
                  <span className="font-semibold text-white">
                    {live?.status ?? campaign.status}
                  </span>{" "}
                  · {total} contacts ·{" "}
                  {new Date(campaign.created_at).toLocaleString()}
                </p>
              </div>
              {campaign.status === "running" && (
                <button
                  onClick={cancel}
                  disabled={cancelling}
                  className="rounded-lg border border-red-700 px-5 py-2.5 font-semibold text-red-400 hover:bg-red-950 disabled:opacity-50"
                >
                  {cancelling ? "Stopping…" : "Stop campaign"}
                </button>
              )}
              {(campaign.status === "failed" ||
                campaign.status === "cancelled") && (
                <button
                  onClick={resume}
                  disabled={cancelling}
                  className="rounded-lg bg-emerald-600 px-5 py-2.5 font-semibold hover:bg-emerald-500 disabled:opacity-50"
                >
                  {cancelling ? "Resuming…" : "Resume campaign"}
                </button>
              )}
              {(campaign.status === "running" ||
                campaign.status === "completed") && (
                <button
                  onClick={retryFailed}
                  disabled={cancelling}
                  className="rounded-lg border border-amber-700 px-5 py-2.5 font-semibold text-amber-400 hover:bg-amber-950 disabled:opacity-50"
                >
                  {cancelling ? "Retrying…" : "Retry failed calls"}
                </button>
              )}
            </div>

            {error && <p className="mt-4 text-sm text-amber-400">{error}</p>}

            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <div className="flex justify-between text-sm text-slate-400">
                <span>Progress</span>
                <span>
                  {done} / {total} ({pct}%)
                </span>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {statusTiles.map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-xl bg-slate-800/60 px-4 py-3 text-center"
                  >
                    <p className="text-2xl font-bold">{value}</p>
                    <p className="text-xs text-slate-400">{label}</p>
                  </div>
                ))}
              </div>
              {(metrics.dialed !== undefined || metrics.connected !== undefined) && (
                <p className="mt-3 text-sm text-slate-400">
                  Dialed: {metrics.dialed ?? "—"} · Connected:{" "}
                  {metrics.connected ?? "—"}
                </p>
              )}
            </div>

            <h2 className="mt-8 text-xl font-bold">Contacts</h2>
            <div className="mt-3 overflow-hidden rounded-2xl border border-slate-800">
              {contacts.length === 0 ? (
                <p className="bg-slate-900 px-5 py-6 text-center text-sm text-slate-500">
                  {live
                    ? "No contact detail yet — check back as calls go out."
                    : "Live contact data unavailable."}
                </p>
              ) : (
                contacts.map((c: any, i: number) => {
                  const call = c.call ?? null;
                  const outcome = call?.outcome ?? null;
                  const dur = call?.durationSeconds;
                  return (
                    <div
                      key={c.id ?? i}
                      className="border-b border-slate-800/60 bg-slate-900 px-5 py-3 last:border-0"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {c.name || "Unknown"} · {c.number || c.phone || ""}
                          </p>
                          {c.endedReason && (
                            <p className="text-xs text-slate-500">{c.endedReason}</p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {outcome && (
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                /hot/i.test(outcome)
                                  ? "bg-red-500/20 text-red-300"
                                  : /interest|follow/i.test(outcome)
                                    ? "bg-amber-500/20 text-amber-300"
                                    : /dnc|not interested/i.test(outcome)
                                      ? "bg-slate-700/40 text-slate-400"
                                      : "bg-emerald-500/20 text-emerald-300"
                              }`}
                            >
                              {outcome}
                            </span>
                          )}
                          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">
                            {c.status ?? "—"}
                          </span>
                        </div>
                      </div>
                      {(dur != null || call?.summary) && (
                        <div className="mt-1.5 text-xs text-slate-400">
                          {dur != null && dur > 0 && (
                            <span className="mr-2 text-slate-500">
                              {Math.floor(dur / 60)}:{String(dur % 60).padStart(2, "0")}
                            </span>
                          )}
                          {call?.summary && (
                            <span className="line-clamp-2">{call.summary}</span>
                          )}
                        </div>
                      )}
                      {call?.providerCallId && (
                        <div className="mt-1.5">
                          <button
                            onClick={() => playRecording(call.providerCallId)}
                            disabled={audioLoading}
                            className="text-xs text-sky-400 hover:text-sky-300 disabled:opacity-50"
                          >
                            {audioLoading && audioFor !== call.providerCallId
                              ? "Loading…"
                              : audioFor === call.providerCallId
                                ? "⏸ Hide recording"
                                : "▶ Play recording"}
                          </button>
                          {audioFor === call.providerCallId && audioUrl && (
                            <audio className="mt-2 w-full" controls src={audioUrl} autoPlay />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Call outcomes, recordings and summaries are written to each
              lead&apos;s call history automatically when calls finish.
              {campaign.status === "running" &&
                " Dialing runs automatically in the background — you can close this page."}
            </p>
          </>
        )}
      </main>
    </div>
    </SubscriptionGate>
  );
}
