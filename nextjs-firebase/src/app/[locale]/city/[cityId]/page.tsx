import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { categoriesFromDirectoryData, collectCategoryCodes } from "../../../../lib/directoryMetadata";
import { getFirestoreAdmin } from "../../../../lib/firebaseAdmin";
import { hubPathForCityDoc, isCityActiveForPublicPages } from "../../../../lib/seoIndexable";
import { firstAdImageUrl, withLocale } from "@koochly/shared";
import { resolveLocale } from "../../../../i18n/server";
import {
  directoryDepartmentDisplayLabel,
  type DirectoryLocale,
} from "../../../../lib/directoryDepartmentLabel";
import {
  firstPersianAdCatForCatCode,
  resolveDirCategoryLabelPreferPersianCatField,
} from "../../../../lib/dirCategoryLabelResolve";
import {
  cityDocHasApprovedAds,
  getApprovedAdCityKeysCached,
} from "../../../../lib/citiesWithApprovedAds";
import { getMapsBrowserApiKey } from "../../../../lib/mapsBrowserKey";
import { reviewSummaryFromAdData } from "../../../../lib/adReviewSummary";
import { resolveCityFlagUrl } from "../../../../lib/cityFlagUrl";
import {
  AD_PROMOTION_TYPES,
  type AdPromotionType,
} from "../../../../lib/adPromotions";
import { adListingPathFromAd } from "../../../../lib/seoIndexable";
import CityAdsViewClient, {
  type CityJumpOption,
  type CityAdCard,
  type DepartmentQuickItem,
  type PopularCategoryLink,
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
  promotionBadges?: unknown;
  /** Alternate field name from some imports / scripts */
  promotion_badges?: unknown;
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
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown> & {
      toMillis?: () => number;
      toDate?: () => Date;
    };
    if (typeof v.toMillis === "function") {
      try {
        const ms = v.toMillis();
        if (typeof ms === "number" && Number.isFinite(ms)) return ms;
      } catch {
        /* ignore */
      }
    }
    if (typeof v.toDate === "function") {
      try {
        const d = v.toDate();
        const t = d instanceof Date ? d.getTime() : Date.parse(String(d));
        return Number.isFinite(t) ? t : null;
      } catch {
        /* ignore */
      }
    }
    const vx = v as {
      seconds?: number | string;
      _seconds?: number | string;
      nanoseconds?: number | string;
      _nanoseconds?: number | string;
    };
    const secRaw =
      typeof vx.seconds === "number" && Number.isFinite(vx.seconds)
        ? vx.seconds
        : typeof vx.seconds === "string"
          ? Number(vx.seconds)
          : typeof vx._seconds === "number" && Number.isFinite(vx._seconds)
            ? vx._seconds
            : typeof vx._seconds === "string"
              ? Number(vx._seconds)
              : NaN;
    const sec = Number.isFinite(secRaw) ? secRaw : null;
    if (sec !== null) {
      const nsRaw =
        typeof vx.nanoseconds === "number"
          ? vx.nanoseconds
          : typeof vx.nanoseconds === "string"
            ? Number(vx.nanoseconds)
            : typeof vx._nanoseconds === "number"
              ? vx._nanoseconds
              : typeof vx._nanoseconds === "string"
                ? Number(vx._nanoseconds)
                : 0;
      const ns = Number.isFinite(nsRaw) ? nsRaw : 0;
      return sec * 1000 + Math.floor(ns / 1e6);
    }
    if (typeof v.__time__ === "string") {
      const t = Date.parse(v.__time__);
      return Number.isFinite(t) ? t : null;
    }
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
    /* Missing expiry = treat as active (manual / legacy docs). */
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
        const snap = await db.collection("ad").doc(id).collection("promotions").get();
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
  // Skip `active === false` cities; if several rows match, prefer the first active one.
  let citySnap: any = null;

  const firstActiveCityDoc = (docs: QueryDocumentSnapshot[]) =>
    docs.find((d) => isCityActiveForPublicPages(d.data() as Record<string, unknown>)) ?? null;

  const byCityEng = await db
    .collection("cities")
    .where("city_eng", "==", cityKey)
    .limit(20)
    .get();
  const engPick = firstActiveCityDoc(byCityEng.docs);
  if (engPick) citySnap = engPick;

  if (!citySnap) {
    const byCityFa = await db
      .collection("cities")
      .where("city_fa", "==", cityKey)
      .limit(20)
      .get();
    const faPick = firstActiveCityDoc(byCityFa.docs);
    if (faPick) citySnap = faPick;
  }

  if (!citySnap) {
    const docSnap = await db.collection("cities").doc(cityKey).get();
    if (
      docSnap.exists &&
      isCityActiveForPublicPages(docSnap.data() as Record<string, unknown>)
    ) {
      citySnap = docSnap;
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
  const canonicalCityKey = sanitizeCityToken(cityEng || cityFa || citySnap.id || "");
  if (canonicalCityKey && cityKey !== canonicalCityKey) {
    redirect(withLocale(uiLocale, `/city/${encodeURIComponent(canonicalCityKey)}`));
  }
  const flagUrl = resolveCityFlagUrl({
    flagUrl: typeof cityData.flag_url === "string" ? cityData.flag_url : undefined,
    countryEng,
    countryFa,
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

  // One equality per query (automatic indexes); filter `approved` in memory.
  const mergedAdDocs = new Map<string, QueryDocumentSnapshot>();
  const cityAdFetchLimit = 2500;
  const pushApproved = (doc: QueryDocumentSnapshot) => {
    const data = doc.data() as Record<string, unknown>;
    if (data.approved !== true) return;
    mergedAdDocs.set(doc.id, doc);
  };
  if (cityEng) {
    const engSnap = await db
      .collection("ad")
      .where("city_eng", "==", cityEng)
      .limit(cityAdFetchLimit)
      .get();
    engSnap.docs.forEach(pushApproved);
  }
  if (cityFa) {
    const faSnap = await db
      .collection("ad")
      .where("city_fa", "==", cityFa)
      .limit(cityAdFetchLimit)
      .get();
    faSnap.docs.forEach(pushApproved);
  }
  const adsSnap = { docs: Array.from(mergedAdDocs.values()) };

  const ads: AdDoc[] = adsSnap.docs.map((d) => {
    const data = d.data() as AdDoc;
    /* Document id must win over any `id` field stored inside the ad payload. */
    return { ...data, id: d.id };
  });

  // Sort by `seq` if present, otherwise keep stable order.
  ads.sort((a, b) => {
    const ao = typeof a.seq === "number" ? a.seq : Number.MAX_SAFE_INTEGER;
    const bo = typeof b.seq === "number" ? b.seq : Number.MAX_SAFE_INTEGER;
    return ao - bo;
  });

  const dirLocale: DirectoryLocale = uiLocale === "en" ? "en" : "fa";
  const directorySnap = await db.collection("dir").get();
  const departmentMap = new Map<string, string>();
  const departmentImageMap = new Map<string, string>();
  const categoryMap = new Map<string, string>();
  const categoryToDepartmentMap = new Map<string, string>();

  directorySnap.docs.forEach((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const deptLabel = directoryDepartmentDisplayLabel(data, doc.id, uiLocale);
    departmentMap.set(doc.id, deptLabel);
    const deptImg = data.image;
    if (typeof deptImg === "string" && deptImg.trim()) {
      departmentImageMap.set(doc.id, deptImg.trim());
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

  // SEO + heading: always prefer city_eng.
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

    const departmentId =
      toDepartmentId(ad.departmentID) ||
      (typeof ad.dir_id === "string" && ad.dir_id.trim() ? ad.dir_id.trim() : null) ||
      (typeof ad.dir_department_slug === "string" && ad.dir_department_slug.trim()
        ? ad.dir_department_slug.trim()
        : null);
    const catCode =
      typeof ad.dir_category_slug === "string" && ad.dir_category_slug.trim()
        ? ad.dir_category_slug.trim()
        : typeof ad.cat_code === "string" && ad.cat_code.trim()
          ? ad.cat_code.trim()
          : null;

    const rawAdCat =
      typeof ad.cat === "string" && ad.cat.trim() ? ad.cat.trim() : null;
    const category =
      (catCode
        ? resolveDirCategoryLabelPreferPersianCatField(
            catCode,
            dirLocale,
            categoryMap,
            rawAdCat,
          )
        : null) ??
      rawAdCat ??
      (typeof ad.dept === "string" && ad.dept.trim() ? ad.dept.trim() : null);

    const description =
      typeof ad.details === "string" && ad.details.trim()
        ? ad.details.trim()
        : null;

    const image = firstAdImageUrl({ images: ad.images, image: ad.image });
    const link = adListingPathFromAd(ad);
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
      activePromotions:
        activePromotions.length > 0 ? activePromotions : undefined,
    };
  });

  const adsForFilter = adsForClient.map((a) => {
    if (a.departmentId) return a;
    if (!a.catCode) return a;
    const inferredDept = categoryToDepartmentMap.get(a.catCode);
    return inferredDept ? { ...a, departmentId: inferredDept } : a;
  });

  // Only include options that exist in the current city's ads.
  const departmentOptions: SelectOption[] = Array.from(
    new Set(adsForFilter.map((a) => a.departmentId).filter(Boolean) as string[]),
  )
    .map((id) => ({
      value: id,
      label: departmentMap.get(id) ?? id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, uiLocale));

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
    .sort((a, b) => a.label.localeCompare(b.label, uiLocale));

  const hubPath = hubPathForCityDoc(cityData);
  const popularCategories: PopularCategoryLink[] = categoryOptions.map(
    (cat): PopularCategoryLink => ({
      value: cat.value,
      label: cat.label,
      href: withLocale(
        uiLocale,
        hubPath
          ? `${hubPath}category/${encodeURIComponent(cat.value)}/`
          : `/city/${encodeURIComponent(canonicalCityKey)}?cat=${encodeURIComponent(cat.value)}`,
      ),
    }),
  );

  const departmentQuickFilters: DepartmentQuickItem[] = Array.from(
    new Set(adsForFilter.map((a) => a.departmentId).filter(Boolean) as string[]),
  )
    .map((id) => ({
      id,
      label: departmentMap.get(id) ?? id,
      imageUrl: departmentImageMap.get(id) ?? null,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, uiLocale));

  const adCityKeys = await getApprovedAdCityKeysCached();
  const citiesSnap = await db.collection("cities").limit(300).get();
  const cityOptions: CityJumpOption[] = citiesSnap.docs
    .filter((doc) => {
      const c = doc.data() as Record<string, unknown>;
      if (c.active !== true) return false;
      return cityDocHasApprovedAds(c, adCityKeys);
    })
    .map((doc) => {
      const c = doc.data() as Record<string, unknown>;
      const fa = sanitizeCityToken(c.city_fa);
      const en = sanitizeCityToken(c.city_eng);
      const cityPath = en || fa || doc.id;
      const label = fa && en ? `${fa} · ${en}` : fa || en || doc.id;
      return { id: cityPath, label };
    })
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
        cityCurrencySymbol={cityCurrencySymbol}
        ads={adsForFilter}
        cityCenter={cityCenter}
        departmentOptions={departmentOptions}
        categoryOptions={categoryOptions}
        departmentQuickFilters={departmentQuickFilters}
        cityOptions={cityOptions}
        popularCategories={popularCategories}
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
  if (!cityKey) return { title: "Persiana" };

  const db = getFirestoreAdmin();
  let citySnap: any = null;

  const firstActiveCityDoc = (docs: QueryDocumentSnapshot[]) =>
    docs.find((d) => isCityActiveForPublicPages(d.data() as Record<string, unknown>)) ?? null;

  const byCityEng = await db
    .collection("cities")
    .where("city_eng", "==", cityKey)
    .limit(20)
    .get();
  const engPick = firstActiveCityDoc(byCityEng.docs);
  if (engPick) citySnap = engPick;

  if (!citySnap) {
    const byCityFa = await db
      .collection("cities")
      .where("city_fa", "==", cityKey)
      .limit(20)
      .get();
    const faPick = firstActiveCityDoc(byCityFa.docs);
    if (faPick) citySnap = faPick;
  }

  if (!citySnap) {
    const docSnap = await db.collection("cities").doc(cityKey).get();
    if (
      docSnap.exists &&
      isCityActiveForPublicPages(docSnap.data() as Record<string, unknown>)
    ) {
      citySnap = docSnap;
    }
  }

  if (!citySnap) return { title: "Persiana" };

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
      ? `${seoCity} - Persiana Ads (${countryFa})`
      : `${seoCity} - Persiana Ads`,
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
      title: countryFa ? `${seoCity} Ads - Persiana` : `${seoCity} Ads - Persiana`,
    },
  };
}

