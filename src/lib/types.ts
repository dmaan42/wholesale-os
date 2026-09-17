export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "offer_made"
  | "under_contract"
  | "assigned"
  | "closed"
  | "dead";

export interface Lead {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  ownerName: string;
  phone: string;
  email: string;
  motivation: string;
  status: LeadStatus;
  source: string;
  arv: number;
  repairEstimate: number;
  offerPrice: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Buyer {
  id: string;
  name: string;
  phone: string;
  email: string;
  buyBox: string;
  preferredAreas: string;
  proofOfFunds: boolean;
  notes: string;
  createdAt: string;
}

export interface DealAnalysis {
  address: string;
  arv: number;
  repairs: number;
  holdingCosts: number;
  closingCosts: number;
  desiredProfit: number;
  assignmentFee: number;
  mao: number;
  offerPrice: number;
}

export const PIPELINE_STAGES: { id: LeadStatus; label: string; color: string }[] = [
  { id: "new", label: "New Leads", color: "bg-blue-500" },
  { id: "contacted", label: "Contacted", color: "bg-indigo-500" },
  { id: "qualified", label: "Qualified", color: "bg-purple-500" },
  { id: "offer_made", label: "Offer Made", color: "bg-yellow-500" },
  { id: "under_contract", label: "Under Contract", color: "bg-orange-500" },
  { id: "assigned", label: "Assigned", color: "bg-emerald-500" },
  { id: "closed", label: "Closed", color: "bg-green-600" },
  { id: "dead", label: "Dead", color: "bg-gray-400" },
];
