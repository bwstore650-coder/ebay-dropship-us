import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getI18n } from "@/lib/i18n/server";
import ReviewForm from "@/components/ReviewForm";

export default async function ReviewPage() {
  const user = await requireUser();
  const { t } = await getI18n();
  const r = t.review;
  const existing = await db.review.findUnique({ where: { userId: user.id } });
  const status = existing ? { PENDING: r.statusPending, APPROVED: r.statusApproved, REJECTED: r.statusRejected }[existing.status] : null;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">{r.title}</h1>
        <p className="mt-2 text-muted">{r.intro}</p>
      </div>
      {status && <p className="rounded-lg bg-surface-2 px-4 py-3 text-sm text-fg-2">{status}</p>}
      <ReviewForm
        t={r}
        errors={t.errors}
        initial={existing ? { rating: existing.rating, text: existing.text, authorName: existing.authorName, authorInfo: existing.authorInfo ?? "" } : null}
      />
    </div>
  );
}
