import { unstable_cache } from "next/cache";
import type { Locale } from "@koochly/shared";
import { withLocale } from "@koochly/shared";
import { getFirestoreAdmin } from "./firebaseAdmin";
import type { DirectoryLocale } from "./directoryDepartmentLabel";
import { collectCategoryCodes, categoriesFromDirectoryData } from "./directoryMetadata";
import { getSiteBaseUrl } from "./siteUrl";

export type CategoryLandingSeoInput = {
  locale: "en" | "fa";
  categoryLabel: string;
  cityEn: string;
  cityFa: string;
  countryEn: string;
  countryFa: string;
  adCount: number;
  brandName?: string;
};

function cityPhraseEn(input: CategoryLandingSeoInput): string {
  const c = input.cityEn.trim() || input.cityFa.trim();
  const co = input.countryEn.trim() || input.countryFa.trim();
  if (c && co) return `${c}, ${co}`;
  return c || co || "this area";
}

function cityPhraseFa(input: CategoryLandingSeoInput): string {
  const c = input.cityFa.trim() || input.cityEn.trim();
  const co = input.countryFa.trim() || input.countryEn.trim();
  if (c && co) return `${c}\u060C ${co}`;
  return c || co || "\u0627\u06CC\u0646 \u0645\u0646\u0637\u0642\u0647";
}

export function categoryLandingH1(input: CategoryLandingSeoInput): string {
  const cat = input.categoryLabel.trim() || "businesses";
  if (input.locale === "fa") {
    const place = cityPhraseFa(input);
    return `${cat} \u0627\u06CC\u0631\u0627\u0646\u06CC \u0648 \u0641\u0627\u0631\u0633\u06CC\u200C\u0632\u0628\u0627\u0646 \u062F\u0631 ${place}`;
  }
  const place = cityPhraseEn(input);
  return `Iranian & Persian ${cat} in ${place}`;
}

export function categoryLandingMetaTitle(input: CategoryLandingSeoInput): string {
  const brand = input.brandName?.trim() || "Persiana";
  const cat = input.categoryLabel.trim() || "Businesses";
  if (input.locale === "fa") {
    return `${cat} \u0627\u06CC\u0631\u0627\u0646\u06CC \u062F\u0631 ${cityPhraseFa(input)} | ${brand}`;
  }
  return `Iranian & Persian ${cat} in ${cityPhraseEn(input)} | ${brand}`;
}

export function categoryLandingMetaDescription(input: CategoryLandingSeoInput): string {
  const cat = input.categoryLabel.trim() || "businesses";
  const n = Math.max(0, input.adCount);
  const brand = input.brandName?.trim() || "Persiana";
  if (input.locale === "fa") {
    const place = cityPhraseFa(input);
    const countPart = n > 0 ? `${n} \u0645\u0648\u0631\u062F \u0641\u0639\u0627\u0644. ` : "";
    return `\u0641\u0647\u0631\u0633\u062A ${cat}\u0647\u0627\u06CC \u0627\u06CC\u0631\u0627\u0646\u06CC \u0648 \u0641\u0627\u0631\u0633\u06CC\u200C\u0632\u0628\u0627\u0646 \u062F\u0631 ${place}. ${countPart}\u062C\u0633\u062A\u062C\u0648 \u0648 \u062A\u0645\u0627\u0633 \u0627\u0632 \u0637\u0631\u06CC\u0642 ${brand}.`;
  }
  const place = cityPhraseEn(input);
  const countPart = n > 0 ? `${n} listings. ` : "";
  return `Find Iranian, Persian, and Farsi-speaking ${cat.toLowerCase()} in ${place}. ${countPart}Browse trusted community businesses on ${brand}.`;
}

