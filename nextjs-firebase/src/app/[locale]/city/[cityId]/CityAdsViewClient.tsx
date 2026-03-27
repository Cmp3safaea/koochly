"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./CityAdsViewClient.module.css";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import KoochlyLogo from "../../../images/Koochly-Logo.png";
import { recordAdVisit } from "../../../../lib/recordAdVisit";
import { telHref, type Locale } from "@koochly/shared";
import { getAuthClientOrNull, getGoogleProvider } from "../../../../lib/firebaseClient";
import { useI18n, useLocalizedHref } from "../../../../i18n/client";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import ActivityLogClient from "../../activity/ActivityLogClient";

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

function CityPinIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M8.25 20c2.72-2.26 4.4-4.44 4.4-6.8a4.4 4.4 0 1 0-8.8 0c0 2.36 1.68 4.54 4.4 6.8Z"
        fill="currentColor"
        opacity="0.9"
      />
      <circle cx="8.25" cy="13.2" r="1.45" fill="white" />
      <path
        d="M13.2 8.2h6.2m0 0-1.9-1.9m1.9 1.9-1.9 1.9M19.4 15.8h-6.2m0 0 1.9-1.9m-1.9 1.9 1.9 1.9"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
}: {
  cityTitle: string;
  /** Persian city name from Firestore (`city_fa`) for copy; falls back to `cityTitle` if empty. */
  cityFa?: string;
  /** Country display names from Firestore for intro copy (`country_fa` / `country_eng`). */
  countryFa?: string;
  countryEng?: string;
  flagUrl?: string;
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
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { t, locale } = useI18n();
  const loc = useLocalizedHref();
  const [mobileMode, setMobileMode] = useState<"list" | "map">("list");
  const [selectedAdId, setSelectedAdId] = useState<string | null>(null);
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
  const [menuOpen, setMenuOpen] = useState(false);
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
  const [priorityPool, setPriorityPool] = useState<PriorityApiAd[]>([]);
  const directoryRef = useRef<HTMLDivElement | null>(null);
  const categoryRef = useRef<HTMLDivElement | null>(null);
  const cityRef = useRef<HTMLDivElement | null>(null);
  const priorityStripRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const cardLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextCardClickRef = useRef(false);
  const prevPathnameRef = useRef<string | null>(null);
  const prevVisitsSigRef = useRef<string | null>(null);

  useEffect(() => {
    setCityJumpId(currentCityId ?? "");
  }, [currentCityId, pathname]);

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
      setMenuOpen(false);
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
      setMenuOpen(false);
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

  const filteredCategoryOptions = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase();
    if (!q) return visibleCategoryOptions;
    return visibleCategoryOptions.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [visibleCategoryOptions, categoryQuery]);

  useEffect(() => {
    const allowed = new Set(visibleCategoryOptions.map((opt) => opt.value));
    setSelectedCatCodes((prev) => prev.filter((code) => allowed.has(code)));
  }, [visibleCategoryOptions]);

  useEffect(() => {
    setSelectedDepartmentIds(initialDeptList(initialDepartmentId));
    setSelectedCatCodes(initialCatList(initialCatCode));
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
      if (cityRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpenFilter(null);
      setMenuOpen(false);
      setCityPickerOpen(false);
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

  const filteredAds = useMemo(
    () => {
      const q = searchQuery.trim().toLowerCase();
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
        return true;
      });

      const visitTotal = (card: CityAdCard) => {
        const v =
          typeof card.visits === "number" && Number.isFinite(card.visits)
            ? Math.max(0, Math.floor(card.visits))
            : 0;
        return v + (visitBumps[card.id] ?? 0);
      };

      out.sort((a, b) => {
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
    ],
  );

  const mapPoints = useMemo(
    () => {
      const out: Array<{
        id: string;
        title: string;
        link: string | null;
        image: string | null;
        lat: number;
        lon: number;
      }> = [];

      for (const a of filteredAds) {
        if (!a.location) continue;
        if (
          typeof a.location.lat !== "number" ||
          typeof a.location.lon !== "number"
        )
          continue;

        out.push({
          id: a.id,
          title: a.title,
          link: a.link ?? null,
          image: a.image ?? null,
          lat: a.location.lat,
          lon: a.location.lon,
        });
      }

      return out;
    },
    [filteredAds],
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
  const selectedDirectorySummary =
    selectedDepartmentIds.length === 0
      ? t("city.allDepartments")
      : selectedDepartmentIds.length === 1
        ? (visibleDirectoryOptions.find((d) => d.value === selectedDepartmentIds[0])?.label ??
          t("city.nDepartmentsSelected", { n: fmtN(1) }))
        : t("city.nDepartmentsSelected", { n: fmtN(selectedDepartmentIds.length) });
  const selectedCategorySummary =
    selectedCatCodes.length === 0
      ? t("city.allCategories")
      : selectedCatCodes.length === 1
        ? (visibleCategoryOptions.find((c) => c.value === selectedCatCodes[0])?.label ??
          t("city.oneCategorySelected"))
        : t("city.nCategoriesSelected", { n: fmtN(selectedCatCodes.length) });

  const hasActiveFilters =
    selectedDepartmentIds.length > 0 ||
    selectedCatCodes.length > 0 ||
    searchQuery.trim().length > 0 ||
    listSortKey !== "date" ||
    listSortDir !== "desc";

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
      <div className={styles.filterBar}>
        <div className={styles.filterBlockCompact} ref={menuRef}>
          <button
            type="button"
            className={styles.menuIconBtn}
            aria-label={t("city.menuAria")}
            title={t("city.menuTitle")}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            <span className={styles.menuIcon} aria-hidden="true">
              ☰
            </span>
          </button>
          {menuOpen ? (
            <div className={styles.menuDropdown}>
              <Link
                href={loc("/")}
                className={styles.menuItem}
                prefetch={false}
                onClick={() => setMenuOpen(false)}
              >
                {t("city.changeCity")}
              </Link>
              <Link
                href={loc("/#about")}
                className={styles.menuItem}
                prefetch={false}
                onClick={() => setMenuOpen(false)}
              >
                {t("city.about")}
              </Link>
              <Link
                href={loc("/#help")}
                className={styles.menuItem}
                prefetch={false}
                onClick={() => setMenuOpen(false)}
              >
                {t("city.help")}
              </Link>
            </div>
          ) : null}
        </div>
        {cityOptions && cityOptions.length > 0 ? (
          <div className={`${styles.filterBlock} ${styles.filterBlockCity}`} ref={cityRef}>
            <button
              type="button"
              className={styles.cityQuickBtn}
              aria-label={t("city.changeCity")}
              aria-expanded={cityPickerOpen}
              onClick={() => setCityPickerOpen((v) => !v)}
            >
              <CityPinIcon className={styles.cityQuickIcon} />
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
        <div className={styles.filterBlockCompact}>
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

        <div className={`${styles.filterBlock} ${styles.filterBlockSearch}`}>
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

        <div className={`${styles.filterBlockCompact} ${styles.sortBtnGroup}`}>
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

        <div className={`${styles.filterBlock} ${styles.filterBlockWide}`} ref={directoryRef}>
          <div
            className={`${styles.filterTrigger} ${
              selectedDepartmentIds.length > 1 ? styles.filterTriggerDense : ""
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
              {selectedDepartmentIds.length === 0 ? (
                <span className={styles.multiPlaceholder}>{selectedDirectorySummary}</span>
              ) : (
                selectedDepartmentIds.map((id) => {
                  const label = visibleDirectoryOptions.find((o) => o.value === id)?.label ?? id;
                  return (
                    <span key={id} className={styles.multiChip}>
                      {label}
                      <button
                        type="button"
                        className={styles.multiChipRemove}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDepartmentIds((prev) => prev.filter((v) => v !== id));
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
                placeholder={selectedDepartmentIds.length === 0 ? t("city.deptSearchPh") : ""}
              />
            </div>
            <div className={styles.multiActions}>
              {selectedDepartmentIds.length > 0 ? (
                <button
                  type="button"
                  className={styles.clearBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedDepartmentIds([]);
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
                const checked = selectedDepartmentIds.includes(opt.value);
                const thumb = deptImageById.get(opt.value) ?? null;
                return (
                  <label key={opt.value} className={styles.filterCheckboxRow}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={
                        !checked && selectedDepartmentIds.length >= MAX_MULTI_SELECTION
                      }
                      onChange={() =>
                        setSelectedDepartmentIds((prev) =>
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

        <div className={`${styles.filterBlock} ${styles.filterBlockWide}`} ref={categoryRef}>
          <div
            className={`${styles.filterTrigger} ${
              selectedCatCodes.length > 1 ? styles.filterTriggerDense : ""
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
              {selectedCatCodes.length === 0 ? (
                <span className={styles.multiPlaceholder}>{selectedCategorySummary}</span>
              ) : (
                selectedCatCodes.map((code) => {
                  const label =
                    visibleCategoryOptions.find((o) => o.value === code)?.label ?? code;
                  return (
                    <span key={code} className={styles.multiChip}>
                      {label}
                      <button
                        type="button"
                        className={styles.multiChipRemove}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCatCodes((prev) => prev.filter((v) => v !== code));
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
                placeholder={selectedCatCodes.length === 0 ? t("city.catSearchPh") : ""}
              />
            </div>
            <div className={styles.multiActions}>
              {selectedCatCodes.length > 0 ? (
                <button
                  type="button"
                  className={styles.clearBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedCatCodes([]);
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
              {filteredCategoryOptions.length === 0 ? (
                <div className={styles.filterEmpty}>{t("city.noCatFound")}</div>
              ) : null}
              {filteredCategoryOptions.map((opt) => {
                const checked = selectedCatCodes.includes(opt.value);
                return (
                  <label key={opt.value} className={styles.filterCheckboxRow}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && selectedCatCodes.length >= MAX_MULTI_SELECTION}
                      onChange={() =>
                        setSelectedCatCodes((prev) =>
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
        <div className={styles.filterLogoWrap}>
          <Link href={loc("/")}>
            <Image
              src={KoochlyLogo}
              alt=""
              className={styles.filterLogo}
              priority
            />
          </Link>
          {flagUrl ? <img src={flagUrl} alt="" className={styles.filterCityFlag} /> : null}
          <span className={styles.filterWordmark} lang={locale === "fa" ? "fa" : "en"}>
            {`${t("city.brand")} · ${introCityName}`}
          </span>
        </div>
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
                  } else {
                    setSelectedDepartmentIds([d.id]);
                    setSelectedCatCodes([]);
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

          <div className={styles.cards}>
            {filteredAds.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyTitle}>{t("city.emptyTitle")}</div>
                <div className={styles.emptyText}>
                  {t("city.emptyBody")}
                </div>
              </div>
            ) : null}

            {filteredAds.map((ad) => {
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
                  setSelectedAdId(ad.id);
                  setMobileMode("map");
                }}
                style={
                  selectedAdId === ad.id
                    ? { outline: "2px solid rgba(15, 118, 110, 0.55)" }
                    : undefined
                }
              >
                <div className={styles.cardTop}>
                  <div className={styles.cardThumb}>
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
                      <span
                        className={styles.cardVisits}
                        title={t("city.visitsTitle")}
                      >
                        {t("city.visits", { n: fmtN(visitCount) })}
                      </span>
                      {addedAgoLabel ? (
                        <div className={styles.cardAddedAgo}>{addedAgoLabel}</div>
                      ) : null}
                    </div>
                  </div>
              </article>
              );
            })}
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
            onAdSelect={setSelectedAdId}
            onAdOpened={registerAdOpenedForId}
          />
          <p
            className={styles.mapCityIntro}
            lang={locale === "fa" ? "fa" : "en"}
          >
            {cityIntroText}
          </p>
        </section>
      </div>
    </div>
  );
}

