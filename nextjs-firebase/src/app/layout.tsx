import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { getSiteBaseUrl } from "../lib/siteUrl";
import { defaultLocale, isLocale, logoPublicPath, type Locale } from "@koochly/shared";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteBaseUrl()),
  title: {
    default: "Persiana",
    template: "%s | Persiana",
  },
  description:
    "Find Iranian businesses, services, and local ads by city and category on Persiana.",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    siteName: "Persiana",
    title: "Persiana",
    description:
      "Find Iranian businesses, services, and local ads by city and category on Persiana.",
    url: getSiteBaseUrl(),
  },
  twitter: {
    card: "summary_large_image",
    title: "Persiana",
    description:
      "Find Iranian businesses, services, and local ads by city and category on Persiana.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f4f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1120" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const raw = h.get("x-next-locale") ?? defaultLocale;
  const locale: Locale = isLocale(raw) ? raw : defaultLocale;
  const dir = locale === "en" ? "ltr" : "rtl";
  const lang = locale === "en" ? "en" : "fa-IR";
  const siteBaseUrl = getSiteBaseUrl();
  const logoPath = logoPublicPath(locale);
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Persiana",
    url: siteBaseUrl,
    logo: `${siteBaseUrl}${logoPath}`,
  };
  const siteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Persiana",
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
