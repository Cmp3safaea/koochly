"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./CityAdsViewClient.module.css";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { recordAdVisit } from "../../../../lib/recordAdVisit";
import { telHref, type Locale } from "@koochly/shared";
import { getAuthClientOrNull, getGoogleProvider } from "../../../../lib/firebaseClient";
import { useI18n, useLocalizedHref } from "../../../../i18n/client";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import ActivityLogClient from "../../activity/ActivityLogClient";
import StarRating from "../../../../components/StarRating";
import type { AdPromotionType } from "../../../../lib/adPromotions";

// Google Maps is client-only and loads external scripts, so we disable SSR.
const GoogleMapView = dynamic(() => import("./GoogleMap"), { ssr: false });

export type CityAdCard = {
  id: string;
  title: string;
  /** English / Latin business name when distinct from `title` (shown under main heading). */
  engName?: string | null;
  category?: string | null;
  description?: string | null;
  image?: string | null;
  link?: string | null;
  phone?: string | null;
  location?: { lat: number; lon: number } | null;
  departmentId?: string | null;
  catCode?: string | null;
  subcats?: string[];
  createdAtMs?: number | null;
  approved?: boolean;
  paidAds?: boolean;
  paidAdsExpiresAtMs?: number | null;
  visits?: number;
  /** From `ads.reviewRatingSum` / `reviewCount` (see ad reviews API). */
  reviewAvg?: number | null;
  reviewCount?: number;
  /** Set for goods listings with a numeric price; null/omitted for services or unset. */
  price?: number | null;
  isFree?: boolean;
  isNewItem?: boolean;
  exchangeable?: boolean;
  negotiable?: boolean;
  mainCategory?: string | null;
  currencySymbol?: string | null;
  /** Non-expired listing promos from `promotionBadges` (see `ads/{id}/promotions`). */
  activePromotions?: AdPromotionType[];
};

export type DepartmentQuickItem = {
  id: string;
  label: string;
  imageUrl: string | null;
};

export type CityJumpOption = {
  id: string;
  label: string;
};
export type PopularCategoryLink = {
  value: string;
  label: string;
  href: string;
};

type SelectOption = {
  value: string;
  label: string;
};

const PROMO_LABEL_KEY: Record<AdPromotionType, string> = {
  featured: "city.promoteFeaturedTitle",
  spotlight: "city.promoteSpotlightTitle",
  bump: "city.promoteBumpTitle",
  urgent: "city.promoteUrgentTitle",
};

const PROMO_PILL_CLASS: Record<AdPromotionType, string> = {
  featured: styles.cardPromoPill_featured,
  spotlight: styles.cardPromoPill_spotlight,
  bump: styles.cardPromoPill_bump,
  urgent: styles.cardPromoPill_urgent,
};

const PROMO_SORT_WEIGHT: Record<AdPromotionType, number> = {
  featured: 40,
  spotlight: 30,
  urgent: 20,
  bump: 10,
};

function getAdPromotionScore(ad: CityAdCard): number {
  const promos = Array.isArray(ad.activePromotions) ? ad.activePromotions : [];
  let score = 0;
  for (const p of promos) {
    const w = PROMO_SORT_WEIGHT[p] ?? 0;
    if (w > score) score = w;
  }
  return score;
}

function getAdPromotionExpiryMs(ad: CityAdCard, nowMs: number): number | null {
  const ms = ad.paidAdsExpiresAtMs;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= nowMs) return null;
  return ms;
}

function getTopPromotionType(types: AdPromotionType[] | undefined): AdPromotionType | null {
  if (!Array.isArray(types) || types.length === 0) return null;
  let top: AdPromotionType | null = null;
  let topWeight = -1;
  for (const t of types) {
    const w = PROMO_SORT_WEIGHT[t] ?? 0;
    if (w > topWeight) {
      top = t;
      topWeight = w;
    }
  }
  return top;
}

function getVisiblePromotionTypes(ad: CityAdCard): AdPromotionType[] {
  return Array.isArray(ad.activePromotions) ? ad.activePromotions : [];
}

function CardPromoTypeIcon({ type }: { type: AdPromotionType }) {
  const cls = styles.cardPromoIconSvg;
  switch (type) {
    case "featured":
      return (
        <svg className={cls} viewBox="0 0 20 20" aria-hidden focusable="false">
          <path
            fill="currentColor"
            d="M10 2.2l2.45 4.96 5.48.8-3.97 3.87.94 5.46L10 14.77l-4.9 2.57.94-5.46-3.97-3.87 5.48-.8L10 2.2z"
          />
        </svg>
      );
    case "spotlight":
      return (
        <svg className={cls} viewBox="0 0 20 20" aria-hidden focusable="false">
          <circle cx="10" cy="10" r="3.25" fill="currentColor" />
          <circle cx="10" cy="3.25" r="1.15" fill="currentColor" opacity="0.85" />
          <circle cx="10" cy="16.75" r="1.15" fill="currentColor" opacity="0.85" />
          <circle cx="3.25" cy="10" r="1.15" fill="currentColor" opacity="0.85" />
          <circle cx="16.75" cy="10" r="1.15" fill="currentColor" opacity="0.85" />
        </svg>
      );
    case "bump":
      return (
        <svg className={cls} viewBox="0 0 20 20" aria-hidden focusable="false">
          <path
            fill="currentColor"
            d="M10 4.5L15.2 12h-3.1v3.5H7.9V12H4.8L10 4.5z"
          />
        </svg>
      );
    case "urgent":
    default:
      return (
        <svg className={cls} viewBox="0 0 20 20" aria-hidden focusable="false">
          <path
            fill="currentColor"
            d="M10 2a8 8 0 100 16 8 8 0 000-16zm-.75 4.2h1.5v5.4h-1.5V6.2zm.75 8.1a1.05 1.05 0 110-2.1 1.05 1.05 0 010 2.1z"
          />
        </svg>
      );
  }
}

function parseListingFilterPrice(s: string): number | null {
  const t = s.trim().replace(/[,\s\u066C]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Matches `/api/ads/priority` rows (up to 35 from the `ads` collection). */
type PriorityApiAd = {
  id: string;
  seq: number;
  title: string;
  category: string;
  isPriority: boolean;
  image: string | null;
};

type PriorityStripSlide = PriorityApiAd & {
  link: string;
  displayImage: string | null;
};

function parsePriorityApiAds(json: unknown): PriorityApiAd[] {
  if (!json || typeof json !== "object") return [];
  const ads = (json as Record<string, unknown>).ads;
  if (!Array.isArray(ads)) return [];
  const out: PriorityApiAd[] = [];
  for (const row of ads) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : null;
    if (!id) continue;
    const seqRaw = o.seq;
    const seq =
      typeof seqRaw === "number" && Number.isFinite(seqRaw)
        ? seqRaw
        : typeof seqRaw === "string"
          ? Number(seqRaw)
          : Number.MAX_SAFE_INTEGER;
    out.push({
      id,
      seq: Number.isFinite(seq) ? seq : Number.MAX_SAFE_INTEGER,
      title: typeof o.title === "string" ? o.title : "",
      category: typeof o.category === "string" ? o.category : "",
      isPriority: o.isPriority === true,
      image: typeof o.image === "string" && o.image.trim() ? o.image.trim() : null,
    });
  }
  return out;
}

/** Same cap as `src/app/api/ads/priority/route.ts` */
const PRIORITY_STRIP_LIMIT = 35;
const PRIORITY_STRIP_AUTO_MS = 4800;

function scrollPriorityStrip(el: HTMLDivElement, direction: "next" | "prev") {
  const { scrollLeft, clientWidth, scrollWidth } = el;
  const delta = Math.max(160, clientWidth * 0.72);
  if (direction === "next") {
    if (scrollLeft + clientWidth >= scrollWidth - 4) {
      el.scrollTo({ left: 0, behavior: "smooth" });
    } else {
      el.scrollTo({ left: scrollLeft + delta, behavior: "smooth" });
    }
  } else if (scrollLeft <= 4) {
    el.scrollTo({ left: Math.max(0, scrollWidth - clientWidth), behavior: "smooth" });
  } else {
    el.scrollTo({ left: Math.max(0, scrollLeft - delta), behavior: "smooth" });
  }
}

function PriorityStripChevron({
  className,
  direction,
}: {
  className?: string;
  direction: "left" | "right";
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {direction === "left" ? (
        <path d="M15 18 9 12l6-6" />
      ) : (
        <path d="m9 18 6-6-6-6" />
      )}
    </svg>
  );
}

const MAX_MULTI_SELECTION = 2;
/** Client-side list pages; last page shows a promotion callout below the grid. */
const ADS_LIST_PAGE_SIZE = 20;
/** Long-press duration on a card (ms) to open the ad page instead of focusing on the map. */
const CARD_LONG_PRESS_MS = 550;

const VISIT_BUMPS_STORAGE_KEY = "koochly_ad_visit_bumps_v1";

function readStoredVisitBumps(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(VISIT_BUMPS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        out[k] = Math.floor(v);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeStoredVisitBumps(next: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    const cleaned: Record<string, number> = {};
    for (const [k, v] of Object.entries(next)) {
      if (v > 0) cleaned[k] = v;
    }
    if (Object.keys(cleaned).length === 0) {
      sessionStorage.removeItem(VISIT_BUMPS_STORAGE_KEY);
    } else {
      sessionStorage.setItem(VISIT_BUMPS_STORAGE_KEY, JSON.stringify(cleaned));
    }
  } catch {
    /* ignore quota / private mode */
  }
}

const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"] as const;

function toPersianDigits(n: number): string {
  return String(Math.max(0, Math.floor(n))).replace(
    /\d/g,
    (d) => FA_DIGITS[Number(d)] ?? d,
  );
}

type Tr = (key: string, vars?: Record<string, string | number>) => string;

/** Relative "posted …" label; `null` if no date. */
function formatAddedAgo(
  createdAtMs: number | null | undefined,
  locale: Locale,
  tr: Tr,
): string | null {
  if (createdAtMs == null || !Number.isFinite(createdAtMs)) return null;
  const diff = Math.max(0, Date.now() - createdAtMs);
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  const week = Math.floor(day / 7);
  const month = Math.floor(day / 30);
  const year = Math.floor(day / 365);
  const fmt = (n: number) =>
    locale === "fa" ? toPersianDigits(n) : String(Math.max(0, Math.floor(n)));
  let tail: string;
  if (sec < 45) tail = tr("city.timeJustNow");
  else if (min < 60) tail = tr("city.timeMinutes", { n: fmt(min) });
  else if (hr < 24) tail = tr("city.timeHours", { n: fmt(hr) });
  else if (day < 7) tail = tr("city.timeDays", { n: fmt(day) });
  else if (day < 30) tail = tr("city.timeWeeks", { n: fmt(week) });
  else if (day < 365) tail = tr("city.timeMonths", { n: fmt(month) });
  else tail = tr("city.timeYears", { n: fmt(year) });
  return tr("city.posted", { when: tail });
}

/** Distinct from logout: user / account — used when signed out (promote sign-in). */
function MapSignInIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="9" r="3.5" />
      <path d="M5 20v-1a7 7 0 0 1 14 0v1" />
    </svg>
  );
}

function MapLogoutIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function MobileToggleListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <circle cx="5" cy="6" r="1.5" fill="currentColor" />
      <circle cx="5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="5" cy="18" r="1.5" fill="currentColor" />
      <line
        x1="9"
        y1="6"
        x2="20"
        y2="6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="9"
        y1="12"
        x2="20"
        y2="12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="9"
        y1="18"
        x2="20"
        y2="18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MobileToggleMapIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 21c-3.8-3.2-7-6.7-7-10.2A7 7 0 0 1 19 10.8C19 14.3 15.8 17.8 12 21Z" />
      <circle cx="12" cy="10.5" r="2.5" />
    </svg>
  );
}

function FilterIconSearch({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function AiSearchGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
    </svg>
  );
}

function FilterIconDept({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2 2 7l10 5 10-5-10-5Z" />
      <path d="m2 17 10 5 10-5" />
      <path d="m2 12 10 5 10-5" />
    </svg>
  );
}

function FilterIconCategory({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11z" />
    </svg>
  );
}

