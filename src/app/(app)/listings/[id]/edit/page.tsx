import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import ListingEditClient from "@/components/ListingEditClient";

export const dynamic = "force-dynamic";

/** Modifier toute une annonce en ligne (photos, titre, description, caractéristiques, prix, variantes). */
export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser();
  const { t } = await getI18n();
  const E = t.listings.editor;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Link href="/listings" className="text-sm font-medium text-brand-300 hover:text-brand-200">{E.back}</Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{E.title}</h1>
        <p className="mt-1 text-sm text-muted">{E.help}</p>
      </div>
      <ListingEditClient id={id} t={E} tl={t.listing} errors={t.errors} />
    </div>
  );
}
