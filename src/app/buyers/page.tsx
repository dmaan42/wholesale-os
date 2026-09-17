"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { Buyer } from "@/lib/types";
import { getBuyers, addBuyer, getUser } from "@/lib/store";
import { useRouter } from "next/navigation";

export default function BuyersPage() {
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    buyBox: "",
    preferredAreas: "",
    proofOfFunds: true,
    notes: "",
  });
  const router = useRouter();

  useEffect(() => {
    if (!getUser()) router.push("/login");
    setBuyers(getBuyers());
  }, [router]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addBuyer(form);
    setBuyers(getBuyers());
    setShowForm(false);
    setForm({ name: "", phone: "", email: "", buyBox: "", preferredAreas: "", proofOfFunds: true, notes: "" });
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar />
      <main className="ml-64 min-h-screen p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Cash Buyers</h1>
            <p className="text-sm text-slate-400">{buyers.length} buyers in your network</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            ➕ Add Buyer
          </button>
        </div>

        {showForm && (
          <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="mb-4 font-semibold">New Cash Buyer</h2>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
              <input required placeholder="Name / Company" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none" />
              <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none" />
              <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none" />
              <input placeholder="Preferred Areas" value={form.preferredAreas} onChange={(e) => setForm({ ...form, preferredAreas: e.target.value })} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none" />
              <input placeholder="Buy Box (e.g. SFH $100-250k)" value={form.buyBox} onChange={(e) => setForm({ ...form, buyBox: e.target.value })} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none sm:col-span-2" />
              <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none sm:col-span-2" rows={2} />
              <div className="flex gap-2 sm:col-span-2">
                <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">Save Buyer</button>
                <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Cancel</button>
              </div>
            </form>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {buyers.map((b) => (
            <div key={b.id} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="mb-3 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🏢</span>
                  <h3 className="font-semibold text-white">{b.name}</h3>
                </div>
                {b.proofOfFunds && (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                    ✓ POF
                  </span>
                )}
              </div>
              <div className="space-y-1.5 text-sm text-slate-400">
                <div>📞 {b.phone}</div>
                <div>✉️ {b.email}</div>
              </div>
              <div className="mt-3 border-t border-slate-800 pt-3 text-xs text-slate-500">
                <p><span className="text-slate-400">Buy Box:</span> {b.buyBox}</p>
                <p className="mt-1"><span className="text-slate-400">Areas:</span> {b.preferredAreas}</p>
                {b.notes && <p className="mt-1 italic">{b.notes}</p>}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
