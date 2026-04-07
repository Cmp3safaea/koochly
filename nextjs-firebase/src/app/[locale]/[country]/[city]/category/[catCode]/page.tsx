import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFirestoreAdmin } from "../../../../../../lib/firebaseAdmin";
import { resolveLocale } from "../../../../../../i18n/server";
import { getSiteBaseUrl } from "../../../../../../lib/siteUrl";
import { firstAdImageUrl, withLocale } from "@koochly/shared";
import {
  directoryDepartmentDisplayLabel,
  type DirectoryLocale,
} from "../../../../../../lib/directoryDepartmentLabel";
import {
  collectCategoryCodes,
  categoriesFromDirectoryData,
} from "../../../../../../lib/directoryMetadata";
import {
  firstPersianAdCatForCatCode,
  resolveDirCategoryLabelPreferPersianCatField,
} from "../../../../../../lib/dirCategoryLabelResolve";
import {
  cityDocHasApprovedAds,
  getApprovedAdCityKeysCached,
} from "../../../../../../lib/citiesWithApprovedAds";
import { getMapsBrowserApiKey } from "../../../../../../lib/mapsBrowserKey";
import { reviewSummaryFromAdData } from "../../../../../../lib/adReviewSummary";
import {
  adListingPathFromAd,
  isCityActiveForPublicPages,
} from "../../../../../../lib/seoIndexable";
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
  dir_category_slug?: string;
  departmentID?: unknown;
  dir_id?: string;
  dir_department_slug?: string;
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

  const pick = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => {
    const active = docs.filter((d) =>
      isCityActiveForPublicPages(d.data() as Record<string, unknown>),
    );
    if (active.length === 0) return null;
    return (
      active.find((d) => {
        const data = d.data() as Record<string, unknown>;
        const ce = typeof data.country_eng === "string" ? data.country_eng.toLowerCase() : "";
        return ce === countryKey;
      }) ?? active[0] ?? null
    );
  };

  const byEng = await db.collection("cities").where("city_eng", "==", cityKey).limit(20).get();
  if (!byEng.empty) {
    const chosen = pick(byEng.docs);
    if (chosen) return chosen;
  }

  const byFa = await db.collection("cities").where("city_fa", "==", cityKey).limit(20).get();
  if (!byFa.empty) {
    const chosen = pick(byFa.docs);
    if (chosen) return chosen;
  }

  const legacy = await db.collection("cities").doc(cityKey).get();
  if (!legacy.exists) return null;
  const legacyData = legacy.data() as Record<string, unknown>;
  return isCityActiveForPublicPages(legacyData) ? legacy : null;
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

