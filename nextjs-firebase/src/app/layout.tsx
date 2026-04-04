import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { getSiteBaseUrl } from "../lib/siteUrl";
import { defaultLocale, isLocale, type Locale } from "@koochly/shared";

/** Full-resolution asset: `public/divaro.png` (served as-is, no image optimizer). */
const divaroLogoPath = "/divaro.png";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteBaseUrl()),
  title: {
    default: "Divaro",
    template: "%s | Divaro",
  },
  description:
    "Find Iranian businesses, services, and local ads by city and category on Divaro.",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    siteName: "Divaro",
    title: "Divaro",
    description:
      "Find Iranian businesses, services, and local ads by city and category on Divaro.",
    url: getSiteBaseUrl(),
    images: [{ url: divaroLogoPath, alt: "Divaro" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Divaro",
    description:
      "Find Iranian businesses, services, and local ads by city and category on Divaro.",
    images: [divaroLogoPath],
  },
  icons: {
    icon: divaroLogoPath,
    shortcut: divaroLogoPath,
    apple: divaroLogoPath,
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
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Divaro",
    url: siteBaseUrl,
    logo: `${siteBaseUrl}${divaroLogoPath}`,
  };
  const siteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Divaro",
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
