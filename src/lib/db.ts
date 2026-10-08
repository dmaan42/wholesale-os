import { getSupabase } from "./supabase";

/** Lazy Supabase client (throws a clear error if env vars are missing). */
function sb() {
  return getSupabase();
}
import type { Lead, Buyer, LeadStatus } from "./types";

/* ------------------------------------------------------------------ */
/* Row mappers: Supabase uses snake_case, the app uses camelCase.      */
/* ------------------------------------------------------------------ */

interface LeadRow {
  id: string;
  user_id: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  owner_name: string | null;
  phone: string | null;
  email: string | null;
  motivation: string | null;
  status: string | null;
  source: string | null;
  arv: number | null;
  repair_estimate: number | null;
  offer_price: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface BuyerRow {
  id: string;
  user_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  buy_box: string | null;
  preferred_areas: string | null;
  proof_of_funds: boolean | null;
  notes: string | null;
  created_at: string;
}

function toLead(r: LeadRow): Lead {
  return {
    id: r.id,
    address: r.address ?? "",
    city: r.city ?? "",
    state: r.state ?? "",
    zip: r.zip ?? "",
    ownerName: r.owner_name ?? "",
    phone: r.phone ?? "",
    email: r.email ?? "",
    motivation: r.motivation ?? "",
    status: (r.status as LeadStatus) ?? "new",
    source: r.source ?? "",
    arv: Number(r.arv) || 0,
    repairEstimate: Number(r.repair_estimate) || 0,
    offerPrice: Number(r.offer_price) || 0,
    notes: r.notes ?? "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toBuyer(r: BuyerRow): Buyer {
  return {
    id: r.id,
    name: r.name ?? "",
    phone: r.phone ?? "",
    email: r.email ?? "",
    buyBox: r.buy_box ?? "",
    preferredAreas: r.preferred_areas ?? "",
    proofOfFunds: r.proof_of_funds ?? false,
    notes: r.notes ?? "",
    createdAt: r.created_at,
  };
}

async function requireUserId(): Promise<string> {
  const {
    data: { user },
  } = await sb().auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
}

function dbError(context: string, error: { message: string; code?: string } | null): never {
  throw new Error(`${context}: ${error?.message ?? "unknown error"}`);
}

/* ------------------------------------------------------------------ */
/* Leads                                                               */
/* ------------------------------------------------------------------ */

export async function getLeads(): Promise<Lead[]> {
  const { data, error } = await sb()
    .from("leads")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) dbError("Failed to load leads", error);
  return ((data ?? []) as LeadRow[]).map(toLead);
}

export async function addLead(
  lead: Omit<Lead, "id" | "createdAt" | "updatedAt">
): Promise<Lead> {
  const user_id = await requireUserId();
  const { data, error } = await sb()
    .from("leads")
    .insert({
      user_id,
      address: lead.address,
      city: lead.city,
      state: lead.state,
      zip: lead.zip,
      owner_name: lead.ownerName,
      phone: lead.phone,
      email: lead.email,
      motivation: lead.motivation,
      status: lead.status,
      source: lead.source,
      arv: lead.arv,
      repair_estimate: lead.repairEstimate,
      offer_price: lead.offerPrice,
      notes: lead.notes,
    })
    .select()
    .single();
  if (error || !data) dbError("Failed to add lead", error);
  return toLead(data as LeadRow);
}

export async function updateLead(
  id: string,
  updates: Partial<Lead>
): Promise<Lead | null> {
  const row: Record<string, unknown> = {};
  if (updates.address !== undefined) row.address = updates.address;
  if (updates.city !== undefined) row.city = updates.city;
  if (updates.state !== undefined) row.state = updates.state;
  if (updates.zip !== undefined) row.zip = updates.zip;
  if (updates.ownerName !== undefined) row.owner_name = updates.ownerName;
  if (updates.phone !== undefined) row.phone = updates.phone;
  if (updates.email !== undefined) row.email = updates.email;
  if (updates.motivation !== undefined) row.motivation = updates.motivation;
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.source !== undefined) row.source = updates.source;
  if (updates.arv !== undefined) row.arv = updates.arv;
  if (updates.repairEstimate !== undefined) row.repair_estimate = updates.repairEstimate;
  if (updates.offerPrice !== undefined) row.offer_price = updates.offerPrice;
  if (updates.notes !== undefined) row.notes = updates.notes;

