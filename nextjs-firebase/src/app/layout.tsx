import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { getSiteBaseUrl } from "../lib/siteUrl";
import { defaultLocale, isLocale, type Locale } from "../i18n/config";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteBaseUrl()),
  title: "Koochly",
  description: "Directory of Iranian businesses abroad and locally.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const raw = h.get("x-next-locale") ?? defaultLocale;
  const locale: Locale = isLocale(raw) ? raw : defaultLocale;
  const dir = locale === "en" ? "ltr" : "rtl";
  const lang = locale === "en" ? "en" : "fa-IR";

  return (
    <html lang={lang} dir={dir} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
