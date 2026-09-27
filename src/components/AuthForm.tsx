"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
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
    if (!res.ok) return setError((await res.json()).error ?? "Erreur");
    router.push(mode === "register" ? "/billing" : "/dashboard");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-20">
      <h1 className="text-2xl font-bold">{mode === "login" ? "Connexion" : "Créer un compte"}</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <input name="email" type="email" required placeholder="Email" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
        <input name="password" type="password" required minLength={8} placeholder="Mot de passe (8 caractères min.)" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={loading} className="w-full rounded-lg bg-blue-600 py-2 font-semibold text-white disabled:opacity-60">
          {loading ? "…" : mode === "login" ? "Se connecter" : "Créer mon compte"}
        </button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        {mode === "login" ? <>Pas de compte ? <Link className="text-blue-600" href="/register">Créer un compte</Link></> : <>Déjà inscrit ? <Link className="text-blue-600" href="/login">Se connecter</Link></>}
      </p>
    </main>
  );
}
