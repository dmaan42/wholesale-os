"use client";

import { useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import Link from "next/link";

function LoginForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkEmail, setCheckEmail] = useState(false);
  const router = useRouter();

  const startCheckout = async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/checkout", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return true;
      }
    } catch {
      // fall through to dashboard
    }
    return false;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "signup") {
        if (!name.trim() || !email.trim() || password.length < 6) {
          throw new Error("Enter your name, a valid email, and a password of 6+ characters.");
        }
        const supabase = getSupabase();
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() } },
        });
        if (error) throw error;
        if (!data.session) {
          // Email confirmation is enabled in Supabase: user must click the link first.
          setCheckEmail(true);
          return;
        }
        const wentToStripe = await startCheckout();
        if (!wentToStripe) router.push("/dashboard");
      } else {
        const { error } = await getSupabase().auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        router.push("/dashboard");
      }
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (checkEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
          <div className="mb-4 text-4xl">📬</div>
          <h2 className="mb-2 text-xl font-bold text-white">Check your email</h2>
          <p className="text-sm text-slate-400">
            We sent a confirmation link to <span className="text-white">{email}</span>.
            Click it, then sign in below.
          </p>
          <button
            onClick={() => {
              setCheckEmail(false);
              setMode("signin");
            }}
            className="mt-6 w-full rounded-lg bg-emerald-600 py-3 font-semibold text-white hover:bg-emerald-500"
          >
            Go to Sign In →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="text-2xl font-bold text-white">WholesaleOS</span>
          </Link>
          <p className="mt-2 text-slate-400">
            {mode === "signup" ? "Start your WholesaleOS subscription" : "Welcome back"}
          </p>
        </div>

        <div className="mb-4 grid grid-cols-2 rounded-xl border border-slate-800 bg-slate-900 p-1">
          {(["signup", "signin"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError("");
              }}
              className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                mode === m ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              {m === "signup" ? "Create Account" : "Sign In"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-800 bg-slate-900 p-8">
          {mode === "signup" && (
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
          )}
          <div className="mb-4">
            <label className="mb-1.5 block text-sm text-slate-300">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white"
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="mb-6">
            <label className="mb-1.5 block text-sm text-slate-300">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white"
              placeholder={mode === "signup" ? "6+ characters" : "Your password"}
              required
              minLength={6}
            />
          </div>
          {error && (
            <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-emerald-600 py-3 font-semibold text-white disabled:opacity-60"
          >
            {loading
              ? "Please wait..."
              : mode === "signup"
                ? "Create Account & Start Trial →"
                : "Sign In →"}
          </button>
          {mode === "signup" && (
            <p className="mt-4 text-center text-xs text-slate-500">
              $197/mo after trial · Cancel anytime · Secure checkout by Stripe
            </p>
          )}
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