  const { data, error } = await sb()
    .from("leads")
    .update(row)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    if (error.code === "PGRST116") return null;
    dbError("Failed to update lead", error);
  }
  return toLead(data as LeadRow);
}

export async function deleteLead(id: string): Promise<void> {
  const { error } = await sb().from("leads").delete().eq("id", id);
  if (error) dbError("Failed to delete lead", error);
}

/* ------------------------------------------------------------------ */
/* Buyers                                                              */
/* ------------------------------------------------------------------ */

export async function getBuyers(): Promise<Buyer[]> {
  const { data, error } = await sb()
    .from("buyers")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) dbError("Failed to load buyers", error);
  return ((data ?? []) as BuyerRow[]).map(toBuyer);
}

export async function addBuyer(
  buyer: Omit<Buyer, "id" | "createdAt">
): Promise<Buyer> {
  const user_id = await requireUserId();
  const { data, error } = await sb()
    .from("buyers")
    .insert({
      user_id,
      name: buyer.name,
      phone: buyer.phone,
      email: buyer.email,
      buy_box: buyer.buyBox,
      preferred_areas: buyer.preferredAreas,
      proof_of_funds: buyer.proofOfFunds,
      notes: buyer.notes,
    })
    .select()
    .single();
  if (error || !data) dbError("Failed to add buyer", error);
  return toBuyer(data as BuyerRow);
}

export async function deleteBuyer(id: string): Promise<void> {
  const { error } = await sb().from("buyers").delete().eq("id", id);
  if (error) dbError("Failed to delete buyer", error);
}

/* ------------------------------------------------------------------ */
/* Call logs (powers the AI dialer)                                    */
/* ------------------------------------------------------------------ */

export interface CallLog {
  id: string;
  leadId: string | null;
  phone: string;
  direction: string;
  status: string;
  durationSeconds: number;
  recordingUrl: string | null;
  summary: string | null;
  outcome: string | null;
  provider: string | null;
  createdAt: string;
}

interface CallLogRow {
  id: string;
  lead_id: string | null;
  phone: string | null;
  direction: string | null;
  status: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  summary: string | null;
  outcome: string | null;
  provider: string | null;
  created_at: string;
}

function toCallLog(r: CallLogRow): CallLog {
  return {
    id: r.id,
    leadId: r.lead_id,
    phone: r.phone ?? "",
    direction: r.direction ?? "outbound",
    status: r.status ?? "initiated",
    durationSeconds: r.duration_seconds ?? 0,
    recordingUrl: r.recording_url,
    summary: r.summary,
    outcome: r.outcome,
    provider: r.provider,
    createdAt: r.created_at,
  };
}

export async function getCallLogs(leadId?: string): Promise<CallLog[]> {
  let q = sb()
    .from("call_logs")
    .select("*")
    .order("created_at", { ascending: false });
  if (leadId) q = q.eq("lead_id", leadId);
  const { data, error } = await q;
  if (error) dbError("Failed to load call logs", error);
  return ((data ?? []) as CallLogRow[]).map(toCallLog);
}

export async function addCallLog(log: {
  leadId?: string | null;
  phone: string;
  status?: string;
  provider?: string;
  providerCallId?: string;
}): Promise<CallLog> {
  const user_id = await requireUserId();
  const { data, error } = await sb()
    .from("call_logs")
    .insert({
      user_id,
      lead_id: log.leadId ?? null,
      phone: log.phone,
      status: log.status ?? "initiated",
      provider: log.provider ?? "",
      provider_call_id: log.providerCallId ?? null,
    })
    .select()
    .single();
  if (error || !data) dbError("Failed to log call", error);
  return toCallLog(data as CallLogRow);
}

