"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { GoogleMap, Marker, useLoadScript } from "@react-google-maps/api";
import { useI18n, useLocalizedHref } from "../../../i18n/client";
import styles from "./AdminPage.module.css";

type CategoryRow = {
  code: string;
  label: string;
  engName?: string;
  subcategories?: string[];
  usageCount?: number;
};
type DepartmentRow = {
  id: string;
  label: string;
  department: string;
  engName: string;
  image?: string;
  usageCount?: number;
  categories: CategoryRow[];
};
type CityRow = {
  id: string;
  active: boolean;
  city_eng: string;
  city_fa: string;
  country_eng: string;
  country_fa: string;
  flag_url: string;
  latlng: { lat: number; lng: number } | null;
  order: number | null;
  usageCount?: number;
};
type PendingAdRow = {
  id: string;
  title: string;
  engName?: string;
  city: string;
  city_eng?: string;
  dept: string;
  cat: string;
  cat_code?: string;
  subcat: string[];
  phone: string;
  details: string;
  address?: string;
  website?: string;
  instagram?: string;
  location?: { lat: number; lng: number } | null;
  images?: string[];
  paidAds?: boolean;
  paidAdsExpiresAtMs?: number | null;
  seq: number | null;
  createdAtMs: number;
  image: string | null;
};
type ManagedAdRow = {
  id: string;
  seq: number | null;
  title: string;
  engName: string;
  details: string;
  address: string;
  phone: string;
  website: string;
  instagram: string;
  cat: string;
  cat_code: string;
  dept: string;
  city: string;
  city_eng: string;
  approved: boolean;
  subcat: string[];
  images?: string[];
  location?: { lat: number; lng: number } | null;
  image: string | null;
  createdAtMs: number;
  paidAds?: boolean;
  paidAdsExpiresAtMs?: number | null;
};
type EventRow = {
  id: string;
  event: string;
  desc: string;
  event_image: string;
  city: string;
  city_eng: string;
  venue: string;
  link: string;
  startAtMs: number | null;
  endAtMs: number | null;
  createdAtMs: number;
};
type ActivityBucket = { key: string; count: number };
type ActivitySummary = {
  totalEvents: number;
  uniqueUsers: number;
  todayEvents: number;
  byPage: ActivityBucket[];
  byCity: ActivityBucket[];
  byDepartment: ActivityBucket[];
  byCategory: ActivityBucket[];
  recent: Array<{ uid: string; page: string; city: string; atMs: number; day: string }>;
};

const EMPTY_CATEGORY: CategoryRow = { code: "", label: "", engName: "", subcategories: [] };
const GOOGLE_MAP_LIBRARIES: [] = [];

function categoryCodeFromLabel(label: string, fallbackIndex: number): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `cat-${fallbackIndex + 1}`;
}

function normKey(v: string): string {
  return v.trim().toLowerCase();
}

