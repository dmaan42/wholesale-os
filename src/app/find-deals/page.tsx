"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import SubscriptionGate from "@/components/SubscriptionGate";
import { useAuth } from "@/lib/auth";

function authHeaders(session: any): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(session?.access_token
      ? { Authorization: `Bearer ${session.access_token}` }
      : {}),
  };
}

const DISTRESS_OPTIONS = [
  { label: "Absentee Owner", value: "absentee-owner" },
  { label: "Out-of-State Owner", value: "out-of-state-absentee-owner" },
  { label: "Vacant", value: "vacant" },
  { label: "Pre-Foreclosure", value: "preforeclosure" },
  { label: "Tax Delinquent", value: "tax-default" },
  { label: "Notice of Default", value: "notice-of-default" },
  { label: "High Equity", value: "high-equity" },
  { label: "Inherited", value: "inherited" },
  { label: "Tired Landlord", value: "tired-landlord" },
];

const LISTING_STATUS_OPTIONS = [
  { label: "Any", value: "any" },
  { label: "Off-market only", value: "off-market" },
  { label: "Actively listed", value: "listed" },
  { label: "Expired / failed", value: "expired-failed" },
];

const PROPERTY_TYPES = [
  "Single Family Residential",
  "Multi-Family",
  "Condo",
  "Vacant Land",
];

interface FoundProperty {
  street: string;
  city: string;
  state: string;
  zip: string;
  ownerName: string;
  estimatedValue: number | null;
  equityPercent: number | null;
  listingStatus: string | null;
  distressFlags: string[];
  apn: string | null;
}

interface SavedLead extends FoundProperty {
  leadId: string;
  phone: string | null;
  traced: boolean;
  tracing: boolean;
}

function fmtMoney(v: number | null): string {
  if (v == null) return "—";
  return "$" + Math.round(v).toLocaleString("en-US");
}

