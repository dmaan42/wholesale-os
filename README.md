# WholesaleOS — All-in-One Real Estate Wholesaling Software

A complete, modern SaaS-style platform for real estate wholesalers.  
One flat monthly subscription. Everything needed to find, analyze, contract, and assign deals.

## Features Included

- **Landing page** with pricing and feature overview
- **Authentication** (demo login — any name + email)
- **Deal Pipeline CRM** — Kanban board with stages: New → Contacted → Qualified → Offer Made → Under Contract → Assigned → Closed
- **Lead Management** — full table view, search, add/edit/delete, notes, source tracking
- **Deal Analyzer** — live MAO calculator (ARV × 70% − repairs − holding − closing − desired profit)
- **Cash Buyer Database** — store buy boxes, preferred areas, proof-of-funds status
- **Contracts & Templates** — Assignable Purchase Agreement, Assignment of Contract, Seller Disclosure
- **Subscription / Settings** page ready for Stripe integration

## Tech Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS v4
- Lucide React icons
- LocalStorage for demo persistence (easy to swap for Supabase / Postgres)

## Quick Start

```bash
cd wholesale-os
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

1. Click **Start Free Trial**
2. Enter any name + email
3. Explore the full dashboard

## Production Roadmap

To turn this into a real subscription product:

1. Replace localStorage with Supabase or Prisma + PostgreSQL
2. Add real auth (Clerk, Supabase Auth, or NextAuth)
3. Integrate Stripe Checkout + Customer Portal for the $197/mo plan
4. Add Twilio for SMS / dialer
5. Add e-signature (DocuSign, HelloSign, or built-in)
6. Property data / skip-tracing API partnerships
7. Multi-tenant isolation and team seats

## Project Structure

```
src/
  app/
    page.tsx              → Marketing landing
    login/page.tsx        → Trial signup
    dashboard/page.tsx    → Pipeline Kanban
    leads/page.tsx        → Lead table
    analyzer/page.tsx     → MAO calculator
    buyers/page.tsx       → Cash buyer CRM
    contracts/page.tsx    → Templates
    settings/page.tsx     → Subscription
  components/
    Sidebar.tsx
    PipelineCard.tsx
    LeadModal.tsx
  lib/
    types.ts
    store.ts              → Data layer (localStorage)
    utils.ts
```

## License

Private — for your commercial use. Customize and sell as your own product.

---

Built as a production-ready foundation for a wholesaling SaaS business.
