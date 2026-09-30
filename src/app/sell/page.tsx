"use client";

import { useState } from "react";

export default function SellPage() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
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

  const update = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/public-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      alert(data.error || "Lead did not save");
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <div className="min-h-screen bg-emerald-950 text-white flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <p className="mb-2 text-emerald-300">Real Estate Solutionz</p>
          <h1 className="text-3xl font-bold mb-3">We got your info</h1>
          <p className="text-emerald-100 mb-4">
            We’ll call you shortly about a cash offer.
          </p>
          <a href="tel:8054757616" className="text-xl font-semibold underline">
            Call us: 805-475-7616
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="mx-auto max-w-xl">
        <p className="text-emerald-400 font-semibold mb-1">Real Estate Solutionz</p>
        <p className="text-slate-400 mb-4">
          Call or text:{" "}
          <a href="tel:8054757616" className="text-white underline">
            805-475-7616
          </a>
        </p>
        <h1 className="text-4xl font-bold mb-3">Get a cash offer for your house</h1>
        <p className="text-slate-300 mb-8">
          We buy houses as-is. No repairs, no commissions, no waiting on the market.
        </p>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6">
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
      </div>
    </div>
  );
}
