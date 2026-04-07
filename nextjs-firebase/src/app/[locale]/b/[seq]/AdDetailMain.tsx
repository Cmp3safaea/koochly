import type { Firestore } from "firebase-admin/firestore";
import Link from "next/link";
import { headers } from "next/headers";
import { getFirestoreAdmin } from "../../../../lib/firebaseAdmin";
import {
  isGoogleImportPlaceholderDescription,
  reviewSummaryFromAdData,
} from "../../../../lib/adReviewSummary";
import { normalizeOpeningHours } from "../../../../lib/openingHoursDisplay";
import { getMapsBrowserApiKey } from "../../../../lib/mapsBrowserKey";
import { isAdDocIndexable } from "../../../../lib/seoIndexable";
import { telHref, withLocale } from "@koochly/shared";
import { getTranslator, resolveLocale } from "../../../../i18n/server";
import BackToCityButton from "./BackToCityButton";
import AdDetailGoogleMap from "./AdDetailGoogleMap";
import ClaimBusinessPanel from "./ClaimBusinessPanel";
import AdReviewsSection from "./AdReviewsSection";
import AdDetailReviewSummary from "./AdDetailReviewSummary";
import OpeningHoursPanel from "./OpeningHoursPanel";
import GalleryStripLightbox from "./GalleryStripLightbox";
import ActivityLogClient from "../../activity/ActivityLogClient";
import styles from "./AdDetailsPage.module.css";

type AdDoc = {
  title?: string;
  engName?: string;
  details?: string;
  dept?: string;
  cat?: string;
  cat_code?: string;
  dir_category_slug?: string;
  departmentID?: unknown;
  dir_department_slug?: string;
  country_eng?: string;
  address?: string;
  phone?: string;
  website?: string;
  instorgam?: string;
  instagram?: string;
  url?: string;
  images?: string[];
  image?: string;
  city?: string;
  city_eng?: string;
  location?: {
    __lat__?: number;
    __lon__?: number;
    lat?: number;
    lon?: number;
    lng?: number;
    latitude?: number;
    longitude?: number;
  } | unknown;
  qr_code?: string;
  seq?: number | string;
  approved?: boolean;
  subcat?: unknown;
  selectedCategoryTags?: unknown;
  opening_hours?: unknown;
  openingHours?: unknown;
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeExternalUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "#";
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

function websiteLinkLabel(raw: string, t: (k: string) => string): string {
  try {
    const u = new URL(normalizeExternalUrl(raw));
    const host = u.hostname.replace(/^www\./i, "");
    return host || t("adDetail.websiteFallback");
  } catch {
    return t("adDetail.websiteView");
  }
}

function parseInstagram(
  ad: AdDoc,
  tr: (k: string, vars?: Record<string, string | number>) => string,
): { href: string; label: string } | null {
  const raw =
    (typeof ad.instagram === "string" && ad.instagram) ||
    (typeof ad.instorgam === "string" && ad.instorgam) ||
    "";
  const text = raw.trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (
    lower === "n/a" ||
    lower === "na" ||
    lower === "none" ||
    lower === "-" ||
    lower === "null" ||
    lower === "undefined"
  ) {
    return null;
  }

  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text);
      const segs = u.pathname.split("/").filter(Boolean);
      const user = segs[0] === "p" || segs[0] === "reel" ? null : segs[0];
      const label = user ? `@${user}` : tr("adDetail.instagram");
      return { href: u.toString(), label };
    } catch {
      return { href: text, label: tr("adDetail.instagram") };
    }
  }

  const handle = text.replace(/^@+/, "").replace(/\/+$/, "").split("/").filter(Boolean)[0];
  if (!handle) return null;
  return {
    href: `https://www.instagram.com/${encodeURIComponent(handle)}/`,
    label: `@${handle}`,
  };
}

