"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type WebLead = {
  id: string;
  owner_name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  motivation: string;
  notes: string;
  follow_up_date: string | null;
  status: string;
};

export default function SellPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [leads, setLeads] = useState<WebLead[]>([]);
  const [form, setForm] = useState({
    owner_name: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    motivation: "",
    notes: "",
  });

  const load = async () => {
    const { data } = await supabase
      .from("public_leads")
      .select("*")
      .order("created_at", { ascending: false });
    setLeads((data as WebLead[]) || []);
  };

  useEffect(() => {
    load();
  }, []);

  const update = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await fetch("/api/public-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    setSent(true);
    load();
  };

  const saveFollowUp = async (id: string, follow_up_date: string) => {
    await supabase.from("public_leads").update({ follow_up_date }).eq("id", id);
    load();
  };

  const markStatus = async (id: string, status: string) => {
    await supabase.from("public_leads").update({ status }).eq("id", id);
    load();
  };

  const copyBuyerBlast = (lead: WebLead) => {
    const text = `New off-market deal

Property: ${lead.address}, ${lead.city}, ${lead.state} ${lead.zip}
Seller motivation: ${lead.motivation || "Not listed"}
Notes: ${lead.notes || "None"}

If you want this deal, reply YES and I’ll send the numbers.`;
    navigator.clipboard.writeText(text);
    alert("Buyer message copied. Paste it into text or email.");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="mx-auto max-w-5xl">
        <p className="text-emerald-400 font-semibold mb-2">We Buy Houses</p>
        <h1 className="text-4xl font-bold mb-3">Get a cash offer for your house</h1>

        {sent ? (
          <p className="mb-8 text-emerald-300">We got your info. A local cash buyer specialist will contact you shortly.</p>
        ) : (
          <form onSubmit={submit} className="mb-10 space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 max-w-xl">
            <input required placeholder="Your name" value={form.owner_name} onChange={(e) => update("owner_name", e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3" />
            <input required placeholder="Phone" value={form.phone} onChange={(e) => update("phone", e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3" />
            <input placeholder="Email" value={form.email} onChange={(e) => update("email", e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3" />
            <input required placeholder="Property address" value={form.address} onChange={(e) => update("address", e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3" />
            <input required placeholder="City" value={form.city} onChange={(e) => update("city", e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3" />
            <input required placeholder="State" value={form.state} onChange={(e) => update("state", e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3" />
            <input required placeholder="ZIP" value={form.zip} onChange={(e) => update("zip", e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3" />
            <select value={form.motivation} onChange={(e) => update("motivation", e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3">
              <option value="">Why are you selling?</option>
              <option>Tired landlord</option>
              <option>Inherited property</option>
              <option>Behind on payments</option>
              <option>Needs repairs</option>
              <option>Relocating</option>
              <option>Other</option>
            </select>
            <textarea placeholder="Anything else we should know?" value={form.notes} onChange={(e) => update("notes", e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 min-h-24" />
            <button disabled={loading} className="w-full rounded-lg bg-emerald-600 py-3 font-semibold">
              {loading ? "Sending..." : "Get my cash offer"}
            </button>
          </form>
        )}

        <h2 className="text-2xl font-bold mb-4">Incoming seller leads</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="p-3">Seller</th>
                <th className="p-3">Property</th>
                <th className="p-3">Phone</th>
                <th className="p-3">Follow up</th>
                <th className="p-3">Status</th>
                <th className="p-3">Buyer blast</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-t border-slate-800">
                  <td className="p-3">{lead.owner_name}</td>
                  <td className="p-3">{lead.address}, {lead.city} {lead.state}</td>
                  <td className="p-3">{lead.phone}</td>
                  <td className="p-3">
                    <input type="date" defaultValue={lead.follow_up_date || ""} onChange={(e) => saveFollowUp(lead.id, e.target.value)} className="rounded bg-slate-800 px-2 py-1" />
                  </td>
                  <td className="p-3">
                    <select value={lead.status || "new"} onChange={(e) => markStatus(lead.id, e.target.value)} className="rounded bg-slate-800 px-2 py-1">
                      <option value="new">New</option>
                      <option value="called">Called</option>
                      <option value="follow-up">Follow up</option>
                      <option value="under-contract">Under contract</option>
                      <option value="dead">Dead</option>
                    </select>
                  </td>
                  <td className="p-3">
                    <button onClick={() => copyBuyerBlast(lead)} className="rounded bg-emerald-600 px-3 py-1">Send to Buyers</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
