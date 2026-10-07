# WholesaleOS — All-in-One Real Estate Wholesaling Software

A complete, modern SaaS-style platform for real estate wholesalers.  
One flat monthly subscription. Everything needed to find, analyze, contract, and assign deals.

## Features

- **Deal Pipeline CRM** — Kanban board: New → Contacted → Qualified → Offer Made → Under Contract → Assigned → Closed
- **Lead Management** — full table view, search, add/edit/delete, notes, source tracking
- **Deal Analyzer** — live MAO calculator (ARV × 70% − repairs − holding − closing − desired profit)
- **Cash Buyer Database** — buy boxes, preferred areas, proof-of-funds status
- **Contracts & Templates** — Assignable Purchase Agreement, Assignment of Contract, Seller Disclosure
- **AI Dialer (coming)** — call leads with the built-in voice agent; outcomes and transcripts land in call logs and move deals through the pipeline automatically
- **Authentication** — real Supabase Auth (email + password)
- **Billing** — Stripe Checkout for the $197/mo plan, with webhook-synced subscription status

## Tech Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS v4
- Supabase (Postgres + Auth, row-level security per user)
- Stripe (Checkout + webhooks)

## Quick Start

```bash
npm install
cp .env.example .env.local   # fill in your keys (see below)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL Editor and run `supabase/migrations/001_initial_schema.sql`. This creates:
   - `profiles` (auto-created on signup, holds Stripe customer + subscription status)
   - `leads`, `buyers`, `call_logs` — all isolated per user via row-level security
3. Copy your **Project URL**, **anon public key**, and **service_role key**
   (Project Settings → API) into your env vars.

> If you enabled **Confirm email** (Auth → Providers → Email), new signups must click
> the confirmation link before signing in — the login page handles this state.

### 2. Stripe

1. Create a $197/mo recurring product and copy its **Price ID** → `STRIPE_PRICE_ID`.
2. Copy your **Secret key** → `STRIPE_SECRET_KEY`.
3. Add a webhook endpoint pointing at `https://<your-app>/api/stripe-webhook`,
   listening for `checkout.session.completed`, `customer.subscription.updated`,
   and `customer.subscription.deleted`. Copy the **Signing secret** → `STRIPE_WEBHOOK_SECRET`.

### 3. AI voice dialer (Vapi)

1. Create an account at [vapi.ai](https://vapi.ai), then create an **Assistant**
   (choose a voice, write the seller-qualification prompt) and a **Phone Number**.
2. Copy the **API key**, **Assistant ID**, and **Phone Number ID** into
   `VAPI_API_KEY`, `VAPI_ASSISTANT_ID`, `VAPI_PHONE_NUMBER_ID`.
3. Generate a random `VOICE_WEBHOOK_SECRET` (e.g. `openssl rand -hex 32`).
4. In the Vapi dashboard (Assistant → Server URL), set the server URL to
   `https://<your-app>/api/voice-webhook?secret=<VOICE_WEBHOOK_SECRET>`
   and subscribe to the `end-of-call-report` event.

How it works: the **📞 Call with AI** button on any lead dials through Vapi.
When the call ends, Vapi posts the report to `/api/voice-webhook`, which saves
the recording, transcript summary, and outcome to the call log and advances the
lead's pipeline stage on positive signals (interested → Qualified,
voicemail/no-answer → Contacted). It never moves a lead backward or to Dead —
that stays a human decision.

### 4. Deploy (Vercel)

Set all variables from `.env.example` in the Vercel project settings, including
`NEXT_PUBLIC_APP_URL` (your production URL — used for Stripe redirects), then deploy.

## Project Structure

```
src/
  app/
    page.tsx              → Marketing landing
    login/page.tsx        → Signup / sign-in (Supabase Auth → Stripe Checkout)
    dashboard/page.tsx    → Pipeline Kanban
    leads/page.tsx        → Lead table
    analyzer/page.tsx     → MAO calculator
    buyers/page.tsx       → Cash buyer CRM
    contracts/page.tsx    → Templates
    settings/page.tsx     → Subscription
    api/
      checkout/route.ts       → Stripe Checkout session
      stripe-webhook/route.ts → subscription status sync
      public-lead/route.ts    → public "sell your house" form
  components/
    Sidebar.tsx
    PipelineCard.tsx
    LeadModal.tsx
  lib/
    types.ts
    db.ts                 → Supabase data layer (leads, buyers, call logs)
    auth.tsx              → AuthProvider + useAuth
    supabase.ts           → Supabase client (env-configured)
    utils.ts
supabase/
  migrations/001_initial_schema.sql
```

## License

Private — for your commercial use. Customize and sell as your own product.
