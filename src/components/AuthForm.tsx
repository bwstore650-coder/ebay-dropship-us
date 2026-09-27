"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";

export default function AuthForm({ mode, t, errors }: { mode: "login" | "register"; t: Dict["auth"]; errors: Dict["errors"] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    setLoading(false);
    if (!res.ok) return setError(errorMessage(errors, (await res.json().catch(() => ({}))).error));
    router.push(mode === "register" ? "/billing" : "/dashboard");
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-16">
      <div className="card p-8">
      <h1 className="text-2xl font-bold tracking-tight">{mode === "login" ? t.loginTitle : t.registerTitle}</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <input name="email" type="email" required placeholder={t.email} aria-label={t.email} className="input" />
        <input name="password" type="password" required minLength={8} placeholder={t.password} aria-label={t.password} className="input" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={loading} className="btn-primary w-full">
          {loading ? "…" : mode === "login" ? t.loginButton : t.registerButton}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        {mode === "login" ? (
          <>{t.noAccount} <Link className="font-medium text-brand-600 hover:underline" href="/register">{t.createAccount}</Link></>
        ) : (
          <>{t.haveAccount} <Link className="font-medium text-brand-600 hover:underline" href="/login">{t.signIn}</Link></>
        )}
      </p>
      </div>
    </div>
  );
}
