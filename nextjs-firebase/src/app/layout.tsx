import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { getSiteBaseUrl } from "../lib/siteUrl";
import { defaultLocale, isLocale, type Locale } from "@koochly/shared";
import KoochlyLogo from "./images/Koochly-Logo.png";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteBaseUrl()),
  title: {
    default: "Koochly",
    template: "%s | Koochly",
  },
  description:
    "Find Iranian businesses, services, and local ads by city and category on Koochly.",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    siteName: "Koochly",
    title: "Koochly",
    description:
      "Find Iranian businesses, services, and local ads by city and category on Koochly.",
    url: getSiteBaseUrl(),
    images: [{ url: KoochlyLogo.src, alt: "Koochly" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Koochly",
    description:
      "Find Iranian businesses, services, and local ads by city and category on Koochly.",
    images: [KoochlyLogo.src],
  },
  icons: {
    icon: KoochlyLogo.src,
    shortcut: KoochlyLogo.src,
    apple: KoochlyLogo.src,
  },
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
  const siteBaseUrl = getSiteBaseUrl();
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Koochly",
    url: siteBaseUrl,
    logo: `${siteBaseUrl}${KoochlyLogo.src}`,
  };
  const siteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Koochly",
    url: siteBaseUrl,
    potentialAction: {
      "@type": "SearchAction",
      target: `${siteBaseUrl}/en?query={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <html lang={lang} dir={dir} suppressHydrationWarning>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
