import AuthForm from "@/components/AuthForm";
import SiteHeader from "@/components/SiteHeader";
import { getI18n } from "@/lib/i18n/server";

export default async function Page() {
  const { locale, t } = await getI18n();
  return (
    <>
      <SiteHeader locale={locale} t={t} />
      <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-brand-500/10 to-canvas">
        <AuthForm mode="login" t={t.auth} errors={t.errors} />
      </main>
    </>
  );
}
