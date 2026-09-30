"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";

type Mode = "login" | "register" | "forgot" | "reset";

/** Remplace {terms} et {privacy} par des liens. */
function TermsLabel({ t }: { t: Dict["auth"] }) {
  const parts = t.acceptTerms.split(/(\{terms\}|\{privacy\})/);
  return (
    <>
      {parts.map((p, i) =>
        p === "{terms}" ? (
          <Link key={i} href="/terms" target="_blank" className="font-medium text-brand-400 underline">{t.termsLink}</Link>
        ) : p === "{privacy}" ? (
          <Link key={i} href="/privacy" target="_blank" className="font-medium text-brand-400 underline">{t.privacyLink}</Link>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

export default function AuthForm({ mode, t, errors, token }: { mode: Mode; t: Dict["auth"]; errors: Dict["errors"]; token?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload =
      mode === "forgot"
        ? { email: form.get("email") }
        : mode === "reset"
          ? { token, password: form.get("password") }
          : { email: form.get("email"), password: form.get("password"), ...(mode === "register" ? { acceptTerms: form.get("acceptTerms") === "on" } : {}) };
    const res = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setLoading(false);
    if (!res.ok) return setError(errorMessage(errors, (await res.json().catch(() => ({}))).error));
    if (mode === "forgot") return setSent(true);
    router.push(mode === "register" ? "/billing" : "/dashboard");
    router.refresh();
  }

  const title = { login: t.loginTitle, register: t.registerTitle, forgot: t.forgotTitle, reset: t.resetTitle }[mode];
  const button = { login: t.loginButton, register: t.registerButton, forgot: t.forgotButton, reset: t.resetButton }[mode];

  return (
    <div className="mx-auto w-full max-w-md px-4 py-16">
      <div className="card p-8">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {mode === "forgot" && <p className="mt-2 text-sm text-muted">{t.forgotHelp}</p>}
        {sent ? (
          <p className="mt-6 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{t.forgotSent}</p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            {mode !== "reset" && <input name="email" type="email" required autoComplete="email" placeholder={t.email} aria-label={t.email} className="input" />}
            {mode !== "forgot" && (
              <input
                name="password"
                type="password"
                required
                minLength={mode === "login" ? 1 : 8}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder={mode === "reset" ? t.newPassword : t.password}
                aria-label={mode === "reset" ? t.newPassword : t.password}
                className="input"
              />
            )}
            {mode === "login" && (
              <p className="text-right text-sm">
                <Link href="/forgot-password" className="font-medium text-brand-400 hover:underline">{t.forgotLink}</Link>
              </p>
            )}
            {mode === "register" && (
              <label className="flex items-start gap-2 text-sm text-muted">
                <input name="acceptTerms" type="checkbox" required className="mt-1" />
                <span><TermsLabel t={t} /></span>
              </label>
            )}
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button disabled={loading} className="btn-primary w-full">{loading ? "…" : button}</button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-muted">
          {mode === "login" ? (
            <>{t.noAccount} <Link className="font-medium text-brand-400 hover:underline" href="/register">{t.createAccount}</Link></>
          ) : mode === "register" ? (
            <>{t.haveAccount} <Link className="font-medium text-brand-400 hover:underline" href="/login">{t.signIn}</Link></>
          ) : (
            <Link className="font-medium text-brand-400 hover:underline" href="/login">{t.backToLogin}</Link>
          )}
        </p>
      </div>
    </div>
  );
}
