"use client";

import { useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import { getUser } from "@/lib/store";
import { useRouter } from "next/navigation";

const templates = [
  {
    title: "Assignable Purchase Agreement",
    description: "Standard purchase contract with 'and/or assigns' language. Use this to lock up the property.",
    content: `ASSIGNABLE REAL ESTATE PURCHASE AGREEMENT

This Agreement is made between Seller and Buyer (and/or assigns).

1. PROPERTY: [Address]
2. PURCHASE PRICE: $[Amount]
3. EARNEST MONEY: $[Amount] to be held by [Escrow/Title]
4. CLOSING DATE: On or before [Date]
5. INSPECTION PERIOD: [X] days
6. ASSIGNMENT: Buyer may assign this Agreement to any third party without Seller's consent. Seller acknowledges Buyer is an investor and may assign for profit.
7. CONTINGENCIES: Subject to Buyer's inspection and financing (if any).
8. DEFAULT: ...

DISCLOSURE: Buyer is a real estate investor and may assign this contract. This is not a traditional owner-occupant purchase.

[Signature blocks]
`,
  },
  {
    title: "Assignment of Contract",
    description: "Transfer your equitable interest to the end buyer and collect your fee.",
    content: `ASSIGNMENT OF REAL ESTATE PURCHASE AGREEMENT

Assignor (Wholesaler) hereby assigns all rights, title, and interest in the Purchase Agreement dated [Date] for the property at [Address] to Assignee (End Buyer).

ASSIGNMENT FEE: $[Amount] payable at closing / upon execution.
ORIGINAL PURCHASE PRICE: $[Amount]
ASSIGNEE AGREES to assume all obligations of the original Buyer under the Purchase Agreement.

[Signatures of Assignor, Assignee, and acknowledgment by Seller if required]
`,
  },
  {
    title: "Seller Disclosure / Intent to Assign",
    description: "Important in many states. Disclose that you may assign the contract.",
    content: `SELLER DISCLOSURE – INTENT TO ASSIGN

I, the undersigned Seller, acknowledge that the Buyer named in the Purchase Agreement is a real estate investor who intends to assign the contract to a third-party end buyer and may receive an assignment fee.

I understand this is a cash transaction (or investor transaction) and not a traditional retail sale.

Seller Signature: ________________ Date: ________
`,
  },
];

export default function ContractsPage() {
  const router = useRouter();

  useEffect(() => {
    if (!getUser()) router.push("/login");
  }, [router]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Template copied to clipboard");
  };

  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar />
      <main className="ml-64 min-h-screen p-6">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Contracts & Templates</h1>
          <p className="text-sm text-slate-400">
            Attorney-reviewed starting points. Always have a licensed attorney customize for your state.
          </p>
        </div>

        <div className="space-y-6">
          {templates.map((t) => (
            <div key={t.title} className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
              <div className="flex items-start justify-between border-b border-slate-800 p-5">
                <div className="flex items-start gap-3">
                  <span className="text-xl">📄</span>
                  <div>
                    <h2 className="font-semibold text-white">{t.title}</h2>
                    <p className="mt-1 text-sm text-slate-400">{t.description}</p>
                  </div>
                </div>
                <button
                  onClick={() => copyToClipboard(t.content)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                >
                  📋 Copy
                </button>
              </div>
              <pre className="max-h-64 overflow-auto bg-slate-950 p-5 text-xs text-slate-300 whitespace-pre-wrap font-mono">
                {t.content}
              </pre>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-200">
          <strong>Legal Notice:</strong> These are educational templates only. Real estate contract requirements vary by state.
          Have a real estate attorney licensed in your market review and customize every document before use.
          Marketing a property without a signed contract can constitute unlicensed brokerage in many jurisdictions.
        </div>
      </main>
    </div>
  );
}
