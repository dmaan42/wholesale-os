"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import LeadModal from "@/components/LeadModal";
import { Lead, PIPELINE_STAGES } from "@/lib/types";
import { getLeads, addLead, updateLead, deleteLead, getUser } from "@/lib/store";
import { formatCurrency } from "@/lib/utils";
import { useRouter } from "next/navigation";


export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!getUser()) router.push("/login");
    setLeads(getLeads());
  }, [router]);

  const filtered = leads.filter(
    (l) =>
      l.address.toLowerCase().includes(search.toLowerCase()) ||
      l.ownerName.toLowerCase().includes(search.toLowerCase()) ||
      l.city.toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd = () => {
    const newLead = addLead({
      address: "",
      city: "",
      state: "",
      zip: "",
      ownerName: "",
      phone: "",
      email: "",
      motivation: "",
      status: "new",
      source: "Manual",
      arv: 0,
      repairEstimate: 0,
      offerPrice: 0,
      notes: "",
    });
    setLeads(getLeads());
    setSelected(newLead);
    setModalOpen(true);
    setShowAdd(false);
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar />
      <main className="ml-64 min-h-screen p-6">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Leads</h1>
            <p className="text-sm text-slate-400">{leads.length} total leads</p>
          </div>
          <div className="flex gap-3">
            <div className="relative">
              🔍
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search address, name, city..."
                className="rounded-lg border border-slate-700 bg-slate-900 py-2 pl-9 pr-4 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <button
              onClick={handleAdd}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              ➕
              Add Lead
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Property</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Offer</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">ARV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filtered.map((lead) => {
                const stage = PIPELINE_STAGES.find((s) => s.id === lead.status);
                return (
                  <tr
                    key={lead.id}
                    onClick={() => {
                      setSelected(lead);
                      setModalOpen(true);
                    }}
                    className="cursor-pointer bg-slate-950 hover:bg-slate-900"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-white">{lead.address || "—"}</div>
                      <div className="text-xs text-slate-500">
                        {lead.city}, {lead.state}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-slate-200">{lead.ownerName || "—"}</div>
                      <div className="text-xs text-slate-500">{lead.phone}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-2.5 py-1 text-xs">
                        <span className={`h-1.5 w-1.5 rounded-full ${stage?.color || "bg-gray-400"}`} />
                        {stage?.label || lead.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-200">
                      {lead.offerPrice > 0 ? formatCurrency(lead.offerPrice) : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{lead.source}</td>
                    <td className="px-4 py-3 text-slate-200">
                      {lead.arv > 0 ? formatCurrency(lead.arv) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="py-12 text-center text-slate-500">No leads found</p>
          )}
        </div>
      </main>

      <LeadModal
        lead={selected}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={(updated) => {
          updateLead(updated.id, updated);
          setLeads(getLeads());
        }}
        onDelete={(id) => {
          deleteLead(id);
          setLeads(getLeads());
        }}
      />
    </div>
  );
}
