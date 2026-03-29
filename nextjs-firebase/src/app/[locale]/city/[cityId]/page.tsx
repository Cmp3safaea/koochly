import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { collectCategoryCodes } from "../../../../lib/directoryMetadata";
import { getFirestoreAdmin } from "../../../../lib/firebaseAdmin";
import { hubPathForCityDoc } from "../../../../lib/seoIndexable";
import { withLocale } from "@koochly/shared";
import { resolveLocale } from "../../../../i18n/server";
import { directoryDepartmentDisplayLabel } from "../../../../lib/directoryDepartmentLabel";
import { getMapsBrowserApiKey } from "../../../../lib/mapsBrowserKey";
import { reviewSummaryFromAdData } from "../../../../lib/adReviewSummary";
import CityAdsViewClient, {
  type CityJumpOption,
  type CityAdCard,
  type DepartmentQuickItem,
} from "./CityAdsViewClient";

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

function toNonEmptyString(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeCityToken(value: unknown): string {
  if (typeof value !== "string") return "";
  // Remove zero-width/invisible formatting chars that can poison URL segments.
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

export default async function CityAdsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; cityId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cityId, locale: localeRaw } = await params;
  const uiLocale = resolveLocale(localeRaw);
  const sp = searchParams ? await searchParams : undefined;
  const initialCatCode = firstSearchParam(sp, "cat");
  const initialDepartmentId = firstSearchParam(sp, "dept");
  const cityKeyRaw = toNonEmptyString(cityId);
  const cityKey = cityKeyRaw ? sanitizeCityToken(cityKeyRaw) : null;

  if (!cityKey) return notFound();

  const db = getFirestoreAdmin();
  // Prefer matching by `cities.city_eng` (new behavior).
  // Fallbacks: `cities.city_fa`, then old behavior using the doc id.
  let citySnap: any = null;

  // 1) city_eng
  const byCityEng = await db
    .collection("cities")
    .where("city_eng", "==", cityKey)
    .limit(1)
    .get();
  if (!byCityEng.empty) citySnap = byCityEng.docs[0];

  // 2) city_fa
  if (!citySnap) {
    const byCityFa = await db
      .collection("cities")
      .where("city_fa", "==", cityKey)
      .limit(1)
      .get();
    if (!byCityFa.empty) citySnap = byCityFa.docs[0];
  }

  // 3) legacy doc id
  if (!citySnap) {
    const docSnap = await db.collection("cities").doc(cityKey).get();
    if (docSnap.exists) citySnap = docSnap;
  }

  if (!citySnap) return notFound();

  const cityData = citySnap.data() as Record<string, unknown>;

  const cityFa = sanitizeCityToken(cityData.city_fa);
  const cityEng = sanitizeCityToken(cityData.city_eng);
  const countryFa =
    typeof cityData.country_fa === "string" ? cityData.country_fa : "";
  const countryEng =
    typeof cityData.country_eng === "string" ? cityData.country_eng : "";
  const canonicalCityKey = sanitizeCityToken(cityEng || cityFa || citySnap.id || "");
  if (canonicalCityKey && cityKey !== canonicalCityKey) {
    redirect(withLocale(uiLocale, `/city/${encodeURIComponent(canonicalCityKey)}`));
  }
  const flagUrl =
    typeof cityData.flag_url === "string" ? cityData.flag_url : undefined;

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

  // Try to query ads by whichever city field exists.
  let adsSnap;
  try {
    if (cityEng) {
      adsSnap = await db
        .collection("ads")
        .where("city_eng", "==", cityEng)
        .where("approved", "==", true)
        .limit(100)
        .get();
    } else {
      adsSnap = await db
        .collection("ads")
        .where("city_fa", "==", cityFa)
        .where("approved", "==", true)
        .limit(100)
        .get();
    }
  } catch {
    // Fallback: fetch a subset and filter client-side (avoids missing index crashes).
    const subset = await db.collection("ads").limit(500).get();
    const filtered = subset.docs.filter((d) => {
      const data = d.data() as Record<string, unknown>;
      if (cityEng && data.city_eng === cityEng) return true;
      if (cityFa && data.city_fa === cityFa) return true;
      return false;
    }).filter((d) => (d.data() as Record<string, unknown>).approved === true);

    adsSnap = {
      docs: filtered,
    } as unknown as { docs: typeof filtered };
  }

  const ads: AdDoc[] = adsSnap.docs.map((d) => {
    const data = d.data() as AdDoc;
    return { id: d.id, ...data };
  });

  // Sort by `seq` if present, otherwise keep stable order.
  ads.sort((a, b) => {
    const ao = typeof a.seq === "number" ? a.seq : Number.MAX_SAFE_INTEGER;
    const bo = typeof b.seq === "number" ? b.seq : Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });

  // SEO + heading: always prefer city_eng.
  const pageTitle =
    cityEng && countryFa ? `${countryFa} - ${cityEng}` : cityEng || cityFa;

  const adsForClient: CityAdCard[] = ads.map((ad) => {
    const rawLoc = ad.location as any;
    // Support multiple Firestore shapes:
    // - { __lat__: number, __lon__: number }
    // - { lat: number, lon: number }
    // - GeoPoint-like: { latitude: number, longitude: number }
    // - sometimes: { lat: number, lng: number }
    const lat = toFiniteNumber(
      rawLoc?.__lat__ ?? rawLoc?.lat ?? rawLoc?.latitude,
    );
    const lon = toFiniteNumber(
      rawLoc?.__lon__ ?? rawLoc?.lon ?? rawLoc?.longitude ?? rawLoc?.lng,
    );

    const location =
      lat !== null && lon !== null ? { lat, lon } : null;

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

    const image = getFirstImage(ad);
    const link = deriveAdDetailPath(ad) ?? normalizeLink(ad);
    const departmentId = toDepartmentId(ad.departmentID);
    const catCode = typeof ad.cat_code === "string" ? ad.cat_code : null;
    const createdAtMs = toDateTimeMs(ad.dateTime);

    const approved = ad.approved === true;
    const paidAds = ad.paidAds === true;
    const paidAdsExpiresAtMsRaw = toDateTimeMs(ad.paidAdsExpiresAt);
    const paidAdsExpiresAtMs =
      paidAds && typeof paidAdsExpiresAtMsRaw === "number" ? paidAdsExpiresAtMsRaw : null;

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

    return {
      id: ad.id ?? title,
      title,
      engName,
      category,
      description,
      image,
      link,
      phone,
      location,
      departmentId,
      catCode,
      subcats,
      createdAtMs,
      visits,
      approved,
      paidAds,
      paidAdsExpiresAtMs,
      reviewAvg: review.avg,
      reviewCount: review.count,
      price: cardPrice,
      isFree: ad.isFree === true,
      isNewItem: ad.isNewItem === true,
      exchangeable: ad.exchangeable === true,
      negotiable: ad.negotiable === true,
      mainCategory: mainCat,
    };
  });

  // Build filter options from directory collection structure.
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

  // Only include options that exist in the current city's ads.
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

  const citiesSnap = await db.collection("cities").limit(300).get();
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

  const googleMapsApiKey = getMapsBrowserApiKey();

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "18px 16px 64px 16px" }}>
      <CityAdsViewClient
        googleMapsApiKey={googleMapsApiKey}
        cityTitle={pageTitle}
        cityFa={cityFa}
        countryFa={countryFa}
        countryEng={countryEng}
        flagUrl={flagUrl}
        ads={adsForClient}
        cityCenter={cityCenter}
        departmentOptions={departmentOptions}
        categoryOptions={categoryOptions}
        departmentQuickFilters={departmentQuickFilters}
        cityOptions={cityOptions}
        currentCityId={canonicalCityKey}
        initialCatCode={initialCatCode}
        initialDepartmentId={initialDepartmentId}
      />
    </main>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; cityId: string }>;
}): Promise<Metadata> {
  const { cityId, locale: localeRaw } = await params;
  const locale = resolveLocale(localeRaw);
  const cityKeyRaw = toNonEmptyString(cityId);
  const cityKey = cityKeyRaw ? sanitizeCityToken(cityKeyRaw) : null;
  if (!cityKey) return { title: "Koochly" };

  const db = getFirestoreAdmin();
  let citySnap: any = null;

  // 1) city_eng
  const byCityEng = await db
    .collection("cities")
    .where("city_eng", "==", cityKey)
    .limit(1)
    .get();
  if (!byCityEng.empty) citySnap = byCityEng.docs[0];

  // 2) city_fa
  if (!citySnap) {
    const byCityFa = await db
      .collection("cities")
      .where("city_fa", "==", cityKey)
      .limit(1)
      .get();
    if (!byCityFa.empty) citySnap = byCityFa.docs[0];
  }

  // 3) legacy doc id
  if (!citySnap) {
    const docSnap = await db.collection("cities").doc(cityKey).get();
    if (docSnap.exists) citySnap = docSnap;
  }

  if (!citySnap) return { title: "Koochly" };

  const cityData = citySnap.data() as Record<string, unknown>;
  const cityFa = sanitizeCityToken(cityData.city_fa);
  const cityEng = sanitizeCityToken(cityData.city_eng);
  const countryFa =
    typeof cityData.country_fa === "string" ? cityData.country_fa : "";

  const seoCity = cityEng || cityFa || "City";
  const hub = hubPathForCityDoc(cityData);
  const pathWithinLocale =
    hub ?? `/city/${encodeURIComponent(cityKey)}/`;
  const canonicalPath = withLocale(locale, pathWithinLocale);

  return {
    title: countryFa
      ? `${seoCity} - Koochly Ads (${countryFa})`
      : `${seoCity} - Koochly Ads`,
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