function FilterIconPanel({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
    </svg>
  );
}

function ListingApplyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function CardOpenIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 6.5 15 12l-6 5.5" />
    </svg>
  );
}

function CardHeartIcon({ className, filled }: { className?: string; filled: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

/** Calendar + arrow: desc = newest first (arrow down), asc = oldest first (arrow up). */
function CardRevealEyeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CardMetaViewsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}

function CardMetaTimeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="8.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 7.6v4.8l3.1 1.9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function AiSparkleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3.8 13.9 8l4.3 1.6-4.3 1.6L12 15.4l-1.9-4.2L5.8 9.6 10.1 8 12 3.8Z"
        fill="currentColor"
      />
      <path
        d="M18.7 13.2l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9.9-2Z"
        fill="currentColor"
        opacity=".9"
      />
      <path
        d="M5.5 14.3l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8.8-1.7Z"
        fill="currentColor"
        opacity=".85"
      />
    </svg>
  );
}

function SortByDateIcon({
  direction,
  className,
}: {
  direction: "asc" | "desc";
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <g
        className={styles.sortDateCal}
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2.5" y="5" width="10.5" height="10.5" rx="1.65" />
        <path d="M2.5 9.25h10.5" />
        <path d="M5.75 5V3.25M9.75 5V3.25" />
      </g>
      <g
        className={styles.sortDateArrow}
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {direction === "desc" ? (
          <path d="M16.5 6.75v9.25M13.25 14.5 16.5 17.75 19.75 14.5" />
        ) : (
          <path d="M16.5 17.25V8M13.25 9.5 16.5 6.25 19.75 9.5" />
        )}
      </g>
    </svg>
  );
}

/** Bar chart + arrow: desc = most visits first, asc = fewest first. */
function SortByVisitsIcon({
  direction,
  className,
}: {
  direction: "asc" | "desc";
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <g
        className={styles.sortDateCal}
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3.5 18.5V11" />
        <path d="M8.25 18.5V6.5" />
        <path d="M13 18.5v-7" />
      </g>
      <g
        className={styles.sortDateArrow}
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {direction === "desc" ? (
          <path d="M19.5 6.75v9.25M16.25 14.5 19.5 17.75 22.75 14.5" />
        ) : (
          <path d="M19.5 17.25V8M16.25 9.5 19.5 6.25 22.75 9.5" />
        )}
      </g>
    </svg>
  );
}

function initialDeptList(id: string | null | undefined): string[] {
  return typeof id === "string" && id.trim() ? [id.trim()] : [];
}

function initialCatList(code: string | null | undefined): string[] {
  return typeof code === "string" && code.trim() ? [code.trim()] : [];
}