export function categoryLandingIntroParagraphs(input: CategoryLandingSeoInput): string[] {
  const cat = input.categoryLabel.trim() || "businesses";
  const n = Math.max(0, input.adCount);
  if (input.locale === "fa") {
    const place = cityPhraseFa(input);
    const brand = input.brandName?.trim() || "Persiana";
    return [
      `\u0627\u06AF\u0631 \u0628\u0647 \u062F\u0646\u0628\u0627\u0644 ${cat} \u0627\u06CC\u0631\u0627\u0646\u06CC \u06CC\u0627 \u0641\u0627\u0631\u0633\u06CC\u200C\u0632\u0628\u0627\u0646 \u062F\u0631 ${place} \u0647\u0633\u062A\u06CC\u062F\u060C ${brand} \u067E\u0644 \u0627\u0631\u062A\u0628\u0627\u0637\u06CC \u0634\u0645\u0627 \u0628\u0627 \u06A9\u0633\u0628\u200C\u0648\u06A9\u0627\u0631\u0647\u0627\u06CC \u0645\u0648\u0631\u062F \u0627\u0639\u062A\u0645\u0627\u062F \u062C\u0627\u0645\u0639\u0647 \u0627\u0633\u062A.`,
      n > 0
        ? `\u062F\u0631 \u062D\u0627\u0644 \u062D\u0627\u0636\u0631 ${n} \u0645\u0648\u0631\u062F \u0641\u0639\u0627\u0644 \u062F\u0631 \u0627\u06CC\u0646 \u062F\u0633\u062A\u0647 \u0628\u0631\u0627\u06CC \u0627\u06CC\u0646 \u0634\u0647\u0631 \u0646\u0645\u0627\u06CC\u0634 \u062F\u0627\u062F\u0647 \u0645\u06CC\u200C\u0634\u0648\u062F.`
        : `\u0628\u0631\u0627\u06CC \u0627\u06CC\u0646 \u0634\u0647\u0631 \u0647\u0646\u0648\u0632 \u0622\u06AF\u0647\u06CC \u06A9\u0645\u062A\u0631\u06CC \u062F\u0631 \u0627\u06CC\u0646 \u062F\u0633\u062A\u0647 \u062B\u0628\u062A \u0634\u062F\u0647 \u0627\u0633\u062A\u061B \u0645\u06CC\u200C\u062A\u0648\u0627\u0646\u06CC\u062F \u0641\u0647\u0631\u0633\u062A \u06A9\u0627\u0645\u0644 \u0634\u0647\u0631 \u0631\u0627 \u0628\u0628\u06CC\u0646\u06CC\u062F.`,
      `\u0628\u0631\u0627\u06CC \u0646\u062A\u0627\u0626\u062C \u0645\u062D\u0644\u06CC \u062F\u0642\u06CC\u0642\u200C\u062A\u0631\u060C \u0627\u0632 \u0641\u06CC\u0644\u062A\u0631 \u0646\u0642\u0634\u0647 \u0648 \u062C\u0633\u062A\u062C\u0648 \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u06A9\u0646\u06CC\u062F.`,
    ];
  }
  const place = cityPhraseEn(input);
  const brand = input.brandName?.trim() || "Persiana";
  const cityToken = input.cityEn || input.cityFa;
  return [
    `Looking for Iranian, Persian, or Farsi-speaking ${cat.toLowerCase()} in ${place}? ${brand} helps you discover trusted businesses. Searches like Iranian ${cat.toLowerCase()} ${cityToken}, Persian ${cat.toLowerCase()}, and Farsi-speaking ${cat.toLowerCase()} map to this page.`,
    n > 0
      ? `This page shows ${n} active listing${n === 1 ? "" : "s"} in this category for ${place}.`
      : `We are still growing coverage for this category in ${place}. Browse the full city hub for all listings.`,
    `Use the map and filters to narrow results. Business owners can list on ${brand}.`,
  ];
}

export type CategoryLandingFaqItem = { question: string; answer: string };

export function categoryLandingFaq(input: CategoryLandingSeoInput): CategoryLandingFaqItem[] {
  const cat = input.categoryLabel.trim() || "businesses";
  const brand = input.brandName?.trim() || "Persiana";
  if (input.locale === "fa") {
    const place = cityPhraseFa(input);
    return [
      {
        question: `\u0686\u06AF\u0648\u0646\u0647 ${cat} \u0627\u06CC\u0631\u0627\u0646\u06CC \u062F\u0631 ${place} \u067E\u06CC\u062F\u0627 \u06A9\u0646\u0645\u061F`,
        answer: `\u062F\u0631 \u0647\u0645\u06CC\u0646 \u0635\u0641\u062D\u0647 \u0641\u0647\u0631\u0633\u062A \u0622\u06AF\u0647\u06CC\u200C\u0647\u0627\u06CC \u0645\u0631\u062A\u0628\u0637 \u0628\u0627 \u062F\u0633\u062A\u0647 \u00AB${cat}\u00BB \u0631\u0627 \u0645\u06CC\u200C\u0628\u06CC\u0646\u06CC\u062F.`,
      },
      {
        question:
          "\u0622\u06CC\u0627 \u0647\u0645\u0647 \u0622\u06AF\u0647\u06CC\u200C\u0647\u0627 \u0641\u0627\u0631\u0633\u06CC\u200C\u0632\u0628\u0627\u0646 \u0647\u0633\u062A\u0646\u062F\u061F",
        answer: `\u0647\u062F\u0641 ${brand} \u0645\u0639\u0631\u0641\u06CC \u06A9\u0633\u0628\u200C\u0648\u06A9\u0627\u0631\u0647\u0627\u06CC \u0645\u0631\u062A\u0628\u0637 \u0628\u0627 \u062C\u0627\u0645\u0639\u0647 \u0627\u06CC\u0631\u0627\u0646\u06CC \u0648 \u0641\u0627\u0631\u0633\u06CC\u200C\u0632\u0628\u0627\u0646 \u0627\u0633\u062A.`,
      },
      {
        question: `\u0686\u06AF\u0648\u0646\u0647 \u06A9\u0633\u0628\u200C\u0648\u06A9\u0627\u0631 \u062E\u0648\u062F \u0631\u0627 \u062B\u0628\u062A \u06A9\u0646\u0645\u061F`,
        answer: `\u0627\u0632 \u06AF\u0632\u06CC\u0646\u0647 \u062B\u0628\u062A \u0622\u06AF\u0647\u06CC \u062F\u0631 ${brand} \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u06A9\u0646\u06CC\u062F.`,
      },
    ];
  }
  const place = cityPhraseEn(input);
  return [
    {
      question: `How do I find Iranian or Persian ${cat.toLowerCase()} in ${place}?`,
      answer: `This page lists directory results for "${cat}" in ${place}.`,
    },
    {
      question: "Are these businesses Farsi-speaking?",
      answer: `${brand} highlights businesses relevant to Iranian and Persian communities; offerings vary by listing.`,
    },
    {
      question: `How can I add my business in ${place}?`,
      answer: `Create a listing on ${brand} with the right city and category.`,
    },
  ];
}

