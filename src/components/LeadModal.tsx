"use client";

import { useState, useEffect } from "react";
import { Lead, LeadStatus, PIPELINE_STAGES } from "@/lib/types";
import { getCallLogs, type CallLog } from "@/lib/db";
import { useAuth } from "@/lib/auth";

interface TracePhone {
  number: string;
  type: string | null;
  dnc: boolean;
  litigator: boolean;
}

interface TracePerson {
  name: string | null;
  phones: TracePhone[];
  emails: string[];
}

interface Props {
  lead: Lead | null;
  open: boolean;
  onClose: () => void;
  onSave: (lead: Lead) => void;
  onDelete: (id: string) => void;
}

export default function LeadModal({ lead, open, onClose, onSave, onDelete }: Props) {
  const [form, setForm] = useState<Partial<Lead>>({});
  const [calling, setCalling] = useState(false);
  const [callingOwn, setCallingOwn] = useState(false);
  const [callMsg, setCallMsg] = useState("");
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  // Recording playback: fetched via the authenticated proxy
  // (/api/call-logs/recording) and played from a blob URL — a raw
  // provider URL can't be played directly (Twilio URLs need Basic Auth,
  // ElevenLabs URLs are short-lived signed URLs).
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFor, setAudioFor] = useState<string | null>(null);
  const [tracing, setTracing] = useState(false);
  const [traceMsg, setTraceMsg] = useState("");
  const [tracePersons, setTracePersons] = useState<TracePerson[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { session } = useAuth();

  useEffect(() => {
    if (lead && open) {
      setForm({ ...lead });
      setCallMsg("");
      setTraceMsg("");
      setTracePersons([]);
      setConfirmDelete(false);
      getCallLogs(lead.id).then(setCallLogs).catch(() => {});
    }
  }, [lead, open]);

  const handleCallAI = async () => {
    if (!lead) return;
    if (!lead.phone) {
      setCallMsg("Add a phone number to the lead first.");
      return;
    }
    setCalling(true);
    setCallMsg("");
    try {
      const res = await fetch("/api/dial", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({ leadId: lead.id, phone: lead.phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Call failed");
      setCallMsg("📞 Calling now — the outcome and recording will appear here when it finishes.");
      getCallLogs(lead.id).then(setCallLogs).catch(() => {});
    } catch (e: any) {
      setCallMsg(e.message || "Call failed");
    } finally {
      setCalling(false);
    }
  };

  // Own dialer: Twilio + our own TwiML agent, no ElevenLabs. Mirrors
  // handleCallAI's authenticated fetch, but posts to /api/own-dial and
  // surfaces the server's error verbatim (including any Twilio error
  // code/message) instead of a generic failure.
  const handleCallOwnDialer = async () => {
    if (!lead) return;
    if (!lead.phone) {
      setCallMsg("Add a phone number to the lead first.");
      return;
    }
    setCallingOwn(true);
    setCallMsg("");
    try {
      const res = await fetch("/api/own-dial", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({ leadId: lead.id, phone: lead.phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Own dialer call failed");
      setCallMsg("📞 Calling now with Own Dialer — the outcome and recording will appear here when it finishes.");
      getCallLogs(lead.id).then(setCallLogs).catch(() => {});
    } catch (e: any) {
      setCallMsg(e.message || "Own dialer call failed");
    } finally {
      setCallingOwn(false);
    }
  };

  const playRecording = async (providerCallId: string) => {
    if (audioFor === providerCallId && audioUrl) {
      setAudioFor(null);
      setAudioUrl(null);
      return;
    }
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
      setCallMsg("Recording unavailable for this call.");
    }
  };

  const handleSkipTrace = async () => {
    if (!lead) return;
    setTracing(true);
    setTraceMsg("");
    setTracePersons([]);
    try {
      const res = await fetch("/api/skip-trace", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Skip trace failed");
      const persons: TracePerson[] = data.persons || [];
      setTracePersons(persons);
      const parts: string[] = [];
      if (data.matchedCount > 0) {
        parts.push(`Found ${data.matchedCount} contact${data.matchedCount === 1 ? "" : "s"}`);
      } else {
        parts.push("No contacts found for this address");
      }
      if (data.savedOwnerName) parts.push(`owner name saved`);
      if (data.savedPhone) {
        parts.push(`phone saved`);
        setForm((prev) => ({ ...prev, phone: data.savedPhone }));
      }
      setTraceMsg(`🔍 ${parts.join(" · ")}.`);
    } catch (e: any) {
      setTraceMsg(e.message || "Skip trace failed");
    } finally {
      setTracing(false);
    }
  };

  const useTracePhone = (num: string) => {
    setForm((prev) => ({ ...prev, phone: num }));
    setTraceMsg(`📱 ${num} set as lead phone — hit Save Changes to keep it.`);
  };

  if (!open || !lead) return null;

  const handleChange = (field: keyof Lead, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave({ ...lead, ...form } as Lead);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-700 bg-slate-900 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">Lead Details</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white text-xl">
            ✕
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Property Address</label>
              <input
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                value={form.address || ""}
                onChange={(e) => handleChange("address", e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">City / State / Zip</label>
              <div className="flex gap-2">
                <input
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  value={form.city || ""}
                  onChange={(e) => handleChange("city", e.target.value)}
                  placeholder="City"
                />
                <input
                  className="w-16 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  value={form.state || ""}
                  onChange={(e) => handleChange("state", e.target.value)}
                  placeholder="ST"
                />
                <input
                  className="w-24 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  value={form.zip || ""}
                  onChange={(e) => handleChange("zip", e.target.value)}
                  placeholder="Zip"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Owner Name</label>
              <input
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                value={form.ownerName || ""}
                onChange={(e) => handleChange("ownerName", e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Phone</label>
              <input
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                value={form.phone || ""}
                onChange={(e) => handleChange("phone", e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Email</label>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              value={form.email || ""}
              onChange={(e) => handleChange("email", e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Motivation</label>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              value={form.motivation || ""}
              onChange={(e) => handleChange("motivation", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">ARV</label>
              <input
                type="number"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                value={form.arv || 0}
                onChange={(e) => handleChange("arv", Number(e.target.value))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Repair Estimate</label>
              <input
                type="number"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                value={form.repairEstimate || 0}
                onChange={(e) => handleChange("repairEstimate", Number(e.target.value))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Offer Price</label>
              <input
                type="number"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                value={form.offerPrice || 0}
                onChange={(e) => handleChange("offerPrice", Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Status</label>
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              value={form.status || "new"}
              onChange={(e) => handleChange("status", e.target.value as LeadStatus)}
            >
              {PIPELINE_STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Source</label>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              value={form.source || ""}
              onChange={(e) => handleChange("source", e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Notes</label>
            <textarea
              rows={3}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              value={form.notes || ""}
              onChange={(e) => handleChange("notes", e.target.value)}
            />
          </div>

          {traceMsg && (
            <p className="text-xs text-slate-400">{traceMsg}</p>
          )}
          {tracePersons.length > 0 && (
            <div>
              <label className="mb-2 block text-xs font-medium text-slate-400">
                Skip Trace Results ({tracePersons.length} contact{tracePersons.length === 1 ? "" : "s"})
              </label>
              <div className="space-y-2">
                {tracePersons.map((p, i) => (
                  <div key={i} className="rounded-lg border border-slate-800 bg-slate-800/50 px-3 py-2 text-xs">
                    {p.name && (
                      <p className="font-medium text-slate-200">{p.name}</p>
                    )}
                    {p.phones.length === 0 && (
                      <p className="mt-1 text-slate-500">No phones found</p>
                    )}
                    {p.phones.map((ph, j) => {
                      const blocked = ph.dnc || ph.litigator;
                      return (
                        <div key={j} className="mt-1.5 flex items-center justify-between gap-2">
                          <span className={blocked ? "text-slate-500 line-through" : "text-slate-300"}>
                            {ph.number}
                            {ph.type ? ` · ${ph.type}` : ""}
                          </span>
                          <span className="flex items-center gap-1.5">
                            {ph.dnc && (
                              <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">
                                DNC
                              </span>
                            )}
                            {ph.litigator && (
                              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">
                                LITIGATOR
                              </span>
                            )}
                            {!blocked && (
                              <button
                                onClick={() => useTracePhone(ph.number)}
                                className="rounded bg-emerald-600/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 hover:bg-emerald-600/40"
                              >
                                Use
                              </button>
                            )}
                          </span>
                        </div>
                      );
                    })}
                    {p.emails.length > 0 && (
                      <p className="mt-1 text-slate-500">{p.emails.join(", ")}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="mb-2 block text-xs font-medium text-slate-400">
              AI Call History {callLogs.length > 0 && `(${callLogs.length})`}
            </label>
            {callLogs.length === 0 ? (
              <p className="text-xs text-slate-600">No AI calls yet — hit “Call with AI” below.</p>
            ) : (
              <div className="space-y-2">
                {callLogs.slice(0, 3).map((c) => (
                  <div key={c.id} className="rounded-lg border border-slate-800 bg-slate-800/50 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-300">
                        {new Date(c.createdAt).toLocaleDateString()} · {c.status}
                        {c.durationSeconds > 0 && ` · ${c.durationSeconds}s`}
                      </span>
                      {c.providerCallId ? (
                        <button
                          onClick={() => playRecording(c.providerCallId as string)}
                          className="text-emerald-400 hover:underline"
                        >
                          ▶ Recording
                        </button>
                      ) : (
                        c.recordingUrl && (
                          <a href={c.recordingUrl} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">
                            ▶ Recording
                          </a>
                        )
                      )}
                      {audioFor === c.providerCallId && audioUrl && (
                        <audio controls src={audioUrl} className="mt-1 w-full" />
                      )}
                    </div>
                    {(c.outcome || c.summary) && (
                      <p className="mt-1 text-slate-400">{c.outcome || c.summary}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {callMsg && (
          <p className="px-6 pt-1 text-xs text-slate-400">{callMsg}</p>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-slate-700 px-6 py-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (confirmDelete) {
                  onDelete(lead.id);
                  onClose();
                } else {
                  setConfirmDelete(true);
                  setTimeout(() => setConfirmDelete(false), 5000);
                }
              }}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-red-500/10 ${
                confirmDelete ? "bg-red-500/20 font-semibold text-red-300" : "text-red-400"
              }`}
            >
              {confirmDelete ? "⚠️ Click again to confirm delete" : "🗑️ Delete"}
            </button>
            <button
              onClick={handleCallAI}
              disabled={calling}
              className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60"
            >
              {calling ? "Dialing…" : "📞 Call with AI"}
            </button>
            <button
              onClick={handleCallOwnDialer}
              disabled={callingOwn}
              className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-60"
            >
              {callingOwn ? "Dialing…" : "📞 Call with Own Dialer"}
            </button>
            <button
              onClick={handleSkipTrace}
              disabled={tracing}
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-60"
            >
              {tracing ? "Tracing…" : "🔍 Skip Trace"}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              💾 Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
