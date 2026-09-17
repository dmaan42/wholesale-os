"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { setUser } from "@/lib/store"
import Link from "next/link"

export default function LoginPage() {
const [name, setName] = useState("");
const [email, setEmail] = useState("");
const [loading, setLoading] = useState(false);
const router = useRouter();

const handleSubmit = async (e: React.FormEvent) => {
e.preventDefault();
if (!name.trim() || !email.trim()) return;

setUser({ name: name.trim(), email: email.trim(), plan: "Pro" });
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
<span className="text-3xl">🎯</span>
<span className="text-2xl font-bold text-white">WholesaleOS</span>
</Link>
<p className="mt-2 text-slate-400">Start your WholesaleOS subscription</p>
</div>

<form onSubmit={handleSubmit} className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
<div className="mb-4">
<label className="mb-1.5 block text-sm font-medium text-slate-300">Full Name</label>
<input
type="text"
required
value={name}
onChange={(e) => setName(e.target.value)}
className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
placeholder="John Smith"
/>
</div>
<div className="mb-6">
<label className="mb-1.5 block text-sm font-medium text-slate-300">Email</label>
<input
type="email"
required
value={email}
onChange={(e) => setEmail(e.target.value)}
className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
placeholder="you@example.com"
/>
</div>
<button
type="submit"
disabled={loading}
className="w-full rounded-lg bg-emerald-600 py-3 font-semibold text-white hover:bg-emerald-500"
>
{loading ? "Sending you to Stripe..." : "Start Free Trial →"}
</button>
<p className="mt-4 text-center text-xs text-slate-500">
You’ll be sent to Stripe Checkout to complete payment.
</p>
</form>
</div>
</div>
);
}