export async function updateCallLog(
  id: string,
  updates: Partial<Pick<CallLog, "status" | "durationSeconds" | "recordingUrl" | "summary" | "outcome">>
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (updates.status !== undefined) row.status = updates.status;
  if (updates.durationSeconds !== undefined) row.duration_seconds = updates.durationSeconds;
  if (updates.recordingUrl !== undefined) row.recording_url = updates.recordingUrl;
  if (updates.summary !== undefined) row.summary = updates.summary;
  if (updates.outcome !== undefined) row.outcome = updates.outcome;
  const { error } = await sb().from("call_logs").update(row).eq("id", id);
  if (error) dbError("Failed to update call log", error);
}

/* ------------------------------------------------------------------ */
/* Deal math (pure function, unchanged behavior)                       */
/* ------------------------------------------------------------------ */

export function calculateMAO(
  arv: number,
  repairs: number,
  holding = 3000,
  closing = 5000,
  desiredProfit = 25000
) {
  // Classic MAO = ARV * 0.7 - Repairs - Holding - Closing - Desired Profit
  // Adjusted for wholesale: leave room for buyer profit
  const mao = arv * 0.7 - repairs - holding - closing - desiredProfit;
  return Math.max(0, Math.round(mao));
}

/* ------------------------------------------------------------------ */
/* Campaigns (AI batch dialer)                                         */
/* ------------------------------------------------------------------ */

export interface Campaign {
  id: string;
  name: string;
  vapiCampaignId: string | null;
  status: string;
  totalContacts: number;
  maxConcurrency: number;
  createdAt: string;
  updatedAt: string;
}

interface CampaignRow {
  id: string;
  user_id: string;
  name: string | null;
  vapi_campaign_id: string | null;
  status: string | null;
  total_contacts: number | null;
  max_concurrency: number | null;
  created_at: string;
  updated_at: string;
}

function toCampaign(r: CampaignRow): Campaign {
  return {
    id: r.id,
    name: r.name ?? "",
    vapiCampaignId: r.vapi_campaign_id,
    status: r.status ?? "draft",
    totalContacts: r.total_contacts ?? 0,
    maxConcurrency: r.max_concurrency ?? 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface CampaignContact {
  id: string;
  campaignId: string;
  leadId: string | null;
  phone: string;
  name: string;
  status: string;
  callLogId: string | null;
  createdAt: string;
}

interface CampaignContactRow {
  id: string;
  campaign_id: string;
  lead_id: string | null;
  phone: string | null;
  name: string | null;
  status: string | null;
  call_log_id: string | null;
  created_at: string;
}

function toCampaignContact(r: CampaignContactRow): CampaignContact {
  return {
    id: r.id,
    campaignId: r.campaign_id,
    leadId: r.lead_id,
    phone: r.phone ?? "",
    name: r.name ?? "",
    status: r.status ?? "queued",
    callLogId: r.call_log_id,
    createdAt: r.created_at,
  };
}

export async function getCampaigns(): Promise<Campaign[]> {
  const { data, error } = await sb()
    .from("campaigns")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) dbError("Failed to load campaigns", error);
  return ((data ?? []) as CampaignRow[]).map(toCampaign);
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const { data, error } = await sb()
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return toCampaign(data as CampaignRow);
}

export async function getCampaignContacts(
  campaignId: string
): Promise<CampaignContact[]> {
  const { data, error } = await sb()
    .from("campaign_contacts")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  if (error) dbError("Failed to load campaign contacts", error);
  return ((data ?? []) as CampaignContactRow[]).map(toCampaignContact);
}
