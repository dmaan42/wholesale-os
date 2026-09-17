"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import PipelineCard from "@/components/PipelineCard";
import LeadModal from "@/components/LeadModal";
import { Lead, PIPELINE_STAGES } from "@/lib/types";
import { getLeads, updateLead, deleteLead, getUser } from "@/lib/store";
import { useRouter } from "next/navigation";

import Link from "next/link";

export default function DashboardPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const user = getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    setLeads(getLeads());
  }, [router]);

  const handleSave = (updated: Lead) => {
    updateLead(updated.id, updated);
    setLeads(getLeads());
  };

  const handleDelete = (id: string) => {
    deleteLead(id);
    setLeads(getLeads());
  };

  const stages = PIPELINE_STAGES.filter((s) => s.id !== "dead");

  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar />
      <main className="ml-64 min-h-screen p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Deal Pipeline</h1>
            <p className="text-sm text-slate-400">Drag deals through stages or click to edit</p>
          </div>
          <Link
            href="/leads"
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            ➕
            Add Lead
          </Link>
        </div>

        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => {
            const stageLeads = leads.filter((l) => l.status === stage.id);
            return (
              <div key={stage.id} className="w-72 shrink-0">
                <div className="mb-3 flex items-center gap-2">
                  <div className={`h-2.5 w-2.5 rounded-full ${stage.color}`} />
                  <h3 className="text-sm font-semibold text-slate-200">{stage.label}</h3>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
                    {stageLeads.length}
                  </span>
                </div>
                <div className="space-y-2 min-h-[200px] rounded-xl border border-slate-800 bg-slate-900/50 p-2">
                  {stageLeads.map((lead) => (
                    <PipelineCard
                      key={lead.id}
                      lead={lead}
                      onClick={() => {
                        setSelected(lead);
                        setModalOpen(true);
                      }}
                    />
                  ))}
                  {stageLeads.length === 0 && (
                    <p className="py-8 text-center text-xs text-slate-600">No deals</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      <LeadModal
        lead={selected}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
  );
}
