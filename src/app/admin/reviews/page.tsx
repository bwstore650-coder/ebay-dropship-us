import { db } from "@/lib/db";
import { moderateReview } from "../actions";

export const dynamic = "force-dynamic";

const LABEL = { PENDING: "En attente", APPROVED: "Publié", REJECTED: "Refusé" } as const;
const BADGE = { PENDING: "bg-amber-100 text-amber-800", APPROVED: "bg-emerald-100 text-emerald-800", REJECTED: "bg-slate-200 text-slate-600" } as const;

export default async function AdminReviews() {
  const reviews = await db.review.findMany({
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: { user: { select: { email: true, plan: true } } },
    take: 200,
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Avis clients</h1>
        <p className="mt-1 text-sm text-slate-600">
          Les avis viennent uniquement de comptes clients réels. Seuls les avis « Publié » apparaissent sur la page d&apos;accueil.
          Si un client modifie son avis, il repasse « En attente ».
        </p>
      </div>
      {reviews.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">Aucun avis pour l&apos;instant.</p>}
      <div className="space-y-4">
        {reviews.map((r) => (
          <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[r.status]}`}>{LABEL[r.status]}</span>
              <span className="text-amber-500" aria-label={`${r.rating} sur 5`}>{"★".repeat(r.rating)}<span className="text-slate-300">{"★".repeat(5 - r.rating)}</span></span>
              <span className="font-semibold">{r.authorName}</span>
              {r.authorInfo && <span className="text-slate-500">{r.authorInfo}</span>}
              <span className="ml-auto text-xs text-slate-500">{r.user.email} · {r.user.plan} · {r.locale.toUpperCase()} · {r.updatedAt.toLocaleDateString("fr-FR")}</span>
            </div>
            <p className="mt-3 whitespace-pre-line text-slate-700">{r.text}</p>
            <div className="mt-4 flex gap-2">
              {r.status !== "APPROVED" && (
                <form action={moderateReview}>
                  <input type="hidden" name="reviewId" value={r.id} />
                  <input type="hidden" name="decision" value="APPROVED" />
                  <button className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Publier</button>
                </form>
              )}
              {r.status !== "REJECTED" && (
                <form action={moderateReview}>
                  <input type="hidden" name="reviewId" value={r.id} />
                  <input type="hidden" name="decision" value="REJECTED" />
                  <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold hover:bg-slate-50">
                    {r.status === "APPROVED" ? "Retirer du site" : "Refuser"}
                  </button>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
