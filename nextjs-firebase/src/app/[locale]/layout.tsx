import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { I18nProvider } from "../../i18n/client";
import { getMessages, isLocale, locales, type Locale } from "@koochly/shared";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import FirebaseRuntimeInit from "../../components/FirebaseRuntimeInit";
import { getFirebaseWebPublicConfig } from "../../lib/firebaseWebConfig";
import { ThemeToggle } from "../ThemeToggle";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: loc } = await params;
  if (!isLocale(loc)) notFound();
  const locale = loc as Locale;
  const messages = getMessages(locale);
  const firebaseWebConfig = getFirebaseWebPublicConfig();

  return (
    <I18nProvider locale={locale} messages={messages}>
      <FirebaseRuntimeInit config={firebaseWebConfig} />
      {children}
      <ThemeToggle />
      <LanguageSwitcher />
    </I18nProvider>
  );
}
