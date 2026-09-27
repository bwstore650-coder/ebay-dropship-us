import AuthForm from "@/components/AuthForm";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { getI18n } from "@/lib/i18n/server";

export default async function Page() {
  const { locale, t } = await getI18n();
  return (
    <>
      <div className="mx-auto flex max-w-sm justify-end px-4 pt-6">
        <LanguageSwitcher locale={locale} label={t.common.language} />
      </div>
      <AuthForm mode="register" t={t.auth} errors={t.errors} />
    </>
  );
}
