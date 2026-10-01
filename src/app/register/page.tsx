import AuthForm from "@/components/AuthForm";
import SiteHeader from "@/components/SiteHeader";
import { getI18n } from "@/lib/i18n/server";
import { googleEnabled } from "@/lib/google-auth";

export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { locale, t } = await getI18n();
  const { error } = await searchParams;
  return (
    <>
      <SiteHeader locale={locale} t={t} />
      <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-brand-500/10 to-canvas">
        <AuthForm mode="register" t={t.auth} errors={t.errors} google={googleEnabled()} initialError={error ?? null} />
      </main>
    </>
  );
}
