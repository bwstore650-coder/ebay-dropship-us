import { requireUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import ExtensionConnect from "@/components/ExtensionConnect";

export const dynamic = "force-dynamic";

/** Ouverte par l'extension : relie l'extension au compte connecté sur le site. */
export default async function ExtensionConnectPage() {
  await requireUser();
  const { t } = await getI18n();
  return <div className="py-8"><ExtensionConnect t={t.extension} /></div>;
}