async function loadCategoryAds(cityEng: string, cityFa: string, catCode: string): Promise<AdDoc[]> {
  const db = getFirestoreAdmin();
  const rows = new Map<string, AdDoc>();
  const limit = 2000;

  const pushIfMatch = (d: FirebaseFirestore.QueryDocumentSnapshot) => {
    const data = d.data() as Record<string, unknown>;
    if (data.approved !== true) return;
    const slug =
      typeof data.dir_category_slug === "string" ? data.dir_category_slug.trim() : "";
    const cc = typeof data.cat_code === "string" ? data.cat_code.trim() : "";
    if (slug !== catCode && cc !== catCode) return;
    rows.set(d.id, { id: d.id, ...(data as AdDoc), cat_code: catCode });
  };

  try {
    if (cityEng) {
      const snap = await db.collection("ad").where("city_eng", "==", cityEng).limit(limit).get();
      snap.docs.forEach(pushIfMatch);
    }
    if (cityFa) {
      const snap = await db.collection("ad").where("city_fa", "==", cityFa).limit(limit).get();
      snap.docs.forEach(pushIfMatch);
    }
  } catch {
    /* ignore */
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

  const db = getFirestoreAdmin();
  const dirLocale: DirectoryLocale = locale === "en" ? "en" : "fa";
  const directorySnap = await db.collection("dir").get();
  const departmentMap = new Map<string, string>();
  const departmentImageMap = new Map<string, string>();
  const categoryMap = new Map<string, string>();
  const categoryToDepartmentMap = new Map<string, string>();
  directorySnap.docs.forEach((doc) => {
    const data = doc.data() as Record<string, unknown>;
    departmentMap.set(doc.id, directoryDepartmentDisplayLabel(data, doc.id, locale));
    if (typeof data.image === "string" && data.image.trim()) {
      departmentImageMap.set(doc.id, data.image.trim());
    }
    collectCategoryCodes(data.categories, categoryMap, dirLocale);
    for (const c of categoriesFromDirectoryData(data, dirLocale)) {
      if (!categoryMap.has(c.code)) {
        categoryMap.set(c.code, c.label);
      }
      if (!categoryToDepartmentMap.has(c.code)) {
        categoryToDepartmentMap.set(c.code, doc.id);
      }
    }
  });

  const ads = await loadCategoryAds(cityEng, cityFa, catCodeParam);
  const categoryLabel =
    resolveDirCategoryLabelPreferPersianCatField(
      catCodeParam,
      dirLocale,
      categoryMap,
      firstPersianAdCatForCatCode(ads, catCodeParam),
    ) ||
    ads.find((a) => typeof a.cat === "string" && a.cat.trim())?.cat?.trim() ||
    catCodeParam;
  const cityName = cityEng || cityFa || cityParam;
  const pageTitle = cityEng && countryFa ? `${countryFa} - ${cityEng}` : cityName;
  const pathWithinLocale = `/${countryParam}/${cityParam}/category/${catCodeParam}/`;
  const canonicalPath = withLocale(locale, pathWithinLocale);
  const canonicalUrl = `${getSiteBaseUrl()}${canonicalPath}`;
  const cityHubPath = withLocale(locale, `/${countryParam}/${cityParam}/`);

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
      const catCodeResolved =
        typeof ad.dir_category_slug === "string" && ad.dir_category_slug.trim()
          ? ad.dir_category_slug.trim()
          : typeof ad.cat_code === "string" && ad.cat_code.trim()
            ? ad.cat_code.trim()
            : null;
      const rawAdCat =
        typeof ad.cat === "string" && ad.cat.trim() ? ad.cat.trim() : null;
      const category =
        (catCodeResolved
          ? resolveDirCategoryLabelPreferPersianCatField(
              catCodeResolved,
              dirLocale,
              categoryMap,
              rawAdCat,
            )
          : null) ??
        rawAdCat ??
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
        image: firstAdImageUrl({ images: ad.images, image: ad.image }),
        link: adListingPathFromAd(ad),
        phone,
        location,
        departmentId:
          toDepartmentId(ad.departmentID) ||
          (typeof ad.dir_id === "string" && ad.dir_id.trim() ? ad.dir_id.trim() : null) ||
          (typeof ad.dir_department_slug === "string" && ad.dir_department_slug.trim()
            ? ad.dir_department_slug.trim()
            : null),
        catCode:
          typeof ad.dir_category_slug === "string" && ad.dir_category_slug.trim()
            ? ad.dir_category_slug.trim()
            : typeof ad.cat_code === "string" && ad.cat_code.trim()
              ? ad.cat_code.trim()
              : null,
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

  const adsForFilter = adsForClient.map((a) => {
    if (a.departmentId) return a;
    if (!a.catCode) return a;
    const inferredDept = categoryToDepartmentMap.get(a.catCode);
    return inferredDept ? { ...a, departmentId: inferredDept } : a;
  });
  const departmentOptions: SelectOption[] = Array.from(
    new Set(adsForFilter.map((a) => a.departmentId).filter(Boolean) as string[]),
  )
    .map((id) => ({ value: id, label: departmentMap.get(id) ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
  const categoryOptions: SelectOption[] = Array.from(
    new Set(adsForFilter.map((a) => a.catCode).filter(Boolean) as string[]),
  )
    .map((code) => ({
      value: code,
      label: resolveDirCategoryLabelPreferPersianCatField(
        code,
        dirLocale,
        categoryMap,
        firstPersianAdCatForCatCode(ads, code),
      ),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
  const departmentQuickFilters: DepartmentQuickItem[] = Array.from(
    new Set(adsForFilter.map((a) => a.departmentId).filter(Boolean) as string[]),
  )
    .map((id) => ({
      id,
      label: departmentMap.get(id) ?? id,
      imageUrl: departmentImageMap.get(id) ?? null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
  const adCityKeys = await getApprovedAdCityKeysCached();
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
    .filter((doc) => {
      const c = doc.data() as Record<string, unknown>;
      if (c.active !== true) return false;
      return cityDocHasApprovedAds(c, adCityKeys);
    })
    .map((doc) => {
      const c = doc.data() as Record<string, unknown>;
      const fa = sanitize(c.city_fa);
      const en = sanitize(c.city_eng);
      const cityPath = en || fa || doc.id;
      const label = fa && en ? `${fa} · ${en}` : fa || en || doc.id;
      return { id: cityPath, label };
    })
    .sort((a, b) => a.label.localeCompare(b.label, locale));

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Persiana", item: `${getSiteBaseUrl()}/${locale}` },
      { "@type": "ListItem", position: 2, name: cityName, item: `${getSiteBaseUrl()}${cityHubPath}` },
      { "@type": "ListItem", position: 3, name: categoryLabel, item: canonicalUrl },
    ],
  };
  const collectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${pageTitle} - Persiana`,
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
        ads={adsForFilter}
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
  if (!countryParam || !cityParam || !catCodeParam) return { title: "Persiana" };

  const pathWithinLocale = `/${countryParam}/${cityParam}/category/${catCodeParam}/`;
  return {
    title: `${catCodeParam} in ${cityParam} - Persiana`,
    description: `Browse ${catCodeParam} listings in ${cityParam} on Persiana.`,
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
