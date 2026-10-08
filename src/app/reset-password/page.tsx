"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";

function ResetForm() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // supabase-js exchanges the ?code= from the email link automatically
    // (detectSessionInUrl). If there's no session, the link is bad/expired.
    getSupabase()
      .auth.getSession()
      .then(({ data, error }) => {
        if (error || !data.session) {
          setError(
            "This reset link is invalid or has expired. Request a new one from the login page."
          );
        }
        setReady(true);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await getSupabase().auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setTimeout(() => router.push("/dashboard"), 1500);
    } catch (err: any) {
      setError(err.message || "Could not update password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="text-2xl font-bold text-white">WholesaleOS</span>
          </Link>
          <p className="mt-2 text-slate-400">Choose a new password</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8">
          {!ready ? (
            <p className="text-center text-sm text-slate-400">Verifying your link…</p>
          ) : error && !done ? (
            <div className="text-center">
              <p className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </p>
              <Link
                href="/login"
                className="inline-block w-full rounded-lg bg-emerald-600 py-3 font-semibold text-white hover:bg-emerald-500"
              >
                Back to Login →
              </Link>
            </div>
          ) : done ? (
            <div className="text-center">
              <div className="mb-4 text-4xl">✅</div>
              <p className="text-sm text-slate-300">
                Password updated. Taking you to your dashboard…
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label className="mb-1.5 block text-sm text-slate-300">New password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white"
                  placeholder="6+ characters"
                  required
                  minLength={6}
                />
              </div>
              <div className="mb-6">
                <label className="mb-1.5 block text-sm text-slate-300">
                  Confirm new password
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-white"
                  placeholder="Repeat your new password"
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
                {loading ? "Please wait..." : "Set New Password →"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <ResetForm />
    </Suspense>
  );
}
