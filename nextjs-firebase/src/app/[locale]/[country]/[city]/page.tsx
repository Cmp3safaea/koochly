import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getFirestoreAdmin } from "../../../../lib/firebaseAdmin";
import { withLocale } from "@koochly/shared";
import { resolveLocale } from "../../../../i18n/server";
import { directoryDepartmentDisplayLabel } from "../../../../lib/directoryDepartmentLabel";
import { getSiteBaseUrl } from "../../../../lib/siteUrl";
import { getMapsBrowserApiKey } from "../../../../lib/mapsBrowserKey";
import { reviewSummaryFromAdData } from "../../../../lib/adReviewSummary";
import { resolveCityFlagUrl } from "../../../../lib/cityFlagUrl";
import {
  AD_PROMOTION_TYPES,
  type AdPromotionType,
} from "../../../../lib/adPromotions";
import CityAdsViewClient, {
  type CityJumpOption,
  type CityAdCard,
  type DepartmentQuickItem,
  type PopularCategoryLink,
} from "../../city/[cityId]/CityAdsViewClient";

export const dynamic = "force-dynamic";

type AdDoc = {
  id?: string;
  title?: string;
  engName?: string;
  images?: string[];
  image?: string;
  url?: string;
  website?: string;
  cat?: string;
  cat_code?: string;
  departmentID?: unknown;
  city?: string;
  city_eng?: string;
  dept?: string;
  details?: string;
  phone?: string;
  location?: { __lat__?: number; __lon__?: number } | unknown;
  dateTime?: unknown;
  seq?: number;
  approved?: boolean;
  paidAds?: boolean;
  paidAdsExpiresAt?: unknown;
  promotionBadges?: unknown;
  promotion_badges?: unknown;
  visits?: unknown;
  subcat?: unknown;
  selectedCategoryTags?: unknown;
  price?: unknown;
  isFree?: unknown;
  isNewItem?: unknown;
  exchangeable?: unknown;
  negotiable?: unknown;
  mainCategory?: unknown;
};

type SelectOption = {
  value: string;
  label: string;
};

function toNonEmptyString(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeCityToken(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim();
}

function firstSearchParam(
  sp: Record<string, string | string[] | undefined> | undefined,
  key: string,
): string | null {
  if (!sp) return null;
  const v = sp[key];
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") {
    const t = v[0].trim();
    return t.length > 0 ? t : null;
  }
  return null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toDateTimeMs(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "object") {
    const v = value as any;
    if (typeof v.toDate === "function") {
      const d = v.toDate();
      const t = d instanceof Date ? d.getTime() : Date.parse(String(d));
      return Number.isFinite(t) ? t : null;
    }
    if (typeof v.__time__ === "string") {
      const t = Date.parse(v.__time__);
      return Number.isFinite(t) ? t : null;
    }
    if (typeof v._seconds === "number") return v._seconds * 1000;
    if (typeof v.seconds === "number") return v.seconds * 1000;
  }
  return null;
}

function toDepartmentId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const parts = value.split("/");
    return parts[parts.length - 1] || null;
  }
  if (typeof value === "object") {
    const v = value as any;
    if (typeof v.id === "string" && v.id) return v.id;
    if (typeof v.path === "string" && v.path) {
      const parts = v.path.split("/");
      return parts[parts.length - 1] || null;
    }
    if (typeof v.__ref__ === "string" && v.__ref__) {
      const parts = v.__ref__.split("/");
      return parts[parts.length - 1] || null;
    }
  }
  return null;
}

function normalizeSubcats(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v, i, arr) => v.length > 0 && arr.indexOf(v) === i)
    .slice(0, 8);
}

const promotionTypeAllowed = new Set<string>([...AD_PROMOTION_TYPES]);

function promotionBadgesAsArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return Object.values(raw as Record<string, unknown>);
  }
  return [];
}

