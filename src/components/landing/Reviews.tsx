import { db } from "@/lib/db";
import { fmt, type Dict } from "@/lib/i18n";
import { reviewSummary } from "@/lib/reviews";

/**
 * Avis publiés (validés dans /admin/reviews). Rien n'est affiché tant qu'il n'y a aucun avis réel :
 * on n'invente jamais de témoignages.
 */
export default async function Reviews({ t }: { t: Dict["landing"]["reviews"] }) {
  let reviews: { id: string; rating: number; text: string; authorName: string; authorInfo: string | null }[] = [];
  let ratings: number[] = [];
  try {
    const where = { status: "APPROVED" as const, consent: true };
    [reviews, ratings] = await Promise.all([
      db.review.findMany({ where, orderBy: { approvedAt: "desc" }, take: 6, select: { id: true, rating: true, text: true, authorName: true, authorInfo: true } }),
      db.review.findMany({ where, select: { rating: true } }).then((rows) => rows.map((r) => r.rating)),
    ]);
  } catch (e) {
    console.error("reviews", e);
    return null;
  }
  const summary = reviewSummary(ratings);
  if (!summary || reviews.length === 0) return null;

  return (
    <section id="reviews" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t.title}</h2>
        <p className="mt-3 text-muted">{t.subtitle}</p>
        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-4 py-1.5 text-sm font-semibold text-amber-300">
          <span className="text-amber-500" aria-hidden="true">★</span>
          {fmt(t.summary, summary)}
        </p>
      </div>
      <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {reviews.map((r) => (
          <figure key={r.id} className="card flex flex-col">
            <div className="text-lg text-amber-400" aria-label={`${r.rating}/5`}>
              {"★".repeat(r.rating)}
              <span className="text-line-strong">{"★".repeat(5 - r.rating)}</span>
            </div>
            <blockquote className="mt-3 flex-1 whitespace-pre-line text-fg-2">“{r.text}”</blockquote>
            <figcaption className="mt-5 flex items-center gap-3 border-t border-line pt-4">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-500/15 text-sm font-bold text-brand-300" aria-hidden="true">
                {r.authorName.trim().charAt(0).toUpperCase()}
              </span>
              <span className="text-sm">
                <span className="block font-semibold text-fg">{r.authorName}</span>
                <span className="block text-muted">
                  {r.authorInfo ? `${r.authorInfo} · ` : ""}
                  <span className="text-emerald-300">✓ {t.verified}</span>
                </span>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
