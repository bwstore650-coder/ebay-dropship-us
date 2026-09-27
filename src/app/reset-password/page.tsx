import AuthForm from "@/components/AuthForm";
import SiteHeader from "@/components/SiteHeader";
import { getI18n } from "@/lib/i18n/server";

export const metadata = { robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { locale, t } = await getI18n();
  const { token } = await searchParams;
  return (
    <>
      <SiteHeader locale={locale} t={t} />
      <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-brand-50/60 to-slate-50">
        {token ? (
          <AuthForm mode="reset" token={token} t={t.auth} errors={t.errors} />
        ) : (
          <p className="mx-auto max-w-md px-4 py-16 text-center text-red-600">{t.errors.RESET_INVALID}</p>
        )}
      </main>
    </>
  );
}