function activePromotionTypesFromDoc(
  data: Record<string, unknown>,
  nowMs: number,
): AdPromotionType[] {
  const raw = promotionBadgesAsArray(
    data.promotionBadges ?? data.promotion_badges,
  );
  const out: AdPromotionType[] = [];
  for (const row of raw) {
    if (typeof row === "string") {
      const type = row.trim().toLowerCase();
      if (promotionTypeAllowed.has(type)) out.push(type as AdPromotionType);
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const typeRaw =
      (typeof o.type === "string" ? o.type : null) ??
      (typeof o.promoType === "string" ? o.promoType : null) ??
      (typeof o.promotionType === "string" ? o.promotionType : null);
    const type = (typeRaw ?? "").trim().toLowerCase();
    if (!promotionTypeAllowed.has(type)) continue;
    const exp = toDateTimeMs(
      o.expireDate ?? o.expiresAt ?? o.expire_at ?? o.expireAt,
    );
    if (exp !== null && exp <= nowMs) continue;
    out.push(type as AdPromotionType);
  }
  return AD_PROMOTION_TYPES.filter((t) => out.includes(t));
}

function mergePromotionTypes(
  a: AdPromotionType[],
  b: AdPromotionType[] | undefined,
): AdPromotionType[] {
  if (!b?.length) return a;
  const set = new Set<string>([...a, ...b]);
  return AD_PROMOTION_TYPES.filter((t) => set.has(t));
}

async function promotionTypesFromSubcollections(
  db: ReturnType<typeof getFirestoreAdmin>,
  adIds: string[],
  nowMs: number,
): Promise<Map<string, AdPromotionType[]>> {
  const out = new Map<string, AdPromotionType[]>();
  await Promise.all(
    adIds.map(async (id) => {
      try {
        const snap = await db.collection("ads").doc(id).collection("promotions").get();
        const found = new Set<string>();
        for (const doc of snap.docs) {
          const d = doc.data() as Record<string, unknown>;
          const rawType =
            (typeof d.type === "string" ? d.type.trim().toLowerCase() : "") ||
            doc.id.trim().toLowerCase();
          if (!promotionTypeAllowed.has(rawType)) continue;
          const exp = toDateTimeMs(
            d.expireDate ?? d.expiresAt ?? d.expire_at ?? d.expireAt,
          );
          if (exp !== null && exp <= nowMs) continue;
          found.add(rawType);
        }
        if (found.size > 0) {
          out.set(id, AD_PROMOTION_TYPES.filter((t) => found.has(t)));
        }
      } catch {
        /* ignore per-ad */
      }
    }),
  );
  return out;
}

function collectCategoryCodes(
  node: unknown,
  output: Map<string, string>,
) {
  if (!node || typeof node !== "object") return;

  if (Array.isArray(node)) {
    node.forEach((item) => collectCategoryCodes(item, output));
    return;
  }

  const obj = node as Record<string, unknown>;
  const code = obj.code;
  const label =
    typeof obj.category === "string" && obj.category.trim()
      ? obj.category
      : typeof obj.engName === "string" && obj.engName.trim()
        ? obj.engName
        : null;

  if (typeof code === "string" && code && label) {
    output.set(code, label);
  }

  Object.values(obj).forEach((v) => collectCategoryCodes(v, output));
}

function getFirstImage(ad: AdDoc): string | null {
  const imgs = ad.images;
  if (Array.isArray(imgs) && imgs.length > 0 && typeof imgs[0] === "string") {
    return imgs[0];
  }
  if (typeof ad.image === "string") return ad.image;
  return null;
}

function normalizeLink(ad: AdDoc): string | null {
  if (typeof ad.url === "string" && ad.url.trim()) return ad.url;
  if (typeof ad.website === "string" && ad.website.trim()) return ad.website;
  return null;
}

function deriveAdDetailPath(ad: AdDoc): string | null {
  if (typeof ad.url === "string" && ad.url.trim()) {
    const m = ad.url.match(/\/b\/(\d+)/);
    if (m?.[1]) return `/b/${m[1]}`;
  }
  if (typeof ad.seq === "number" && Number.isFinite(ad.seq)) {
    return `/b/${ad.seq}`;
  }
  return null;
}

export default async function CityAdsByCountryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; country: string; city: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { country, city, locale: localeRaw } = await params;
  const uiLocale = resolveLocale(localeRaw);
  const sp = searchParams ? await searchParams : undefined;
  const initialCatCode = firstSearchParam(sp, "cat");
  const initialDepartmentId = firstSearchParam(sp, "dept");
  const countryParam = toNonEmptyString(country);
  const cityParam = toNonEmptyString(city);
  if (!countryParam || !cityParam) return notFound();

  const db = getFirestoreAdmin();

  const countryKey = sanitizeCityToken(countryParam);
  const cityKey = sanitizeCityToken(cityParam);
  const countryLower = countryKey.toLowerCase();
  const cityLower = cityKey.toLowerCase();

  // Avoid composite-index requirements: fetch by city, then (optionally) pick by country.
  // This way, `uk/birmingham/` works even if someone passes "United Kingdom" instead of "uk".
  let citySnap: any = null;

  const pickByCountryOrFirst = (docs: any[]) => {
    if (docs.length === 0) return null;
    const matchByCountry =
      docs.find((d) => {
        const data = d.data() as Record<string, unknown>;
        const ce = data.country_eng;
        if (typeof ce !== "string") return false;
        return ce.toLowerCase() === countryLower;
      }) ?? null;
    return matchByCountry ?? docs[0] ?? null;
  };

  const cityEngQ = await db
    .collection("cities")
    .where("city_eng", "==", cityKey)
    .limit(20)
    .get();
  if (!cityEngQ.empty) {
    citySnap = pickByCountryOrFirst(cityEngQ.docs);
  }

  // Fallback: try lower-case city_eng match (some data may not be normalized).
  if (!citySnap) {
    const cityEngQL = await db
      .collection("cities")
      .where("city_eng", "==", cityLower)
      .limit(20)
      .get();
    if (!cityEngQL.empty) {
      citySnap = pickByCountryOrFirst(cityEngQL.docs);
    }
  }

  // Fallback: try city_fa (if someone uses Persian city in the URL).
  if (!citySnap) {
    const cityFaQ = await db
      .collection("cities")
      .where("city_fa", "==", cityKey)
      .limit(20)
      .get();
    if (!cityFaQ.empty) {
      citySnap = pickByCountryOrFirst(cityFaQ.docs);
    }
  }

  if (!citySnap) return notFound();

  const cityData = citySnap.data() as Record<string, unknown>;
  const cityFa = sanitizeCityToken(cityData.city_fa);
  const cityEng = sanitizeCityToken(cityData.city_eng);
  const countryFa =
    typeof cityData.country_fa === "string" ? cityData.country_fa : "";
  const countryEng =
    typeof cityData.country_eng === "string" ? cityData.country_eng : "";
  const cityCurrencySymbol =
    typeof cityData.currency_symbol === "string" ? cityData.currency_symbol.trim() : "";
  const flagUrl = resolveCityFlagUrl({
    flagUrl: typeof cityData.flag_url === "string" ? cityData.flag_url : undefined,
    countryEng,
    countryFa,
    pathCountrySlug: countryParam,
  });
  const rawLatLng = cityData.latlng as any;
  const cityCenterLat = toFiniteNumber(
    rawLatLng?.__lat__ ?? rawLatLng?.lat ?? rawLatLng?.latitude,
  );
  const cityCenterLon = toFiniteNumber(
    rawLatLng?.__lon__ ?? rawLatLng?.lon ?? rawLatLng?.longitude,
  );
  const cityCenter =
    cityCenterLat !== null && cityCenterLon !== null
      ? { lat: cityCenterLat, lon: cityCenterLon }
      : null;

  // Query ads: prefer city_eng. Fallback to subset + filter.
  const mergedAds = new Map<string, any>();

  try {
    // 1) city_eng matches
    if (cityEng) {
      const engAds = await db
        .collection("ads")
        .where("city_eng", "==", cityEng)
        .where("approved", "==", true)
        .limit(100)
        .get();
      engAds.docs.forEach((doc) => mergedAds.set(doc.id, doc));
    }

    // 2) city_fa matches (covers the case where some ads use `city_fa` only)
    if (cityFa) {
      const faAds = await db
        .collection("ads")
        .where("city_fa", "==", cityFa)
        .where("approved", "==", true)
        .limit(100)
        .get();
      faAds.docs.forEach((doc) => mergedAds.set(doc.id, doc));
    }
  } catch {
    // Last resort: pull a subset and filter client-side.
    const subset = await db.collection("ads").limit(500).get();
    subset.docs.forEach((d) => {
      const data = d.data() as Record<string, unknown>;
      if (data.approved !== true) return;
      if (cityEng && data.city_eng === cityEng) mergedAds.set(d.id, d);
      if (cityFa && data.city_fa === cityFa) mergedAds.set(d.id, d);
    });
  }

  const adsDocs = Array.from(mergedAds.values());
  const adsSnap = { docs: adsDocs };

  const ads: AdDoc[] = adsSnap.docs.map((d) => {
    const data = d.data() as AdDoc;
    return { id: d.id, ...data };
  });

  ads.sort((a, b) => {
    const ao = typeof a.seq === "number" ? a.seq : Number.MAX_SAFE_INTEGER;
    const bo = typeof b.seq === "number" ? b.seq : Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });

  const pageTitle =
    cityEng && countryFa ? `${countryFa} - ${cityEng}` : cityEng || cityFa;
  const nowMs = Date.now();
  const allAdDocIds = ads
    .map((a) => a.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const subPromoByAdId =
    allAdDocIds.length > 0
      ? await promotionTypesFromSubcollections(db, allAdDocIds, nowMs)
      : new Map<string, AdPromotionType[]>();

  const adsForClient: CityAdCard[] = ads.map((ad) => {
    const rawLoc = ad.location as any;
    const lat = toFiniteNumber(
      rawLoc?.__lat__ ?? rawLoc?.lat ?? rawLoc?.latitude,
    );
    const lon = toFiniteNumber(
      rawLoc?.__lon__ ?? rawLoc?.lon ?? rawLoc?.longitude ?? rawLoc?.lng,
    );
    const location = lat !== null && lon !== null ? { lat, lon } : null;

    const title =
      typeof ad.title === "string" && ad.title.trim()
        ? ad.title.trim()
        : typeof ad.engName === "string"
          ? ad.engName
          : ad.id ?? "";

    const engRaw =
      typeof ad.engName === "string" && ad.engName.trim() ? ad.engName.trim() : null;
    const engName = engRaw && engRaw !== title ? engRaw : null;

    const category =
      (typeof ad.cat === "string" && ad.cat.trim() ? ad.cat.trim() : null) ??
      (typeof ad.dept === "string" && ad.dept.trim() ? ad.dept.trim() : null);

    const description =
      typeof ad.details === "string" && ad.details.trim()
        ? ad.details.trim()
        : null;

    const phone =
      typeof ad.phone === "string" && ad.phone.trim() ? ad.phone.trim() : null;

    const visitsRaw = ad.visits;
    const visits =
      typeof visitsRaw === "number" && Number.isFinite(visitsRaw)
        ? Math.max(0, Math.floor(visitsRaw))
        : 0;
    const subcats = normalizeSubcats(ad.subcat).length
      ? normalizeSubcats(ad.subcat)
      : normalizeSubcats(ad.selectedCategoryTags);

    const review = reviewSummaryFromAdData(ad as unknown as Record<string, unknown>);

    const priceRaw = toFiniteNumber(ad.price);
    const mainCat =
      typeof ad.mainCategory === "string" && ad.mainCategory.trim()
        ? ad.mainCategory.trim().toLowerCase()
        : null;
    const cardPrice =
      mainCat === "services"
        ? null
        : ad.isFree === true
          ? null
          : priceRaw;
    const paidAds = ad.paidAds === true;
    const paidAdsExpiresAtMsRaw = toDateTimeMs(ad.paidAdsExpiresAt);
    const paidAdsExpiresAtMs =
      paidAds && typeof paidAdsExpiresAtMsRaw === "number" ? paidAdsExpiresAtMsRaw : null;
    const adData = ad as unknown as Record<string, unknown>;
    const fromBadges = activePromotionTypesFromDoc(adData, nowMs);
    const fromSub =
      typeof ad.id === "string" && ad.id
        ? subPromoByAdId.get(ad.id)
        : undefined;
    const activePromotions = mergePromotionTypes(fromBadges, fromSub);

    return {
      id: ad.id ?? title,
      title,
      engName,
      category,
      description,
      image: getFirstImage(ad),
      link: deriveAdDetailPath(ad) ?? normalizeLink(ad),
      phone,
      location,
      departmentId: toDepartmentId(ad.departmentID),
      catCode: typeof ad.cat_code === "string" ? ad.cat_code : null,
      subcats,
      createdAtMs: toDateTimeMs(ad.dateTime),
      visits,
      reviewAvg: review.avg,
      reviewCount: review.count,
      price: cardPrice,
      isFree: ad.isFree === true,
      isNewItem: ad.isNewItem === true,
      exchangeable: ad.exchangeable === true,
      negotiable: ad.negotiable === true,
      mainCategory: mainCat,
      paidAds,
      paidAdsExpiresAtMs,
      activePromotions:
        activePromotions.length > 0 ? activePromotions : undefined,
    };
  });

  const directorySnap = await db.collection("directory").get();
  const departmentMap = new Map<string, string>();
  const departmentImageMap = new Map<string, string>();
  const categoryMap = new Map<string, string>();
  const adCategoryLabelMap = new Map<string, string>();

  directorySnap.docs.forEach((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const deptLabel = directoryDepartmentDisplayLabel(data, doc.id, uiLocale);
    departmentMap.set(doc.id, deptLabel);
    const deptImg = data.image;
    if (typeof deptImg === "string" && deptImg.trim()) {
      departmentImageMap.set(doc.id, deptImg.trim());
    }

    collectCategoryCodes(data.categories, categoryMap);
  });

  ads.forEach((ad) => {
    if (
      typeof ad.cat_code === "string" &&
      ad.cat_code &&
      typeof ad.cat === "string" &&
      ad.cat.trim()
    ) {
      adCategoryLabelMap.set(ad.cat_code, ad.cat.trim());
    }
  });

  const departmentOptions: SelectOption[] = Array.from(
    new Set(adsForClient.map((a) => a.departmentId).filter(Boolean) as string[]),
  )
    .map((id) => ({
      value: id,
      label: departmentMap.get(id) ?? id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const categoryOptions: SelectOption[] = Array.from(
    new Set(adsForClient.map((a) => a.catCode).filter(Boolean) as string[]),
  )
    .map((code) => ({
      value: code,
      label: adCategoryLabelMap.get(code) ?? categoryMap.get(code) ?? code,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const departmentQuickFilters: DepartmentQuickItem[] = Array.from(
    new Set(adsForClient.map((a) => a.departmentId).filter(Boolean) as string[]),
  )
    .map((id) => ({
      id,
      label: departmentMap.get(id) ?? id,
      imageUrl: departmentImageMap.get(id) ?? null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  let citiesSnap;
  try {
    citiesSnap = await db
      .collection("cities")
      .where("active", "==", true)
      .orderBy("order")
      .limit(300)
      .get();
  } catch {
    citiesSnap = await db.collection("cities").limit(300).get();
  }
  const cityOptions: CityJumpOption[] = citiesSnap.docs
    .map((doc) => {
      const c = doc.data() as Record<string, unknown>;
      if (c.active !== true) return null;
      const fa = sanitizeCityToken(c.city_fa);
      const en = sanitizeCityToken(c.city_eng);
      const cityPath = en || fa || doc.id;
      const label = fa && en ? `${fa} · ${en}` : fa || en || doc.id;
      return { id: cityPath, label };
    })
    .filter((x): x is CityJumpOption => x !== null)
    .sort((a, b) => a.label.localeCompare(b.label, uiLocale));

  const pathWithinLocale = `/${encodeURIComponent(countryParam)}/${encodeURIComponent(cityParam)}/`;
  const canonicalPath = withLocale(uiLocale, pathWithinLocale);
  const canonicalUrl = `${getSiteBaseUrl()}${canonicalPath}`;
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Koochly",
        item: `${getSiteBaseUrl()}/${uiLocale}`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: pageTitle,
        item: canonicalUrl,
      },
    ],
  };
  const topAdUrls = adsForClient
    .map((a) => a.link)
    .filter((link): link is string => typeof link === "string" && link.startsWith("/b/"))
    .slice(0, 10)
    .map((link) => `${getSiteBaseUrl()}${withLocale(uiLocale, link)}`);
  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${pageTitle} - Koochly`,
    url: canonicalUrl,
    inLanguage: uiLocale,
    description: `Business listings for ${pageTitle}.`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: topAdUrls.map((url, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url,
      })),
    },
  };

  const googleMapsApiKey = getMapsBrowserApiKey();

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "18px 16px 64px 16px" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
      />
      <CityAdsViewClient
        googleMapsApiKey={googleMapsApiKey}
        cityTitle={pageTitle}
        cityFa={cityFa}
        countryFa={countryFa}
        countryEng={countryEng}
        flagUrl={flagUrl}
        cityCurrencySymbol={cityCurrencySymbol}
        ads={adsForClient}
        cityCenter={cityCenter}
        departmentOptions={departmentOptions}
        categoryOptions={categoryOptions}
        departmentQuickFilters={departmentQuickFilters}
        cityOptions={cityOptions}
        popularCategories={categoryOptions.map((cat): PopularCategoryLink => ({
          value: cat.value,
          label: cat.label,
          href: withLocale(
            uiLocale,
            `/${countryParam}/${cityParam}/category/${cat.value}/`,
          ),
        }))}
        currentCityId={(cityEng || cityFa || citySnap.id || "").trim()}
        initialCatCode={initialCatCode}
        initialDepartmentId={initialDepartmentId}
      />
    </main>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; country: string; city: string }>;
}): Promise<Metadata> {
  const { country, city, locale: localeRaw } = await params;
  const locale = resolveLocale(localeRaw);
  const countryParam = toNonEmptyString(country);
  const cityParam = toNonEmptyString(city);
  if (!countryParam || !cityParam) return { title: "Koochly" };

  const db = getFirestoreAdmin();
  const countryKey = sanitizeCityToken(countryParam);
  const cityKey = sanitizeCityToken(cityParam);

  const cityEngQ = await db
    .collection("cities")
    .where("city_eng", "==", cityKey)
    .limit(20)
    .get();
  const match =
    cityEngQ.docs.find((d) => {
      const data = d.data() as Record<string, unknown>;
      const ce = data.country_eng;
      return typeof ce === "string" && ce === countryKey;
    }) ?? null;

  const citySnap = match ?? (cityEngQ.empty ? null : cityEngQ.docs[0] ?? null);
  if (!citySnap) return { title: "Koochly" };

  const cityData = citySnap.data() as Record<string, unknown>;
  const cityEng = sanitizeCityToken(cityData.city_eng);
  const cityFa = sanitizeCityToken(cityData.city_fa);
  const countryFa =
    typeof cityData.country_fa === "string" ? cityData.country_fa : "";

  const seoCity = cityEng || cityFa || "City";
  const pathWithinLocale = `/${encodeURIComponent(countryParam)}/${encodeURIComponent(cityParam)}/`;
  const canonicalPath = withLocale(locale, pathWithinLocale);

  return {
    title: countryFa ? `${seoCity} - Koochly Ads (${countryFa})` : `${seoCity} - Koochly Ads`,
    description: countryFa
      ? `Explore business listings and ads for ${seoCity} in ${countryFa}.`
      : `Explore business listings and ads for ${seoCity}.`,
    alternates: {
      canonical: canonicalPath,
      languages: {
        fa: withLocale("fa", pathWithinLocale),
        en: withLocale("en", pathWithinLocale),
        "x-default": withLocale("en", pathWithinLocale),
      },
    },
    openGraph: {
      title: countryFa ? `${seoCity} Ads - Koochly` : `${seoCity} Ads - Koochly`,
    },
  };
}

