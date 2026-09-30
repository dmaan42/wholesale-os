"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setUser } from "@/lib/store";
import Link from "next/link";

function LoginForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const isOwner = searchParams.get("owner") === "1";

  const enterApp = () => {
    setUser({
      name: name.trim() || "Owner",
      email: email.trim() || "owner@wholesaleos.com",
      plan: isOwner ? "Owner" : "Pro",
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner && (!name.trim() || !email.trim())) return;
    enterApp();

    if (isOwner) {
      router.push("/dashboard");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      router.push("/dashboard");
    } catch {
      router.push("/dashboard");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="text-2xl font-bold text-white">WholesaleOS</span>
          </Link>
          <p className="mt-2 text-slate-400">
            {isOwner ? "Owner Access" : "Start your WholesaleOS subscription"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-800 bg-slate-900 p-8">
          <div className="mb-4">
            <label className="mb-1.5 block text-sm text-slate-300">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white"
              placeholder="Your name"
            />
          </div>
          <div className="mb-6">
            <label className="mb-1.5 block text-sm text-slate-300">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white"
              placeholder="you@example.com"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-emerald-600 py-3 font-semibold text-white"
          >
            {isOwner ? "Owner Access →" : loading ? "Sending you to Stripe..." : "Start Free Trial →"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <LoginForm />
    </Suspense>
  );
}
