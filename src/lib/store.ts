"use client";

import { Lead, Buyer, LeadStatus } from "./types";
import { generateId } from "./utils";

const LEADS_KEY = "wholesale_os_leads";
const BUYERS_KEY = "wholesale_os_buyers";
const USER_KEY = "wholesale_os_user";

export function getLeads(): Lead[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(LEADS_KEY);
    return data ? JSON.parse(data) : getSeedLeads();
  } catch {
    return getSeedLeads();
  }
}

export function saveLeads(leads: Lead[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LEADS_KEY, JSON.stringify(leads));
}

export function addLead(lead: Omit<Lead, "id" | "createdAt" | "updatedAt">): Lead {
  const leads = getLeads();
  const newLead: Lead = {
    ...lead,
    id: generateId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  leads.unshift(newLead);
  saveLeads(leads);
  return newLead;
}

export function updateLead(id: string, updates: Partial<Lead>) {
  const leads = getLeads();
  const idx = leads.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  leads[idx] = { ...leads[idx], ...updates, updatedAt: new Date().toISOString() };
  saveLeads(leads);
  return leads[idx];
}

export function deleteLead(id: string) {
  const leads = getLeads().filter((l) => l.id !== id);
  saveLeads(leads);
}

export function getBuyers(): Buyer[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(BUYERS_KEY);
    return data ? JSON.parse(data) : getSeedBuyers();
  } catch {
    return getSeedBuyers();
  }
}

export function saveBuyers(buyers: Buyer[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(BUYERS_KEY, JSON.stringify(buyers));
}

export function addBuyer(buyer: Omit<Buyer, "id" | "createdAt">): Buyer {
  const buyers = getBuyers();
  const newBuyer: Buyer = {
    ...buyer,
    id: generateId(),
    createdAt: new Date().toISOString(),
  };
  buyers.unshift(newBuyer);
  saveBuyers(buyers);
  return newBuyer;
}

export function getUser() {
  if (typeof window === "undefined") return null;
  try {
    const data = localStorage.getItem(USER_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function setUser(user: { name: string; email: string; plan: string } | null) {
  if (typeof window === "undefined") return;
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(USER_KEY);
  }
}

function getSeedLeads(): Lead[] {
  const now = new Date().toISOString();
  return [
    {
      id: "seed1",
      address: "1247 Oak Street",
      city: "Houston",
      state: "TX",
      zip: "77002",
      ownerName: "Maria Gonzalez",
      phone: "(713) 555-0142",
      email: "maria.g@example.com",
      motivation: "Inherited property, lives out of state",
      status: "qualified",
      source: "Direct Mail",
      arv: 285000,
      repairEstimate: 45000,
      offerPrice: 165000,
      notes: "Wants to close in 21 days. Open to cash offer.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed2",
      address: "892 Pine Avenue",
      city: "Dallas",
      state: "TX",
      zip: "75201",
      ownerName: "James Wilson",
      phone: "(214) 555-0198",
      email: "jwilson@email.com",
      motivation: "Pre-foreclosure, behind on payments",
      status: "under_contract",
      source: "Skip Trace Call",
      arv: 340000,
      repairEstimate: 62000,
      offerPrice: 198000,
      notes: "Contract signed. Looking for buyer.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed3",
      address: "451 Maple Court",
      city: "Austin",
      state: "TX",
      zip: "78701",
      ownerName: "Susan Park",
      phone: "(512) 555-0167",
      email: "spark@email.com",
      motivation: "Tired landlord, multiple vacancies",
      status: "new",
      source: "Facebook Ad",
      arv: 410000,
      repairEstimate: 28000,
      offerPrice: 0,
      notes: "Just came in. Needs quick follow-up.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "seed4",
      address: "2103 Cedar Lane",
      city: "San Antonio",
      state: "TX",
      zip: "78205",
      ownerName: "Robert Chen",
      phone: "(210) 555-0133",
      email: "rchen@email.com",
      motivation: "Divorce, needs to sell quickly",
      status: "offer_made",
      source: "SEO Landing Page",
      arv: 265000,
      repairEstimate: 35000,
      offerPrice: 155000,
      notes: "Offer sent via email. Waiting response.",
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function getSeedBuyers(): Buyer[] {
  return [
    {
      id: "b1",
      name: "Texas Cash Homes LLC",
      phone: "(713) 555-1001",
      email: "deals@texascashhomes.com",
      buyBox: "SFH, $100k-$250k, any condition",
      preferredAreas: "Houston, Katy, Sugar Land",
      proofOfFunds: true,
      notes: "Closes in 10 days. Prefers assignments.",
      createdAt: new Date().toISOString(),
    },
    {
      id: "b2",
      name: "Metro Flip Partners",
      phone: "(214) 555-2002",
      email: "acquisitions@metroflip.com",
      buyBox: "SFH & Duplex, ARV $200k+",
      preferredAreas: "Dallas-Fort Worth",
      proofOfFunds: true,
      notes: "High volume. Good for larger deals.",
      createdAt: new Date().toISOString(),
    },
    {
      id: "b3",
      name: "Austin Investor Group",
      phone: "(512) 555-3003",
      email: "buy@austininvestors.com",
      buyBox: "Any residential under $400k",
      preferredAreas: "Austin, Round Rock, Cedar Park",
      proofOfFunds: true,
      notes: "Responds fast. Prefers subject-to sometimes.",
      createdAt: new Date().toISOString(),
    },
  ];
}

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
