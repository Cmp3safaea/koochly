import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFirestoreAdmin } from "../../../../../../lib/firebaseAdmin";
import { resolveLocale } from "../../../../../../i18n/server";
import { getSiteBaseUrl } from "../../../../../../lib/siteUrl";
import { withLocale } from "@koochly/shared";
import { directoryDepartmentDisplayLabel } from "../../../../../../lib/directoryDepartmentLabel";
import { getMapsBrowserApiKey } from "../../../../../../lib/mapsBrowserKey";
import { reviewSummaryFromAdData } from "../../../../../../lib/adReviewSummary";
import CityAdsViewClient, {
  type CityAdCard,
  type CityJumpOption,
  type DepartmentQuickItem,
} from "../../../../city/[cityId]/CityAdsViewClient";

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

type SelectOption = { value: string; label: string };

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitize(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim();
}

async function findCityDoc(country: string, city: string) {
  const db = getFirestoreAdmin();
  const countryKey = sanitize(country).toLowerCase();
  const cityKey = sanitize(city);

  const pick = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) =>
    docs.find((d) => {
      const data = d.data() as Record<string, unknown>;
      const ce = typeof data.country_eng === "string" ? data.country_eng.toLowerCase() : "";
      return ce === countryKey;
    }) ?? docs[0] ?? null;

  const byEng = await db.collection("cities").where("city_eng", "==", cityKey).limit(20).get();
  if (!byEng.empty) return pick(byEng.docs);

  const byFa = await db.collection("cities").where("city_fa", "==", cityKey).limit(20).get();
  if (!byFa.empty) return pick(byFa.docs);

  const legacy = await db.collection("cities").doc(cityKey).get();
  return legacy.exists ? legacy : null;
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

async function loadCategoryAds(cityEng: string, cityFa: string, catCode: string): Promise<AdDoc[]> {
  const db = getFirestoreAdmin();
  const rows = new Map<string, AdDoc>();

  const pushDoc = (d: FirebaseFirestore.QueryDocumentSnapshot) => {
    const data = d.data() as Record<string, unknown>;
    rows.set(d.id, { id: d.id, ...(data as AdDoc), cat_code: catCode });
  };

  try {
    if (cityEng) {
      const q = await db
        .collection("ads")
        .where("city_eng", "==", cityEng)
        .where("cat_code", "==", catCode)
        .where("approved", "==", true)
        .limit(200)
        .get();
      q.docs.forEach(pushDoc);
    }
    if (cityFa) {
      const q = await db
        .collection("ads")
        .where("city_fa", "==", cityFa)
        .where("cat_code", "==", catCode)
        .where("approved", "==", true)
        .limit(200)
        .get();
      q.docs.forEach(pushDoc);
    }
  } catch {
    const subset = await db.collection("ads").limit(700).get();
    subset.docs.forEach((d) => {
      const data = d.data() as Record<string, unknown>;
      if (data.approved !== true) return;
      if (typeof data.cat_code !== "string" || data.cat_code.trim() !== catCode) return;
      const matchEng = cityEng && data.city_eng === cityEng;
      const matchFa = cityFa && data.city_fa === cityFa;
      if (!matchEng && !matchFa) return;
      pushDoc(d);
    });
  }

  return Array.from(rows.values());
}

