import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎯</span>
            <span className="text-xl font-bold tracking-tight">WholesaleOS</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm text-slate-400 hover:text-white">
              Sign in
            </Link>
            <Link
              href="/login"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Start Free Trial
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 text-sm text-emerald-400">
          ⚡ All-in-One Wholesaling Platform
        </div>
        <h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          Run your entire
          <br />
          <span className="text-emerald-400">wholesale business</span>
          <br />
          from one login
        </h1>
        <p className="mx-auto mb-10 max-w-2xl text-lg text-slate-400">
          Pipeline CRM, deal analyzer, cash buyer database, contracts with e-sign,
          lead capture, and marketing tools — everything you need to close high-profit
          deals without stacking five different subscriptions.
        </p>
        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/login"
            className="flex items-center gap-2 rounded-lg bg-emerald-600 px-8 py-3.5 text-base font-semibold text-white hover:bg-emerald-500"
          >
            Start Free Trial →
          </Link>
          <Link
            href="#features"
            className="rounded-lg border border-slate-700 px-8 py-3.5 text-base font-medium text-slate-300 hover:bg-slate-900"
          >
            See Features
          </Link>
        </div>
        <p className="mt-4 text-sm text-slate-500">No credit card required · Cancel anytime</p>
      </section>

      <section id="features" className="border-t border-slate-800 bg-slate-900/50 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-12 text-center text-3xl font-bold">Everything included. No upgrades.</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: "📊", title: "Deal Pipeline CRM", desc: "Kanban board from new lead → under contract → assigned → closed. Drag, update, and never lose a deal." },
              { icon: "🧮", title: "Deal Analyzer", desc: "Instant ARV, repairs, MAO, and assignment fee calculations. Know your numbers before you offer." },
              { icon: "👥", title: "Lead Management", desc: "Capture, qualify, and track motivated sellers. Notes, status, source, and full history in one place." },
              { icon: "🏢", title: "Cash Buyer Database", desc: "Build and search your buyer list by buy-box, area, and proof of funds. Blast deals instantly." },
              { icon: "📄", title: "Contracts & Templates", desc: "Assignables purchase agreements, assignment contracts, and disclosure templates ready to use." },
              { icon: "🎯", title: "One Flat Subscription", desc: "No feature gates. No per-seat surprises. One price that includes the tools serious wholesalers need." },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-slate-800 bg-slate-950 p-6 transition hover:border-emerald-500/40"
              >
                <div className="mb-4 text-3xl">{f.icon}</div>
                <h3 className="mb-2 text-lg font-semibold">{f.title}</h3>
                <p className="text-sm text-slate-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <h2 className="mb-4 text-3xl font-bold">Simple pricing</h2>
          <p className="mb-12 text-slate-400">One plan. Everything included. Built for wholesalers who want to close deals, not manage software.</p>
          <div className="mx-auto max-w-md rounded-2xl border border-emerald-500/40 bg-slate-900 p-8 shadow-xl shadow-emerald-500/10">
            <div className="mb-2 text-sm font-semibold uppercase tracking-widest text-emerald-400">Pro</div>
            <div className="mb-1 text-5xl font-bold">
              $197<span className="text-lg font-normal text-slate-400">/mo</span>
            </div>
            <p className="mb-6 text-sm text-slate-400">or $1,970/year (save 2 months)</p>
            <ul className="mb-8 space-y-3 text-left text-sm">
              {[
                "Unlimited leads & deals",
                "Full pipeline CRM",
                "Deal analyzer & MAO calculator",
                "Cash buyer database",
                "Contract templates",
                "Lead capture forms",
                "Priority support",
                "All future features included",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="text-emerald-400">✓</span>
                  {item}
                </li>
              ))}
            </ul>
            <Link
              href="/login"
              className="block w-full rounded-lg bg-emerald-600 py-3.5 text-center font-semibold text-white hover:bg-emerald-500"
            >
              Start Free 14-Day Trial
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎯</span>
            <span className="font-semibold">WholesaleOS</span>
          </div>
          <p className="text-sm text-slate-500">
            © 2026 WholesaleOS. Educational software for real estate investors. Always verify local laws.
          </p>
        </div>
      </footer>
    </div>
  );
}