export default function FindDealsPage() {
  const router = useRouter();
  const { user, session, loading: authLoading } = useAuth();

  // Search form
  const [zip, setZip] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [distress, setDistress] = useState<string[]>(["absentee-owner"]);
  const [listingStatus, setListingStatus] = useState("off-market");
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [minBeds, setMinBeds] = useState("");

  // Results
  const [searching, setSearching] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [properties, setProperties] = useState<FoundProperty[]>([]);
  const [billedRecords, setBilledRecords] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const [batchDataMissing, setBatchDataMissing] = useState(false);

  // Saved leads flow
  const [saving, setSaving] = useState(false);
  const [savedLeads, setSavedLeads] = useState<SavedLead[]>([]);
  const [tracingAll, setTracingAll] = useState(false);
  const [launching, setLaunching] = useState(false);

  const toggleDistress = (value: string) => {
    setDistress((prev) =>
      prev.includes(value)
        ? prev.filter((d) => d !== value)
        : [...prev, value]
    );
  };

  const toggleSelect = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === properties.length) setSelected(new Set());
    else setSelected(new Set(properties.map((_, i) => i)));
  };

  const doSearch = async () => {
    setError("");
    setBatchDataMissing(false);
    if (!zip.trim() && !city.trim()) {
      setError("Enter a ZIP code or city to search.");
      return;
    }
    setSearching(true);
    setCount(null);
    setProperties([]);
    setSelected(new Set());
    setSavedLeads([]);
    try {
      const res = await fetch("/api/property-search", {
        method: "POST",
        headers: authHeaders(session),
        body: JSON.stringify({
          zip: zip.trim(),
          city: city.trim(),
          state: state.trim(),
          distress,
          listingStatus,
          minValue: minValue ? Number(minValue) : undefined,
          maxValue: maxValue ? Number(maxValue) : undefined,
          propertyType: propertyType || undefined,
          minBeds: minBeds ? Number(minBeds) : undefined,
          maxResults: 50,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 503) setBatchDataMissing(true);
        throw new Error(data.error || "Search failed");
      }
      setCount(data.count ?? 0);
      setProperties(data.properties ?? []);
      setBilledRecords(data.billedRecords ?? 0);
      setSelected(new Set((data.properties ?? []).map((_: any, i: number) => i)));
    } catch (e: any) {
      setError(e.message || "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const saveAsLeads = async () => {
    const chosen = properties.filter((_, i) => selected.has(i));
    if (chosen.length === 0) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/property-search/import", {
        method: "POST",
        headers: authHeaders(session),
        body: JSON.stringify({ properties: chosen }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      const leadIds: string[] = data.leadIds ?? [];
      setSavedLeads(
        chosen.map((p, i) => ({
          ...p,
          leadId: leadIds[i] ?? "",
          phone: null,
          traced: false,
          tracing: false,
        }))
      );
    } catch (e: any) {
      setError(e.message || "Import failed");
    } finally {
      setSaving(false);
    }
  };

  const traceLead = async (leadId: string) => {
    setSavedLeads((prev) =>
      prev.map((l) => (l.leadId === leadId ? { ...l, tracing: true } : l))
    );
    try {
      const res = await fetch("/api/skip-trace", {
        method: "POST",
        headers: authHeaders(session),
        body: JSON.stringify({ leadId }),
      });
      const data = await res.json();
      const phone =
        data.savedPhone ||
        data.persons?.[0]?.phones?.find((p: any) => !p.dnc && !p.litigator)
          ?.number ||
        null;
      setSavedLeads((prev) =>
        prev.map((l) =>
          l.leadId === leadId
            ? {
                ...l,
                tracing: false,
                traced: true,
                phone: phone || l.phone,
                ownerName: data.ownerName || l.ownerName,
              }
            : l
        )
      );
    } catch {
      setSavedLeads((prev) =>
        prev.map((l) =>
          l.leadId === leadId ? { ...l, tracing: false, traced: true } : l
        )
      );
    }
  };

  const traceAll = async () => {
    setTracingAll(true);
    for (const lead of savedLeads) {
      if (!lead.traced) await traceLead(lead.leadId);
    }
    setTracingAll(false);
  };

  const launchCampaign = async () => {
    const dialable = savedLeads.filter((l) => l.leadId);
    if (dialable.length === 0) return;
    setLaunching(true);
    setError("");
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: authHeaders(session),
        body: JSON.stringify({
          name: `Find Deals ${zip.trim() || city.trim()} - ${new Date().toLocaleDateString()}`,
          leadIds: dialable.map((l) => l.leadId),
          maxConcurrency: 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Launch failed");
      router.push(`/campaigns/${data.campaignId}`);
    } catch (e: any) {
      setError(e.message || "Launch failed");
      setLaunching(false);
    }
  };

  if (!authLoading && !user) {
    router.push("/login");
    return null;
  }

  return (
    <SubscriptionGate>
      <div className="min-h-screen bg-slate-950 text-white">
        <Sidebar />
        <main className="ml-64 p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold">🎯 Find Deals</h1>
            <p className="mt-1 text-sm text-slate-400">
              Search distressed properties by ZIP — no XLeads needed. Searches
              run on your BatchData account.
            </p>
          </div>

          {/* Search card */}
          <div className="mb-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-slate-400">
              Where?
            </h2>
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm text-slate-400">
                  ZIP code *
                </label>
                <input
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  placeholder="44502"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-white placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-400">City</label>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Youngstown"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-white placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-400">State</label>
                <input
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="OH"
                  maxLength={2}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-white placeholder:text-slate-500"
                />
              </div>
            </div>

            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">
              What kind of deals?
            </h2>
            <div className="mb-6 flex flex-wrap gap-2">
              {DISTRESS_OPTIONS.map((opt) => {
                const active = distress.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleDistress(opt.value)}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                      active
                        ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                        : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                    }`}
                  >
                    {active ? "✓ " : ""}{opt.label}
                  </button>
                );
              })}
            </div>

            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-400">
              Listing status
            </h2>
            <div className="mb-6 flex flex-wrap gap-2">
              {LISTING_STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setListingStatus(opt.value)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                    listingStatus === opt.value
                      ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                      : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-sm text-slate-400">
                  Min value $
                </label>
                <input
                  value={minValue}
                  onChange={(e) => setMinValue(e.target.value)}
                  placeholder="50,000"
                  inputMode="numeric"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-white placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-400">
                  Max value $
                </label>
                <input
                  value={maxValue}
                  onChange={(e) => setMaxValue(e.target.value)}
                  placeholder="200,000"
                  inputMode="numeric"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-white placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-400">
                  Property type
                </label>
                <select
                  value={propertyType}
                  onChange={(e) => setPropertyType(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-white"
                >
                  <option value="">Any</option>
                  {PROPERTY_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-400">
                  Min beds
                </label>
                <input
                  value={minBeds}
                  onChange={(e) => setMinBeds(e.target.value)}
                  placeholder="3"
                  inputMode="numeric"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-white placeholder:text-slate-500"
                />
              </div>
            </div>

            {batchDataMissing && (
              <div className="mb-4 rounded-lg border border-amber-600/40 bg-amber-500/10 p-4 text-sm text-amber-300">
                BatchData isn't connected yet.{" "}
                <Link href="/settings" className="font-semibold underline">
                  Connect it in Settings → Data &amp; Skip Tracing
                </Link>{" "}
                to search for deals.
              </div>
            )}
            {error && (
              <div className="mb-4 rounded-lg border border-red-600/40 bg-red-500/10 p-4 text-sm text-red-300">
                {error}
              </div>
            )}

            <button
              onClick={doSearch}
              disabled={searching}
              className="w-full rounded-xl bg-emerald-600 px-6 py-4 text-lg font-bold text-white hover:bg-emerald-500 disabled:opacity-50 sm:w-auto sm:px-12"
            >
              {searching ? "Searching…" : "🔍 Find deals"}
            </button>
          </div>

          {/* Results */}
          {count !== null && (
            <div className="mb-8">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-bold">
                  {count.toLocaleString()} propert{count === 1 ? "y" : "ies"}{" "}
                  found
                  {properties.length < count &&
                    ` (showing ${properties.length})`}
                </h2>
                <p className="text-xs text-slate-500">
                  Searches use your BatchData account — {billedRecords}{" "}
                  record{billedRecords === 1 ? "" : "s"} this search.
                </p>
              </div>

              {properties.length === 0 ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-10 text-center text-slate-400">
                  No properties matched. Try fewer filters or a different ZIP.
                </div>
              ) : (
                <>
                  <div className="mb-3 flex items-center gap-3">
                    <button
                      onClick={toggleSelectAll}
                      className="text-sm text-emerald-400 hover:underline"
                    >
                      {selected.size === properties.length
                        ? "Deselect all"
                        : "Select all"}
                    </button>
                    <span className="text-sm text-slate-500">
                      {selected.size} selected
                    </span>
                  </div>
                  <div className="space-y-3">
                    {properties.map((p, i) => (
                      <label
                        key={i}
                        className={`flex cursor-pointer items-start gap-4 rounded-xl border p-4 transition-colors ${
                          selected.has(i)
                            ? "border-emerald-600/50 bg-slate-900"
                            : "border-slate-800 bg-slate-900/50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(i)}
                          onChange={() => toggleSelect(i)}
                          className="mt-1 h-5 w-5 accent-emerald-500"
                        />
                        <div className="flex-1">
                          <p className="font-semibold">
                            {p.street || "Address unavailable"}
                          </p>
                          <p className="text-sm text-slate-400">
                            {p.city}, {p.state} {p.zip}
                            {p.ownerName && ` · Owner: ${p.ownerName}`}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <span className="rounded bg-slate-800 px-2 py-1 text-slate-300">
                              Est. {fmtMoney(p.estimatedValue)}
                            </span>
                            {p.equityPercent != null && (
                              <span className="rounded bg-slate-800 px-2 py-1 text-slate-300">
                                {Math.round(p.equityPercent)}% equity
                              </span>
                            )}
                            {p.listingStatus && (
                              <span className="rounded bg-slate-800 px-2 py-1 text-slate-300">
                                {p.listingStatus}
                              </span>
                            )}
                            {p.distressFlags.map((f) => (
                              <span
                                key={f}
                                className="rounded-full bg-amber-500/15 px-2 py-1 font-medium text-amber-300"
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="mt-6">
                    <button
                      onClick={saveAsLeads}
                      disabled={saving || selected.size === 0}
                      className="rounded-xl bg-emerald-600 px-8 py-3 font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {saving
                        ? "Saving…"
                        : `💾 Save ${selected.size} as lead${selected.size === 1 ? "" : "s"}`}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Saved leads → skip trace → campaign */}
          {savedLeads.length > 0 && (
            <div className="mb-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="mb-1 text-xl font-bold">
                ✅ {savedLeads.length} leads saved
              </h2>
              <p className="mb-4 text-sm text-slate-400">
                Skip trace to get phone numbers, then launch your AI calling
                campaign.
              </p>
              <div className="mb-4 space-y-2">
                {savedLeads.map((l) => (
                  <div
                    key={l.leadId}
                    className="flex items-center justify-between rounded-lg bg-slate-800/60 px-4 py-2.5 text-sm"
                  >
                    <span>
                      <span className="font-medium">{l.street}</span>
                      <span className="text-slate-400">
                        {" "}
                        · {l.ownerName || "Unknown owner"}
                      </span>
                    </span>
                    <span className="text-slate-300">
                      {l.tracing
                        ? "⏳ Tracing…"
                        : l.phone
                          ? `📱 ${l.phone}`
                          : l.traced
                            ? "No number found"
                            : "—"}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={traceAll}
                  disabled={tracingAll}
                  className="rounded-xl border border-slate-600 px-6 py-3 font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  {tracingAll ? "Tracing…" : "📱 Skip trace all"}
                </button>
                <button
                  onClick={launchCampaign}
                  disabled={launching}
                  className="rounded-xl bg-emerald-600 px-6 py-3 font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {launching ? "Launching…" : "🚀 Launch calling campaign"}
                </button>
              </div>
              {error && (
                <div className="mt-4 rounded-lg border border-red-600/40 bg-red-500/10 p-4 text-sm text-red-300">
                  {error}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </SubscriptionGate>
  );
}