export default function CityAdsViewClient({
  cityTitle,
  cityFa = "",
  countryFa = "",
  countryEng = "",
  flagUrl,
  cityCurrencySymbol = "",
  ads,
  cityCenter,
  departmentOptions,
  categoryOptions,
  departmentQuickFilters,
  cityOptions,
  popularCategories,
  relatedCategoryLabel = null,
  allCityAdsHref = null,
  currentCityId = null,
  initialDepartmentId = null,
  initialCatCode = null,
  googleMapsApiKey = "",
}: {
  cityTitle: string;
  /** Persian city name from Firestore (`city_fa`) for copy; falls back to `cityTitle` if empty. */
  cityFa?: string;
  /** Country display names from Firestore for intro copy (`country_fa` / `country_eng`). */
  countryFa?: string;
  countryEng?: string;
  flagUrl?: string;
  cityCurrencySymbol?: string;
  ads: CityAdCard[];
  cityCenter?: { lat: number; lon: number } | null;
  departmentOptions?: SelectOption[];
  categoryOptions?: SelectOption[];
  departmentQuickFilters?: DepartmentQuickItem[];
  cityOptions?: CityJumpOption[];
  popularCategories?: PopularCategoryLink[];
  relatedCategoryLabel?: string | null;
  allCityAdsHref?: string | null;
  currentCityId?: string | null;
  initialDepartmentId?: string | null;
  initialCatCode?: string | null;
  googleMapsApiKey?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { t, locale } = useI18n();
  const loc = useLocalizedHref();
  const [mobileMode, setMobileMode] = useState<"list" | "map">("list");
  const [selectedAdId, setSelectedAdId] = useState<string | null>(null);
  /** Wide layout (≥901px): moving the mouse over a list card tints the map pin. */
  const [allowListMapHover, setAllowListMapHover] = useState(false);
  /** Matches city layout breakpoint: list hidden in map mode below this width. */
  const [layoutNarrow, setLayoutNarrow] = useState(false);
  const [hoveredListAdId, setHoveredListAdId] = useState<string | null>(null);
  const [cityJumpId, setCityJumpId] = useState<string>(currentCityId ?? "");
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<string[]>(() =>
    initialDeptList(initialDepartmentId),
  );
  const [selectedCatCodes, setSelectedCatCodes] = useState<string[]>(() =>
    initialCatList(initialCatCode),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [listSortKey, setListSortKey] = useState<"date" | "visits">("date");
  const [listSortDir, setListSortDir] = useState<"desc" | "asc">("desc");
  const [openFilter, setOpenFilter] = useState<null | "directory" | "category">(null);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [draftDepartmentIds, setDraftDepartmentIds] = useState<string[]>(() =>
    initialDeptList(initialDepartmentId),
  );
  const [draftCatCodes, setDraftCatCodes] = useState<string[]>(() =>
    initialCatList(initialCatCode),
  );
  const [revealedPhones, setRevealedPhones] = useState<Record<string, boolean>>({});
  const [authLoading, setAuthLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [userDisplayName, setUserDisplayName] = useState<string | null>(null);
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(() => new Set());
  /**
   * Optimistic visit increments while navigating away loses React state; persisted in
   * sessionStorage and dropped once `visitsSig` updates after `router.refresh()`.
   * Initial state must stay `{}` on server and first client pass so SSR HTML matches hydration
   * (sessionStorage bumps are applied in `useLayoutEffect`).
   */
  const [visitBumps, setVisitBumps] = useState<Record<string, number>>({});
  /** After layout effects: session visit bumps + `Date.now()`-relative labels are safe to show. */
  const [clientUiReady, setClientUiReady] = useState(false);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [priceMinStr, setPriceMinStr] = useState("");
  const [priceMaxStr, setPriceMaxStr] = useState("");
  const [filterFreeOnly, setFilterFreeOnly] = useState(false);
  const [filterNewOnly, setFilterNewOnly] = useState(false);
  const [filterExchangeOnly, setFilterExchangeOnly] = useState(false);
  const [filterNegotiableOnly, setFilterNegotiableOnly] = useState(false);
  const [filterPromoAny, setFilterPromoAny] = useState(false);
  const [filterPromoFeatured, setFilterPromoFeatured] = useState(false);
  const [filterPromoSpotlight, setFilterPromoSpotlight] = useState(false);
  const [filterPromoBump, setFilterPromoBump] = useState(false);
  const [filterPromoUrgent, setFilterPromoUrgent] = useState(false);
  /** Draft values for price/item listing filters (applied only after user taps Apply). */
  const [listingDraftMinStr, setListingDraftMinStr] = useState("");
  const [listingDraftMaxStr, setListingDraftMaxStr] = useState("");
  const [listingDraftFreeOnly, setListingDraftFreeOnly] = useState(false);
  const [listingDraftNewOnly, setListingDraftNewOnly] = useState(false);
  const [listingDraftExchangeOnly, setListingDraftExchangeOnly] = useState(false);
  const [listingDraftNegotiableOnly, setListingDraftNegotiableOnly] = useState(false);
  const [listingDraftPromoAny, setListingDraftPromoAny] = useState(false);
  const [listingDraftPromoFeatured, setListingDraftPromoFeatured] = useState(false);
  const [listingDraftPromoSpotlight, setListingDraftPromoSpotlight] = useState(false);
  const [listingDraftPromoBump, setListingDraftPromoBump] = useState(false);
  const [listingDraftPromoUrgent, setListingDraftPromoUrgent] = useState(false);
  const [priorityPool, setPriorityPool] = useState<PriorityApiAd[]>([]);
  const [aiSearchOpen, setAiSearchOpen] = useState(false);
  const [aiQuery, setAiQuery] = useState("");
  /** `null` = AI filter off; array = last AI result order (may be empty). */
  const [aiMatchedIds, setAiMatchedIds] = useState<string[] | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  /** 0-based page index for the main listing grid (see `ADS_LIST_PAGE_SIZE`). */
  const [adsListPageIndex, setAdsListPageIndex] = useState(0);
  const directoryRef = useRef<HTMLDivElement | null>(null);
  const categoryRef = useRef<HTMLDivElement | null>(null);
  const advancedPanelRef = useRef<HTMLDivElement | null>(null);
  const advancedFiltersToggleRef = useRef<HTMLButtonElement | null>(null);
  const advancedPanelEverOpenedRef = useRef(false);
  const cityRef = useRef<HTMLDivElement | null>(null);
  const priorityStripRef = useRef<HTMLDivElement | null>(null);
  const cardLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextCardClickRef = useRef(false);
  const prevPathnameRef = useRef<string | null>(null);
  const prevVisitsSigRef = useRef<string | null>(null);
  const cardsSectionRef = useRef<HTMLDivElement | null>(null);
  const prevFilterScrollSigRef = useRef<string | null>(null);
  const prevSortScrollSigRef = useRef<string | null>(null);

  const filterScrollSig = useMemo(
    () =>
      `${[...selectedDepartmentIds].sort().join("\0")}\n${[...selectedCatCodes].sort().join("\0")}\n${priceMinStr}\n${priceMaxStr}\n${filterFreeOnly}\n${filterNewOnly}\n${filterExchangeOnly}\n${filterNegotiableOnly}\n${filterPromoAny}\n${filterPromoFeatured}\n${filterPromoSpotlight}\n${filterPromoBump}\n${filterPromoUrgent}`,
    [
      selectedDepartmentIds,
      selectedCatCodes,
      priceMinStr,
      priceMaxStr,
      filterFreeOnly,
      filterNewOnly,
      filterExchangeOnly,
      filterNegotiableOnly,
      filterPromoAny,
      filterPromoFeatured,
      filterPromoSpotlight,
      filterPromoBump,
      filterPromoUrgent,
    ],
  );

  const sortScrollSig = useMemo(
    () => `${listSortKey}\n${listSortDir}`,
    [listSortKey, listSortDir],
  );

  useEffect(() => {
    setCityJumpId(currentCityId ?? "");
  }, [currentCityId, pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mqWide = window.matchMedia("(min-width: 901px)");
    const update = () => {
      const wide = mqWide.matches;
      setAllowListMapHover(wide);
      setLayoutNarrow(!wide);
    };
    update();
    mqWide.addEventListener("change", update);
    return () => mqWide.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const prev = prevFilterScrollSigRef.current;
    prevFilterScrollSigRef.current = filterScrollSig;
    if (prev === null) return;
    if (prev === filterScrollSig) return;
    cardsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [filterScrollSig]);

  useEffect(() => {
    if (advancedFiltersOpen) {
      if (!advancedPanelEverOpenedRef.current) {
        advancedPanelEverOpenedRef.current = true;
        setDraftDepartmentIds([...selectedDepartmentIds]);
        setDraftCatCodes([...selectedCatCodes]);
        setListingDraftMinStr(priceMinStr);
        setListingDraftMaxStr(priceMaxStr);
        setListingDraftFreeOnly(filterFreeOnly);
        setListingDraftNewOnly(filterNewOnly);
        setListingDraftExchangeOnly(filterExchangeOnly);
        setListingDraftNegotiableOnly(filterNegotiableOnly);
        setListingDraftPromoAny(filterPromoAny);
        setListingDraftPromoFeatured(filterPromoFeatured);
        setListingDraftPromoSpotlight(filterPromoSpotlight);
        setListingDraftPromoBump(filterPromoBump);
        setListingDraftPromoUrgent(filterPromoUrgent);
      }
    } else {
      advancedPanelEverOpenedRef.current = false;
    }
  }, [
    advancedFiltersOpen,
    selectedDepartmentIds,
    selectedCatCodes,
    priceMinStr,
    priceMaxStr,
    filterFreeOnly,
    filterNewOnly,
    filterExchangeOnly,
    filterNegotiableOnly,
    filterPromoAny,
    filterPromoFeatured,
    filterPromoSpotlight,
    filterPromoBump,
    filterPromoUrgent,
  ]);

  const listingDraftDirty = useMemo(
    () =>
      listingDraftMinStr !== priceMinStr ||
      listingDraftMaxStr !== priceMaxStr ||
      listingDraftFreeOnly !== filterFreeOnly ||
      listingDraftNewOnly !== filterNewOnly ||
      listingDraftExchangeOnly !== filterExchangeOnly ||
      listingDraftNegotiableOnly !== filterNegotiableOnly ||
      listingDraftPromoAny !== filterPromoAny ||
      listingDraftPromoFeatured !== filterPromoFeatured ||
      listingDraftPromoSpotlight !== filterPromoSpotlight ||
      listingDraftPromoBump !== filterPromoBump ||
      listingDraftPromoUrgent !== filterPromoUrgent,
    [
      listingDraftMinStr,
      listingDraftMaxStr,
      listingDraftFreeOnly,
      listingDraftNewOnly,
      listingDraftExchangeOnly,
      listingDraftNegotiableOnly,
      listingDraftPromoAny,
      listingDraftPromoFeatured,
      listingDraftPromoSpotlight,
      listingDraftPromoBump,
      listingDraftPromoUrgent,
      priceMinStr,
      priceMaxStr,
      filterFreeOnly,
      filterNewOnly,
      filterExchangeOnly,
      filterNegotiableOnly,
      filterPromoAny,
      filterPromoFeatured,
      filterPromoSpotlight,
      filterPromoBump,
      filterPromoUrgent,
    ],
  );

  const selectionSig = useCallback(
    (ids: string[]) => [...ids].sort().join("\0"),
    [],
  );

  const deptCatDraftDirty = useMemo(
    () =>
      selectionSig(draftDepartmentIds) !== selectionSig(selectedDepartmentIds) ||
      selectionSig(draftCatCodes) !== selectionSig(selectedCatCodes),
    [
      draftCatCodes,
      draftDepartmentIds,
      selectedCatCodes,
      selectedDepartmentIds,
      selectionSig,
    ],
  );

  const advancedFiltersDirty = deptCatDraftDirty || listingDraftDirty;

  const applyAdvancedFilters = useCallback(() => {
    setSelectedDepartmentIds([...draftDepartmentIds]);
    setSelectedCatCodes([...draftCatCodes]);
    setPriceMinStr(listingDraftMinStr);
    setPriceMaxStr(listingDraftMaxStr);
    setFilterFreeOnly(listingDraftFreeOnly);
    setFilterNewOnly(listingDraftNewOnly);
    setFilterExchangeOnly(listingDraftExchangeOnly);
    setFilterNegotiableOnly(listingDraftNegotiableOnly);
    setFilterPromoAny(listingDraftPromoAny);
    setFilterPromoFeatured(listingDraftPromoFeatured);
    setFilterPromoSpotlight(listingDraftPromoSpotlight);
    setFilterPromoBump(listingDraftPromoBump);
    setFilterPromoUrgent(listingDraftPromoUrgent);
    setOpenFilter(null);
    setAdvancedFiltersOpen(false);
  }, [
    draftDepartmentIds,
    draftCatCodes,
    listingDraftMinStr,
    listingDraftMaxStr,
    listingDraftFreeOnly,
    listingDraftNewOnly,
    listingDraftExchangeOnly,
    listingDraftNegotiableOnly,
    listingDraftPromoAny,
    listingDraftPromoFeatured,
    listingDraftPromoSpotlight,
    listingDraftPromoBump,
    listingDraftPromoUrgent,
  ]);

  useEffect(() => {
    const prev = prevSortScrollSigRef.current;
    prevSortScrollSigRef.current = sortScrollSig;
    if (prev === null) return;
    if (prev === sortScrollSig) return;
    cardsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [sortScrollSig]);

  useEffect(() => {
    // Firebase Auth state is global for this client bundle.
    // We subscribe once per mount of this component.
    let unsubscribe: (() => void) | null = null;
    try {
      const auth = getAuthClientOrNull();
      if (!auth) {
        setAuthConfigured(false);
        setAuthLoading(false);
        setUserEmail(null);
        return;
      }

      setAuthConfigured(true);
      unsubscribe = onAuthStateChanged(auth, (user) => {
        const email = user?.email ?? null;
        setUserEmail(email);
        const dn = typeof user?.displayName === "string" ? user?.displayName.trim() : "";
        const display =
          dn ||
          (typeof email === "string" && email.includes("@")
            ? email.split("@")[0]
            : email) ||
          null;
        setUserDisplayName(display);
        setAuthLoading(false);
      });
    } catch (e) {
      // If Firebase client env vars are not configured, keep UI usable.
      console.error(e);
      setAuthConfigured(false);
      setAuthLoading(false);
      setUserEmail(null);
      setUserDisplayName(null);
    }
    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!authConfigured || !userEmail) {
      setBookmarkedIds(new Set());
      return;
    }
    const auth = getAuthClientOrNull();
    const u = auth?.currentUser;
    if (!u) {
      setBookmarkedIds(new Set());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const token = await u.getIdToken();
        const res = await fetch("/api/user/profile", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json().catch(() => ({}))) as {
          profile?: { bookmarkedAdIds?: string[] };
        };
        if (cancelled || !res.ok) return;
        const ids = json.profile?.bookmarkedAdIds;
        setBookmarkedIds(new Set(Array.isArray(ids) ? ids : []));
      } catch {
        if (!cancelled) setBookmarkedIds(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authConfigured, userEmail]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ads/priority");
        if (!res.ok) return;
        const json: unknown = await res.json();
        if (cancelled) return;
        setPriorityPool(parsePriorityApiAds(json));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!aiSearchOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !aiBusy) setAiSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aiSearchOpen, aiBusy]);

  useLayoutEffect(() => {
    setVisitBumps(readStoredVisitBumps());
    setClientUiReady(true);
  }, []);

  const handleLoginWithGmail = async () => {
    setAuthLoading(true);
    try {
      const auth = getAuthClientOrNull();
      if (!auth) {
        setAuthConfigured(false);
        setAuthLoading(false);
        return;
      }
      const provider = getGoogleProvider();
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error(e);
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    setAuthLoading(true);
    try {
      const auth = getAuthClientOrNull();
      if (!auth) {
        setAuthConfigured(false);
        setAuthLoading(false);
        return;
      }
      await signOut(auth);
    } catch (e) {
      console.error(e);
      setAuthLoading(false);
    }
  };

  const visitsSig = useMemo(
    () =>
      [...ads]
        .map((a) => {
          const v =
            typeof a.visits === "number" && Number.isFinite(a.visits)
              ? Math.max(0, Math.floor(a.visits))
              : 0;
          return `${a.id}:${v}`;
        })
        .sort()
        .join("|"),
    [ads],
  );

  useEffect(() => {
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = pathname;
    if (prev === null) return;
    const wasAdDetail = /^\/b\/[^/]+$/.test(prev);
    const isAdDetail = /^\/b\/[^/]+$/.test(pathname);
    if (wasAdDetail && !isAdDetail) {
      router.refresh();
    }
  }, [pathname, router]);

  useEffect(() => {
    const prevSig = prevVisitsSigRef.current;
    prevVisitsSigRef.current = visitsSig;
    if (prevSig === null) return;
    if (prevSig !== visitsSig) {
      setVisitBumps({});
      sessionStorage.removeItem(VISIT_BUMPS_STORAGE_KEY);
    }
  }, [visitsSig]);

  const clearCardLongPressTimer = () => {
    if (cardLongPressTimerRef.current !== null) {
      clearTimeout(cardLongPressTimerRef.current);
      cardLongPressTimerRef.current = null;
    }
  };

  const registerAdOpenedForId = useCallback((id: string) => {
    recordAdVisit(id);
    setVisitBumps((p) => {
      const next = { ...p, [id]: (p[id] ?? 0) + 1 };
      writeStoredVisitBumps(next);
      return next;
    });
  }, []);

  const toggleBookmark = useCallback(async (adId: string, mark: boolean) => {
    const auth = getAuthClientOrNull();
    const u = auth?.currentUser;
    if (!u) return;
    setBookmarkedIds((prev) => {
      const next = new Set(prev);
      if (mark) next.add(adId);
      else next.delete(adId);
      return next;
    });
    try {
      const token = await u.getIdToken();
      const res = await fetch("/api/user/bookmarks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ adId, bookmark: mark }),
      });
      if (!res.ok) throw new Error("bookmark");
    } catch {
      setBookmarkedIds((prev) => {
        const next = new Set(prev);
        if (mark) next.delete(adId);
        else next.add(adId);
        return next;
      });
    }
  }, []);

  const directoryLabelMap = useMemo(
    () => new Map((departmentOptions ?? []).map((opt) => [opt.value, opt.label] as const)),
    [departmentOptions],
  );

  const deptImageById = useMemo(
    () =>
      new Map(
        (departmentQuickFilters ?? []).map((d) => [d.id, d.imageUrl] as const),
      ),
    [departmentQuickFilters],
  );

  const visibleDirectoryOptions = useMemo(() => {
    const ids = Array.from(new Set(ads.map((a) => a.departmentId).filter(Boolean) as string[]));
    return ids
      .map((id) => ({
        value: id,
        label: directoryLabelMap.get(id) ?? id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [ads, directoryLabelMap]);

  const filteredDirectoryOptions = useMemo(() => {
    const q = directoryQuery.trim().toLowerCase();
    if (!q) return visibleDirectoryOptions;
    return visibleDirectoryOptions.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [visibleDirectoryOptions, directoryQuery]);

  const categoryLabelMap = useMemo(
    () => new Map((categoryOptions ?? []).map((opt) => [opt.value, opt.label] as const)),
    [categoryOptions],
  );

  const visibleCategoryOptions = useMemo(() => {
    const sourceAds = selectedDepartmentIds.length > 0
      ? ads.filter((a) => a.departmentId && selectedDepartmentIds.includes(a.departmentId))
      : ads;

    const codes = Array.from(
      new Set(sourceAds.map((a) => a.catCode).filter(Boolean) as string[]),
    );

    return codes
      .map((code) => ({
        value: code,
        label: categoryLabelMap.get(code) ?? code,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [ads, selectedDepartmentIds, categoryLabelMap]);

  const visibleCategoryOptionsForDraft = useMemo(() => {
    const sourceAds =
      draftDepartmentIds.length > 0
        ? ads.filter((a) => a.departmentId && draftDepartmentIds.includes(a.departmentId))
        : ads;
    const codes = Array.from(
      new Set(sourceAds.map((a) => a.catCode).filter(Boolean) as string[]),
    );
    return codes
      .map((code) => ({
        value: code,
        label: categoryLabelMap.get(code) ?? code,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [ads, draftDepartmentIds, categoryLabelMap]);

  const filteredCategoryOptions = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase();
    if (!q) return visibleCategoryOptions;
    return visibleCategoryOptions.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [visibleCategoryOptions, categoryQuery]);

  const filteredCategoryOptionsForDraft = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase();
    if (!q) return visibleCategoryOptionsForDraft;
    return visibleCategoryOptionsForDraft.filter((opt) =>
      opt.label.toLowerCase().includes(q),
    );
  }, [visibleCategoryOptionsForDraft, categoryQuery]);

  useEffect(() => {
    const allowed = new Set(visibleCategoryOptions.map((opt) => opt.value));
    setSelectedCatCodes((prev) => prev.filter((code) => allowed.has(code)));
  }, [visibleCategoryOptions]);

  useEffect(() => {
    if (!advancedFiltersOpen) return;
    const allowed = new Set(visibleCategoryOptionsForDraft.map((opt) => opt.value));
    setDraftCatCodes((prev) => prev.filter((code) => allowed.has(code)));
  }, [advancedFiltersOpen, visibleCategoryOptionsForDraft]);

  useEffect(() => {
    const nextDept = initialDeptList(initialDepartmentId);
    const nextCat = initialCatList(initialCatCode);
    setSelectedDepartmentIds(nextDept);
    setSelectedCatCodes(nextCat);
    setDraftDepartmentIds(nextDept);
    setDraftCatCodes(nextCat);
    setAdvancedFiltersOpen(false);
    setOpenFilter(null);
  }, [pathname, initialDepartmentId, initialCatCode]);

  useEffect(() => {
    return () => {
      if (cardLongPressTimerRef.current !== null) {
        clearTimeout(cardLongPressTimerRef.current);
        cardLongPressTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (directoryRef.current?.contains(target)) return;
      if (categoryRef.current?.contains(target)) return;
      if (advancedPanelRef.current?.contains(target)) return;
      if (advancedFiltersToggleRef.current?.contains(target)) return;
      if (cityRef.current?.contains(target)) return;
      setOpenFilter(null);
      setCityPickerOpen(false);
      setAdvancedFiltersOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const priorityStrip = useMemo(() => {
    const byId = new Map(ads.map((a) => [a.id, a]));
    const out: PriorityStripSlide[] = [];
    for (const p of priorityPool) {
      const card = byId.get(p.id);
      const link = card?.link;
      if (typeof link !== "string" || !link.trim()) continue;
      out.push({
        ...p,
        link: link.trim(),
        displayImage: card?.image ?? p.image,
      });
      if (out.length >= PRIORITY_STRIP_LIMIT) break;
    }
    return out;
  }, [priorityPool, ads]);

  useEffect(() => {
    const el = priorityStripRef.current;
    if (!el || priorityStrip.length < 2) return;
    const id = window.setInterval(() => scrollPriorityStrip(el, "next"), PRIORITY_STRIP_AUTO_MS);
    return () => window.clearInterval(id);
  }, [priorityStrip.length]);

  const priceBounds = useMemo(() => {
    const nums = ads
      .map((a) => (typeof a.price === "number" && Number.isFinite(a.price) ? a.price : null))
      .filter((n): n is number => n !== null && n >= 0);
    if (nums.length === 0) return null;
    const min = Math.floor(Math.min(...nums));
    const max = Math.ceil(Math.max(...nums));
    return { min, max: Math.max(min + 1, max) };
  }, [ads]);
  const sliderBounds = priceBounds ?? { min: 0, max: 1000 };

  const filteredAds = useMemo(
    () => {
      const q = searchQuery.trim().toLowerCase();
      let minP = parseListingFilterPrice(priceMinStr);
      let maxP = parseListingFilterPrice(priceMaxStr);
      if (minP !== null && maxP !== null && minP > maxP) {
        const s = minP;
        minP = maxP;
        maxP = s;
      }
      const hasPriceRange = minP !== null || maxP !== null;

      const out = ads.filter((a) => {
        if (
          selectedDepartmentIds.length > 0 &&
          (!a.departmentId || !selectedDepartmentIds.includes(a.departmentId))
        ) {
          return false;
        }
        if (
          selectedCatCodes.length > 0 &&
          (!a.catCode || !selectedCatCodes.includes(a.catCode))
        ) {
          return false;
        }
        if (q) {
          const title = a.title.toLowerCase();
          const category = (a.category ?? "").toLowerCase();
          if (!title.includes(q) && !category.includes(q)) return false;
        }
        if (filterFreeOnly && !a.isFree) return false;
        if (filterNewOnly && !a.isNewItem) return false;
        if (filterExchangeOnly && !a.exchangeable) return false;
        if (filterNegotiableOnly && !a.negotiable) return false;
        const adPromos = Array.isArray(a.activePromotions) ? a.activePromotions : [];
        if (filterPromoAny && adPromos.length === 0) return false;
        if (filterPromoFeatured && !adPromos.includes("featured")) return false;
        if (filterPromoSpotlight && !adPromos.includes("spotlight")) return false;
        if (filterPromoBump && !adPromos.includes("bump")) return false;
        if (filterPromoUrgent && !adPromos.includes("urgent")) return false;
        if (hasPriceRange) {
          const p =
            typeof a.price === "number" && Number.isFinite(a.price) ? a.price : null;
          if (p === null) return false;
          if (minP !== null && p < minP) return false;
          if (maxP !== null && p > maxP) return false;
        }
        return true;
      });

      const visitTotal = (card: CityAdCard) => {
        const v =
          typeof card.visits === "number" && Number.isFinite(card.visits)
            ? Math.max(0, Math.floor(card.visits))
            : 0;
        return v + (visitBumps[card.id] ?? 0);
      };

      const nowMs = Date.now();
      out.sort((a, b) => {
        // Promoted and non-expired ads should be shown first.
        const aPromoScore = getAdPromotionScore(a);
        const bPromoScore = getAdPromotionScore(b);
        const aPromoExpiry = getAdPromotionExpiryMs(a, nowMs);
        const bPromoExpiry = getAdPromotionExpiryMs(b, nowMs);
        const aHasPriority = aPromoScore > 0 || aPromoExpiry !== null;
        const bHasPriority = bPromoScore > 0 || bPromoExpiry !== null;
        if (aHasPriority !== bHasPriority) return aHasPriority ? -1 : 1;
        if (aPromoScore !== bPromoScore) return bPromoScore - aPromoScore;
        if (aPromoExpiry !== null && bPromoExpiry !== null && aPromoExpiry !== bPromoExpiry) {
          // Nearer expiry first keeps soon-ending promotions visible.
          return aPromoExpiry - bPromoExpiry;
        }
        if (aPromoExpiry !== null && bPromoExpiry === null) return -1;
        if (aPromoExpiry === null && bPromoExpiry !== null) return 1;

        if (listSortKey === "visits") {
          const av = visitTotal(a);
          const bv = visitTotal(b);
          let cmp = listSortDir === "desc" ? bv - av : av - bv;
          if (cmp !== 0) return cmp;
          const ams = typeof a.createdAtMs === "number" ? a.createdAtMs : null;
          const bms = typeof b.createdAtMs === "number" ? b.createdAtMs : null;
          if (ams === null && bms === null) return a.title.localeCompare(b.title, "fa");
          if (ams === null) return 1;
          if (bms === null) return -1;
          return bms - ams;
        }

        const ams = typeof a.createdAtMs === "number" ? a.createdAtMs : null;
        const bms = typeof b.createdAtMs === "number" ? b.createdAtMs : null;
        if (ams === null && bms === null) return visitTotal(b) - visitTotal(a);
        if (ams === null) return 1;
        if (bms === null) return -1;
        let cmp = listSortDir === "asc" ? ams - bms : bms - ams;
        if (cmp !== 0) return cmp;
        return visitTotal(b) - visitTotal(a);
      });

      return out;
    },
    [
      ads,
      selectedDepartmentIds,
      selectedCatCodes,
      searchQuery,
      listSortKey,
      listSortDir,
      visitBumps,
      priceMinStr,
      priceMaxStr,
      filterFreeOnly,
      filterNewOnly,
      filterExchangeOnly,
      filterNegotiableOnly,
      filterPromoAny,
      filterPromoFeatured,
      filterPromoSpotlight,
      filterPromoBump,
      filterPromoUrgent,
    ],
  );

  const displayedAds = useMemo(() => {
    if (aiMatchedIds === null) return filteredAds;
    const byId = new Map(filteredAds.map((a) => [a.id, a]));
    const out: CityAdCard[] = [];
    for (const id of aiMatchedIds) {
      const c = byId.get(id);
      if (c) out.push(c);
    }
    return out;
  }, [filteredAds, aiMatchedIds]);

  const displayedAdsListResetSig = useMemo(() => {
    if (displayedAds.length === 0) return "0";
    const last = displayedAds[displayedAds.length - 1];
    return `${displayedAds.length}:${displayedAds[0]?.id ?? ""}:${last?.id ?? ""}`;
  }, [displayedAds]);

  useEffect(() => {
    setAdsListPageIndex(0);
  }, [filterScrollSig, sortScrollSig, searchQuery, aiMatchedIds, displayedAdsListResetSig]);

  const adsListTotalPages = useMemo(
    () => Math.max(1, Math.ceil(displayedAds.length / ADS_LIST_PAGE_SIZE)),
    [displayedAds.length],
  );

  useEffect(() => {
    setAdsListPageIndex((p) => Math.min(p, Math.max(0, adsListTotalPages - 1)));
  }, [adsListTotalPages]);

  const adsListSafePage = Math.min(adsListPageIndex, adsListTotalPages - 1);
  const paginatedListAds = useMemo(() => {
    const start = adsListSafePage * ADS_LIST_PAGE_SIZE;
    return displayedAds.slice(start, start + ADS_LIST_PAGE_SIZE);
  }, [displayedAds, adsListSafePage]);

  const showAdsPagination = displayedAds.length > ADS_LIST_PAGE_SIZE;
  const isAdsListLastPage =
    displayedAds.length > 0 && adsListSafePage === adsListTotalPages - 1;
  /** Under the pager in the list column (not below the tall map column). */
  const showPromoteInListCards =
    isAdsListLastPage && (!layoutNarrow || mobileMode !== "map");
  /** Narrow + map tab: list column is hidden in CSS — show promote under the map. */
  const showPromoteInMapFooter =
    isAdsListLastPage && layoutNarrow && mobileMode === "map";

  const runAiSearch = useCallback(async () => {
    const q = aiQuery.trim();
    if (!q) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const auth = getAuthClientOrNull();
      const u = auth?.currentUser;
      if (!u) {
        setAiError(t("city.aiSearchErrAuth"));
        return;
      }
      const token = await u.getIdToken();
      const items = ads.map((a) => ({
        id: a.id,
        title: a.title,
        category: a.category ?? null,
        description: a.description ?? null,
      }));
      const res = await fetch("/api/ai/search-ads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query: q, items }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        ids?: string[];
      };
      if (!res.ok) {
        if (res.status === 401) setAiError(t("city.aiSearchErrAuth"));
        else if (res.status === 503) setAiError(t("city.aiSearchErrConfig"));
        else if (res.status === 502) setAiError(t("city.aiSearchErrService"));
        else setAiError(json.error || t("city.aiSearchErrGeneric"));
        return;
      }
      const nextIds = Array.isArray(json.ids) ? json.ids : [];
      setAiMatchedIds(nextIds);
      setAiSearchOpen(false);
      requestAnimationFrame(() => {
        cardsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch {
      setAiError(t("city.aiSearchErrGeneric"));
    } finally {
      setAiBusy(false);
    }
  }, [aiQuery, ads, t]);

  const mapPoints = useMemo(
    () => {
      const out: Array<{
        id: string;
        title: string;
        category: string | null;
        link: string | null;
        image: string | null;
        lat: number;
        lon: number;
      }> = [];

      for (const a of displayedAds) {
        if (!a.location) continue;
        if (
          typeof a.location.lat !== "number" ||
          typeof a.location.lon !== "number"
        )
          continue;

        const cat =
          typeof a.category === "string" && a.category.trim()
            ? a.category.trim()
            : null;

        out.push({
          id: a.id,
          title: a.title,
          category: cat,
          link: a.link ?? null,
          image: a.image ?? null,
          lat: a.location.lat,
          lon: a.location.lon,
        });
      }

      return out;
    },
    [displayedAds],
  );

  const listTitle = cityTitle;
  const introCityName = (typeof cityFa === "string" && cityFa.trim()) || cityTitle;
  const introCountryLabel = useMemo(() => {
    const fa = typeof countryFa === "string" ? countryFa.trim() : "";
    const en = typeof countryEng === "string" ? countryEng.trim() : "";
    if (locale === "fa") return fa || en;
    return en || fa;
  }, [countryFa, countryEng, locale]);
  const cityIntroText =
    introCountryLabel.length > 0
      ? t("city.introPrefix", { city: introCityName, country: introCountryLabel })
      : t("city.introPrefixNoCountry", { city: introCityName });
  const fmtN = (n: number) => (locale === "fa" ? toPersianDigits(n) : String(n));
  const formatPrice = (n: number) =>
    locale === "fa" ? n.toLocaleString("fa-IR") : n.toLocaleString("en-GB");

  const draftDirectorySummary =
    draftDepartmentIds.length === 0
      ? t("city.allDepartments")
      : draftDepartmentIds.length === 1
        ? (visibleDirectoryOptions.find((d) => d.value === draftDepartmentIds[0])?.label ??
          t("city.nDepartmentsSelected", { n: fmtN(1) }))
        : t("city.nDepartmentsSelected", { n: fmtN(draftDepartmentIds.length) });
  const draftCategorySummary =
    draftCatCodes.length === 0
      ? t("city.allCategories")
      : draftCatCodes.length === 1
        ? (visibleCategoryOptionsForDraft.find((c) => c.value === draftCatCodes[0])?.label ??
          t("city.oneCategorySelected"))
        : t("city.nCategoriesSelected", { n: fmtN(draftCatCodes.length) });

  const listingFiltersDraftActive =
    listingDraftMinStr.trim() !== "" ||
    listingDraftMaxStr.trim() !== "" ||
    listingDraftFreeOnly ||
    listingDraftNewOnly ||
    listingDraftExchangeOnly ||
    listingDraftNegotiableOnly ||
    listingDraftPromoAny ||
    listingDraftPromoFeatured ||
    listingDraftPromoSpotlight ||
    listingDraftPromoBump ||
    listingDraftPromoUrgent;

  const listingFiltersActive =
    priceMinStr.trim() !== "" ||
    priceMaxStr.trim() !== "" ||
    filterFreeOnly ||
    filterNewOnly ||
    filterExchangeOnly ||
    filterNegotiableOnly ||
    filterPromoAny ||
    filterPromoFeatured ||
    filterPromoSpotlight ||
    filterPromoBump ||
    filterPromoUrgent;

  const advancedFiltersAppliedBadge =
    selectedDepartmentIds.length > 0 ||
    selectedCatCodes.length > 0 ||
    listingFiltersActive;

  const hasActiveFilters =
    selectedDepartmentIds.length > 0 ||
    selectedCatCodes.length > 0 ||
    searchQuery.trim().length > 0 ||
    listSortKey !== "date" ||
    listSortDir !== "desc" ||
    listingFiltersActive ||
    aiMatchedIds !== null;

  return (
    <div className={styles.shell}>
      <ActivityLogClient
        page="city_ads"
        pathname={pathname}
        city={cityTitle}
        departmentIds={selectedDepartmentIds}
        categoryCodes={selectedCatCodes}
      />
      <div className={styles.mobileToggle}>
        <button
          type="button"
          className={`${styles.toggleBtn} ${
            mobileMode === "list" ? styles.toggleBtnActive : ""
          }`}
          onClick={() => setMobileMode("list")}
          aria-pressed={mobileMode === "list"}
        >
          <span className={styles.toggleBtnInner}>
            <MobileToggleListIcon className={styles.toggleBtnGlyph} />
            <span>{t("city.tabList")}</span>
          </span>
        </button>
        <button
          type="button"
          className={`${styles.toggleBtn} ${
            mobileMode === "map" ? styles.toggleBtnActive : ""
          }`}
          onClick={() => setMobileMode("map")}
          aria-pressed={mobileMode === "map"}
        >
          <span className={styles.toggleBtnInner}>
            <MobileToggleMapIcon className={styles.toggleBtnGlyph} />
            <span>{t("city.tabMap")}</span>
          </span>
        </button>
      </div>
      <div className={styles.filterBarShell}>
        <div
          className={`${styles.filterBar} ${
            cityOptions && cityOptions.length > 0 ? styles.filterBarHasCityPicker : ""
          }`}
        >
        {cityOptions && cityOptions.length > 0 ? (
          <div
            className={`${styles.filterBlockCompact} ${styles.filterBlockCity} ${styles.filterBarCityPicker}`}
            ref={cityRef}
          >
            <button
              type="button"
              className={styles.menuIconBtn}
              aria-label={t("city.changeCity")}
              aria-expanded={cityPickerOpen}
              title={t("city.changeCity")}
              onClick={() => setCityPickerOpen((v) => !v)}
            >
              <span className={styles.menuIcon} aria-hidden="true">
                ☰
              </span>
            </button>
            {cityPickerOpen ? (
              <div className={styles.cityQuickMenu}>
                {cityOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`${styles.cityQuickItem} ${
                      opt.id === cityJumpId ? styles.cityQuickItemActive : ""
                    }`}
                    onClick={() => {
                      setCityPickerOpen(false);
                      setCityJumpId(opt.id);
                      if (!opt.id || opt.id === currentCityId) return;
                      router.push(loc(`/city/${encodeURIComponent(opt.id)}`));
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className={`${styles.filterBlockCompact} ${styles.filterBarToggleSlot}`}>
          <button
            ref={advancedFiltersToggleRef}
            type="button"
            className={`${styles.sortIconBtn} ${styles.filterPanelToggleBtn} ${
              advancedFiltersOpen ? styles.sortIconBtnActive : ""
            }`}
            aria-expanded={advancedFiltersOpen}
            aria-label={t("city.advancedFiltersToggleAria")}
            title={t("city.advancedFiltersToggleTitle")}
            onClick={() => setAdvancedFiltersOpen((v) => !v)}
          >
            <FilterIconPanel className={styles.sortDateGlyph} />
            {advancedFiltersAppliedBadge ? (
              <span className={styles.filterPanelToggleDot} aria-hidden />
            ) : null}
          </button>
        </div>

        <div className={`${styles.filterBlock} ${styles.filterBlockSearch} ${styles.filterBarSearchSlot}`}>
          <div className={`${styles.filterTrigger} ${styles.searchTrigger}`}>
            <FilterIconSearch className={styles.filterLeadIcon} />
            <div className={styles.multiValueWrap}>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`${styles.multiInput} ${styles.searchInput}`}
                placeholder={t("city.searchPlaceholder")}
              />
            </div>
          </div>
        </div>

        <div className={`${styles.filterBlockCompact} ${styles.filterBarClearSlot}`}>
          <button
            type="button"
            className={styles.clearFiltersBtn}
            onClick={() => {
              setSelectedDepartmentIds([]);
              setSelectedCatCodes([]);
              setSearchQuery("");
              setListSortKey("date");
              setListSortDir("desc");
              setDirectoryQuery("");
              setCategoryQuery("");
              setOpenFilter(null);
              setPriceMinStr("");
              setPriceMaxStr("");
              setFilterFreeOnly(false);
              setFilterNewOnly(false);
              setFilterExchangeOnly(false);
              setFilterNegotiableOnly(false);
              setListingDraftMinStr("");
              setListingDraftMaxStr("");
              setListingDraftFreeOnly(false);
              setListingDraftNewOnly(false);
              setListingDraftExchangeOnly(false);
              setListingDraftNegotiableOnly(false);
              setDraftDepartmentIds([]);
              setDraftCatCodes([]);
              setAdvancedFiltersOpen(false);
              setAiMatchedIds(null);
              setAiQuery("");
              setAiError(null);
            }}
            disabled={!hasActiveFilters}
            aria-label={t("city.clearFiltersAria")}
            title={t("city.clearFiltersTitle")}
          >
            <span className={styles.clearFiltersIcon} aria-hidden="true">
              ↺
            </span>
          </button>
        </div>

        {authConfigured && userEmail ? (
          <div className={`${styles.filterBlockCompact} ${styles.aiSearchWrap} ${styles.filterBarAiSlot}`}>
            <button
              type="button"
              className={`${styles.sortIconBtn} ${
                aiMatchedIds !== null ? styles.sortIconBtnActive : ""
              }`}
              onClick={() => {
                if (aiMatchedIds !== null) {
                  setAiMatchedIds(null);
                  setAiError(null);
                  setAiSearchOpen(false);
                  return;
                }
                setAiSearchOpen(true);
                setAiError(null);
              }}
              disabled={authLoading}
              aria-label={
                aiMatchedIds !== null
                  ? t("city.aiSearchClearAria")
                  : t("city.aiSearchAria")
              }
              aria-pressed={aiMatchedIds !== null}
              title={
                aiMatchedIds !== null
                  ? t("city.aiSearchClearTitle")
                  : t("city.aiSearchTitle")
              }
            >
              <AiSearchGlyph className={styles.sortDateGlyph} />
            </button>
          </div>
        ) : null}

        <div className={`${styles.filterBlockCompact} ${styles.sortBtnGroup} ${styles.filterBarSortSlot}`}>
          <button
            type="button"
            className={`${styles.sortIconBtn} ${
              listSortKey === "date" ? styles.sortIconBtnActive : ""
            }`}
            onClick={() => {
              if (listSortKey === "date") {
                setListSortDir((d) => (d === "desc" ? "asc" : "desc"));
              } else {
                setListSortKey("date");
                setListSortDir("desc");
              }
            }}
            aria-label={
              listSortKey === "date"
                ? listSortDir === "desc"
                  ? t("city.sortDateNewOld")
                  : t("city.sortDateOldNew")
                : t("city.sortDateDefault")
            }
            title={
              listSortKey === "date"
                ? listSortDir === "desc"
                  ? t("city.sortDateTitleNew")
                  : t("city.sortDateTitleOld")
                : t("city.sortDateDefault")
            }
          >
            <SortByDateIcon
              direction={listSortKey === "date" ? listSortDir : "desc"}
              className={styles.sortDateGlyph}
            />
          </button>
          <button
            type="button"
            className={`${styles.sortIconBtn} ${
              listSortKey === "visits" ? styles.sortIconBtnActive : ""
            }`}
            onClick={() => {
              if (listSortKey === "visits") {
                setListSortDir((d) => (d === "desc" ? "asc" : "desc"));
              } else {
                setListSortKey("visits");
                setListSortDir("desc");
              }
            }}
            aria-label={
              listSortKey === "visits"
                ? listSortDir === "desc"
                  ? t("city.sortVisitsHighLow")
                  : t("city.sortVisitsLowHigh")
                : t("city.sortVisitsDefault")
            }
            title={
              listSortKey === "visits"
                ? listSortDir === "desc"
                  ? t("city.sortVisitsTitleHigh")
                  : t("city.sortVisitsTitleLow")
                : t("city.sortVisitsDefault")
            }
          >
            <SortByVisitsIcon
              direction={listSortKey === "visits" ? listSortDir : "desc"}
              className={styles.sortDateGlyph}
            />
          </button>
        </div>

        <div className={styles.filterLogoWrap}>
          <Link href={loc("/")}>
            <img
              src="/divaro.png"
              alt={t("city.brand")}
              className={styles.filterLogo}
              decoding="async"
              fetchPriority="high"
            />
          </Link>
        </div>
        </div>

        {advancedFiltersOpen ? (
          <div ref={advancedPanelRef} className={styles.advancedFiltersPanel}>
            <div className={styles.advancedFiltersGrid}>
              <div className={styles.advancedFiltersField}>
                <div className={styles.advancedFiltersSectionLabel}>
                  {t("city.advancedFiltersSectionDept")}
                </div>
                <div
                  className={`${styles.filterBlock} ${styles.filterBlockWide} ${styles.advancedFiltersDept}`}
                  ref={directoryRef}
                >
                  <div
                    className={`${styles.filterTrigger} ${
                      draftDepartmentIds.length > 1 ? styles.filterTriggerDense : ""
                    }`}
                    onClick={() => setOpenFilter("directory")}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setOpenFilter("directory");
                    }}
                  >
                    <FilterIconDept className={styles.filterLeadIcon} />
                    <div className={styles.multiValueWrap}>
                      {draftDepartmentIds.length === 0 ? (
                        <span className={styles.multiPlaceholder}>{draftDirectorySummary}</span>
                      ) : (
                        draftDepartmentIds.map((id) => {
                          const label =
                            visibleDirectoryOptions.find((o) => o.value === id)?.label ?? id;
                          return (
                            <span key={id} className={styles.multiChip}>
                              {label}
                              <button
                                type="button"
                                className={styles.multiChipRemove}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDraftDepartmentIds((prev) => prev.filter((v) => v !== id));
                                }}
                                aria-label={`Remove ${label}`}
                              >
                                ×
                              </button>
                            </span>
                          );
                        })
                      )}
                      <input
                        value={directoryQuery}
                        onChange={(e) => {
                          setDirectoryQuery(e.target.value);
                          setOpenFilter("directory");
                        }}
                        onFocus={() => setOpenFilter("directory")}
                        className={styles.multiInput}
                        placeholder={
                          draftDepartmentIds.length === 0 ? t("city.deptSearchPh") : ""
                        }
                      />
                    </div>
                    <div className={styles.multiActions}>
                      {draftDepartmentIds.length > 0 ? (
                        <button
                          type="button"
                          className={styles.clearBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDraftDepartmentIds([]);
                          }}
                          aria-label={t("city.clearAllDeptsAria")}
                        >
                          ×
                        </button>
                      ) : null}
                      <span className={styles.filterChevron}>▾</span>
                    </div>
                  </div>
                  {openFilter === "directory" ? (
                    <div className={styles.filterMenu}>
                      {filteredDirectoryOptions.length === 0 ? (
                        <div className={styles.filterEmpty}>{t("city.noDeptFound")}</div>
                      ) : null}
                      {filteredDirectoryOptions.map((opt) => {
                        const checked = draftDepartmentIds.includes(opt.value);
                        const thumb = deptImageById.get(opt.value) ?? null;
                        return (
                          <label key={opt.value} className={styles.filterCheckboxRow}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={
                                !checked && draftDepartmentIds.length >= MAX_MULTI_SELECTION
                              }
                              onChange={() =>
                                setDraftDepartmentIds((prev) =>
                                  checked
                                    ? prev.filter((v) => v !== opt.value)
                                    : prev.length >= MAX_MULTI_SELECTION
                                      ? prev
                                      : [...prev, opt.value],
                                )
                              }
                            />
                            {thumb ? (
                              <span className={styles.filterRowThumb}>
                                <img src={thumb} alt="" loading="lazy" decoding="async" />
                              </span>
                            ) : (
                              <span className={styles.filterRowThumbFallback} aria-hidden>
                                <FilterIconDept className={styles.filterRowThumbIcon} />
                              </span>
                            )}
                            <span className={styles.filterCheckboxLabel}>{opt.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className={styles.advancedFiltersField}>
                <div className={styles.advancedFiltersSectionLabel}>
                  {t("city.advancedFiltersSectionCat")}
                </div>
                <div
                  className={`${styles.filterBlock} ${styles.filterBlockWide} ${styles.advancedFiltersCategory}`}
                  ref={categoryRef}
                >
                  <div
                    className={`${styles.filterTrigger} ${
                      draftCatCodes.length > 1 ? styles.filterTriggerDense : ""
                    }`}
                    onClick={() => setOpenFilter("category")}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setOpenFilter("category");
                    }}
                  >
                    <FilterIconCategory className={styles.filterLeadIcon} />
                    <div className={styles.multiValueWrap}>
                      {draftCatCodes.length === 0 ? (
                        <span className={styles.multiPlaceholder}>{draftCategorySummary}</span>
                      ) : (
                        draftCatCodes.map((code) => {
                          const label =
                            visibleCategoryOptionsForDraft.find((opt) => opt.value === code)
                              ?.label ?? code;
                          return (
                            <span key={code} className={styles.multiChip}>
                              {label}
                              <button
                                type="button"
                                className={styles.multiChipRemove}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDraftCatCodes((prev) => prev.filter((v) => v !== code));
                                }}
                                aria-label={`Remove ${label}`}
                              >
                                ×
                              </button>
                            </span>
                          );
                        })
                      )}
                      <input
                        value={categoryQuery}
                        onChange={(e) => {
                          setCategoryQuery(e.target.value);
                          setOpenFilter("category");
                        }}
                        onFocus={() => setOpenFilter("category")}
                        className={styles.multiInput}
                        placeholder={draftCatCodes.length === 0 ? t("city.catSearchPh") : ""}
                      />
                    </div>
                    <div className={styles.multiActions}>
                      {draftCatCodes.length > 0 ? (
                        <button
                          type="button"
                          className={styles.clearBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDraftCatCodes([]);
                          }}
                          aria-label={t("city.clearAllCatsAria")}
                        >
                          ×
                        </button>
                      ) : null}
                      <span className={styles.filterChevron}>▾</span>
                    </div>
                  </div>
                  {openFilter === "category" ? (
                    <div className={styles.filterMenu}>
                      {filteredCategoryOptionsForDraft.length === 0 ? (
                        <div className={styles.filterEmpty}>{t("city.noCatFound")}</div>
                      ) : null}
                      {filteredCategoryOptionsForDraft.map((opt) => {
                        const checked = draftCatCodes.includes(opt.value);
                        return (
                          <label key={opt.value} className={styles.filterCheckboxRow}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={
                                !checked && draftCatCodes.length >= MAX_MULTI_SELECTION
                              }
                              onChange={() =>
                                setDraftCatCodes((prev) =>
                                  checked
                                    ? prev.filter((v) => v !== opt.value)
                                    : prev.length >= MAX_MULTI_SELECTION
                                      ? prev
                                      : [...prev, opt.value],
                                )
                              }
                            />
                            <span className={styles.filterCheckboxLabel}>{opt.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>

              <div
                className={`${styles.advancedFiltersField} ${styles.advancedFiltersListingSlot}`}
              >
                <div className={styles.advancedFiltersSectionLabel}>
                  {t("city.advancedFiltersSectionListing")}
                </div>
                <div
                  className={`${styles.advancedFiltersListingCard} ${
                    listingFiltersDraftActive ? styles.advancedFiltersListingCardActive : ""
                  }`}
                >
                  <div className={styles.listingFilterSliders}>
                      <label className={styles.listingFilterPriceField}>
                        <span className={styles.listingFilterPriceLabel}>
                          {t("city.priceMin")}
                          <strong className={styles.listingFilterPriceValue}>
                            {parseListingFilterPrice(listingDraftMinStr) ?? sliderBounds.min}
                          </strong>
                        </span>
                        <input
                          type="range"
                          min={sliderBounds.min}
                          max={sliderBounds.max}
                          step={1}
                          className={styles.listingFilterRange}
                          value={parseListingFilterPrice(listingDraftMinStr) ?? sliderBounds.min}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            const currMax =
                              parseListingFilterPrice(listingDraftMaxStr) ?? sliderBounds.max;
                            setListingDraftMinStr(String(Math.min(next, currMax)));
                          }}
                        />
                      </label>
                      <label className={styles.listingFilterPriceField}>
                        <span className={styles.listingFilterPriceLabel}>
                          {t("city.priceMax")}
                          <strong className={styles.listingFilterPriceValue}>
                            {parseListingFilterPrice(listingDraftMaxStr) ?? sliderBounds.max}
                          </strong>
                        </span>
                        <input
                          type="range"
                          min={sliderBounds.min}
                          max={sliderBounds.max}
                          step={1}
                          className={styles.listingFilterRange}
                          value={parseListingFilterPrice(listingDraftMaxStr) ?? sliderBounds.max}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            const currMin =
                              parseListingFilterPrice(listingDraftMinStr) ?? sliderBounds.min;
                            setListingDraftMaxStr(String(Math.max(next, currMin)));
                          }}
                        />
                      </label>
                    </div>
                  <label className={styles.filterCheckboxRow}>
                    <input
                      type="checkbox"
                      checked={listingDraftFreeOnly}
                      onChange={(e) => setListingDraftFreeOnly(e.target.checked)}
                    />
                    <span className={styles.filterCheckboxLabel}>{t("city.filterFreeOnly")}</span>
                  </label>
                  <label className={styles.filterCheckboxRow}>
                    <input
                      type="checkbox"
                      checked={listingDraftNewOnly}
                      onChange={(e) => setListingDraftNewOnly(e.target.checked)}
                    />
                    <span className={styles.filterCheckboxLabel}>{t("city.filterNewOnly")}</span>
                  </label>
                  <label className={styles.filterCheckboxRow}>
                    <input
                      type="checkbox"
                      checked={listingDraftExchangeOnly}
                      onChange={(e) => setListingDraftExchangeOnly(e.target.checked)}
                    />
                    <span className={styles.filterCheckboxLabel}>
                      {t("city.filterExchangeOnly")}
                    </span>
                  </label>
                  <label className={styles.filterCheckboxRow}>
                    <input
                      type="checkbox"
                      checked={listingDraftNegotiableOnly}
                      onChange={(e) => setListingDraftNegotiableOnly(e.target.checked)}
                    />
                    <span className={styles.filterCheckboxLabel}>
                      {t("city.filterNegotiableOnly")}
                    </span>
                  </label>
                  <div className={styles.listingPromoHead}>
                    {t("city.filterPromotions")}
                  </div>
                  <label className={styles.filterCheckboxRow}>
                    <input
                      type="checkbox"
                      checked={listingDraftPromoAny}
                      onChange={(e) => setListingDraftPromoAny(e.target.checked)}
                    />
                    <span className={styles.filterCheckboxLabel}>{t("city.filterPromoAny")}</span>
                  </label>
                  <label className={styles.filterCheckboxRow}>
                    <input
                      type="checkbox"
                      checked={listingDraftPromoFeatured}
                      onChange={(e) => setListingDraftPromoFeatured(e.target.checked)}
                    />
                    <span className={styles.filterCheckboxLabel}>{t("city.promoteFeaturedTitle")}</span>
                  </label>
                  <label className={styles.filterCheckboxRow}>
                    <input
                      type="checkbox"
                      checked={listingDraftPromoSpotlight}
                      onChange={(e) => setListingDraftPromoSpotlight(e.target.checked)}
                    />
                    <span className={styles.filterCheckboxLabel}>{t("city.promoteSpotlightTitle")}</span>
                  </label>
                  <label className={styles.filterCheckboxRow}>
                    <input
                      type="checkbox"
                      checked={listingDraftPromoBump}
                      onChange={(e) => setListingDraftPromoBump(e.target.checked)}
                    />
                    <span className={styles.filterCheckboxLabel}>{t("city.promoteBumpTitle")}</span>
                  </label>
                  <label className={styles.filterCheckboxRow}>
                    <input
                      type="checkbox"
                      checked={listingDraftPromoUrgent}
                      onChange={(e) => setListingDraftPromoUrgent(e.target.checked)}
                    />
                    <span className={styles.filterCheckboxLabel}>{t("city.promoteUrgentTitle")}</span>
                  </label>
                </div>
              </div>
            </div>

            <div className={styles.advancedFiltersFooter}>
              <button
                type="button"
                className={styles.advancedFiltersApplyBtn}
                disabled={!advancedFiltersDirty}
                onClick={() => applyAdvancedFilters()}
                aria-label={t("city.advancedFiltersApplyAria")}
              >
                <ListingApplyIcon className={styles.listingFilterApplyGlyph} />
                <span>{t("city.advancedFiltersApply")}</span>
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {priorityStrip.length > 0 ? (
        <section
          className={styles.priorityStripSection}
          aria-labelledby="priority-strip-heading"
        >
          <div className={styles.priorityStripHead}>
            <h2 id="priority-strip-heading" className={styles.priorityStripTitle}>
              {t("home.priorityAdsTitle")}
            </h2>
          </div>
          <div className={styles.priorityStripRow}>
            {priorityStrip.length > 1 ? (
              <button
                type="button"
                className={styles.priorityStripNavBtn}
                aria-label={t("city.priorityStripPrevAria")}
                onClick={() => {
                  const el = priorityStripRef.current;
                  if (el) scrollPriorityStrip(el, "prev");
                }}
              >
                <PriorityStripChevron
                  direction="left"
                  className={styles.priorityStripNavGlyph}
                />
              </button>
            ) : null}
            <div
              ref={priorityStripRef}
              className={styles.priorityStrip}
              dir="ltr"
              role="region"
              aria-label={t("city.priorityStripAria")}
            >
              {priorityStrip.map((item) => (
                <Link
                  key={item.id}
                  href={loc(item.link)}
                  prefetch={false}
                  className={styles.priorityStripCard}
                  lang={locale === "fa" ? "fa" : "en"}
                >
                  <div className={styles.priorityStripImgWrap}>
                    {item.displayImage ? (
                      <img
                        src={item.displayImage}
                        alt=""
                        className={styles.priorityStripImg}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className={styles.priorityStripPlaceholder} aria-hidden>
                        {item.title.trim().slice(0, 1) || "?"}
                      </span>
                    )}
                  </div>
                  <div className={styles.priorityStripBody}>
                    {item.isPriority ? (
                      <span className={styles.priorityStripBadge}>{t("home.priorityBadge")}</span>
                    ) : null}
                    <div className={styles.priorityStripCardTitle}>{item.title}</div>
                    {item.category ? (
                      <div className={styles.priorityStripCat}>{item.category}</div>
                    ) : null}
                  </div>
                </Link>
              ))}
            </div>
            {priorityStrip.length > 1 ? (
              <button
                type="button"
                className={styles.priorityStripNavBtn}
                aria-label={t("city.priorityStripNextAria")}
                onClick={() => {
                  const el = priorityStripRef.current;
                  if (el) scrollPriorityStrip(el, "next");
                }}
              >
                <PriorityStripChevron
                  direction="right"
                  className={styles.priorityStripNavGlyph}
                />
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {departmentQuickFilters && departmentQuickFilters.length > 0 ? (
        <div className={styles.deptQuickStrip} role="list" aria-label={t("city.deptQuickAria")}>
          {departmentQuickFilters.map((d) => {
            const active =
              selectedDepartmentIds.length === 1 && selectedDepartmentIds[0] === d.id;
            return (
              <button
                key={d.id}
                type="button"
                role="listitem"
                className={`${styles.deptQuickItem} ${active ? styles.deptQuickItemActive : ""}`}
                onClick={() => {
                  if (active) {
                    setSelectedDepartmentIds([]);
                    if (advancedFiltersOpen) {
                      setDraftDepartmentIds([]);
                      setDraftCatCodes([]);
                    }
                  } else {
                    setSelectedDepartmentIds([d.id]);
                    setSelectedCatCodes([]);
                    if (advancedFiltersOpen) {
                      setDraftDepartmentIds([d.id]);
                      setDraftCatCodes([]);
                    }
                  }
                  setDirectoryQuery("");
                  setCategoryQuery("");
                  setOpenFilter(null);
                }}
                title={d.label}
                aria-label={d.label}
                aria-pressed={active}
              >
                <span className={styles.deptQuickImgWrap}>
                  {d.imageUrl ? (
                    <img
                      src={d.imageUrl}
                      alt=""
                      className={styles.deptQuickImg}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span className={styles.deptQuickFallback} aria-hidden>
                      {d.label.slice(0, 1)}
                    </span>
                  )}
                </span>
                <span className={styles.deptQuickCaption}>{d.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className={styles.columns} data-mobile-mode={mobileMode}>
        <aside className={styles.listCol}>
          <div className={styles.listHeader}>
            <div className={styles.listHeaderLeft}>
              {flagUrl ? (
                <img className={styles.flag} src={flagUrl} alt={listTitle} />
              ) : null}
              <div>
                <h1 className={styles.pageTitle}>{listTitle}</h1>
                <div className={styles.pageSubtitle}>
                  {relatedCategoryLabel && relatedCategoryLabel.trim()
                    ? `${t("city.relatedAds")} · ${relatedCategoryLabel.trim()}`
                    : t("city.relatedAds")}
                </div>
                {allCityAdsHref ? (
                  <Link href={allCityAdsHref} className={styles.allCityAdsLink} prefetch={false}>
                    {locale === "fa" ? "نمایش همه آگهی‌های شهر" : "View all city ads"}
                  </Link>
                ) : null}
              </div>
            </div>
            <p
              className={styles.cityIntro}
              lang={locale === "fa" ? "fa" : "en"}
            >
              {cityIntroText}
            </p>
            {popularCategories ? (
              <section className={styles.popularCategoriesPanel} aria-label={locale === "fa" ? "دسته های محبوب این شهر" : "Popular categories in this city"}>
                <h2 className={styles.popularCategoriesTitle}>
                  {locale === "fa" ? "دسته های محبوب این شهر" : "Popular categories in this city"}
                </h2>
                {popularCategories.length > 0 ? (
                  <div className={styles.popularCategoriesWrap}>
                    {popularCategories.slice(0, 20).map((cat) => (
                      <Link key={cat.value} href={cat.href} className={styles.popularCategoryChip} prefetch={false}>
                        {cat.label}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className={styles.popularCategoriesEmpty}>
                    {locale === "fa" ? "هنوز دسته فعالی برای این شهر ثبت نشده است." : "No active categories found for this city yet."}
                  </p>
                )}
              </section>
            ) : null}
          </div>

          <div ref={cardsSectionRef} className={styles.cards}>
            {displayedAds.length === 0 ? (
              <div
                className={`${styles.empty} ${
                  aiMatchedIds !== null ? styles.emptyAiSearch : ""
                }`}
              >
                <div className={styles.emptyTitle}>
                  {aiMatchedIds !== null
                    ? t("city.aiSearchEmptyTitle")
                    : t("city.emptyTitle")}
                </div>
                <div className={styles.emptyText}>
                  {aiMatchedIds !== null
                    ? t("city.aiSearchNoMatches")
                    : t("city.emptyBody")}
                </div>
              </div>
            ) : null}

            {paginatedListAds.map((ad) => {
              const visiblePromotions = getVisiblePromotionTypes(ad);
              const topPromotionType = getTopPromotionType(visiblePromotions);
              const approved = ad.approved === true;
              const paidValid =
                ad.paidAds === true &&
                typeof ad.paidAdsExpiresAtMs === "number" &&
                Number.isFinite(ad.paidAdsExpiresAtMs) &&
                ad.paidAdsExpiresAtMs > Date.now();
              const valid = approved; // valid to users (approved) regardless of paid
              const addedAgoLabel = clientUiReady
                ? formatAddedAgo(ad.createdAtMs, locale, t)
                : null;
              const visitBase =
                typeof ad.visits === "number" && Number.isFinite(ad.visits)
                  ? Math.max(0, Math.floor(ad.visits))
                  : 0;
              const visitCount =
                visitBase +
                (clientUiReady ? (visitBumps[ad.id] ?? 0) : 0);
              return (
              <article
                key={ad.id}
                className={`${styles.card} ${paidValid ? styles.cardPaidValid : valid ? styles.cardValid : ""}`}
                onMouseEnter={() => {
                  if (!allowListMapHover) return;
                  const locPt = ad.location;
                  if (
                    locPt &&
                    typeof locPt.lat === "number" &&
                    typeof locPt.lon === "number"
                  ) {
                    setHoveredListAdId(ad.id);
                  }
                }}
                onMouseLeave={() => {
                  if (!allowListMapHover) return;
                  setHoveredListAdId(null);
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  clearCardLongPressTimer();
                  if (!ad.link) return;
                  cardLongPressTimerRef.current = setTimeout(() => {
                    cardLongPressTimerRef.current = null;
                    suppressNextCardClickRef.current = true;
                    registerAdOpenedForId(ad.id);
                    router.push(loc(ad.link!));
                  }, CARD_LONG_PRESS_MS);
                }}
                onPointerUp={clearCardLongPressTimer}
                onPointerCancel={clearCardLongPressTimer}
                onPointerLeave={clearCardLongPressTimer}
                onClick={() => {
                  if (suppressNextCardClickRef.current) {
                    suppressNextCardClickRef.current = false;
                    return;
                  }
                  const href = ad.link?.trim();
                  if (href) {
                    registerAdOpenedForId(ad.id);
                    router.push(loc(href));
                    return;
                  }
                  setSelectedAdId(ad.id);
                  setMobileMode("map");
                }}
                style={
                  selectedAdId === ad.id
                    ? { outline: "2px solid rgba(15, 118, 110, 0.55)" }
                    : allowListMapHover && hoveredListAdId === ad.id
                      ? { outline: "2px solid rgba(15, 118, 110, 0.32)" }
                      : undefined
                }
              >
                <div className={styles.cardTop}>
                  <div className={styles.cardThumb}>
                    {topPromotionType ? (
                      <span
                        className={`${styles.cardPromoThumbBadge} ${PROMO_PILL_CLASS[topPromotionType]}`}
                        aria-label={t(PROMO_LABEL_KEY[topPromotionType])}
                      >
                        <CardPromoTypeIcon type={topPromotionType} />
                      </span>
                    ) : null}
                    {ad.image ? (
                      <img
                        className={styles.cardImg}
                        src={ad.image}
                        alt={ad.title}
                        loading="lazy"
                      />
                    ) : (
                      <div className={styles.cardImgPlaceholder} />
                    )}
                  </div>
                  <div className={styles.cardBody}>
                    <h3 className={styles.cardTitle}>{ad.title}</h3>
                    {ad.engName ? (
                      <p className={styles.cardEngName} dir="ltr" lang="en">
                        {ad.engName}
                      </p>
                    ) : null}
                    {ad.category ? (
                      <div className={styles.cardCat}>{ad.category}</div>
                    ) : null}
                    {typeof ad.price === "number" && Number.isFinite(ad.price) ? (
                      <div className={styles.cardPrice}>
                        {formatPrice(ad.price)}
                        {((ad.currencySymbol ?? cityCurrencySymbol).trim() && ` ${(ad.currencySymbol ?? cityCurrencySymbol).trim()}`) || ""}
                      </div>
                    ) : null}
                    {(ad.reviewCount ?? 0) > 0 && ad.reviewAvg != null ? (
                      <div className={styles.cardReviewRow}>
                        <StarRating
                          value={ad.reviewAvg}
                          size="sm"
                          ariaLabel={t("adDetail.reviewsOutOf", {
                            n: ad.reviewAvg.toFixed(1),
                          })}
                        />
                        <span className={styles.cardReviewCount}>
                          {(ad.reviewCount ?? 0) === 1
                            ? t("adDetail.reviewsCountOne")
                            : t("adDetail.reviewsCount", {
                                count: String(ad.reviewCount ?? 0),
                              })}
                        </span>
                      </div>
                    ) : null}
                    {Array.isArray(ad.subcats) && ad.subcats.length > 0 ? (
                      <div className={styles.cardSubcatWrap}>
                        {ad.subcats.map((tag) => (
                          <span key={`${ad.id}-${tag}`} className={styles.cardSubcatChip}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {ad.description ? (
                      <p className={styles.cardDesc}>{ad.description}</p>
                    ) : null}
                  </div>
                </div>

                <div className={styles.cardFoot}>
                    {ad.link || ad.phone || userEmail ? (
                      <div className={styles.cardFootActions}>
                        {ad.link ? (
                          <Link
                            className={`${styles.cardLink} ${styles.cardFootBtn}`}
                            href={loc(ad.link)}
                            prefetch={false}
                            title={t("city.view")}
                            aria-label={t("city.view")}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              registerAdOpenedForId(ad.id);
                            }}
                          >
                            <CardOpenIcon className={styles.cardLinkIcon} />
                          </Link>
                        ) : null}
                        {userEmail ? (
                          <button
                            type="button"
                            className={`${styles.cardBookmarkBtn} ${bookmarkedIds.has(ad.id) ? styles.cardBookmarkBtnOn : ""}`}
                            aria-pressed={bookmarkedIds.has(ad.id)}
                            title={
                              bookmarkedIds.has(ad.id)
                                ? t("city.bookmarkRemove")
                                : t("city.bookmarkAdd")
                            }
                            aria-label={
                              bookmarkedIds.has(ad.id)
                                ? t("city.bookmarkAriaRemove")
                                : t("city.bookmarkAriaAdd")
                            }
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              void toggleBookmark(ad.id, !bookmarkedIds.has(ad.id));
                            }}
                          >
                            <CardHeartIcon
                              className={styles.cardBookmarkIcon}
                              filled={bookmarkedIds.has(ad.id)}
                            />
                          </button>
                        ) : null}
                        {ad.phone ? (
                          revealedPhones[ad.id] ? (
                            <a
                              href={telHref(ad.phone)}
                              dir="ltr"
                              className={`${styles.cardPhoneLink} ${styles.cardPhoneLinkFoot}`}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {ad.phone}
                            </a>
                          ) : (
                            <button
                              type="button"
                              className={styles.cardPhoneShowBtn}
                              title={t("city.showPhoneTitle")}
                              aria-label={t("city.showPhoneAria", { title: ad.title })}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                setRevealedPhones((p) => ({ ...p, [ad.id]: true }));
                              }}
                            >
                              <CardRevealEyeIcon className={styles.cardPhoneShowBtnIcon} />
                              <span>{t("city.showPhone")}</span>
                            </button>
                          )
                        ) : null}
                      </div>
                    ) : null}
                    <div className={styles.cardFootMeta}>
                      <span className={styles.cardMetaItem} title={t("city.visitsTitle")}>
                        <CardMetaViewsIcon className={styles.cardMetaIcon} />
                        <span className={styles.cardVisits}>
                          {t("city.visits", { n: fmtN(visitCount) })}
                        </span>
                      </span>
                      {addedAgoLabel ? (
                        <div className={styles.cardMetaItem}>
                          <CardMetaTimeIcon className={styles.cardMetaIcon} />
                          <span className={styles.cardAddedAgo}>{addedAgoLabel}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
              </article>
              );
            })}

            {showAdsPagination ? (
              <nav
                className={styles.adsListPagination}
                aria-label={t("city.adsPaginationAria")}
              >
                <button
                  type="button"
                  className={styles.adsListPaginationBtn}
                  disabled={adsListSafePage <= 0}
                  aria-label={t("city.adsPaginationPrev")}
                  onClick={() => {
                    setAdsListPageIndex((p) => Math.max(0, p - 1));
                    requestAnimationFrame(() => {
                      cardsSectionRef.current?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                    });
                  }}
                >
                  ‹
                </button>
                <span className={styles.adsListPaginationStatus}>
                  {t("city.adsPaginationPage", {
                    current: fmtN(adsListSafePage + 1),
                    total: fmtN(adsListTotalPages),
                  })}
                </span>
                <button
                  type="button"
                  className={styles.adsListPaginationBtn}
                  disabled={adsListSafePage >= adsListTotalPages - 1}
                  aria-label={t("city.adsPaginationNext")}
                  onClick={() => {
                    setAdsListPageIndex((p) =>
                      Math.min(adsListTotalPages - 1, p + 1),
                    );
                    requestAnimationFrame(() => {
                      cardsSectionRef.current?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                    });
                  }}
                >
                  ›
                </button>
              </nav>
            ) : null}

            {showPromoteInListCards ? (
              <div
                className={`${styles.promoteCalloutStrip} ${styles.promoteCalloutAfterPager}`}
              >
                <section
                  className={styles.promoteCallout}
                  aria-labelledby="city-promote-heading"
                >
                  <h2
                    id="city-promote-heading"
                    className={styles.promoteCalloutTitle}
                  >
                    {t("city.promoteHeading")}
                  </h2>
                  <p className={styles.promoteCalloutIntro}>
                    {t("city.promoteIntro")}
                  </p>
                  <ul className={styles.promoteCalloutList}>
                    <li className={styles.promoteCalloutItem}>
                      <span className={styles.promoteCalloutItemTitle}>
                        {t("city.promoteFeaturedTitle")}
                      </span>
                      <span className={styles.promoteCalloutItemBody}>
                        {t("city.promoteFeaturedBody")}
                      </span>
                    </li>
                    <li className={styles.promoteCalloutItem}>
                      <span className={styles.promoteCalloutItemTitle}>
                        {t("city.promoteSpotlightTitle")}
                      </span>
                      <span className={styles.promoteCalloutItemBody}>
                        {t("city.promoteSpotlightBody")}
                      </span>
                    </li>
                    <li className={styles.promoteCalloutItem}>
                      <span className={styles.promoteCalloutItemTitle}>
                        {t("city.promoteBumpTitle")}
                      </span>
                      <span className={styles.promoteCalloutItemBody}>
                        {t("city.promoteBumpBody")}
                      </span>
                    </li>
                    <li className={styles.promoteCalloutItem}>
                      <span className={styles.promoteCalloutItemTitle}>
                        {t("city.promoteUrgentTitle")}
                      </span>
                      <span className={styles.promoteCalloutItemBody}>
                        {t("city.promoteUrgentBody")}
                      </span>
                    </li>
                  </ul>
                  <div className={styles.promoteCalloutActions}>
                    <Link href={loc("/add-ad")} className={styles.promoteCalloutCta}>
                      {t("city.promoteCtaPost")}
                    </Link>
                    <Link
                      href={loc("/workspace")}
                      className={styles.promoteCalloutCtaSecondary}
                    >
                      {t("city.promoteCtaWorkspace")}
                    </Link>
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </aside>

        <section className={styles.mapCol} aria-label={t("city.mapColAria")}>
          <div className={styles.mapAuthBar}>
            {authLoading ? (
              <div className={styles.mapAuthInner}>
                <div className={styles.mapAuthStatus} aria-live="polite">
                  {t("city.mapChecking")}
                </div>
                <Link href={loc("/add-ad")} className={styles.mapAuthAddLink}>
                  {t("city.postAd")}
                </Link>
              </div>
            ) : !authConfigured ? (
              <div className={styles.mapAuthInner}>
                <Link href={loc("/add-ad")} className={styles.mapAuthAddLink}>
                  {t("city.postAd")}
                </Link>
                <button
                  type="button"
                  className={styles.mapAuthIconBtn}
                  disabled
                  aria-disabled="true"
                  aria-label={t("city.signInDisabledAria")}
                  title={t("city.signInTitle")}
                >
                  <MapSignInIcon className={styles.mapAuthIconGlyph} />
                </button>
              </div>
            ) : userEmail ? (
              <div className={styles.mapAuthInner}>
                <div className={styles.mapUserWelcome} aria-live="polite">
                  {userDisplayName
                    ? t("city.welcomeNamed", { name: userDisplayName })
                    : t("city.welcomePlain")}
                </div>
                <Link href={loc("/add-ad")} className={styles.mapAuthAddLink}>
                  {t("city.postAd")}
                </Link>
                <Link href={loc("/workspace")} className={styles.mapAuthAddLink}>
                  {t("city.myWorkspace")}
                </Link>
                <button
                  type="button"
                  className={styles.mapAuthIconBtn}
                  onClick={handleLogout}
                  aria-label={t("city.signOutAria")}
                  title={t("city.signOutTitle")}
                >
                  <MapLogoutIcon className={styles.mapAuthIconGlyph} />
                </button>
              </div>
            ) : (
              <div className={styles.mapAuthInner}>
                <p className={styles.mapAuthPromo}>
                  {t("city.signInHint")}
                </p>
                <Link href={loc("/add-ad")} className={styles.mapAuthAddLink}>
                  {t("city.postAd")}
                </Link>
                <button
                  type="button"
                  className={styles.mapAuthIconBtn}
                  onClick={handleLoginWithGmail}
                  aria-label={t("city.signInAria")}
                  title={t("city.signInTitle")}
                >
                  <MapSignInIcon className={styles.mapAuthIconGlyph} />
                </button>
              </div>
            )}
          </div>
          <GoogleMapView
            points={mapPoints}
            center={cityCenter}
            className={styles.map}
            activeAdId={selectedAdId}
            hoverAdId={hoveredListAdId}
            onAdSelect={setSelectedAdId}
            onAdOpened={registerAdOpenedForId}
            popupViewLabel={t("city.view")}
            popupIsRtl={locale === "fa"}
            mapsApiKey={googleMapsApiKey}
          />
          <p
            className={styles.mapCityIntro}
            lang={locale === "fa" ? "fa" : "en"}
          >
            {cityIntroText}
          </p>

          {showPromoteInMapFooter ? (
            <div
              className={`${styles.promoteCalloutStrip} ${styles.promoteCalloutMapFooter}`}
            >
              <section
                className={styles.promoteCallout}
                aria-label={t("city.promoteHeading")}
              >
                <h2 className={styles.promoteCalloutTitle}>
                  {t("city.promoteHeading")}
                </h2>
                <p className={styles.promoteCalloutIntro}>
                  {t("city.promoteIntro")}
                </p>
                <ul className={styles.promoteCalloutList}>
                  <li className={styles.promoteCalloutItem}>
                    <span className={styles.promoteCalloutItemTitle}>
                      {t("city.promoteFeaturedTitle")}
                    </span>
                    <span className={styles.promoteCalloutItemBody}>
                      {t("city.promoteFeaturedBody")}
                    </span>
                  </li>
                  <li className={styles.promoteCalloutItem}>
                    <span className={styles.promoteCalloutItemTitle}>
                      {t("city.promoteSpotlightTitle")}
                    </span>
                    <span className={styles.promoteCalloutItemBody}>
                      {t("city.promoteSpotlightBody")}
                    </span>
                  </li>
                  <li className={styles.promoteCalloutItem}>
                    <span className={styles.promoteCalloutItemTitle}>
                      {t("city.promoteBumpTitle")}
                    </span>
                    <span className={styles.promoteCalloutItemBody}>
                      {t("city.promoteBumpBody")}
                    </span>
                  </li>
                  <li className={styles.promoteCalloutItem}>
                    <span className={styles.promoteCalloutItemTitle}>
                      {t("city.promoteUrgentTitle")}
                    </span>
                    <span className={styles.promoteCalloutItemBody}>
                      {t("city.promoteUrgentBody")}
                    </span>
                  </li>
                </ul>
                <div className={styles.promoteCalloutActions}>
                  <Link href={loc("/add-ad")} className={styles.promoteCalloutCta}>
                    {t("city.promoteCtaPost")}
                  </Link>
                  <Link
                    href={loc("/workspace")}
                    className={styles.promoteCalloutCtaSecondary}
                  >
                    {t("city.promoteCtaWorkspace")}
                  </Link>
                </div>
              </section>
            </div>
          ) : null}
        </section>
      </div>

      {aiSearchOpen ? (
        <div
          className={styles.aiSearchOverlay}
          role="presentation"
          onClick={() => {
            if (!aiBusy) setAiSearchOpen(false);
          }}
        >
          <div
            className={styles.aiSearchModal}
            role="dialog"
            aria-modal="true"
            aria-busy={aiBusy}
            aria-labelledby="ai-search-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.aiSearchHero}>
              <span className={styles.aiSearchHeroIconWrap} aria-hidden>
                <AiSparkleIcon className={styles.aiSearchHeroIcon} />
              </span>
            </div>
            <h2 id="ai-search-dialog-title" className={styles.aiSearchModalTitle}>
              {t("city.aiSearchModalTitle")}
            </h2>
            <p className={styles.aiSearchLead}>{t("city.aiSearchLead")}</p>
            <textarea
              className={styles.aiSearchTextarea}
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              placeholder={t("city.aiSearchPlaceholder")}
              disabled={aiBusy}
              rows={3}
              autoFocus
            />
            {aiBusy ? (
              <div className={styles.aiSearchThinking} aria-live="polite">
                <div className={styles.aiSearchThinkingRow}>
                  <span className={styles.aiSearchThinkingLabel}>
                    {t("city.aiSearchThinking")}
                  </span>
                  <span className={styles.aiSearchDots} aria-hidden="true">
                    <span className={styles.aiSearchDot} />
                    <span className={styles.aiSearchDot} />
                    <span className={styles.aiSearchDot} />
                  </span>
                </div>
              </div>
            ) : null}
            <p className={styles.aiSearchPrivacy}>{t("city.aiSearchPrivacy")}</p>
            <div className={styles.aiSearchActions}>
              <button
                type="button"
                className={styles.aiSearchBtnSecondary}
                onClick={() => {
                  if (!aiBusy) setAiSearchOpen(false);
                }}
                disabled={aiBusy}
              >
                {t("city.aiSearchCancel")}
              </button>
              <button
                type="button"
                className={styles.aiSearchBtnPrimary}
                onClick={() => void runAiSearch()}
                disabled={aiBusy || !aiQuery.trim()}
              >
                {aiBusy ? t("city.aiSearchBusy") : t("city.aiSearchSubmit")}
              </button>
            </div>
            {aiError ? (
              <p className={styles.aiSearchErr} role="alert">
                {aiError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <footer className={styles.cityPageFooter}>
        <Link href={loc("/help")} className={styles.cityPageFooterHelp}>
          {t("city.helpFooterLink")}
        </Link>
      </footer>
    </div>
  );
}

