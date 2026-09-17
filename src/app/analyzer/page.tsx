"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import { calculateMAO } from "@/lib/store";
import { formatCurrency } from "@/lib/utils";
import { getUser } from "@/lib/store";
import { useRouter } from "next/navigation";

export default function AnalyzerPage() {
  const router = useRouter();
  const [arv, setArv] = useState(300000);
  const [repairs, setRepairs] = useState(40000);
  const [holding, setHolding] = useState(3000);
  const [closing, setClosing] = useState(5000);
  const [desiredProfit, setDesiredProfit] = useState(25000);
  const [assignmentFee, setAssignmentFee] = useState(15000);

  useEffect(() => {
    if (!getUser()) router.push("/login");
  }, [router]);

  const mao = calculateMAO(arv, repairs, holding, closing, desiredProfit);
  const offerPrice = Math.max(0, mao - assignmentFee);
  const buyerProfit = arv - repairs - holding - closing - offerPrice - assignmentFee;

  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar />
      <main className="ml-64 min-h-screen p-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Deal Analyzer</h1>
          <p className="text-sm text-slate-400">Calculate MAO and assignment fee in seconds</p>
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              🧮 Deal Inputs
            </h2>
            <div className="space-y-4">
              {[
                { label: "After Repair Value (ARV)", value: arv, set: setArv },
                { label: "Repair Estimate", value: repairs, set: setRepairs },
                { label: "Holding Costs", value: holding, set: setHolding },
                { label: "Closing Costs", value: closing, set: setClosing },
                { label: "Buyer Desired Profit", value: desiredProfit, set: setDesiredProfit },
                { label: "Your Assignment Fee Target", value: assignmentFee, set: setAssignmentFee },
              ].map((field) => (
                <div key={field.label}>
                  <label className="mb-1 block text-sm text-slate-400">{field.label}</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                    <input
                      type="number"
                      value={field.value}
                      onChange={(e) => field.set(Number(e.target.value))}
                      className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2.5 pl-8 pr-3 text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-6">
              <p className="mb-1 text-sm text-emerald-400">Maximum Allowable Offer (MAO)</p>
              <p className="text-4xl font-bold text-white">{formatCurrency(mao)}</p>
              <p className="mt-2 text-xs text-slate-400">
                ARV × 70% − Repairs − Holding − Closing − Buyer Profit
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 className="mb-4 flex items-center gap-2 font-semibold">
                📈 Offer Strategy
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Suggested Offer Price</span>
                  <span className="font-semibold text-white">{formatCurrency(offerPrice)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Your Assignment Fee</span>
                  <span className="font-semibold text-emerald-400">{formatCurrency(assignmentFee)}</span>
                </div>
                <div className="flex justify-between border-t border-slate-800 pt-3">
                  <span className="text-slate-400">Buyer Net Profit (est.)</span>
                  <span className="font-semibold text-white">{formatCurrency(Math.max(0, buyerProfit))}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 className="mb-3 font-semibold">Quick Tips</h3>
              <ul className="space-y-2 text-sm text-slate-400">
                <li>• Start negotiations below your MAO to leave room.</li>
                <li>• Adjust the 70% rule based on local market strength.</li>
                <li>• Always verify ARV with recent comps and a reliable source.</li>
                <li>• Get repair estimates from trusted contractors when possible.</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