function toDepartmentId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const parts = value.split("/");
    return parts[parts.length - 1] || null;
  }
  if (typeof value === "object") {
    const v = value as { id?: string; path?: string; __ref__?: string };
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

async function resolveCityAdsPath(
  db: Firestore,
  cityEng: string | null | undefined,
  countryEngHint?: string | null,
): Promise<{ country: string; city: string } | null> {
  const ce = typeof cityEng === "string" ? cityEng.trim() : "";
  if (!ce) return null;

  const pickPath = (docs: { data: () => Record<string, unknown> }[]) => {
    if (docs.length === 0) return null;
    const hint = countryEngHint?.trim().toLowerCase();
    let doc = docs[0];
    if (hint) {
      const hit = docs.find((d) => {
        const x = d.data().country_eng;
        return typeof x === "string" && x.toLowerCase() === hint;
      });
      if (hit) doc = hit;
    }
    const data = doc.data();
    const country = data.country_eng;
    const cityOut = data.city_eng;
    if (typeof country !== "string" || !country.trim()) return null;
    return {
      country: country.trim(),
      city: typeof cityOut === "string" && cityOut.trim() ? cityOut.trim() : ce,
    };
  };

  let snap = await db.collection("cities").where("city_eng", "==", ce).limit(20).get();
  if (snap.empty) {
    snap = await db.collection("cities").where("city_eng", "==", ce.toLowerCase()).limit(20).get();
  }
  if (snap.empty) return null;
  return pickPath(snap.docs);
}

function getImages(ad: AdDoc): string[] {
  const imgs = Array.isArray(ad.images)
    ? ad.images.filter((x): x is string => typeof x === "string" && !!x)
    : [];
  if (imgs.length > 0) return imgs;
  if (typeof ad.image === "string" && ad.image) return [ad.image];
  return [];
}

export type AdDetailMainProps = {
  ad: AdDoc & { id: string };
  localeRaw: string;
  pathForLogAndQr: string;
  seqForLabel?: number | null;
};

export default async function AdDetailMain({
  ad,
  localeRaw,
  pathForLogAndQr,
  seqForLabel = null,
}: AdDetailMainProps) {
  const locale = resolveLocale(localeRaw);
  const t = getTranslator(localeRaw);
  const googleMapsApiKey = getMapsBrowserApiKey();

  const title =
    (typeof ad.title === "string" && ad.title.trim()) ||
    (typeof ad.engName === "string" && ad.engName.trim()) ||
    (seqForLabel !== null && Number.isFinite(seqForLabel)
      ? `Ad #${seqForLabel}`
      : `Ad ${ad.id.slice(0, 8)}`);

  const images = getImages(ad);
  const heroImage = images[0] ?? null;
  const rawLoc = ad.location as {
    __lat__?: number;
    __lon__?: number;
    lat?: number;
    lon?: number;
    lng?: number;
    latitude?: number;
    longitude?: number;
  };
  const lat = toFiniteNumber(rawLoc?.__lat__ ?? rawLoc?.lat ?? rawLoc?.latitude);
  const lon = toFiniteNumber(rawLoc?.__lon__ ?? rawLoc?.lon ?? rawLoc?.longitude ?? rawLoc?.lng);

  const db = getFirestoreAdmin();
  const cityPath =
    typeof ad.city_eng === "string" && ad.city_eng.trim()
      ? await resolveCityAdsPath(db, ad.city_eng, ad.country_eng)
      : null;
  const deptId =
    toDepartmentId(ad.departmentID) ||
    (typeof ad.dir_department_slug === "string" && ad.dir_department_slug.trim()
      ? ad.dir_department_slug.trim()
      : null);
  const catCode =
    typeof ad.dir_category_slug === "string" && ad.dir_category_slug.trim()
      ? ad.dir_category_slug.trim()
      : typeof ad.cat_code === "string" && ad.cat_code.trim()
        ? ad.cat_code.trim()
        : null;
  let sameCategoryHref: string | null = null;
  if (cityPath && catCode) {
    const qs = new URLSearchParams();
    qs.set("cat", catCode);
    if (deptId) qs.set("dept", deptId);
    sameCategoryHref = withLocale(
      locale,
      `/${encodeURIComponent(cityPath.country)}/${encodeURIComponent(cityPath.city)}/?${qs.toString()}`,
    );
  }

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const pageUrl = `${proto}://${host}${withLocale(locale, pathForLogAndQr)}`;
  const qrSrc =
    typeof ad.qr_code === "string" && ad.qr_code.trim()
      ? `data:image/png;base64,${ad.qr_code.trim()}`
      : `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(pageUrl)}`;

  const initialReviewSummary = reviewSummaryFromAdData(ad as Record<string, unknown>);

  const instagram = parseInstagram(ad, t);
  const openingHourLines = normalizeOpeningHours(ad.opening_hours ?? ad.openingHours);
  const subcats = normalizeSubcats(ad.subcat).length
    ? normalizeSubcats(ad.subcat)
    : normalizeSubcats(ad.selectedCategoryTags);
  const indexable = isAdDocIndexable(ad as Record<string, unknown>);
  const localBusinessJsonLd = indexable
    ? {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        name: title,
        description:
          typeof ad.details === "string" && !isGoogleImportPlaceholderDescription(ad.details)
            ? ad.details.slice(0, 320)
            : undefined,
        url: pageUrl,
        image: images.slice(0, 6),
        telephone: typeof ad.phone === "string" ? ad.phone : undefined,
        address:
          typeof ad.address === "string" && ad.address.trim()
            ? { "@type": "PostalAddress", streetAddress: ad.address.trim() }
            : undefined,
        geo:
          lat !== null && lon !== null
            ? { "@type": "GeoCoordinates", latitude: lat, longitude: lon }
            : undefined,
      }
    : null;

  return (
    <main className={styles.page}>
      {localBusinessJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }}
        />
      ) : null}
      <div className={styles.inner}>
        <div className={styles.topNav}>
          <BackToCityButton className={styles.backBtn} label={t("adDetail.back")} />
        </div>

        <section className={styles.sheet}>
          <ActivityLogClient
            page="ad_detail"
            pathname={withLocale(locale, pathForLogAndQr)}
            city={ad.city_eng || ad.city || ""}
            adId={ad.id}
            departmentIds={deptId ? [deptId] : []}
            categoryCodes={catCode ? [catCode] : []}
          />
          <h1 className={styles.title}>{title}</h1>
          <AdDetailReviewSummary avg={initialReviewSummary.avg} count={initialReviewSummary.count} />

          <div className={styles.chips}>
            {ad.dept ? (
              <span className={`${styles.chip} ${styles.chipDept}`}>{ad.dept}</span>
            ) : null}
            {ad.cat ? (
              <span className={`${styles.chip} ${styles.chipCat}`}>{ad.cat}</span>
            ) : null}
            {ad.city_eng || ad.city ? (
              <span className={`${styles.chip} ${styles.chipCity}`}>{ad.city_eng || ad.city}</span>
            ) : null}
            {subcats.map((tag) => (
              <span key={tag} className={`${styles.chip} ${styles.chipSubcat}`}>
                {tag}
              </span>
            ))}
            {sameCategoryHref ? (
              <Link
                href={sameCategoryHref}
                className={styles.sameCategoryBtn}
                title={
                  ad.cat
                    ? t("adDetail.sameCategoryTitleCat", { cat: ad.cat })
                    : t("adDetail.sameCategoryTitle")
                }
                aria-label={
                  ad.cat
                    ? t("adDetail.sameCategoryAriaCat", { cat: ad.cat })
                    : t("adDetail.sameCategoryAria")
                }
              >
                <svg
                  className={styles.sameCategoryIcon}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <rect x="3.5" y="4.5" width="12" height="14.5" rx="2.25" />
                  <rect x="8.5" y="8.5" width="12" height="14.5" rx="2.25" />
                </svg>
                <span className={styles.sameCategoryLabel}>{t("adDetail.sameCategory")}</span>
              </Link>
            ) : null}
          </div>

          <GalleryStripLightbox images={images} title={title} />

          {ad.details && !isGoogleImportPlaceholderDescription(ad.details) ? (
            <p className={styles.details}>{ad.details}</p>
          ) : null}

          <div className={styles.contactGrid}>
            {ad.address ? (
              <div className={styles.contactCard}>
                <span className={styles.iconWrap} aria-hidden>
                  {"\u{1F4CD}"}
                </span>
                <div className={styles.contactBody}>
                  <div className={styles.contactLabel}>{t("adDetail.address")}</div>
                  <div className={styles.contactText}>{ad.address.trim()}</div>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ad.address.trim())}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.mapLink}
                  >
                    {t("adDetail.openMap")}
                  </a>
                </div>
              </div>
            ) : null}

            {ad.phone ? (
              <div className={styles.contactCard}>
                <span className={styles.iconWrap} aria-hidden>
                  {"\u260E"}
                </span>
                <div className={styles.contactBody}>
                  <div className={styles.contactLabel}>{t("adDetail.phone")}</div>
                  <a href={telHref(ad.phone)} dir="ltr" className={styles.phoneLink}>
                    {ad.phone.trim()}
                  </a>
                </div>
              </div>
            ) : null}

            {ad.website ? (
              <div className={styles.contactCard}>
                <span className={styles.iconWrap} aria-hidden>
                  {"\u{1F310}"}
                </span>
                <div className={styles.contactBody}>
                  <div className={styles.contactLabel}>{t("adDetail.website")}</div>
                  <a
                    href={normalizeExternalUrl(ad.website)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.websiteLink}
                  >
                    {websiteLinkLabel(ad.website, t)}
                    <span aria-hidden>{"\u2197"}</span>
                  </a>
                </div>
              </div>
            ) : null}

            {instagram ? (
              <div className={styles.contactCard}>
                <span className={`${styles.iconWrap} ${styles.iconWrapInstagram}`} aria-hidden>
                  <svg
                    className={styles.instagramGlyph}
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden
                  >
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
                  </svg>
                </span>
                <div className={styles.contactBody}>
                  <div className={styles.contactLabel}>{t("adDetail.instagram")}</div>
                  <a
                    href={instagram.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.instagramLink}
                  >
                    <span dir="ltr">{instagram.label}</span>
                    <span aria-hidden>{"\u2197"}</span>
                  </a>
                </div>
              </div>
            ) : null}
          </div>

          <div
            className={
              openingHourLines.length > 0 ? styles.mapQrGrid : styles.mapQrGridMapOnly
            }
          >
            <div className={styles.mapPanel}>
              <div className={styles.mapPanelHead}>{t("adDetail.mapHead")}</div>
              {lat !== null && lon !== null ? (
                <AdDetailGoogleMap
                  adId={ad.id}
                  title={title}
                  category={typeof ad.cat === "string" && ad.cat.trim() ? ad.cat.trim() : null}
                  lat={lat}
                  lon={lon}
                  heroImage={heroImage}
                  googleMapsApiKey={googleMapsApiKey}
                />
              ) : (
                <div className={styles.mapEmpty}>{t("adDetail.noCoords")}</div>
              )}
            </div>

            {openingHourLines.length > 0 ? (
              <div className={styles.hoursSideSlot}>
                <OpeningHoursPanel
                  compact
                  lines={openingHourLines}
                  title={t("adDetail.openingHours")}
                  todayLabel={t("adDetail.openingHoursToday")}
                />
              </div>
            ) : null}
          </div>

          <ClaimBusinessPanel adId={ad.id} />
          <AdReviewsSection adId={ad.id} initialSummary={initialReviewSummary} />

          <div className={styles.qrFooter}>
            <div className={styles.qrFooterTitle}>{t("adDetail.qrTitle")}</div>
            <img src={qrSrc} alt="QR code" className={styles.qrFooterImg} loading="lazy" />
            <div className={styles.qrFooterUrl}>{pageUrl}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