export default async function CityCategoryLandingPage({
  params,
}: {
  params: Promise<{ locale: string; country: string; city: string; catCode: string }>;
}) {
  const { locale: localeRaw, country, city, catCode } = await params;
  const locale = resolveLocale(localeRaw);
  const countryParam = toNonEmptyString(country);
  const cityParam = toNonEmptyString(city);
  const catCodeParam = toNonEmptyString(catCode);
  if (!countryParam || !cityParam || !catCodeParam) return notFound();

  const cityDoc = await findCityDoc(countryParam, cityParam);
  if (!cityDoc) return notFound();
  const cityData = cityDoc.data() as Record<string, unknown>;
  const cityEng = sanitize(cityData.city_eng);
  const cityFa = sanitize(cityData.city_fa);
  const countryEng = typeof cityData.country_eng === "string" ? cityData.country_eng : "";
  const countryFa = typeof cityData.country_fa === "string" ? cityData.country_fa.trim() : "";
  const rawLatLng = cityData.latlng as any;
  const cityCenterLat = toFiniteNumber(rawLatLng?.__lat__ ?? rawLatLng?.lat ?? rawLatLng?.latitude);
  const cityCenterLon = toFiniteNumber(rawLatLng?.__lon__ ?? rawLatLng?.lon ?? rawLatLng?.longitude);
  const cityCenter =
    cityCenterLat !== null && cityCenterLon !== null
      ? { lat: cityCenterLat, lon: cityCenterLon }
      : null;

  const ads = await loadCategoryAds(cityEng, cityFa, catCodeParam);
  const categoryLabel =
    ads.find((a) => typeof a.cat === "string" && a.cat.trim())?.cat?.trim() || catCodeParam;
  const cityName = cityEng || cityFa || cityParam;
  const pageTitle = cityEng && countryFa ? `${countryFa} - ${cityEng}` : cityName;
  const pathWithinLocale = `/${countryParam}/${cityParam}/category/${catCodeParam}/`;
  const canonicalPath = withLocale(locale, pathWithinLocale);
  const canonicalUrl = `${getSiteBaseUrl()}${canonicalPath}`;
  const cityHubPath = withLocale(locale, `/${countryParam}/${cityParam}/`);
  const db = getFirestoreAdmin();

  const adsForClient: CityAdCard[] = ads
    .map((ad) => {
      const rawLoc = ad.location as any;
      const lat = toFiniteNumber(rawLoc?.__lat__ ?? rawLoc?.lat ?? rawLoc?.latitude);
      const lon = toFiniteNumber(rawLoc?.__lon__ ?? rawLoc?.lon ?? rawLoc?.longitude ?? rawLoc?.lng);
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
        typeof ad.details === "string" && ad.details.trim() ? ad.details.trim() : null;
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
        image: getFirstImage(ad),
        link: deriveAdDetailPath(ad) ?? normalizeLink(ad),
        phone,
        location,
        departmentId: toDepartmentId(ad.departmentID),
        catCode: typeof ad.cat_code === "string" ? ad.cat_code : null,
        subcats,
        createdAtMs: toDateTimeMs(ad.dateTime),
        visits,
        price: cardPrice,
        isFree: ad.isFree === true,
        isNewItem: ad.isNewItem === true,
        exchangeable: ad.exchangeable === true,
        negotiable: ad.negotiable === true,
        mainCategory: mainCat,
        reviewAvg: review.avg,
        reviewCount: review.count,
      } satisfies CityAdCard;
    })
    .sort((a, b) => {
      const ao = typeof a.createdAtMs === "number" ? a.createdAtMs : Number.MAX_SAFE_INTEGER;
      const bo = typeof b.createdAtMs === "number" ? b.createdAtMs : Number.MAX_SAFE_INTEGER;
      return bo - ao;
    });

  const directorySnap = await db.collection("directory").get();
  const departmentMap = new Map<string, string>();
  const departmentImageMap = new Map<string, string>();
  directorySnap.docs.forEach((doc) => {
    const data = doc.data() as Record<string, unknown>;
    departmentMap.set(doc.id, directoryDepartmentDisplayLabel(data, doc.id, locale));
    if (typeof data.image === "string" && data.image.trim()) {
      departmentImageMap.set(doc.id, data.image.trim());
    }
  });
  const departmentOptions: SelectOption[] = Array.from(
    new Set(adsForClient.map((a) => a.departmentId).filter(Boolean) as string[]),
  )
    .map((id) => ({ value: id, label: departmentMap.get(id) ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const categoryOptions: SelectOption[] = Array.from(
    new Set(adsForClient.map((a) => a.catCode).filter(Boolean) as string[]),
  )
    .map((code) => ({ value: code, label: code === catCodeParam ? categoryLabel : code }))
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
      const fa = sanitize(c.city_fa);
      const en = sanitize(c.city_eng);
      const cityPath = en || fa || doc.id;
      const label = fa && en ? `${fa} · ${en}` : fa || en || doc.id;
      return { id: cityPath, label };
    })
    .filter((x): x is CityJumpOption => x !== null)
    .sort((a, b) => a.label.localeCompare(b.label, locale));

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Koochly", item: `${getSiteBaseUrl()}/${locale}` },
      { "@type": "ListItem", position: 2, name: cityName, item: `${getSiteBaseUrl()}${cityHubPath}` },
      { "@type": "ListItem", position: 3, name: categoryLabel, item: canonicalUrl },
    ],
  };
  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${pageTitle} - Koochly`,
    url: canonicalUrl,
    inLanguage: locale,
  };

  const googleMapsApiKey = getMapsBrowserApiKey();

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "18px 16px 56px 16px" }}>
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
        ads={adsForClient}
        cityCenter={cityCenter}
        departmentOptions={departmentOptions}
        categoryOptions={categoryOptions}
        departmentQuickFilters={departmentQuickFilters}
        cityOptions={cityOptions}
        currentCityId={(cityEng || cityFa || cityDoc.id || "").trim()}
        initialCatCode={catCodeParam}
        relatedCategoryLabel={categoryLabel}
        allCityAdsHref={cityHubPath}
      />
    </main>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; country: string; city: string; catCode: string }>;
}): Promise<Metadata> {
  const { locale: localeRaw, country, city, catCode } = await params;
  const locale = resolveLocale(localeRaw);
  const countryParam = toNonEmptyString(country);
  const cityParam = toNonEmptyString(city);
  const catCodeParam = toNonEmptyString(catCode);
  if (!countryParam || !cityParam || !catCodeParam) return { title: "Koochly" };

  const pathWithinLocale = `/${countryParam}/${cityParam}/category/${catCodeParam}/`;
  return {
    title: `${catCodeParam} in ${cityParam} - Koochly`,
    description: `Browse ${catCodeParam} listings in ${cityParam} on Koochly.`,
    alternates: {
      canonical: withLocale(locale, pathWithinLocale),
      languages: {
        fa: withLocale("fa", pathWithinLocale),
        en: withLocale("en", pathWithinLocale),
        "x-default": withLocale("en", pathWithinLocale),
      },
    },
  };
}
