"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

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

export default function WebLeadsPage() {
  const [leads, setLeads] = useState<WebLead[]>([]);

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
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Incoming Seller Leads</h1>
            <p className="text-slate-400">From your public We Buy Houses page</p>
          </div>
          <Link href="/dashboard" className="text-emerald-400">
            Back to dashboard
          </Link>
        </div>

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
                  <td className="p-3">
                    {lead.address}, {lead.city} {lead.state}
                  </td>
                  <td className="p-3">{lead.phone}</td>
                  <td className="p-3">
                    <input
                      type="date"
                      defaultValue={lead.follow_up_date || ""}
                      onChange={(e) => saveFollowUp(lead.id, e.target.value)}
                      className="rounded bg-slate-800 px-2 py-1"
                    />
                  </td>
                  <td className="p-3">
                    <select
                      value={lead.status}
                      onChange={(e) => markStatus(lead.id, e.target.value)}
                      className="rounded bg-slate-800 px-2 py-1"
                    >
                      <option value="new">New</option>
                      <option value="called">Called</option>
                      <option value="follow-up">Follow up</option>
                      <option value="under-contract">Under contract</option>
                      <option value="dead">Dead</option>
                    </select>
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => copyBuyerBlast(lead)}
                      className="rounded bg-emerald-600 px-3 py-1"
                    >
                      Send to Buyers
                    </button>
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
