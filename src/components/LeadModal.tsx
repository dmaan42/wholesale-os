"use client";

import { useState, useEffect } from "react";
import { Lead, LeadStatus, PIPELINE_STAGES } from "@/lib/types";
import { getCallLogs, type CallLog } from "@/lib/db";
import { useAuth } from "@/lib/auth";

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
  const [callMsg, setCallMsg] = useState("");
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const { session } = useAuth();

  useEffect(() => {
    if (lead && open) {
      setForm({ ...lead });
      setCallMsg("");
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
                      {c.recordingUrl && (
                        <a href={c.recordingUrl} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">
                          ▶ Recording
                        </a>
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
                if (confirm("Delete this lead?")) {
                  onDelete(lead.id);
                  onClose();
                }
              }}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-red-500/10"
            >
              🗑️ Delete
            </button>
            <button
              onClick={handleCallAI}
              disabled={calling}
              className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60"
            >
              {calling ? "Dialing…" : "📞 Call with AI"}
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
