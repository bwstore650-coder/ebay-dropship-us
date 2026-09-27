"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmt, type Dict } from "@/lib/i18n";
import { errorMessage } from "@/lib/i18n/errors";

type Initial = { rating: number; text: string; authorName: string; authorInfo: string } | null;

export default function ReviewForm({ t, errors, initial }: { t: Dict["review"]; errors: Dict["errors"]; initial: Initial }) {
  const router = useRouter();
  const [rating, setRating] = useState(initial?.rating ?? 5);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rating,
        text: f.get("text"),
        authorName: f.get("authorName"),
        authorInfo: f.get("authorInfo") ?? "",
        consent: f.get("consent") === "on",
      }),
    });
    if (!res.ok) {
      setError(errorMessage(errors, (await res.json().catch(() => ({}))).error));
      setState("idle");
      return;
    }
    setState("done");
    router.refresh();
  }

  if (state === "done") return <p className="rounded-2xl bg-emerald-50 p-6 text-emerald-800">{t.thanks}</p>;

  const field = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none";
  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <fieldset>
        <legend className="text-sm font-medium">{t.rating}</legend>
        <div className="mt-2 flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              aria-label={fmt(t.star, { n })}
              aria-pressed={rating === n}
              className={`text-3xl leading-none transition ${n <= rating ? "text-amber-400" : "text-slate-300 hover:text-amber-200"}`}
            >
              ★
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm font-medium">
        {t.text}
        <textarea name="text" required minLength={20} maxLength={1000} rows={5} defaultValue={initial?.text} placeholder={t.textPlaceholder} className={field} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          {t.name}
          <input name="authorName" required minLength={2} maxLength={40} defaultValue={initial?.authorName} placeholder={t.namePlaceholder} className={field} />
        </label>
        <label className="block text-sm font-medium">
          {t.info}
          <input name="authorInfo" maxLength={60} defaultValue={initial?.authorInfo} placeholder={t.infoPlaceholder} className={field} />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-600">
        <input name="consent" type="checkbox" required className="mt-1" />
        {t.consent}
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={state === "sending"} className="btn-primary">{state === "sending" ? t.sending : t.submit}</button>
    </form>
  );
}