function toDateTimeLocalInput(ms: number | null): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${min}`;
}

function dateTimeLocalToMs(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

export default function AdminClient({
  googleMapsApiKey = "",
}: {
  googleMapsApiKey?: string;
} = {}) {
  const { t, locale } = useI18n();
  const loc = useLocalizedHref();

  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [departmentFa, setDepartmentFa] = useState("");
  const [departmentEn, setDepartmentEn] = useState("");
  const [departmentImage, setDepartmentImage] = useState("");
  const [tab, setTab] = useState<
    "dashboard" | "directory" | "city" | "adsApproval" | "adsManage" | "events"
  >("dashboard");
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [categorySearch, setCategorySearch] = useState("");
  const [subcategoryDrafts, setSubcategoryDrafts] = useState<Record<number, string>>({});
  const [isDragOverImage, setIsDragOverImage] = useState(false);
  const [cities, setCities] = useState<CityRow[]>([]);
  const [selectedCityId, setSelectedCityId] = useState<string | null>(null);
  const [isNewCity, setIsNewCity] = useState(false);
  const [cityActive, setCityActive] = useState(false);
  const [cityEng, setCityEng] = useState("");
  const [cityFa, setCityFa] = useState("");
  const [countryEng, setCountryEng] = useState("");
  const [countryFa, setCountryFa] = useState("");
  const [flagUrl, setFlagUrl] = useState("");
  const [cityOrder, setCityOrder] = useState("");
  const [cityLat, setCityLat] = useState("");
  const [cityLng, setCityLng] = useState("");
  const [pendingAds, setPendingAds] = useState<PendingAdRow[]>([]);
  const [selectedPendingAdId, setSelectedPendingAdId] = useState<string | null>(null);
  const [managedAds, setManagedAds] = useState<ManagedAdRow[]>([]);
  const [adsQuery, setAdsQuery] = useState("");
  const [selectedAdId, setSelectedAdId] = useState<string | null>(null);
  const [adTitle, setAdTitle] = useState("");
  const [adEngName, setAdEngName] = useState("");
  const [adDetails, setAdDetails] = useState("");
  const [adAddress, setAdAddress] = useState("");
  const [adPhone, setAdPhone] = useState("");
  const [adWebsite, setAdWebsite] = useState("");
  const [adInstagram, setAdInstagram] = useState("");
  const [adCat, setAdCat] = useState("");
  const [adCatCode, setAdCatCode] = useState("");
  const [adDept, setAdDept] = useState("");
  const [adCity, setAdCity] = useState("");
  const [adCityEng, setAdCityEng] = useState("");
  const [adApproved, setAdApproved] = useState(false);
  const [adSubcatDraft, setAdSubcatDraft] = useState("");
  const [adSubcat, setAdSubcat] = useState<string[]>([]);
  const [adImages, setAdImages] = useState<string[]>([]);
  const [adLat, setAdLat] = useState("");
  const [adLng, setAdLng] = useState("");
  const [adPaidAds, setAdPaidAds] = useState(false);
  const [adPaidExpiresAtMs, setAdPaidExpiresAtMs] = useState<number | null>(null);
  const [paidTermPickerOpen, setPaidTermPickerOpen] = useState(false);
  const [activitySummary, setActivitySummary] = useState<ActivitySummary | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isNewEvent, setIsNewEvent] = useState(false);
  const [eventsQuery, setEventsQuery] = useState("");
  const [eventsCityFilter, setEventsCityFilter] = useState("");
  const [eventTitle, setEventTitle] = useState("");
  const [eventDesc, setEventDesc] = useState("");
  const [eventCity, setEventCity] = useState("");
  const [eventCityEng, setEventCityEng] = useState("");
  const [eventImage, setEventImage] = useState("");
  const [eventVenue, setEventVenue] = useState("");
  const [eventLink, setEventLink] = useState("");
  const [eventStartAtInput, setEventStartAtInput] = useState("");
  const [eventEndAtInput, setEventEndAtInput] = useState("");
  const cityMapApiKey =
    googleMapsApiKey.trim() ||
    (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "");
  const { isLoaded: cityMapLoaded } = useLoadScript({
    googleMapsApiKey: cityMapApiKey,
    libraries: GOOGLE_MAP_LIBRARIES,
    id: "koochly-admin-city-map",
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isNewEventRef = useRef(false);
  useEffect(() => {
    isNewEventRef.current = isNewEvent;
  }, [isNewEvent]);

  /** Directory response matches this UI locale (labels are locale-specific). */
  const directoryDataLocaleRef = useRef<string | null>(null);
  /** Cities list fetched at least once this session (API is not locale-specific). */
  const citiesHydratedRef = useRef(false);

  useEffect(() => {
    directoryDataLocaleRef.current = null;
  }, [locale]);

  const selected = useMemo(
    () => departments.find((d) => d.id === selectedId) ?? null,
    [departments, selectedId],
  );

  const loadAll = async (preferredDeptId?: string | null) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/directory?locale=${encodeURIComponent(locale)}`);
      const json = (await res.json().catch(() => ({}))) as {
        departments?: DepartmentRow[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? t("admin.loadErr"));
      const rows = Array.isArray(json.departments) ? json.departments : [];
      setDepartments(rows);
      if (rows.length > 0) {
        const keepId = preferredDeptId ?? selectedId;
        const picked = (keepId && rows.find((r) => r.id === keepId)) || rows[0];
        setSelectedId(picked.id);
        setDepartmentFa(picked.department ?? "");
        setDepartmentEn(picked.engName ?? "");
        setDepartmentImage(picked.image ?? "");
        setCategories(picked.categories ?? []);
      } else {
        setSelectedId(null);
        setDepartmentFa("");
        setDepartmentEn("");
        setDepartmentImage("");
        setCategories([]);
      }
      directoryDataLocaleRef.current = locale;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.loadErr"));
    }
  };

  const loadCities = async (preferredCityId?: string | null) => {
    setError(null);
    try {
      const res = await fetch("/api/admin/cities");
      const json = (await res.json().catch(() => ({}))) as { cities?: CityRow[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? t("admin.loadErr"));
      const rows = Array.isArray(json.cities) ? json.cities : [];
      setCities(rows);
      if (rows.length > 0) {
        const keepId = preferredCityId ?? selectedCityId;
        const picked = (keepId && rows.find((r) => r.id === keepId)) || rows[0];
        if (!picked) return;
        setSelectedCityId(picked.id);
        setCityActive(picked.active);
        setCityEng(picked.city_eng ?? "");
        setCityFa(picked.city_fa ?? "");
        setCountryEng(picked.country_eng ?? "");
        setCountryFa(picked.country_fa ?? "");
        setFlagUrl(picked.flag_url ?? "");
        setCityOrder(picked.order !== null && picked.order !== undefined ? String(picked.order) : "");
        setCityLat(
          picked.latlng && Number.isFinite(picked.latlng.lat) ? String(picked.latlng.lat) : "",
        );
        setCityLng(
          picked.latlng && Number.isFinite(picked.latlng.lng) ? String(picked.latlng.lng) : "",
        );
      } else {
        setSelectedCityId(null);
        setCityActive(false);
        setCityEng("");
        setCityFa("");
        setCountryEng("");
        setCountryFa("");
        setFlagUrl("");
        setCityOrder("");
        setCityLat("");
        setCityLng("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.loadErr"));
    } finally {
      citiesHydratedRef.current = true;
    }
  };

  const loadPendingAds = async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/ads/pending");
      const json = (await res.json().catch(() => ({}))) as { ads?: PendingAdRow[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? t("admin.loadErr"));
      const rows = Array.isArray(json.ads) ? json.ads : [];
      setPendingAds(rows);
      if (rows.length > 0) {
        const picked =
          (selectedPendingAdId && rows.find((x) => x.id === selectedPendingAdId)) || rows[0];
        setSelectedPendingAdId(picked.id);
      } else {
        setSelectedPendingAdId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.loadErr"));
    }
  };

  const loadManagedAds = async (query?: string) => {
    setError(null);
    try {
      const q = (query ?? adsQuery).trim();
      const url = q
        ? `/api/admin/ads?q=${encodeURIComponent(q)}&limit=50`
        : "/api/admin/ads?limit=50";
      const res = await fetch(url);
      const json = (await res.json().catch(() => ({}))) as { ads?: ManagedAdRow[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? t("admin.loadErr"));
      const rows = Array.isArray(json.ads) ? json.ads : [];
      setManagedAds(rows);
      if (rows.length > 0) {
        const picked = selectedAdId ? rows.find((x) => x.id === selectedAdId) ?? rows[0] : rows[0];
        setSelectedAdId(picked.id);
      } else {
        setSelectedAdId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.loadErr"));
    }
  };

  const loadEvents = async (
    q?: string,
    city?: string,
    opts?: { skipAutoSelect?: boolean; selectId?: string | null },
  ) => {
    setError(null);
    try {
      const search = (q ?? eventsQuery).trim();
      const cityQ = (city ?? eventsCityFilter).trim();
      const params = new URLSearchParams();
      params.set("limit", "200");
      if (search) params.set("q", search);
      if (cityQ) params.set("city", cityQ);
      const res = await fetch(`/api/admin/events?${params.toString()}`);
      const json = (await res.json().catch(() => ({}))) as { events?: EventRow[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? t("admin.loadErr"));
      const rows = Array.isArray(json.events) ? json.events : [];
      setEvents(rows);
      if (opts?.skipAutoSelect) return;
      const prefer = opts?.selectId?.trim() ?? "";
      if (prefer && rows.some((x) => x.id === prefer)) {
        setSelectedEventId(prefer);
        setIsNewEvent(false);
        return;
      }
      if (rows.length > 0) {
        setSelectedEventId((prev) => {
          if (prev && rows.some((x) => x.id === prev)) return prev;
          return rows[0].id;
        });
        setIsNewEvent(false);
      } else {
        setSelectedEventId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.loadErr"));
    }
  };

  const loadActivitySummary = async () => {
    try {
      const res = await fetch("/api/admin/activitylog/summary");
      const json = (await res.json().catch(() => ({}))) as {
        summary?: ActivitySummary;
      };
      if (!res.ok) return;
      setActivitySummary(json.summary ?? null);
    } catch {
      // keep dashboard usable even if activity summary fails
      setActivitySummary(null);
    }
  };

  useEffect(() => {
    const needDirectory = directoryDataLocaleRef.current !== locale;
    const needCities = !citiesHydratedRef.current;

    if (tab === "dashboard") {
      const tasks: Promise<unknown>[] = [loadActivitySummary()];
      if (needDirectory) tasks.push(loadAll());
      if (needCities) tasks.push(loadCities());
      void Promise.all(tasks);
      return;
    }
    if (tab === "directory") {
      if (!needDirectory) return;
      void loadAll();
      return;
    }
    if (tab === "city") {
      if (!needCities) return;
      void loadCities();
      return;
    }
    if (tab === "adsApproval") {
      const tasks: Promise<unknown>[] = [loadPendingAds()];
      if (needCities) tasks.push(loadCities());
      if (needDirectory) tasks.push(loadAll());
      void Promise.all(tasks);
      return;
    }
    if (tab === "adsManage") {
      const tasks: Promise<unknown>[] = [loadManagedAds(adsQuery)];
      if (needCities) tasks.push(loadCities());
      if (needDirectory) tasks.push(loadAll());
      void Promise.all(tasks);
      return;
    }
    if (tab === "events") {
      const tasks: Promise<unknown>[] = [loadEvents("", "", { skipAutoSelect: false })];
      if (needCities) tasks.push(loadCities());
      void Promise.all(tasks);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, tab]);

  useEffect(() => {
    if (tab !== "adsManage") return;
    const timer = window.setTimeout(() => {
      void loadManagedAds(adsQuery);
    }, 280);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adsQuery]);

  useEffect(() => {
    if (tab !== "events") return;
    const timer = window.setTimeout(() => {
      void loadEvents(eventsQuery, eventsCityFilter, {
        skipAutoSelect: isNewEventRef.current,
      });
    }, 280);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsQuery, eventsCityFilter]);

  useEffect(() => {
    if (!selected) return;
    setDepartmentFa(selected.department ?? "");
    setDepartmentEn(selected.engName ?? "");
    setDepartmentImage(selected.image ?? "");
    setCategories(selected.categories ?? []);
    setCategorySearch("");
    setIsNew(false);
  }, [selected]);

  const selectedCity = useMemo(
    () => cities.find((c) => c.id === selectedCityId) ?? null,
    [cities, selectedCityId],
  );
  const selectedManagedAd = useMemo(
    () => managedAds.find((a) => a.id === selectedAdId) ?? null,
    [managedAds, selectedAdId],
  );
  const selectedPendingAd = useMemo(
    () => pendingAds.find((a) => a.id === selectedPendingAdId) ?? null,
    [pendingAds, selectedPendingAdId],
  );
  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );
  const activeEditingAdId = tab === "adsApproval" ? selectedPendingAdId : selectedAdId;
  const cityLatNum = useMemo(() => {
    const n = Number(cityLat);
    return Number.isFinite(n) ? n : null;
  }, [cityLat]);
  const cityLngNum = useMemo(() => {
    const n = Number(cityLng);
    return Number.isFinite(n) ? n : null;
  }, [cityLng]);
  const cityMarker = useMemo(() => {
    if (cityLatNum === null || cityLngNum === null) return null;
    return { lat: cityLatNum, lng: cityLngNum };
  }, [cityLatNum, cityLngNum]);
  const cityMapCenter = cityMarker ?? { lat: 51.5074, lng: -0.1278 };
  const adLatNum = useMemo(() => {
    const n = Number(adLat);
    return Number.isFinite(n) ? n : null;
  }, [adLat]);
  const adLngNum = useMemo(() => {
    const n = Number(adLng);
    return Number.isFinite(n) ? n : null;
  }, [adLng]);
  const adMarker = useMemo(() => {
    if (adLatNum === null || adLngNum === null) return null;
    return { lat: adLatNum, lng: adLngNum };
  }, [adLatNum, adLngNum]);
  const adMapCenter = adMarker ?? cityMapCenter;
  const orderNum = useMemo(() => {
    const n = Number(cityOrder);
    if (!Number.isFinite(n)) return 5;
    return Math.min(10, Math.max(0, Math.round(n)));
  }, [cityOrder]);
  const orderLevel = useMemo(() => {
    if (orderNum <= 3) return t("admin.orderHigh");
    if (orderNum <= 5) return t("admin.orderMid");
    return t("admin.orderLow");
  }, [orderNum, t]);
  const filteredCategoryRows = useMemo(() => {
    return categories.map((row, idx) => ({ row, idx }));
  }, [categories]);
  const globalCategoryMatches = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return [];
    const out: Array<{
      deptId: string;
      deptLabel: string;
      categoryLabel: string;
      categoryCode: string;
    }> = [];
    departments.forEach((dept) => {
      (dept.categories ?? []).forEach((cat) => {
        const label = (cat.label ?? "").toLowerCase();
        const eng = (cat.engName ?? "").toLowerCase();
        const code = (cat.code ?? "").toLowerCase();
        if (label.includes(q) || eng.includes(q) || code.includes(q)) {
          out.push({
            deptId: dept.id,
            deptLabel: dept.label,
            categoryLabel: cat.label,
            categoryCode: cat.code,
          });
        }
      });
    });
    return out.slice(0, 80);
  }, [departments, categorySearch]);
  const sortedCitiesByUsage = useMemo(
    () => [...cities].sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0)),
    [cities],
  );
  const sortedDepartmentsByUsage = useMemo(
    () => [...departments].sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0)),
    [departments],
  );
  const dashboardTotals = useMemo(() => {
    const totalAdsByDept = departments.reduce((sum, d) => sum + (d.usageCount ?? 0), 0);
    const totalCats = departments.reduce((sum, d) => sum + (d.categories?.length ?? 0), 0);
    return {
      totalAdsByDept,
      totalCities: cities.length,
      totalDepartments: departments.length,
      totalCats,
    };
  }, [cities.length, departments]);
  const adDeptOptions = useMemo(
    () =>
      departments.map((d) => ({
        id: d.id,
        label: d.label || d.department || d.engName || d.id,
      })),
    [departments],
  );
  const selectedAdDeptRow = useMemo(() => {
    const normalized = adDept.trim().toLowerCase();
    return (
      departments.find((d) => {
        const label = (d.label || d.department || d.engName || "").trim().toLowerCase();
        return label === normalized;
      }) ?? null
    );
  }, [departments, adDept]);
  const adCategoryOptions = useMemo(
    () => (selectedAdDeptRow?.categories ?? []).map((c) => ({ code: c.code, label: c.label, subcategories: c.subcategories ?? [] })),
    [selectedAdDeptRow],
  );
  const selectedAdCategory = useMemo(
    () => adCategoryOptions.find((c) => c.code === adCatCode) ?? null,
    [adCategoryOptions, adCatCode],
  );
  const departmentLabelById = useMemo(() => {
    const out = new Map<string, string>();
    departments.forEach((d) => {
      out.set(normKey(d.id), d.label || d.department || d.engName || d.id);
    });
    return out;
  }, [departments]);
  const categoryLabelByCode = useMemo(() => {
    const out = new Map<string, string>();
    departments.forEach((d) => {
      (d.categories ?? []).forEach((c) => {
        if (c.code) out.set(normKey(c.code), c.label || c.code);
      });
    });
    return out;
  }, [departments]);

  useEffect(() => {
    if (!selectedCity) return;
    setCityActive(selectedCity.active);
    setCityEng(selectedCity.city_eng ?? "");
    setCityFa(selectedCity.city_fa ?? "");
    setCountryEng(selectedCity.country_eng ?? "");
    setCountryFa(selectedCity.country_fa ?? "");
    setFlagUrl(selectedCity.flag_url ?? "");
    setCityOrder(
      selectedCity.order !== null && selectedCity.order !== undefined
        ? String(selectedCity.order)
        : "",
    );
    setCityLat(
      selectedCity.latlng && Number.isFinite(selectedCity.latlng.lat)
        ? String(selectedCity.latlng.lat)
        : "",
    );
    setCityLng(
      selectedCity.latlng && Number.isFinite(selectedCity.latlng.lng)
        ? String(selectedCity.latlng.lng)
        : "",
    );
    setIsNewCity(false);
  }, [selectedCity]);

  useEffect(() => {
    if (!selectedManagedAd) return;
    setAdTitle(selectedManagedAd.title ?? "");
    setAdEngName(selectedManagedAd.engName ?? "");
    setAdDetails(selectedManagedAd.details ?? "");
    setAdAddress(selectedManagedAd.address ?? "");
    setAdPhone(selectedManagedAd.phone ?? "");
    setAdWebsite(selectedManagedAd.website ?? "");
    setAdInstagram(selectedManagedAd.instagram ?? "");
    setAdCat(selectedManagedAd.cat ?? "");
    setAdCatCode(selectedManagedAd.cat_code ?? "");
    setAdDept(selectedManagedAd.dept ?? "");
    setAdCity(selectedManagedAd.city ?? "");
    setAdCityEng(selectedManagedAd.city_eng ?? "");
    setAdApproved(selectedManagedAd.approved === true);
    setAdPaidAds(selectedManagedAd.paidAds === true);
    setAdPaidExpiresAtMs(
      typeof selectedManagedAd.paidAdsExpiresAtMs === "number" &&
        Number.isFinite(selectedManagedAd.paidAdsExpiresAtMs)
        ? selectedManagedAd.paidAdsExpiresAtMs
        : null,
    );
    setAdSubcat(Array.isArray(selectedManagedAd.subcat) ? selectedManagedAd.subcat : []);
    setAdImages(
      Array.isArray(selectedManagedAd.images)
        ? selectedManagedAd.images.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : selectedManagedAd.image
          ? [selectedManagedAd.image]
          : [],
    );
    setAdLat(
      selectedManagedAd.location && Number.isFinite(selectedManagedAd.location.lat)
        ? String(selectedManagedAd.location.lat)
        : "",
    );
    setAdLng(
      selectedManagedAd.location && Number.isFinite(selectedManagedAd.location.lng)
        ? String(selectedManagedAd.location.lng)
        : "",
    );
    setAdSubcatDraft("");
    setPaidTermPickerOpen(false);
  }, [selectedManagedAd]);

  useEffect(() => {
    if (isNewEvent) return;
    if (!selectedEvent) {
      if (!selectedEventId) {
        setEventTitle("");
        setEventDesc("");
        setEventCity("");
        setEventCityEng("");
        setEventImage("");
        setEventVenue("");
        setEventLink("");
        setEventStartAtInput("");
        setEventEndAtInput("");
      }
      return;
    }
    setEventTitle(selectedEvent.event ?? "");
    setEventDesc(selectedEvent.desc ?? "");
    setEventCity(selectedEvent.city ?? "");
    setEventCityEng(selectedEvent.city_eng ?? "");
    setEventImage(selectedEvent.event_image ?? "");
    setEventVenue(selectedEvent.venue ?? "");
    setEventLink(selectedEvent.link ?? "");
    setEventStartAtInput(toDateTimeLocalInput(selectedEvent.startAtMs));
    setEventEndAtInput(toDateTimeLocalInput(selectedEvent.endAtMs));
  }, [selectedEvent, selectedEventId, isNewEvent]);

  useEffect(() => {
    if (!selectedPendingAd) return;
    setAdTitle(selectedPendingAd.title ?? "");
    setAdEngName(selectedPendingAd.engName ?? "");
    setAdDetails(selectedPendingAd.details ?? "");
    setAdAddress(selectedPendingAd.address ?? "");
    setAdPhone(selectedPendingAd.phone ?? "");
    setAdWebsite(selectedPendingAd.website ?? "");
    setAdInstagram(selectedPendingAd.instagram ?? "");
    setAdCat(selectedPendingAd.cat ?? "");
    setAdCatCode(selectedPendingAd.cat_code ?? "");
    setAdDept(selectedPendingAd.dept ?? "");
    setAdCity(selectedPendingAd.city ?? "");
    setAdCityEng(selectedPendingAd.city_eng ?? selectedPendingAd.city ?? "");
    setAdApproved(false);
    setAdPaidAds(selectedPendingAd.paidAds === true);
    setAdPaidExpiresAtMs(
      typeof selectedPendingAd.paidAdsExpiresAtMs === "number" &&
        Number.isFinite(selectedPendingAd.paidAdsExpiresAtMs)
        ? selectedPendingAd.paidAdsExpiresAtMs
        : null,
    );
    setAdSubcat(Array.isArray(selectedPendingAd.subcat) ? selectedPendingAd.subcat : []);
    setAdImages(
      Array.isArray(selectedPendingAd.images)
        ? selectedPendingAd.images.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        : selectedPendingAd.image
          ? [selectedPendingAd.image]
          : [],
    );
    setAdLat(
      selectedPendingAd.location && Number.isFinite(selectedPendingAd.location.lat)
        ? String(selectedPendingAd.location.lat)
        : "",
    );
    setAdLng(
      selectedPendingAd.location && Number.isFinite(selectedPendingAd.location.lng)
        ? String(selectedPendingAd.location.lng)
        : "",
    );
    setAdSubcatDraft("");
    setPaidTermPickerOpen(false);
  }, [selectedPendingAd]);

  const onCreateNew = () => {
    setIsNew(true);
    setSelectedId(null);
    setDepartmentFa("");
    setDepartmentEn("");
    setDepartmentImage("");
    setCategories([]);
    setCategorySearch("");
    setSubcategoryDrafts({});
    setStatus(null);
    setError(null);
  };

  const onCreateNewCity = () => {
    setIsNewCity(true);
    setSelectedCityId(null);
    setCityActive(false);
    setCityEng("");
    setCityFa("");
    setCountryEng("");
    setCountryFa("");
    setFlagUrl("");
    setCityOrder("5");
    setCityLat("");
    setCityLng("");
    setStatus(null);
    setError(null);
  };

  const onSaveDepartment = async () => {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      if (!departmentFa.trim() && !departmentEn.trim()) {
        throw new Error(t("admin.fillDept"));
      }

      if (isNew) {
        const res = await fetch("/api/admin/directory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            department: departmentFa.trim(),
            engName: departmentEn.trim(),
            image: departmentImage.trim(),
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
        if (!res.ok) throw new Error(json.error ?? t("admin.saveErr"));
        await loadAll(json.id ?? null);
        if (json.id) setSelectedId(json.id);
      } else if (selectedId) {
        const res = await fetch(`/api/admin/directory/${encodeURIComponent(selectedId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            department: departmentFa.trim(),
            engName: departmentEn.trim(),
            image: departmentImage.trim(),
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? t("admin.saveErr"));
        await loadAll(selectedId);
      }
      setStatus(t("admin.saved"));
      setIsNew(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.saveErr"));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteDepartment = async () => {
    if (!selectedId) return;
    if (!window.confirm(t("admin.deleteConfirm"))) return;
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/directory/${encodeURIComponent(selectedId)}`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? t("admin.deleteErr"));
      await loadAll(null);
      setStatus(t("admin.deleted"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.deleteErr"));
    } finally {
      setBusy(false);
    }
  };

  const onSaveCategories = async () => {
    if (!selectedId) {
      setError(t("admin.saveDeptFirst"));
      return;
    }
    const cleaned = categories
      .map((c, idx) => {
        const label = c.label.trim();
        const currentCode = c.code.trim();
        const code = currentCode || categoryCodeFromLabel(label, idx);
        const engName = (c.engName ?? "").trim();
        const subcategories = Array.isArray(c.subcategories)
          ? c.subcategories.map((s) => s.trim()).filter(Boolean)
          : [];
        return { code, label, engName, subcategories };
      })
      .filter((c) => c.label);

    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/directory/${encodeURIComponent(selectedId)}/categories`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categories: cleaned }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? t("admin.saveCategoryErr"));
      await loadAll(selectedId);
      setStatus(t("admin.savedCategories"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.saveCategoryErr"));
    } finally {
      setBusy(false);
    }
  };

  const onSaveCity = async () => {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      if (!cityEng.trim() && !cityFa.trim()) {
        throw new Error(t("admin.fillCity"));
      }
      const latNum = cityLat.trim() ? Number(cityLat.trim()) : null;
      const lngNum = cityLng.trim() ? Number(cityLng.trim()) : null;
      const orderNum = cityOrder.trim() ? Number(cityOrder.trim()) : null;
      const payload = {
        active: cityActive,
        city_eng: cityEng.trim(),
        city_fa: cityFa.trim(),
        country_eng: countryEng.trim(),
        country_fa: countryFa.trim(),
        flag_url: flagUrl.trim(),
        order: orderNum,
        latlng:
          latNum !== null && Number.isFinite(latNum) && lngNum !== null && Number.isFinite(lngNum)
            ? { lat: latNum, lng: lngNum }
            : null,
      };
      if (isNewCity) {
        const res = await fetch("/api/admin/cities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
        if (!res.ok) throw new Error(json.error ?? t("admin.saveErr"));
        await loadCities(json.id ?? null);
      } else if (selectedCityId) {
        const res = await fetch(`/api/admin/cities/${encodeURIComponent(selectedCityId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? t("admin.saveErr"));
        await loadCities(selectedCityId);
      }
      setStatus(t("admin.saved"));
      setIsNewCity(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.saveErr"));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteCity = async () => {
    if (!selectedCityId) return;
    if (!window.confirm(t("admin.deleteConfirmCity"))) return;
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/cities/${encodeURIComponent(selectedCityId)}`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? t("admin.deleteErr"));
      await loadCities(null);
      setStatus(t("admin.deleted"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.deleteErr"));
    } finally {
      setBusy(false);
    }
  };

  const onApproveAd = async (adId: string) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/admin/ads/${encodeURIComponent(adId)}/approve`, {
        method: "PATCH",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? t("admin.approveAdErr"));
      setPendingAds((prev) => prev.filter((ad) => ad.id !== adId));
      setStatus(t("admin.approvedAd"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.approveAdErr"));
    } finally {
      setBusy(false);
    }
  };

  const addAdSubcatTag = () => {
    const tag = adSubcatDraft.trim();
    if (!tag) return;
    setAdSubcat((prev) =>
      prev.some((x) => x.toLowerCase() === tag.toLowerCase()) ? prev : [...prev, tag],
    );
    setAdSubcatDraft("");
  };

  const removeAdSubcatTag = (tag: string) => {
    setAdSubcat((prev) => prev.filter((x) => x !== tag));
  };

  const uploadAdImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/admin/ads/upload-image", {
          method: "POST",
          body: form,
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string; url?: string };
        if (!res.ok || !json.url) throw new Error(json.error ?? t("admin.imageUploadErr"));
        uploaded.push(json.url);
      }
      if (uploaded.length > 0) {
        setAdImages((prev) => [...prev, ...uploaded].slice(0, 12));
        setStatus(t("admin.imageUploaded"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.imageUploadErr"));
    } finally {
      setBusy(false);
    }
  };

  const removeAdImage = (url: string) => {
    setAdImages((prev) => prev.filter((x) => x !== url));
  };

  const onSaveAd = async () => {
    if (!activeEditingAdId) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/admin/ads/${encodeURIComponent(activeEditingAdId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: adTitle,
          engName: adEngName,
          details: adDetails,
          address: adAddress,
          phone: adPhone,
          website: adWebsite,
          instagram: adInstagram,
          cat: adCat,
          cat_code: adCatCode,
          dept: adDept,
          city: adCity,
          city_eng: adCityEng,
          approved: adApproved,
          subcat: adSubcat,
          images: adImages,
          paidAds: adPaidAds,
          paidAdsExpiresAtMs: adPaidAds && adPaidExpiresAtMs ? adPaidExpiresAtMs : null,
          location:
            adLat.trim() && adLng.trim()
              ? { lat: Number(adLat), lng: Number(adLng) }
              : null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? t("admin.saveErr"));
      setStatus(t("admin.saved"));
      await loadManagedAds();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.saveErr"));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteAd = async () => {
    if (!activeEditingAdId) return;
    if (!window.confirm(t("admin.deleteConfirmAd"))) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/admin/ads/${encodeURIComponent(activeEditingAdId)}`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? t("admin.deleteErr"));
      setStatus(t("admin.deletedAd"));
      await loadManagedAds();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.deleteErr"));
    } finally {
      setBusy(false);
    }
  };

  const onCreateNewEvent = () => {
    setIsNewEvent(true);
    setSelectedEventId(null);
    setEventTitle("");
    setEventDesc("");
    setEventCity("");
    setEventCityEng("");
    setEventImage("");
    setEventVenue("");
    setEventLink("");
    setEventStartAtInput("");
    setEventEndAtInput("");
    setStatus(null);
    setError(null);
  };

  const uploadEventImage = async (file: File) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/events/upload-image", {
        method: "POST",
        body: form,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; url?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? t("admin.imageUploadErr"));
      setEventImage(json.url);
      setStatus(t("admin.imageUploaded"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.imageUploadErr"));
    } finally {
      setBusy(false);
    }
  };

  const onSaveEvent = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      if (!eventTitle.trim()) {
        throw new Error(t("admin.eventTitleRequired"));
      }
      const startAtMs = dateTimeLocalToMs(eventStartAtInput);
      const endAtMs = dateTimeLocalToMs(eventEndAtInput);
      const body = {
        event: eventTitle.trim(),
        desc: eventDesc.trim(),
        event_image: eventImage.trim(),
        city: eventCity.trim(),
        city_eng: eventCityEng.trim(),
        venue: eventVenue.trim(),
        link: eventLink.trim(),
        startAtMs,
        endAtMs,
      };
      if (isNewEvent) {
        const res = await fetch("/api/admin/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
        if (!res.ok) throw new Error(json.error ?? t("admin.saveErr"));
        setStatus(t("admin.saved"));
        setIsNewEvent(false);
        await loadEvents(eventsQuery, eventsCityFilter, {
          skipAutoSelect: false,
          selectId: json.id ?? null,
        });
      } else if (selectedEventId) {
        const res = await fetch(`/api/admin/events/${encodeURIComponent(selectedEventId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? t("admin.saveErr"));
        setStatus(t("admin.saved"));
        await loadEvents(eventsQuery, eventsCityFilter, {
          skipAutoSelect: true,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.saveErr"));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteEvent = async () => {
    if (!selectedEventId || isNewEvent) return;
    if (!window.confirm(t("admin.deleteConfirmEvent"))) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/admin/events/${encodeURIComponent(selectedEventId)}`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? t("admin.deleteErr"));
      setStatus(t("admin.deletedEvent"));
      await loadEvents(eventsQuery, eventsCityFilter, { skipAutoSelect: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.deleteErr"));
    } finally {
      setBusy(false);
    }
  };

  const uploadDepartmentImage = async (file: File) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/directory/upload-image", {
        method: "POST",
        body: form,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; url?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? t("admin.imageUploadErr"));
      setDepartmentImage(json.url);
      setStatus(t("admin.imageUploaded"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.imageUploadErr"));
    } finally {
      setBusy(false);
    }
  };

  const addSubcategoryTag = (idx: number) => {
    const draft = (subcategoryDrafts[idx] ?? "").trim();
    if (!draft) return;
    setCategories((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const current = Array.isArray(row.subcategories) ? row.subcategories : [];
        if (current.some((s) => s.toLowerCase() === draft.toLowerCase())) return row;
        return { ...row, subcategories: [...current, draft] };
      }),
    );
    setSubcategoryDrafts((prev) => ({ ...prev, [idx]: "" }));
  };

  const removeSubcategoryTag = (idx: number, tag: string) => {
    setCategories((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const current = Array.isArray(row.subcategories) ? row.subcategories : [];
        return { ...row, subcategories: current.filter((s) => s !== tag) };
      }),
    );
  };

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t("admin.title")}</h1>
        <p className={styles.sub}>{t("admin.sub")}</p>
        <Link href={loc("/")} className={styles.backLink}>
          {t("admin.backHome")}
        </Link>
      </header>

      <section className={styles.tabs}>
        <button
          type="button"
          className={tab === "dashboard" ? styles.tabActive : styles.tab}
          onClick={() => setTab("dashboard")}
        >
          {t("admin.optionDashboard")}
        </button>
        <button
          type="button"
          className={tab === "directory" ? styles.tabActive : styles.tab}
          onClick={() => setTab("directory")}
        >
          {t("admin.optionDirectory")}
        </button>
        <button
          type="button"
          className={tab === "city" ? styles.tabActive : styles.tab}
          onClick={() => setTab("city")}
        >
          {t("admin.optionCity")}
        </button>
        <button
          type="button"
          className={tab === "adsApproval" ? styles.tabActive : styles.tab}
          onClick={() => setTab("adsApproval")}
        >
          {t("admin.optionAdsApproval")}
        </button>
        <button
          type="button"
          className={tab === "adsManage" ? styles.tabActive : styles.tab}
          onClick={() => setTab("adsManage")}
        >
          {t("admin.optionAdsManage")}
        </button>
        <button
          type="button"
          className={tab === "events" ? styles.tabActive : styles.tab}
          onClick={() => setTab("events")}
        >
          {t("admin.optionEvents")}
        </button>
      </section>

      {error ? <p className={styles.err}>{error}</p> : null}
      {status ? <p className={styles.ok}>{status}</p> : null}

      <section className={tab === "dashboard" ? styles.gridDashboard : styles.grid}>
        {tab === "dashboard" ? (
          <section className={styles.editorPane}>
            <h2>{t("admin.dashboardTitle")}</h2>
            <div className={styles.dashboardStats}>
              <article className={styles.dashboardCard}>
                <h3>{t("admin.dashboardTotalCities")}</h3>
                <strong>{dashboardTotals.totalCities}</strong>
              </article>
              <article className={styles.dashboardCard}>
                <h3>{t("admin.dashboardTotalDepartments")}</h3>
                <strong>{dashboardTotals.totalDepartments}</strong>
              </article>
              <article className={styles.dashboardCard}>
                <h3>{t("admin.dashboardTotalCategories")}</h3>
                <strong>{dashboardTotals.totalCats}</strong>
              </article>
              <article className={styles.dashboardCard}>
                <h3>{t("admin.dashboardAdsCount")}</h3>
                <strong>{dashboardTotals.totalAdsByDept}</strong>
              </article>
              <article className={styles.dashboardCard}>
                <h3>{t("admin.dashboardActivityEvents")}</h3>
                <strong>{activitySummary?.totalEvents ?? 0}</strong>
              </article>
              <article className={styles.dashboardCard}>
                <h3>{t("admin.dashboardActivityUsers")}</h3>
                <strong>{activitySummary?.uniqueUsers ?? 0}</strong>
              </article>
              <article className={styles.dashboardCard}>
                <h3>{t("admin.dashboardActivityToday")}</h3>
                <strong>{activitySummary?.todayEvents ?? 0}</strong>
              </article>
            </div>

            <div className={styles.dashboardGrid2}>
              <section className={styles.dashboardPanel}>
                <h3>{t("admin.dashboardAdsByCity")}</h3>
                <div className={styles.dashboardList}>
                  {sortedCitiesByUsage.map((c) => (
                    <div key={c.id} className={styles.dashboardRow}>
                      <span>{c.city_fa || c.city_eng || c.id}</span>
                      <span className={styles.usageBadge}>{c.usageCount ?? 0}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className={styles.dashboardPanel}>
                <h3>{t("admin.dashboardAdsByDepartment")}</h3>
                <div className={styles.dashboardList}>
                  {sortedDepartmentsByUsage.map((d) => (
                    <div key={d.id} className={styles.dashboardRow}>
                      <span>{d.label}</span>
                      <span className={styles.usageBadge}>{d.usageCount ?? 0}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className={styles.dashboardPanel}>
              <h3>{t("admin.dashboardAdsByCategory")}</h3>
              <div className={styles.dashboardCatWrap}>
                {sortedDepartmentsByUsage.map((d) => (
                  <div key={`cats-${d.id}`} className={styles.dashboardCatGroup}>
                    <div className={styles.dashboardCatHead}>
                      <span>{d.label}</span>
                      <span className={styles.usageBadge}>{d.usageCount ?? 0}</span>
                    </div>
                    <div className={styles.dashboardList}>
                      {(d.categories ?? [])
                        .slice()
                        .sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0))
                        .map((cat) => (
                          <div key={`${d.id}-${cat.code}`} className={styles.dashboardRow}>
                            <span>{cat.label}</span>
                            <span className={styles.usageBadgeSmall}>{cat.usageCount ?? 0}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <div className={styles.dashboardGrid2}>
              <section className={styles.dashboardPanel}>
                <h3>{t("admin.dashboardActivityByPage")}</h3>
                <div className={styles.dashboardList}>
                  {(activitySummary?.byPage ?? []).map((row) => (
                    <div key={`ap-${row.key}`} className={styles.dashboardRow}>
                      <span>{row.key}</span>
                      <span className={styles.usageBadge}>{row.count}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className={styles.dashboardPanel}>
                <h3>{t("admin.dashboardActivityByCity")}</h3>
                <div className={styles.dashboardList}>
                  {(activitySummary?.byCity ?? []).map((row) => (
                    <div key={`ac-${row.key}`} className={styles.dashboardRow}>
                      <span>{row.key}</span>
                      <span className={styles.usageBadge}>{row.count}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
            <div className={styles.dashboardGrid2}>
              <section className={styles.dashboardPanel}>
                <h3>{t("admin.dashboardActivityByDepartment")}</h3>
                <div className={styles.dashboardList}>
                  {(activitySummary?.byDepartment ?? []).map((row) => (
                    <div key={`ad-${row.key}`} className={styles.dashboardRow}>
                      <span>{departmentLabelById.get(normKey(row.key)) ?? row.key}</span>
                      <span className={styles.usageBadge}>{row.count}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className={styles.dashboardPanel}>
                <h3>{t("admin.dashboardActivityByCategory")}</h3>
                <div className={styles.dashboardList}>
                  {(activitySummary?.byCategory ?? []).map((row) => (
                    <div key={`ag-${row.key}`} className={styles.dashboardRow}>
                      <span>{categoryLabelByCode.get(normKey(row.key)) ?? row.key}</span>
                      <span className={styles.usageBadge}>{row.count}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </section>
        ) : null}
        {tab === "directory" ? (
          <>
        <aside className={styles.listPane}>
          <div className={styles.paneHead}>
            <h2>{t("admin.departments")}</h2>
            <button type="button" onClick={onCreateNew} disabled={busy}>
              {t("admin.newDepartment")}
            </button>
          </div>
          <div className={styles.list}>
            {departments.map((d) => (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                className={`${styles.listItem} ${selectedId === d.id ? styles.listItemActive : ""}`}
                onClick={() => setSelectedId(d.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(d.id);
                  }
                }}
              >
                {d.image ? <img src={d.image} alt="" className={styles.deptIcon} /> : null}
                <span className={styles.deptTitle}>
                  {d.label}
                  <span className={styles.usageBadge}>{d.usageCount ?? 0}</span>
                </span>
                <div className={styles.treeWrap}>
                  <span className={styles.treeHead}>{t("admin.categories")}</span>
                  {d.categories.length > 0 ? (
                    <ul className={styles.treeList}>
                      {d.categories.map((cat) => (
                        <li key={`${d.id}-${cat.code}`} className={styles.treeItem}>
                          <span className={styles.treeLabel}>{cat.label}</span>
                          <span className={styles.usageBadgeSmall}>{cat.usageCount ?? 0}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className={styles.treeEmpty}>-</span>
                  )}
                </div>
              </div>
            ))}
            {departments.length === 0 ? (
              <p className={styles.info}>{t("admin.emptyDepartments")}</p>
            ) : null}
          </div>
        </aside>

        <section className={styles.editorPane}>
          <h2>{t("admin.departmentEditor")}</h2>
          <div className={styles.formRow}>
            <label>{t("admin.departmentFa")}</label>
            <input
              value={departmentFa}
              onChange={(e) => setDepartmentFa(e.target.value)}
              placeholder={t("admin.departmentFaPh")}
            />
          </div>
          <div className={styles.formRow}>
            <label>{t("admin.departmentEn")}</label>
            <input
              value={departmentEn}
              onChange={(e) => setDepartmentEn(e.target.value)}
              placeholder={t("admin.departmentEnPh")}
            />
          </div>
          <div className={styles.formRow}>
            <div
              className={`${styles.imageDropZone} ${isDragOverImage ? styles.imageDropZoneActive : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOverImage(true);
              }}
              onDragLeave={() => setIsDragOverImage(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOverImage(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void uploadDepartmentImage(file);
              }}
            >
              <span>{t("admin.imageDropHint")}</span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                {t("admin.imagePick")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className={styles.hiddenFileInput}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadDepartmentImage(file);
                  e.currentTarget.value = "";
                }}
              />
            </div>
            {departmentImage.trim() ? (
              <img src={departmentImage.trim()} alt="" className={styles.departmentImagePreview} />
            ) : null}
          </div>
          <div className={styles.actions}>
            <button type="button" onClick={onSaveDepartment} disabled={busy}>
              {t("admin.saveDepartment")}
            </button>
            {!isNew && selectedId ? (
              <button
                type="button"
                className={`${styles.danger} ${(selected?.usageCount ?? 0) > 0 ? styles.blockedDelete : ""}`}
                onClick={onDeleteDepartment}
                disabled={busy || (selected?.usageCount ?? 0) > 0}
                title={(selected?.usageCount ?? 0) > 0 ? t("admin.deleteBlockedInUse") : undefined}
              >
                {t("admin.deleteDepartment")}
              </button>
            ) : null}
          </div>

          <hr className={styles.sep} />

          <h2>{t("admin.categories")}</h2>
          <div className={styles.formRow}>
            <input
              value={categorySearch}
              onChange={(e) => setCategorySearch(e.target.value)}
              placeholder={t("admin.categorySearchPh")}
            />
          </div>
          {categorySearch.trim() ? (
            <div className={styles.categorySearchGlobalResults}>
              {globalCategoryMatches.length === 0 ? (
                <p className={styles.info}>{t("admin.noCategorySearchResult")}</p>
              ) : (
                globalCategoryMatches.map((m) => (
                  <button
                    key={`${m.deptId}-${m.categoryCode}`}
                    type="button"
                    className={styles.categorySearchResultBtn}
                    onClick={() => {
                      setSelectedId(m.deptId);
                      setCategorySearch("");
                    }}
                  >
                    <span>{m.categoryLabel}</span>
                    <small>{m.deptLabel}</small>
                  </button>
                ))
              )}
            </div>
          ) : null}
          <div className={styles.categoryList}>
            {filteredCategoryRows.map(({ row: c, idx }) => (
              <div key={`${c.code}-${idx}`} className={styles.categoryRow}>
                <input
                  value={c.label}
                  onChange={(e) =>
                    setCategories((prev) =>
                      prev.map((row, i) => (i === idx ? { ...row, label: e.target.value } : row)),
                    )
                  }
                  placeholder={t("admin.categoryLabelPh")}
                />
                <input
                  value={c.engName ?? ""}
                  onChange={(e) =>
                    setCategories((prev) =>
                      prev.map((row, i) =>
                        i === idx ? { ...row, engName: e.target.value } : row,
                      ),
                    )
                  }
                  placeholder={t("admin.categoryEngNamePh")}
                />
                <div className={styles.tagEditor}>
                  <div className={styles.tagList}>
                    {(c.subcategories ?? []).map((tag) => (
                      <span key={`${idx}-${tag}`} className={styles.tagItem}>
                        {tag}
                        <button
                          type="button"
                          className={styles.tagRemove}
                          onClick={() => removeSubcategoryTag(idx, tag)}
                          aria-label={`${t("admin.remove")} ${tag}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className={styles.tagInputRow}>
                    <input
                      value={subcategoryDrafts[idx] ?? ""}
                      onChange={(e) =>
                        setSubcategoryDrafts((prev) => ({ ...prev, [idx]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === ",") {
                          e.preventDefault();
                          addSubcategoryTag(idx);
                        }
                      }}
                      placeholder={t("admin.categorySubcatsPh")}
                    />
                    <button type="button" onClick={() => addSubcategoryTag(idx)}>
                      +
                    </button>
                  </div>
                </div>
                <span className={styles.usageBadgeSmall}>{c.usageCount ?? 0}</span>
                <button
                  type="button"
                  className={`${styles.miniDanger} ${(c.usageCount ?? 0) > 0 ? styles.blockedDelete : ""}`}
                  onClick={() => setCategories((prev) => prev.filter((_, i) => i !== idx))}
                  disabled={(c.usageCount ?? 0) > 0}
                  title={(c.usageCount ?? 0) > 0 ? t("admin.deleteBlockedInUse") : undefined}
                >
                  {t("admin.remove")}
                </button>
              </div>
            ))}
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              onClick={() => setCategories((prev) => [...prev, { ...EMPTY_CATEGORY }])}
              disabled={busy}
            >
              {t("admin.addCategory")}
            </button>
            <button type="button" onClick={onSaveCategories} disabled={busy}>
              {t("admin.saveCategories")}
            </button>
          </div>
        </section>
          </>
        ) : null}
        {tab === "city" ? (
          <>
            <aside className={styles.listPane}>
              <div className={styles.paneHead}>
                <h2>{t("admin.cities")}</h2>
                <button type="button" onClick={onCreateNewCity} disabled={busy}>
                  {t("admin.newCity")}
                </button>
              </div>
              <div className={styles.list}>
                {cities.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`${styles.listItem} ${styles.cityCard} ${selectedCityId === c.id ? styles.listItemActive : ""}`}
                    onClick={() => setSelectedCityId(c.id)}
                  >
                    <span className={styles.cityTop}>
                      {c.flag_url ? <img src={c.flag_url} alt="" className={styles.cityFlag} /> : null}
                      <span className={styles.deptTitle}>
                        {c.city_fa || c.city_eng || c.id}
                        <span className={styles.usageBadge}>{c.usageCount ?? 0}</span>
                      </span>
                    </span>
                    <small className={styles.cityCountry}>{c.country_fa || c.country_eng}</small>
                    <small className={styles.cityEnglish}>{c.city_eng}</small>
                  </button>
                ))}
                {cities.length === 0 ? <p className={styles.info}>{t("admin.emptyCities")}</p> : null}
              </div>
            </aside>

            <section className={styles.editorPane}>
              <h2>{t("admin.cityEditor")}</h2>
              <div className={styles.formRow}>
                <label>{t("admin.cityActive")}</label>
                <label className={styles.switchRow}>
                  <input
                    type="checkbox"
                    checked={cityActive}
                    onChange={(e) => setCityActive(e.target.checked)}
                    className={styles.switchInput}
                  />
                  <span className={styles.switchTrack} aria-hidden="true" />
                  <span>{cityActive ? "true" : "false"}</span>
                </label>
              </div>
              <div className={styles.formRow}>
                <label>{t("admin.cityEn")}</label>
                <input value={cityEng} onChange={(e) => setCityEng(e.target.value)} />
              </div>
              <div className={styles.formRow}>
                <label>{t("admin.cityFa")}</label>
                <input value={cityFa} onChange={(e) => setCityFa(e.target.value)} />
              </div>
              <div className={styles.formRow}>
                <label>{t("admin.countryEn")}</label>
                <input value={countryEng} onChange={(e) => setCountryEng(e.target.value)} />
              </div>
              <div className={styles.formRow}>
                <label>{t("admin.countryFa")}</label>
                <input value={countryFa} onChange={(e) => setCountryFa(e.target.value)} />
              </div>
              <div className={styles.formRow}>
                <label>{t("admin.flagUrl")}</label>
                <input value={flagUrl} onChange={(e) => setFlagUrl(e.target.value)} />
              </div>
              <div className={styles.formRow}>
                <label>{t("admin.cityOrder")}</label>
                <div className={styles.orderWrap}>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    value={orderNum}
                    onChange={(e) => setCityOrder(e.target.value)}
                  />
                  <div className={styles.orderMeta}>
                    <span>{orderNum}</span>
                    <span>{orderLevel}</span>
                  </div>
                  <small className={styles.orderHelp}>
                    {t("admin.orderHelp")}
                  </small>
                </div>
              </div>
              <div className={styles.inline2}>
                <div className={styles.formRow}>
                  <label>{t("admin.cityLat")}</label>
                  <input value={cityLat} onChange={(e) => setCityLat(e.target.value)} />
                </div>
                <div className={styles.formRow}>
                  <label>{t("admin.cityLng")}</label>
                  <input value={cityLng} onChange={(e) => setCityLng(e.target.value)} />
                </div>
              </div>
              <div className={styles.formRow}>
                <label>{t("admin.cityMapPick")}</label>
                <div className={styles.cityMapWrap}>
                  {cityMapLoaded && cityMapApiKey ? (
                    <GoogleMap
                      mapContainerStyle={{ width: "100%", height: "100%" }}
                      center={cityMapCenter}
                      zoom={cityMarker ? 10 : 4}
                      onClick={(e) => {
                        const lat = e.latLng?.lat();
                        const lng = e.latLng?.lng();
                        if (typeof lat !== "number" || typeof lng !== "number") return;
                        setCityLat(String(lat));
                        setCityLng(String(lng));
                      }}
                      options={{
                        disableDefaultUI: true,
                        zoomControl: true,
                        clickableIcons: false,
                        gestureHandling: "greedy",
                      }}
                    >
                      {cityMarker ? (
                        <Marker
                          position={cityMarker}
                          draggable
                          onDragEnd={(e) => {
                            const lat = e.latLng?.lat();
                            const lng = e.latLng?.lng();
                            if (typeof lat !== "number" || typeof lng !== "number") return;
                            setCityLat(String(lat));
                            setCityLng(String(lng));
                          }}
                        />
                      ) : null}
                    </GoogleMap>
                  ) : (
                    <div className={styles.cityMapFallback}>{t("admin.cityMapFallback")}</div>
                  )}
                </div>
              </div>
              <div className={styles.actions}>
                <button type="button" onClick={onSaveCity} disabled={busy}>
                  {t("admin.saveCity")}
                </button>
                {!isNewCity && selectedCityId ? (
                  <button
                    type="button"
                    className={`${styles.danger} ${(selectedCity?.usageCount ?? 0) > 0 ? styles.blockedDelete : ""}`}
                    onClick={onDeleteCity}
                    disabled={busy || (selectedCity?.usageCount ?? 0) > 0}
                    title={(selectedCity?.usageCount ?? 0) > 0 ? t("admin.deleteBlockedInUse") : undefined}
                  >
                    {t("admin.deleteCity")}
                  </button>
                ) : null}
              </div>
            </section>
          </>
        ) : null}
        {tab === "adsApproval" ? (
          <>
            <aside className={styles.listPane}>
              <div className={styles.paneHead}>
                <h2>{t("admin.pendingAds")}</h2>
                <button type="button" onClick={() => void loadPendingAds()} disabled={busy}>
                  {t("admin.refresh")}
                </button>
              </div>
              <div className={styles.list}>
                {pendingAds.map((ad) => (
                  <button
                    key={ad.id}
                    type="button"
                    className={`${styles.listItem} ${selectedPendingAdId === ad.id ? styles.listItemActive : ""}`}
                    onClick={() => setSelectedPendingAdId(ad.id)}
                  >
                    <span className={styles.deptTitle}>
                      {ad.title}
                      {ad.seq ? <span className={styles.usageBadge}>#{ad.seq}</span> : null}
                    </span>
                    <small>{[ad.city, ad.dept, ad.cat].filter(Boolean).join(" · ")}</small>
                  </button>
                ))}
                {pendingAds.length === 0 ? <p className={styles.info}>{t("admin.emptyPendingAds")}</p> : null}
              </div>
            </aside>
            <section className={styles.editorPane}>
              <h2>{t("admin.adEditor")}</h2>
              {!selectedPendingAd ? (
                <p className={styles.info}>{t("admin.pickAdToEdit")}</p>
              ) : (
                <>
                  <div className={styles.inline2}>
                    <div className={styles.formRow}>
                      <label>{t("addAd.city")}</label>
                      <select
                        value={adCityEng}
                        onChange={(e) => {
                          const nextEng = e.target.value;
                          setAdCityEng(nextEng);
                          const row = cities.find((c) => (c.city_eng ?? "") === nextEng);
                          if (row) setAdCity(row.city_fa || row.city_eng || "");
                        }}
                      >
                        <option value="">{t("addAd.cityPh")}</option>
                        {cities.map((c) => (
                          <option key={c.id} value={c.city_eng}>
                            {c.city_fa || c.city_eng}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.formRow}>
                      <label>{t("addAd.dept")}</label>
                      <select
                        value={adDept}
                        onChange={(e) => {
                          const next = e.target.value;
                          setAdDept(next);
                          setAdCatCode("");
                          setAdCat("");
                          setAdSubcat([]);
                        }}
                      >
                        <option value="">{t("addAd.deptPh")}</option>
                        {adDeptOptions.map((d) => (
                          <option key={d.id} value={d.label}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className={styles.inline2}>
                    <div className={styles.formRow}>
                      <label>{t("addAd.category")}</label>
                      <select
                        value={adCatCode}
                        onChange={(e) => {
                          const code = e.target.value;
                          setAdCatCode(code);
                          const picked = adCategoryOptions.find((x) => x.code === code);
                          setAdCat(picked?.label ?? "");
                          setAdSubcat([]);
                        }}
                      >
                        <option value="">{t("addAd.catPh")}</option>
                        {adCategoryOptions.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.formRow}>
                      <label>{t("addAd.engName")}</label>
                    <input dir="auto" value={adEngName} onChange={(e) => setAdEngName(e.target.value)} />
                    </div>
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("addAd.adTitle")}</label>
                    <input dir="auto" value={adTitle} onChange={(e) => setAdTitle(e.target.value)} />
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("addAd.details")}</label>
                    <input dir="auto" value={adDetails} onChange={(e) => setAdDetails(e.target.value)} />
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("addAd.address")}</label>
                    <input dir="auto" value={adAddress} onChange={(e) => setAdAddress(e.target.value)} />
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("addAd.phone")}</label>
                    <input dir="auto" value={adPhone} onChange={(e) => setAdPhone(e.target.value)} />
                  </div>
                  <div className={styles.inline2}>
                    <div className={styles.formRow}>
                      <label>{t("addAd.website")}</label>
                      <input dir="auto" value={adWebsite} onChange={(e) => setAdWebsite(e.target.value)} />
                    </div>
                    <div className={styles.formRow}>
                      <label>{t("addAd.instagram")}</label>
                      <input dir="auto" value={adInstagram} onChange={(e) => setAdInstagram(e.target.value)} />
                    </div>
                  </div>
                  <div className={styles.inline2}>
                    <div className={styles.formRow}>
                      <label>{t("admin.cityLat")}</label>
                      <input dir="auto" value={adLat} onChange={(e) => setAdLat(e.target.value)} />
                    </div>
                    <div className={styles.formRow}>
                      <label>{t("admin.cityLng")}</label>
                      <input dir="auto" value={adLng} onChange={(e) => setAdLng(e.target.value)} />
                    </div>
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("admin.cityMapPick")}</label>
                    <div className={styles.cityMapWrap}>
                      {cityMapLoaded && cityMapApiKey ? (
                        <GoogleMap
                          mapContainerStyle={{ width: "100%", height: "100%" }}
                          center={adMapCenter}
                          zoom={adMarker ? 12 : 4}
                          onClick={(e) => {
                            const lat = e.latLng?.lat();
                            const lng = e.latLng?.lng();
                            if (typeof lat !== "number" || typeof lng !== "number") return;
                            setAdLat(String(lat));
                            setAdLng(String(lng));
                          }}
                          options={{
                            disableDefaultUI: true,
                            zoomControl: true,
                            clickableIcons: false,
                            gestureHandling: "greedy",
                          }}
                        >
                          {adMarker ? (
                            <Marker
                              position={adMarker}
                              draggable
                              onDragEnd={(e) => {
                                const lat = e.latLng?.lat();
                                const lng = e.latLng?.lng();
                                if (typeof lat !== "number" || typeof lng !== "number") return;
                                setAdLat(String(lat));
                                setAdLng(String(lng));
                              }}
                            />
                          ) : null}
                        </GoogleMap>
                      ) : (
                        <div className={styles.cityMapFallback}>{t("admin.cityMapFallback")}</div>
                      )}
                    </div>
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("addAd.images")}</label>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={(e) => {
                        void uploadAdImages(e.target.files);
                        e.currentTarget.value = "";
                      }}
                    />
                    {adImages.length > 0 ? (
                      <div className={styles.imageGrid}>
                        {adImages.map((url) => (
                          <div key={url} className={styles.imageItem}>
                            <img src={url} alt="" />
                            <button type="button" className={styles.miniDanger} onClick={() => removeAdImage(url)}>
                              {t("admin.remove")}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("addAd.tags")}</label>
                    <div className={styles.tagEditor}>
                      <div className={styles.tagList}>
                        {adSubcat.map((tag) => (
                          <span key={tag} className={styles.tagItem}>
                            {tag}
                            <button
                              type="button"
                              className={styles.tagRemove}
                              onClick={() => removeAdSubcatTag(tag)}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                      {selectedAdCategory?.subcategories?.length ? (
                        <div className={styles.tagList}>
                          {selectedAdCategory.subcategories.map((tag) => (
                            <button
                              key={`suggest-${tag}`}
                              type="button"
                              className={styles.tagSuggest}
                              onClick={() => {
                                setAdSubcat((prev) =>
                                  prev.some((x) => x.toLowerCase() === tag.toLowerCase())
                                    ? prev
                                    : [...prev, tag],
                                );
                              }}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <div className={styles.tagInputRow}>
                        <input
                          dir="auto"
                          value={adSubcatDraft}
                          onChange={(e) => setAdSubcatDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === ",") {
                              e.preventDefault();
                              addAdSubcatTag();
                            }
                          }}
                        />
                        <button type="button" onClick={addAdSubcatTag}>+</button>
                      </div>
                    </div>
                  </div>
                  <div className={styles.actions}>
                    <button type="button" onClick={onSaveAd} disabled={busy}>
                      {t("admin.saveAd")}
                    </button>
                    <button type="button" onClick={() => void onApproveAd(selectedPendingAd.id)} disabled={busy}>
                      {t("admin.approveAd")}
                    </button>
                  </div>
                </>
              )}
            </section>
          </>
        ) : null}
        {tab === "adsManage" ? (
          <>
            <aside className={styles.listPane}>
              <div className={styles.paneHead}>
                <h2>{t("admin.manageAds")}</h2>
                <Link href={loc("/add-ad")} className={styles.backLink}>
                  {t("admin.newAd")}
                </Link>
              </div>
              <div className={styles.formRow}>
                <input
                  value={adsQuery}
                  onChange={(e) => setAdsQuery(e.target.value)}
                  placeholder={t("admin.adsSearchPh")}
                />
              </div>
              <div className={styles.list}>
                {managedAds.map((ad) => {
                  const approved = ad.approved === true;
                  const paidValid =
                    ad.paidAds === true &&
                    typeof ad.paidAdsExpiresAtMs === "number" &&
                    Number.isFinite(ad.paidAdsExpiresAtMs) &&
                    ad.paidAdsExpiresAtMs > Date.now();
                  const highlightClass = paidValid ? styles.listItemPaidValid : approved ? styles.listItemValid : "";
                  const paidExpireMs =
                    ad.paidAds === true &&
                    typeof ad.paidAdsExpiresAtMs === "number" &&
                    Number.isFinite(ad.paidAdsExpiresAtMs)
                      ? ad.paidAdsExpiresAtMs
                      : null;
                  const paidExpirePast =
                    typeof paidExpireMs === "number" && paidExpireMs <= Date.now();
                  const paidExpireLabel =
                    paidExpireMs !== null
                      ? new Date(paidExpireMs).toLocaleDateString(
                          locale === "fa" ? "fa-IR" : "en-GB",
                          locale === "fa"
                            ? { year: "numeric", month: "2-digit", day: "2-digit" }
                            : { year: "numeric", month: "short", day: "numeric" },
                        )
                      : null;

                  return (
                    <button
                      key={ad.id}
                      type="button"
                      className={[
                        styles.listItem,
                        selectedAdId === ad.id ? styles.listItemActive : "",
                        highlightClass,
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => setSelectedAdId(ad.id)}
                    >
                      <span className={styles.deptTitle}>
                        {ad.title || ad.id}
                        {ad.seq ? <span className={styles.usageBadge}>#{ad.seq}</span> : null}
                        {paidValid ? (
                          <span
                            className={styles.paidListIconWrap}
                            title={t("admin.paidListingActive")}
                            aria-label={t("admin.paidListingActive")}
                          >
                            <svg
                              className={styles.paidListIcon}
                              viewBox="0 0 24 24"
                              fill="none"
                              aria-hidden="true"
                              focusable="false"
                            >
                              <circle
                                cx="12"
                                cy="12"
                                r="9.25"
                                fill="currentColor"
                                fillOpacity="0.14"
                                stroke="currentColor"
                                strokeWidth="1.5"
                              />
                              <path
                                d="M7.75 12.25 10.5 15l5.75-6.5"
                                stroke="currentColor"
                                strokeWidth="1.75"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        ) : null}
                      </span>
                      <small>{[ad.city_eng || ad.city, ad.dept, ad.cat].filter(Boolean).join(" · ")}</small>
                      {paidExpireMs !== null ? (
                        <span
                          className={`${styles.listItemExpire} ${paidExpirePast ? styles.listItemExpirePast : ""}`}
                          dir={locale === "fa" ? "rtl" : "ltr"}
                        >
                          {paidExpireLabel}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                {managedAds.length === 0 ? <p className={styles.info}>{t("admin.emptyAds")}</p> : null}
              </div>
            </aside>
            <section className={styles.editorPane}>
              <h2>{t("admin.adEditor")}</h2>
              {!selectedManagedAd ? (
                <p className={styles.info}>{t("admin.pickAdToEdit")}</p>
              ) : (
                <>
                  <div className={styles.inline2}>
                    <div className={styles.formRow}>
                      <label>{t("addAd.city")}</label>
                      <select
                        value={adCityEng}
                        onChange={(e) => {
                          const nextEng = e.target.value;
                          setAdCityEng(nextEng);
                          const row = cities.find((c) => (c.city_eng ?? "") === nextEng);
                          if (row) setAdCity(row.city_fa || row.city_eng || "");
                        }}
                      >
                        <option value="">{t("addAd.cityPh")}</option>
                        {cities.map((c) => (
                          <option key={c.id} value={c.city_eng}>
                            {c.city_fa || c.city_eng}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.formRow}>
                      <label>{t("addAd.dept")}</label>
                      <select
                        value={adDept}
                        onChange={(e) => {
                          const next = e.target.value;
                          setAdDept(next);
                          setAdCatCode("");
                          setAdCat("");
                          setAdSubcat([]);
                        }}
                      >
                        <option value="">{t("addAd.deptPh")}</option>
                        {adDeptOptions.map((d) => (
                          <option key={d.id} value={d.label}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className={styles.inline2}>
                    <div className={styles.formRow}>
                      <label>{t("addAd.category")}</label>
                      <select
                        value={adCatCode}
                        onChange={(e) => {
                          const code = e.target.value;
                          setAdCatCode(code);
                          const picked = adCategoryOptions.find((x) => x.code === code);
                          setAdCat(picked?.label ?? "");
                          setAdSubcat([]);
                        }}
                      >
                        <option value="">{t("addAd.catPh")}</option>
                        {adCategoryOptions.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.formRow}>
                      <label>{t("addAd.engName")}</label>
                      <input dir="auto" value={adEngName} onChange={(e) => setAdEngName(e.target.value)} />
                    </div>
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("addAd.adTitle")}</label>
                    <input dir="auto" value={adTitle} onChange={(e) => setAdTitle(e.target.value)} />
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("addAd.details")}</label>
                    <input dir="auto" value={adDetails} onChange={(e) => setAdDetails(e.target.value)} />
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("addAd.address")}</label>
                    <input dir="auto" value={adAddress} onChange={(e) => setAdAddress(e.target.value)} />
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("addAd.phone")}</label>
                    <input dir="auto" value={adPhone} onChange={(e) => setAdPhone(e.target.value)} />
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("addAd.website")}</label>
                    <input dir="auto" value={adWebsite} onChange={(e) => setAdWebsite(e.target.value)} />
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("addAd.instagram")}</label>
                    <input dir="auto" value={adInstagram} onChange={(e) => setAdInstagram(e.target.value)} />
                  </div>
                  <div className={styles.inline2}>
                    <div className={styles.formRow}>
                      <label>{t("admin.cityLat")}</label>
                      <input dir="auto" value={adLat} onChange={(e) => setAdLat(e.target.value)} />
                    </div>
                    <div className={styles.formRow}>
                      <label>{t("admin.cityLng")}</label>
                      <input dir="auto" value={adLng} onChange={(e) => setAdLng(e.target.value)} />
                    </div>
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("admin.cityMapPick")}</label>
                    <div className={styles.cityMapWrap}>
                      {cityMapLoaded && cityMapApiKey ? (
                        <GoogleMap
                          mapContainerStyle={{ width: "100%", height: "100%" }}
                          center={adMapCenter}
                          zoom={adMarker ? 12 : 4}
                          onClick={(e) => {
                            const lat = e.latLng?.lat();
                            const lng = e.latLng?.lng();
                            if (typeof lat !== "number" || typeof lng !== "number") return;
                            setAdLat(String(lat));
                            setAdLng(String(lng));
                          }}
                          options={{
                            disableDefaultUI: true,
                            zoomControl: true,
                            clickableIcons: false,
                            gestureHandling: "greedy",
                          }}
                        >
                          {adMarker ? (
                            <Marker
                              position={adMarker}
                              draggable
                              onDragEnd={(e) => {
                                const lat = e.latLng?.lat();
                                const lng = e.latLng?.lng();
                                if (typeof lat !== "number" || typeof lng !== "number") return;
                                setAdLat(String(lat));
                                setAdLng(String(lng));
                              }}
                            />
                          ) : null}
                        </GoogleMap>
                      ) : (
                        <div className={styles.cityMapFallback}>{t("admin.cityMapFallback")}</div>
                      )}
                    </div>
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("addAd.images")}</label>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={(e) => {
                        void uploadAdImages(e.target.files);
                        e.currentTarget.value = "";
                      }}
                    />
                    {adImages.length > 0 ? (
                      <div className={styles.imageGrid}>
                        {adImages.map((url) => (
                          <div key={url} className={styles.imageItem}>
                            <img src={url} alt="" />
                            <button type="button" className={styles.miniDanger} onClick={() => removeAdImage(url)}>
                              {t("admin.remove")}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("addAd.tags")}</label>
                    <div className={styles.tagEditor}>
                      <div className={styles.tagList}>
                        {adSubcat.map((tag) => (
                          <span key={tag} className={styles.tagItem}>
                            {tag}
                            <button
                              type="button"
                              className={styles.tagRemove}
                              onClick={() => removeAdSubcatTag(tag)}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                      {selectedAdCategory?.subcategories?.length ? (
                        <div className={styles.tagList}>
                          {selectedAdCategory.subcategories.map((tag) => (
                            <button
                              key={`suggest-${tag}`}
                              type="button"
                              className={styles.tagSuggest}
                              onClick={() => {
                                setAdSubcat((prev) =>
                                  prev.some((x) => x.toLowerCase() === tag.toLowerCase())
                                    ? prev
                                    : [...prev, tag],
                                );
                              }}
                            >
                              {tag}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <div className={styles.tagInputRow}>
                        <input
                          dir="auto"
                          value={adSubcatDraft}
                          onChange={(e) => setAdSubcatDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === ",") {
                              e.preventDefault();
                              addAdSubcatTag();
                            }
                          }}
                        />
                        <button type="button" onClick={addAdSubcatTag}>+</button>
                      </div>
                    </div>
                  </div>
                  <div className={styles.formRow}>
                    <label className={styles.switchRow}>
                      <input
                        type="checkbox"
                        checked={adApproved}
                        onChange={(e) => setAdApproved(e.target.checked)}
                        className={styles.switchInput}
                      />
                      <span className={styles.switchTrack} aria-hidden="true" />
                      <span>approved</span>
                    </label>
                  </div>
                  <div className={styles.formRow}>
                    <label className={styles.paidLabel}>{t("admin.paidAds")}</label>
                    {adPaidAds && adPaidExpiresAtMs ? (
                      <div
                        className={`${styles.paidInfo} ${locale === "fa" ? styles.paidInfoFa : ""}`}
                      >
                        <strong>
                          {new Date(adPaidExpiresAtMs).toLocaleDateString(
                            locale === "fa" ? "fa-IR" : "en-GB",
                            { year: "numeric", month: "short", day: "numeric" },
                          )}
                        </strong>
                      </div>
                    ) : (
                      <div className={styles.paidInfo}>{t("admin.paidNotSet")}</div>
                    )}

                    <div className={styles.paidActions}>
                      <button
                        type="button"
                        className={adPaidAds ? styles.secondaryBtn : styles.btn}
                        onClick={() => setPaidTermPickerOpen(true)}
                        disabled={busy}
                      >
                        {adPaidAds ? t("admin.extendPaid") : t("admin.markPaid")}
                      </button>
                      {adPaidAds ? (
                        <button
                          type="button"
                          className={styles.miniDanger}
                          onClick={() => {
                            setAdPaidAds(false);
                            setAdPaidExpiresAtMs(null);
                          }}
                          disabled={busy}
                        >
                          {t("admin.clearPaid")}
                        </button>
                      ) : null}
                    </div>

                    {paidTermPickerOpen ? (
                      <div className={styles.paidTermPicker} role="dialog" aria-modal="true">
                        <div className={styles.paidTermTitle}>{t("admin.choosePaidTerm")}</div>
                        <div className={styles.paidTermButtons}>
                          <button
                            type="button"
                            onClick={() => {
                              const ms = Date.now() + 7 * 24 * 60 * 60 * 1000;
                              setAdPaidAds(true);
                              setAdPaidExpiresAtMs(ms);
                              setPaidTermPickerOpen(false);
                            }}
                            disabled={busy}
                          >
                            {t("admin.term1w")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const ms = Date.now() + 30 * 24 * 60 * 60 * 1000;
                              setAdPaidAds(true);
                              setAdPaidExpiresAtMs(ms);
                              setPaidTermPickerOpen(false);
                            }}
                            disabled={busy}
                          >
                            {t("admin.term1m")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const ms = Date.now() + 90 * 24 * 60 * 60 * 1000;
                              setAdPaidAds(true);
                              setAdPaidExpiresAtMs(ms);
                              setPaidTermPickerOpen(false);
                            }}
                            disabled={busy}
                          >
                            {t("admin.term3m")}
                          </button>
                        </div>
                        <button
                          type="button"
                          className={styles.paidTermClose}
                          onClick={() => setPaidTermPickerOpen(false)}
                        >
                          {t("admin.cancel")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className={styles.actions}>
                    <button type="button" onClick={onSaveAd} disabled={busy}>
                      {t("admin.saveAd")}
                    </button>
                    <button type="button" className={styles.danger} onClick={onDeleteAd} disabled={busy}>
                      {t("admin.deleteAd")}
                    </button>
                  </div>
                </>
              )}
            </section>
          </>
        ) : null}
        {tab === "events" ? (
          <>
            <aside className={styles.listPane}>
              <div className={styles.paneHead}>
                <h2>{t("admin.manageEvents")}</h2>
                <div className={styles.eventPaneActions}>
                  <button type="button" onClick={onCreateNewEvent} disabled={busy}>
                    {t("admin.newEvent")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void loadEvents(eventsQuery, eventsCityFilter, {
                        skipAutoSelect: isNewEventRef.current,
                      })
                    }
                    disabled={busy}
                  >
                    {t("admin.refresh")}
                  </button>
                </div>
              </div>
              <div className={styles.formRow}>
                <label>{t("admin.eventsCityFilter")}</label>
                <input
                  value={eventsCityFilter}
                  onChange={(e) => setEventsCityFilter(e.target.value)}
                  placeholder={t("admin.eventsCityFilterPh")}
                  dir="auto"
                />
              </div>
              <div className={styles.formRow}>
                <label>{t("admin.search")}</label>
                <input
                  value={eventsQuery}
                  onChange={(e) => setEventsQuery(e.target.value)}
                  placeholder={t("admin.eventsSearchPh")}
                  dir="auto"
                />
              </div>
              <div className={styles.list}>
                {events.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    className={`${styles.listItem} ${
                      selectedEventId === ev.id && !isNewEvent ? styles.listItemActive : ""
                    }`}
                    onClick={() => {
                      setSelectedEventId(ev.id);
                      setIsNewEvent(false);
                    }}
                  >
                    <span className={styles.deptTitle}>{ev.event || ev.id}</span>
                    <small>{[ev.city_eng || ev.city].filter(Boolean).join(" · ")}</small>
                  </button>
                ))}
                {events.length === 0 ? <p className={styles.info}>{t("admin.emptyEvents")}</p> : null}
              </div>
            </aside>
            <section className={styles.editorPane}>
              <h2>{t("admin.eventEditor")}</h2>
              {isNewEvent || selectedEventId ? (
                <>
                  <div className={styles.formRow}>
                    <label>{t("admin.eventTitle")}</label>
                    <input dir="auto" value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} />
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("admin.eventDesc")}</label>
                    <textarea
                      className={styles.textArea}
                      dir="auto"
                      value={eventDesc}
                      onChange={(e) => setEventDesc(e.target.value)}
                      rows={4}
                    />
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("addAd.city")}</label>
                    <select
                      value={eventCityEng}
                      onChange={(e) => {
                        const nextEng = e.target.value;
                        setEventCityEng(nextEng);
                        const row = cities.find((c) => (c.city_eng ?? "") === nextEng);
                        if (row) setEventCity(row.city_fa || row.city_eng || "");
                      }}
                    >
                      <option value="">{t("addAd.cityPh")}</option>
                      {cities.map((c) => (
                        <option key={c.id} value={c.city_eng}>
                          {c.city_fa || c.city_eng}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.inline2}>
                    <div className={styles.formRow}>
                      <label>{t("admin.eventStart")}</label>
                      <input
                        type="datetime-local"
                        value={eventStartAtInput}
                        onChange={(e) => setEventStartAtInput(e.target.value)}
                        className={styles.dateTimeInput}
                      />
                    </div>
                    <div className={styles.formRow}>
                      <label>{t("admin.eventEnd")}</label>
                      <input
                        type="datetime-local"
                        value={eventEndAtInput}
                        onChange={(e) => setEventEndAtInput(e.target.value)}
                        className={styles.dateTimeInput}
                      />
                    </div>
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("admin.eventVenue")}</label>
                    <input dir="auto" value={eventVenue} onChange={(e) => setEventVenue(e.target.value)} />
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("admin.eventLink")}</label>
                    <input dir="auto" value={eventLink} onChange={(e) => setEventLink(e.target.value)} />
                  </div>
                  <div className={styles.formRow}>
                    <label>{t("addAd.images")}</label>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadEventImage(file);
                        e.currentTarget.value = "";
                      }}
                    />
                    {eventImage.trim() ? (
                      <img src={eventImage.trim()} alt="" className={styles.departmentImagePreview} />
                    ) : null}
                  </div>
                  <div className={styles.actions}>
                    <button type="button" onClick={() => void onSaveEvent()} disabled={busy}>
                      {t("admin.saveEvent")}
                    </button>
                    {!isNewEvent && selectedEventId ? (
                      <button
                        type="button"
                        className={styles.danger}
                        onClick={() => void onDeleteEvent()}
                        disabled={busy}
                      >
                        {t("admin.deleteEvent")}
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <p className={styles.info}>{t("admin.pickEventToEdit")}</p>
              )}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
