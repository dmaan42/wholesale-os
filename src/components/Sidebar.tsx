"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { getUser, setUser } from "@/lib/store";
import { useEffect, useState } from "react";

const navItems = [
  { href: "/dashboard", label: "Pipeline", icon: "📊" },
  { href: "/leads", label: "Leads", icon: "👥" },
  { href: "/analyzer", label: "Deal Analyzer", icon: "🧮" },
  { href: "/buyers", label: "Cash Buyers", icon: "🏢" },
  { href: "/contracts", label: "Contracts", icon: "📄" },
  { href: "/settings", label: "Subscription", icon: "⚙️" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [user, setUserState] = useState<{ name: string; email: string; plan: string } | null>(null);

  useEffect(() => {
    setUserState(getUser());
  }, []);

  const handleLogout = () => {
    setUser(null);
    window.location.href = "/";
  };

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-slate-800 bg-slate-950 text-slate-100">
      <div className="flex h-full flex-col">
        <div className="flex h-16 items-center gap-2 border-b border-slate-800 px-6">
          <span className="text-2xl">🎯</span>
          <div>
            <span className="text-lg font-bold tracking-tight">WholesaleOS</span>
            <p className="text-[10px] uppercase tracking-widest text-emerald-400">All-in-One Platform</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                )}
              >
                <span className="text-lg">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-4">
          {user ? (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">{user.name}</p>
                <p className="text-xs text-slate-500">{user.email}</p>
                <span className="mt-1 inline-block rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-400">
                  {user.plan} Plan
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                🚪 Sign out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              🏠 Sign in
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}
