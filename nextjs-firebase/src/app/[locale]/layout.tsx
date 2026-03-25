import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { I18nProvider } from "../../i18n/client";
import { isLocale, type Locale } from "../../i18n/config";
import { getMessages } from "../../i18n/getMessages";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { ThemeToggle } from "../ThemeToggle";
import { locales } from "../../i18n/config";

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

  return (
    <I18nProvider locale={locale} messages={messages}>
      {children}
      <ThemeToggle />
      <LanguageSwitcher />
    </I18nProvider>
  );
}