async function buildCategoryCodeToLabel(dirLocale: DirectoryLocale): Promise<Record<string, string>> {
  const db = getFirestoreAdmin();
  const snap = await db.collection("dir").get();
  const map = new Map<string, string>();
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    collectCategoryCodes(data.categories, map, dirLocale);
    for (const c of categoriesFromDirectoryData(data, dirLocale)) {
      if (!map.has(c.code)) map.set(c.code, c.label);
    }
  }
  return Object.fromEntries(map);
}

export function getDirectoryCategoryLabelsCached(locale: "en" | "fa") {
  const dirLocale: DirectoryLocale = locale === "en" ? "en" : "fa";
  return unstable_cache(
    async () => buildCategoryCodeToLabel(dirLocale),
    ["directory-category-labels-v1", locale],
    { revalidate: 3600 },
  )();
}

export function buildFaqPageJsonLd(faqs: CategoryLandingFaqItem[], pageUrl: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: f.answer,
      },
    })),
    url: pageUrl,
  };
}

type AdForJsonLd = {
  title: string;
  link: string | null | undefined;
  image?: string | null | undefined;
  phone?: string | null | undefined;
  description?: string | null | undefined;
  location?: { lat: number; lon: number } | null | undefined;
  reviewAvg?: number | null | undefined;
  reviewCount?: number | null | undefined;
};

export function buildItemListLocalBusinessJsonLd(
  locale: Locale,
  pageUrl: string,
  listName: string,
  ads: AdForJsonLd[],
  maxItems: number,
): Record<string, unknown> {
  const base = getSiteBaseUrl();
  const slice = ads.slice(0, maxItems);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: listName,
    url: pageUrl,
    numberOfItems: slice.length,
    itemListElement: slice.map((ad, index) => {
      const path = ad.link?.startsWith("/") ? withLocale(locale, ad.link) : ad.link;
      const itemUrl = path && path.startsWith("http") ? path : path ? `${base}${path}` : pageUrl;
      const item: Record<string, unknown> = {
        "@type": "LocalBusiness",
        name: ad.title,
        url: itemUrl,
      };
      if (ad.image) item.image = ad.image;
      if (ad.phone) item.telephone = ad.phone;
      if (ad.description) item.description = String(ad.description).slice(0, 320);
      if (ad.location) {
        item.geo = {
          "@type": "GeoCoordinates",
          latitude: ad.location.lat,
          longitude: ad.location.lon,
        };
      }
      if (
        typeof ad.reviewAvg === "number" &&
        Number.isFinite(ad.reviewAvg) &&
        typeof ad.reviewCount === "number" &&
        ad.reviewCount > 0
      ) {
        item.aggregateRating = {
          "@type": "AggregateRating",
          ratingValue: Math.round(ad.reviewAvg * 10) / 10,
          reviewCount: ad.reviewCount,
          bestRating: 5,
          worstRating: 1,
        };
      }
      return {
        "@type": "ListItem",
        position: index + 1,
        item,
      };
    }),
  };
}

export function buildOrganizationJsonLd(siteName: string): Record<string, unknown> {
  const base = getSiteBaseUrl();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteName,
    url: base,
    description:
      "Global directory of Iranian, Persian, and Farsi-speaking businesses and services by city.",
  };
}
