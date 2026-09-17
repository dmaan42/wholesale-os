"use client";

import { Lead } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

interface Props {
  lead: Lead;
  onClick: () => void;
}

export default function PipelineCard({ lead, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-lg border border-slate-700 bg-slate-800/80 p-3 shadow-sm transition hover:border-emerald-500/50 hover:bg-slate-800"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-100 leading-tight">
          {lead.address}
        </h4>
        {lead.offerPrice > 0 && (
          <span className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
            {formatCurrency(lead.offerPrice)}
          </span>
        )}
      </div>
      <p className="mb-2 text-xs text-slate-400">
        {lead.city}, {lead.state} {lead.zip}
      </p>
      <div className="space-y-1 text-xs text-slate-400">
        <div className="flex items-center gap-1.5">
          <span>👤</span>
          <span className="truncate">{lead.ownerName}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>📞</span>
          <span>{lead.phone}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>📍</span>
          <span className="truncate">{lead.motivation}</span>
        </div>
      </div>
      {lead.arv > 0 && (
        <div className="mt-2 flex justify-between border-t border-slate-700 pt-2 text-[10px] text-slate-500">
          <span>ARV {formatCurrency(lead.arv)}</span>
          <span>Repairs {formatCurrency(lead.repairEstimate)}</span>
        </div>
      )}
    </div>
  );
}
