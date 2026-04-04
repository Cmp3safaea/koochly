"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { onAuthStateChanged, signInWithPopup, type User } from "firebase/auth";
import {
  getAuthClientOrNull,
  getGoogleProvider,
  isFirebaseClientConfigured,
} from "../../../lib/firebaseClient";
import { getCitiesCached } from "../../../lib/citiesClientCache";
import { logoPublicPath } from "@koochly/shared";
import { useDocumentTheme } from "../../../lib/useDocumentTheme";
import { useI18n, useLocalizedHref } from "../../../i18n/client";
import { CustomSelect } from "./CustomSelect";
import styles from "./AddAdForm.module.css";
import {
  AD_PROMOTION_TYPES,
  type AdPromotionType,
} from "../../../lib/adPromotions";

const PROMO_HELP: Record<AdPromotionType, { title: string; body: string }> = {
  featured: {
    title: "city.promoteFeaturedTitle",
    body: "city.promoteFeaturedBody",
  },
  spotlight: {
    title: "city.promoteSpotlightTitle",
    body: "city.promoteSpotlightBody",
  },
  bump: {
    title: "city.promoteBumpTitle",
    body: "city.promoteBumpBody",
  },
  urgent: {
    title: "city.promoteUrgentTitle",
    body: "city.promoteUrgentBody",
  },
};

const AddAdLocationPicker = dynamic(() => import("./AddAdLocationPicker"), { ssr: false });

type CityRow = {
  id: string;
  city_fa?: string;
  city_eng?: string;
  currency_symbol?: string;
  active?: boolean;
} & Record<string, unknown>;

type DeptRow = {
  id: string;
  label: string;
};

type CategoryRow = { code: string; label: string; subcategories?: string[] };
type UserProfileDefaults = {
  city?: string;
  address?: string;
  phone_number?: string;
  website?: string;
  instogram?: string;
};

const MAX_AD_IMAGES = 4;
const MAX_SUBCATEGORY_TAGS = 2;
type MainCategory = "goods" | "services";
const MAX_IMAGE_FILE_BYTES = 100 * 1024;
const ACCEPT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function readFileAsBase64(file: File): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== "string") {
        reject(new Error("read_failed"));
        return;
      }
      const comma = r.indexOf(",");
      const payload = comma >= 0 ? r.slice(comma + 1) : r;
      resolve({ base64: payload, mime: file.type || "image/jpeg" });
    };
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

function cityLabel(c: CityRow): string {
  const fa =
    typeof c.city_fa === "string" && c.city_fa.trim() ? c.city_fa.trim() : "";
  const en =
    typeof c.city_eng === "string" && c.city_eng.trim() ? c.city_eng.trim() : "";
  if (fa && en) return `${fa} · ${en}`;
  return fa || en || c.id;
}

function cityCenterFromRow(c: CityRow | undefined): { lat: number; lng: number } | null {
  if (!c) return null;
  const raw = c.latlng as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const lat = Number(
    raw.__lat__ ?? raw.lat ?? raw.latitude,
  );
  const lng = Number(
    raw.__lon__ ?? raw.lon ?? raw.longitude ?? raw.lng,
  );
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

export default function AddAdClient({
  googleMapsApiKey,
}: {
  googleMapsApiKey?: string;
} = {}) {
  const { t, locale } = useI18n();
  const docTheme = useDocumentTheme();
  const loc = useLocalizedHref();
  const searchParams = useSearchParams();
  const editParam = (searchParams.get("edit") ?? "").trim();
  const configured = isFirebaseClientConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [cities, setCities] = useState<CityRow[]>([]);
  const [departments, setDepartments] = useState<DeptRow[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [categoryOptions, setCategoryOptions] = useState<CategoryRow[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  const [cityId, setCityId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [catCode, setCatCode] = useState("");
  const [title, setTitle] = useState("");
  const [engName, setEngName] = useState("");
  const [details, setDetails] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [instagram, setInstagram] = useState("");
  const [mainCategory, setMainCategory] = useState<MainCategory | "">("");
  const [servicesDescription, setServicesDescription] = useState("");
  const [priceStr, setPriceStr] = useState("");
  const [isNewItem, setIsNewItem] = useState(false);
  const [exchangeable, setExchangeable] = useState(false);
  const [isFree, setIsFree] = useState(false);
  const [negotiable, setNegotiable] = useState(false);
  const [latStr, setLatStr] = useState("");
  const [lonStr, setLonStr] = useState("");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);
  const [selectedPromotionTypes, setSelectedPromotionTypes] = useState<
    AdPromotionType[]
  >([]);

  useLayoutEffect(() => {
    const urls = imageFiles.map((f) => URL.createObjectURL(f));
    setImagePreviewUrls(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [imageFiles]);

  useEffect(() => {
    if (mainCategory === "services") {
      setPriceStr("");
      setIsNewItem(false);
      setExchangeable(false);
      setIsFree(false);
      setNegotiable(false);
    }
    if (mainCategory === "goods") {
      setServicesDescription("");
    }
  }, [mainCategory]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    seq: number | null;
    url: string;
    pendingApproval?: boolean;
  } | null>(null);
  const [step, setStep] = useState(1);
  const [profileCityPref, setProfileCityPref] = useState("");
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);
  const [startChoice, setStartChoice] = useState<"unset" | "manual" | "ai">(
    "unset",
  );
  const [aiOffering, setAiOffering] = useState("");
  const [aiExtra, setAiExtra] = useState("");
  const [aiDraftErr, setAiDraftErr] = useState<string | null>(null);
  const [aiDraftBusy, setAiDraftBusy] = useState(false);
  const [editingAdId, setEditingAdId] = useState("");
  const [existingImageUrls, setExistingImageUrls] = useState<string[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const [editLoadErr, setEditLoadErr] = useState<string | null>(null);

  const totalSteps = editingAdId ? 4 : 5;

  useEffect(() => {
    if (!user) setStartChoice("unset");
  }, [user]);

  useEffect(() => {
    if (!editParam) {
      setEditingAdId("");
      setExistingImageUrls([]);
      setEditLoadErr(null);
    }
  }, [editParam]);

  useEffect(() => {
    if (!editParam || !user) return;
    setStartChoice("manual");
    setStep(1);
  }, [editParam, user]);

  useEffect(() => {
    if (!configured) {
      setAuthReady(true);
      return;
    }
    const auth = getAuthClientOrNull();
    if (!auth) {
      setAuthReady(true);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, [configured]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cRes, dRes] = await Promise.all([
          getCitiesCached(0),
          fetch(`/api/directory?locale=${encodeURIComponent(locale)}`),
        ]);
        const cJson = cRes;
        const dJson = await dRes.json().catch(() => ({}));
        if (!dRes.ok) throw new Error(dJson?.error ?? t("addAd.errDept"));
        if (cancelled) return;
        setCities(Array.isArray(cJson.cities) ? (cJson.cities as CityRow[]) : []);
        setDepartments(Array.isArray(dJson.departments) ? dJson.departments : []);
      } catch (e) {
        if (!cancelled) {
          setMetaErr(e instanceof Error ? e.message : t("addAd.errLoad"));
        }
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t, locale]);

  const activeCities = useMemo(
    () => cities.filter((c) => c.active === true),
    [cities],
  );

  useEffect(() => {
    if (!user || defaultsLoaded) return;
    if (editParam) {
      setDefaultsLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/user/profile", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json().catch(() => ({}))) as {
          profile?: UserProfileDefaults;
        };
        const p = json.profile ?? {};
        if (cancelled) return;
        if (!address.trim() && typeof p.address === "string") setAddress(p.address);
        if (!phone.trim() && typeof p.phone_number === "string") setPhone(p.phone_number);
        if (!website.trim() && typeof p.website === "string") setWebsite(p.website);
        if (!instagram.trim() && typeof p.instogram === "string") setInstagram(p.instogram);
        if (typeof p.city === "string" && p.city.trim()) setProfileCityPref(p.city.trim());
      } catch {
        // Defaults are optional; do not block ad creation.
      } finally {
        if (!cancelled) setDefaultsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, defaultsLoaded, editParam, address, phone, website, instagram]);

  useEffect(() => {
    if (!editParam || !user || !authReady || metaLoading) return;
    let cancelled = false;
    (async () => {
      setEditLoading(true);
      setEditLoadErr(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/user/my-ads/${encodeURIComponent(editParam)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          throw new Error(typeof json.error === "string" ? json.error : t("addAd.editLoadErr"));
        }
        if (cancelled) return;
        setEditingAdId(editParam);
        setCityId(typeof json.cityId === "string" ? json.cityId : "");
        setDepartmentId(typeof json.departmentId === "string" ? json.departmentId : "");
        setCatCode(typeof json.catCode === "string" ? json.catCode : "");
        setTitle(typeof json.title === "string" ? json.title : "");
        setEngName(typeof json.engName === "string" ? json.engName : "");
        setDetails(typeof json.details === "string" ? json.details : "");
        setAddress(typeof json.address === "string" ? json.address : "");
        setPhone(typeof json.phone === "string" ? json.phone : "");
        setWebsite(typeof json.website === "string" ? json.website : "");
        setInstagram(typeof json.instagram === "string" ? json.instagram : "");
        const mc = json.mainCategory === "services" ? "services" : "goods";
        setMainCategory(mc);
        setServicesDescription(typeof json.services === "string" ? json.services : "");
        const tags = Array.isArray(json.selectedTags)
          ? json.selectedTags.filter((x): x is string => typeof x === "string")
          : [];
        setSelectedTags(tags.slice(0, MAX_SUBCATEGORY_TAGS));
        if (typeof json.lat === "number" && Number.isFinite(json.lat)) {
          setLatStr(json.lat.toFixed(6));
        } else {
          setLatStr("");
        }
        if (typeof json.lon === "number" && Number.isFinite(json.lon)) {
          setLonStr(json.lon.toFixed(6));
        } else {
          setLonStr("");
        }
        if (mc === "goods") {
          const p = json.price;
          if (json.isFree === true) {
            setIsFree(true);
            setPriceStr("");
          } else if (typeof p === "number" && Number.isFinite(p)) {
            setIsFree(false);
            setPriceStr(String(p));
          } else {
            setIsFree(false);
            setPriceStr("");
          }
          setIsNewItem(json.isNewItem === true);
          setExchangeable(json.exchangeable === true);
          setNegotiable(json.negotiable === true);
        } else {
          setPriceStr("");
          setIsNewItem(false);
          setExchangeable(false);
          setIsFree(false);
          setNegotiable(false);
        }
        const imgs = Array.isArray(json.images)
          ? json.images.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
          : [];
        setExistingImageUrls(imgs.slice(0, MAX_AD_IMAGES));
        setImageFiles([]);
        setSelectedPromotionTypes([]);
        setStep(1);
        setErr(null);
      } catch (e) {
        if (!cancelled) {
          setEditLoadErr(e instanceof Error ? e.message : t("addAd.editLoadErr"));
          setEditingAdId("");
        }
      } finally {
        if (!cancelled) setEditLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editParam, user, authReady, metaLoading, t]);

  useEffect(() => {
    if (cityId || !profileCityPref || activeCities.length === 0) return;
    const pref = profileCityPref.trim().toLowerCase();
    const matched = activeCities.find((c) => {
      const fa = typeof c.city_fa === "string" ? c.city_fa.trim().toLowerCase() : "";
      const en = typeof c.city_eng === "string" ? c.city_eng.trim().toLowerCase() : "";
      return fa === pref || en === pref || c.id.trim().toLowerCase() === pref;
    });
    if (matched) setCityId(matched.id);
  }, [profileCityPref, activeCities, cityId]);

  const selectedCity = useMemo(
    () => activeCities.find((x) => x.id === cityId),
    [activeCities, cityId],
  );
  const selectedCityCurrencySymbol = useMemo(() => {
    if (!selectedCity) return "";
    const c = selectedCity as Record<string, unknown>;
    const fromSnake = typeof c.currency_symbol === "string" ? c.currency_symbol.trim() : "";
    const fromCamel = typeof c.currencySymbol === "string" ? c.currencySymbol.trim() : "";
    const fromLegacy = typeof c.currency === "string" ? c.currency.trim() : "";
    return fromSnake || fromCamel || fromLegacy || "";
  }, [selectedCity]);

  const mapCenter = useMemo(() => cityCenterFromRow(selectedCity), [selectedCity]);

  useEffect(() => {
    if (!departmentId) {
      setCategoryOptions([]);
      setCategoriesLoading(false);
      return;
    }
    let cancelled = false;
    setCategoriesLoading(true);
    setCategoryOptions([]);
    const url = `/api/directory/${encodeURIComponent(departmentId)}/categories`;
    fetch(url)
      .then(async (res) => {
        const j = (await res.json().catch(() => ({}))) as {
          categories?: unknown;
          error?: string;
        };
        if (!res.ok) throw new Error(j.error ?? t("addAd.errDept"));
        return j;
      })
      .then((j) => {
        if (cancelled) return;
        const raw = j.categories;
        const list = Array.isArray(raw)
          ? raw.filter(
              (row): row is CategoryRow =>
                row != null &&
                typeof row === "object" &&
                typeof (row as CategoryRow).code === "string" &&
                typeof (row as CategoryRow).label === "string",
            )
              .map((row) => ({
                code: row.code,
                label: row.label,
                subcategories: Array.isArray((row as any).subcategories)
                  ? ((row as any).subcategories as unknown[])
                      .map((v) => (typeof v === "string" ? v.trim() : ""))
                      .filter((v) => v.length > 0)
                  : [],
              }))
          : [];
        setCategoryOptions(list);
      })
      .catch(() => {
        if (!cancelled) setCategoryOptions([]);
      })
      .finally(() => {
        if (!cancelled) setCategoriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [departmentId, t]);

  const signIn = useCallback(async () => {
    const auth = getAuthClientOrNull();
    if (!auth) return;
    await signInWithPopup(auth, getGoogleProvider());
  }, []);

  const onDeptChange = (id: string) => {
    setDepartmentId(id);
    setCatCode("");
    setSelectedTags([]);
  };

  const onCategoryChange = (code: string) => {
    setCatCode(code);
    setSelectedTags([]);
  };

  const applyAiDraft = useCallback(
    (draft: {
      departmentId: string;
      catCode: string;
      mainCategory: MainCategory;
      title: string;
      engName: string;
      details: string;
      services: string;
      selectedTags: string[];
    }) => {
      setDepartmentId(draft.departmentId);
      setCatCode(draft.catCode);
      setMainCategory(draft.mainCategory);
      setTitle(draft.title);
      setEngName(draft.engName);
      setDetails(draft.details);
      setServicesDescription(draft.services);
      setSelectedTags(draft.selectedTags);
      setStartChoice("manual");
      setStep(1);
      setErr(null);
      setAiDraftErr(null);
    },
    [],
  );

  const runAiDraft = useCallback(async () => {
    setAiDraftErr(null);
    const offer = aiOffering.trim();
    if (!offer) {
      setAiDraftErr(t("addAd.aiErrOffering"));
      return;
    }
    const auth = getAuthClientOrNull();
    const u = auth?.currentUser;
    if (!u) {
      setAiDraftErr(t("city.aiSearchErrAuth"));
      return;
    }
    setAiDraftBusy(true);
    try {
      const token = await u.getIdToken();
      const res = await fetch("/api/ai/draft-ad", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          locale,
          offering: offer,
          extra: aiExtra.trim(),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        draft?: {
          departmentId: string;
          catCode: string;
          mainCategory: MainCategory;
          title: string;
          engName: string;
          details: string;
          services: string;
          selectedTags: string[];
        };
      };
      if (!res.ok) {
        if (res.status === 401) setAiDraftErr(t("city.aiSearchErrAuth"));
        else if (res.status === 503) setAiDraftErr(t("city.aiSearchErrConfig"));
        else if (res.status === 502) setAiDraftErr(t("city.aiSearchErrService"));
        else if (res.status === 422)
          setAiDraftErr(json.error || t("addAd.aiErrInvalid"));
        else setAiDraftErr(json.error || t("city.aiSearchErrGeneric"));
        return;
      }
      const d = json.draft;
      if (
        !d ||
        (d.mainCategory !== "goods" && d.mainCategory !== "services")
      ) {
        setAiDraftErr(t("city.aiSearchErrGeneric"));
        return;
      }
      applyAiDraft(d);
    } catch {
      setAiDraftErr(t("city.aiSearchErrGeneric"));
    } finally {
      setAiDraftBusy(false);
    }
  }, [aiExtra, aiOffering, applyAiDraft, locale, t]);

  const availableTags = useMemo(() => {
    const selected = categoryOptions.find((c) => c.code === catCode);
    return Array.isArray(selected?.subcategories) ? selected!.subcategories : [];
  }, [categoryOptions, catCode]);

  const parseCoord = (s: string): number | null => {
    const t = s.trim().replace(",", ".");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const parsePriceNumber = (s: string): number | null => {
    const t = s.trim().replace(/[,\s\u066C]/g, "");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const submit = async () => {
    setErr(null);
    if (!configured) return;
    if (!user) {
      setErr(t("addAd.authLead"));
      return;
    }
    if (!cityId || !departmentId || !catCode || title.trim().length < 2) {
      setErr(t("addAd.errFill"));
      return;
    }
    const imageCount = editingAdId ? existingImageUrls.length + imageFiles.length : imageFiles.length;
    if (imageCount < 1) {
      setErr(t("addAd.errImageRequired"));
      return;
    }
    const lat = parseCoord(latStr);
    const lon = parseCoord(lonStr);
    if ((latStr.trim() || lonStr.trim()) && (lat === null || lon === null)) {
      setErr(t("addAd.errCoords"));
      return;
    }

    const auth = getAuthClientOrNull();
    if (!auth?.currentUser) {
      setErr(t("addAd.errSession"));
      return;
    }

    setBusy(true);
    try {
      const imagesPayload: {
        imageBase64: string;
        imageMimeType: string;
        imageFileName: string;
      }[] = [];
      for (const imageFile of imageFiles) {
        if (!ACCEPT_IMAGE_TYPES.has(imageFile.type)) {
          setErr(t("addAd.errImageType"));
          setBusy(false);
          return;
        }
        if (imageFile.size > MAX_IMAGE_FILE_BYTES) {
          setErr(t("addAd.errImageSize", { name: imageFile.name }));
          setBusy(false);
          return;
        }
        const img = await readFileAsBase64(imageFile);
        imagesPayload.push({
          imageBase64: img.base64,
          imageMimeType: img.mime,
          imageFileName: imageFile.name,
        });
      }

      if (mainCategory !== "goods" && mainCategory !== "services") {
        setErr(t("addAd.errFill"));
        setBusy(false);
        return;
      }

      const isGoods = mainCategory === "goods";
      const idToken = await auth.currentUser.getIdToken();
      if (editingAdId) {
        const res = await fetch(`/api/user/my-ads/${encodeURIComponent(editingAdId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idToken,
            cityId,
            departmentId,
            catCode,
            title: title.trim(),
            engName: engName.trim(),
            details: details.trim(),
            address: address.trim(),
            phone: phone.trim(),
            website: website.trim(),
            instagram: instagram.trim(),
            lat,
            lon,
            selectedTags,
            existingImageUrls,
            images: imagesPayload,
            mainCategory,
            services: servicesDescription.trim(),
            ...(isGoods
              ? {
                  price: isFree ? null : parsePriceNumber(priceStr),
                  isNewItem,
                  exchangeable,
                  isFree,
                  negotiable,
                }
              : {
                  price: null,
                  isNewItem: false,
                  exchangeable: false,
                  isFree: false,
                  negotiable: false,
                }),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          seq?: number | null;
          url?: string;
          pendingApproval?: boolean;
        };
        if (!res.ok) {
          setErr(data.error ?? t("addAd.errSubmit"));
          return;
        }
        const u = typeof data.url === "string" ? data.url : "";
        const sq = typeof data.seq === "number" ? data.seq : null;
        if (u || sq !== null) {
          setSuccess({
            seq: sq,
            url: u || (sq !== null ? loc(`/b/${sq}`) : ""),
            pendingApproval: true,
          });
        }
        return;
      }

      const res = await fetch("/api/ads/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken,
          cityId,
          departmentId,
          catCode,
          title: title.trim(),
          engName: engName.trim(),
          details: details.trim(),
          address: address.trim(),
          phone: phone.trim(),
          website: website.trim(),
          instagram: instagram.trim(),
          lat,
          lon,
          selectedTags,
          images: imagesPayload,
          promotionTypes: selectedPromotionTypes,
          mainCategory,
          services: servicesDescription.trim(),
          ...(isGoods
            ? {
                price: isFree ? null : parsePriceNumber(priceStr),
                isNewItem,
                exchangeable,
                isFree,
                negotiable,
              }
            : {
                price: null,
                isNewItem: false,
                exchangeable: false,
                isFree: false,
                negotiable: false,
              }),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        seq?: number;
        url?: string;
      };
      if (!res.ok) {
        setErr(data.error ?? t("addAd.errSubmit"));
        return;
      }
      if (typeof data.seq === "number" && typeof data.url === "string") {
        setSuccess({ seq: data.seq, url: data.url, pendingApproval: true });
        setTitle("");
        setEngName("");
        setDetails("");
        setAddress("");
        setPhone("");
        setWebsite("");
        setInstagram("");
        setMainCategory("");
        setServicesDescription("");
        setPriceStr("");
        setIsNewItem(false);
        setExchangeable(false);
        setIsFree(false);
        setNegotiable(false);
        setLatStr("");
        setLonStr("");
        setSelectedTags([]);
        setImageFiles([]);
        setSelectedPromotionTypes([]);
      }
    } catch (e) {
      console.error(e);
      setErr(t("addAd.errNetwork"));
    } finally {
      setBusy(false);
    }
  };

  const canProceedStep1 = Boolean(
    cityId && departmentId && catCode && title.trim().length >= 2 && mainCategory !== "",
  );
  const canProceedStep2 = true;
  const canProceedStep3 = (() => {
    const lat = parseCoord(latStr);
    const lon = parseCoord(lonStr);
    if (!latStr.trim() && !lonStr.trim()) return true;
    return lat !== null && lon !== null;
  })();
  const canProceedStep4 =
    (editingAdId ? existingImageUrls.length + imageFiles.length : imageFiles.length) >= 1;

  const nextStep = () => {
    setErr(null);
    if (step === 1 && !canProceedStep1) {
      setErr(t("addAd.errFill"));
      return;
    }
    if (step === 3 && !canProceedStep3) {
      setErr(t("addAd.errCoords"));
      return;
    }
    if (step === 4 && !canProceedStep4) {
      setErr(t("addAd.errImageRequired"));
      return;
    }
    setStep((s) => Math.min(totalSteps, s + 1));
  };

  const prevStep = () => {
    setErr(null);
    setStep((s) => Math.max(1, s - 1));
  };

  if (!configured) {
    return (
      <div className={styles.page}>
        <div className={styles.shell}>
          <p className={styles.mutedCfg}>{t("addAd.notConfigured")}</p>
        </div>
      </div>
    );
  }

  const submitted = success != null;

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.topBar}>
          <Link href={loc("/")} className={styles.brand}>
            <img
              src={logoPublicPath(locale, docTheme)}
              alt={t("addAd.brand")}
              className={styles.logo}
              decoding="async"
            />
          </Link>
          {submitted ? null : (
            <Link href={loc("/")} className={styles.backLink}>
              {t("addAd.backHome")}
            </Link>
          )}
        </div>

        <div className={styles.card}>
          {submitted ? (
            <div className={styles.success} role="status">
              <div className={styles.successTitle}>{t("addAd.successTitle")}</div>
              <p className={styles.successText}>
                {success.pendingApproval ? (
                  success.seq != null ? (
                    <>
                      {t("addAd.successBody")}: <strong>{success.seq}</strong>
                      <br />
                      {t("addAd.successPendingApproval")}
                    </>
                  ) : (
                    t("addAd.successPendingApproval")
                  )
                ) : success.seq != null ? (
                  <>
                    {t("addAd.successBody")}: <strong>{success.seq}</strong> — {t("addAd.successUrl")}
                    :&nbsp;
                    <span dir="ltr">{success.url}</span>
                  </>
                ) : success.url ? (
                  <>
                    {t("addAd.successUrl")}:&nbsp;
                    <span dir="ltr">{success.url}</span>
                  </>
                ) : (
                  t("addAd.successTitle")
                )}
              </p>
              {!success.pendingApproval && success.seq != null ? (
                <Link href={loc(`/b/${success.seq}`)} className={styles.successLink}>
                  {t("addAd.viewAd")}
                </Link>
              ) : !success.pendingApproval && success.url ? (
                <Link
                  href={
                    /^https?:\/\//i.test(success.url)
                      ? success.url
                      : loc(success.url.startsWith("/") ? success.url : `/${success.url}`)
                  }
                  className={styles.successLink}
                >
                  {t("addAd.viewAd")}
                </Link>
              ) : null}
            </div>
          ) : (
            <>
          <header className={styles.cardHead}>
            <div className={styles.cardKicker}>
              {editParam ? t("addAd.editKicker") : t("addAd.kicker")}
            </div>
            <h1 className={styles.cardTitle}>
              {editParam ? t("addAd.editTitle") : t("addAd.title")}
            </h1>
            <p className={styles.cardLead}>
              {editParam ? t("addAd.editLead") : t("addAd.lead")}
            </p>
          </header>

          {!authReady ? (
            <p className={styles.hint}>{t("addAd.checkingAuth")}</p>
          ) : metaLoading ? (
            <p className={styles.hint}>{t("addAd.loadingMeta")}</p>
          ) : metaErr ? (
            <p className={styles.error} role="alert">
              {metaErr}
            </p>
          ) : (
            <>
              {!user ? (
                <div className={styles.authInline}>
                  <h2 className={styles.authTitle}>{t("addAd.authTitle")}</h2>
                  <p className={styles.authLead}>{t("addAd.authLead")}</p>
                  <button
                    type="button"
                    className={styles.signIn}
                    onClick={() => void signIn()}
                  >
                    {t("addAd.signInGoogle")}
                  </button>
                </div>
              ) : null}

              {user && startChoice === "unset" && !editParam ? (
                <div
                  className={styles.modePickSection}
                  dir={locale === "en" ? "ltr" : "rtl"}
                >
                  <h2 className={styles.modePickTitle}>{t("addAd.modePickTitle")}</h2>
                  <p className={styles.modePickLead}>{t("addAd.modePickLead")}</p>
                  <div className={styles.modePickGrid}>
                    <button
                      type="button"
                      className={styles.modeCard}
                      onClick={() => {
                        setStartChoice("manual");
                        setStep(1);
                        setErr(null);
                      }}
                    >
                      <span className={styles.modeCardIcon} aria-hidden>
                        ✎
                      </span>
                      <span className={styles.modeCardKicker}>{t("addAd.sub")}</span>
                      <span className={styles.modeCardTitle}>
                        {t("addAd.modeManualTitle")}
                      </span>
                      <p className={styles.modeCardBody}>{t("addAd.modeManualBody")}</p>
                    </button>
                    <button
                      type="button"
                      className={styles.modeCard}
                      onClick={() => {
                        setStartChoice("ai");
                        setAiDraftErr(null);
                      }}
                    >
                      <span className={styles.modeCardIcon} aria-hidden>
                        ✨
                      </span>
                      <span className={styles.modeCardKicker}>AI</span>
                      <span className={styles.modeCardTitle}>{t("addAd.modeAiTitle")}</span>
                      <p className={styles.modeCardBody}>{t("addAd.modeAiBody")}</p>
                    </button>
                  </div>
                </div>
              ) : null}

              {user && startChoice === "ai" ? (
                <div
                  className={styles.aiPanel}
                  dir={locale === "en" ? "ltr" : "rtl"}
                >
                  <h2 className={styles.aiPanelTitle}>{t("addAd.aiPanelTitle")}</h2>
                  <p className={styles.aiPanelLead}>{t("addAd.aiPanelLead")}</p>
                  <div className={styles.aiExamples}>
                    <div className={styles.aiExamplesLabel}>
                      {t("addAd.aiExamplesTitle")}
                    </div>
                    <ul className={styles.aiExampleList}>
                      <li>{t("addAd.aiEx1")}</li>
                      <li>{t("addAd.aiEx2")}</li>
                      <li>{t("addAd.aiEx3")}</li>
                    </ul>
                  </div>
                  <div className={`${styles.field} ${styles.fieldFull}`}>
                    <label className={styles.label} htmlFor="ai-offering">
                      {t("addAd.aiLabelOffering")}
                    </label>
                    <textarea
                      id="ai-offering"
                      className={styles.textarea}
                      value={aiOffering}
                      onChange={(e) => setAiOffering(e.target.value)}
                      placeholder={t("addAd.aiPhOffering")}
                      rows={3}
                      dir="auto"
                    />
                  </div>
                  <div className={`${styles.field} ${styles.fieldFull}`}>
                    <label className={styles.label} htmlFor="ai-extra">
                      {t("addAd.aiLabelExtra")}
                    </label>
                    <textarea
                      id="ai-extra"
                      className={styles.textarea}
                      value={aiExtra}
                      onChange={(e) => setAiExtra(e.target.value)}
                      placeholder={t("addAd.aiPhExtra")}
                      rows={2}
                      dir="auto"
                    />
                  </div>
                  {aiDraftErr ? (
                    <div className={styles.error} role="alert">
                      {aiDraftErr}
                    </div>
                  ) : null}
                  <div className={styles.aiActions}>
                    <button
                      type="button"
                      className={styles.navBtn}
                      disabled={aiDraftBusy}
                      onClick={() => {
                        setStartChoice("unset");
                        setAiDraftErr(null);
                      }}
                    >
                      {t("addAd.stepBack")}
                    </button>
                    <button
                      type="button"
                      className={styles.submit}
                      disabled={aiDraftBusy}
                      onClick={() => void runAiDraft()}
                    >
                      {aiDraftBusy ? t("addAd.aiGenerating") : t("addAd.aiGenerate")}
                    </button>
                  </div>
                </div>
              ) : null}

              {(!user || startChoice === "manual") ? (
                <>
                  {user && startChoice === "manual" ? (
                    <button
                      type="button"
                      className={styles.modeChangeBtn}
                      onClick={() => {
                        setStartChoice("unset");
                        setStep(1);
                        setErr(null);
                      }}
                    >
                      {t("addAd.modeChange")}
                    </button>
                  ) : null}

                  <div className={styles.stepHeader}>
                <div className={styles.stepMeta}>
                  {t("addAd.stepOf", { current: step, total: totalSteps })}
                </div>
                <div className={styles.stepBar} aria-hidden="true">
                  <div
                    className={styles.stepBarFill}
                    style={{ width: `${(step / totalSteps) * 100}%` }}
                  />
                </div>
              </div>

              <div className={styles.stepChips} aria-hidden="true">
                <span className={`${styles.stepChip} ${step >= 1 ? styles.stepChipActive : ""}`}>
                  <span className={styles.stepChipIndex}>1</span>
                  {t("addAd.stepBasics")}
                </span>
                <span className={`${styles.stepChip} ${step >= 2 ? styles.stepChipActive : ""}`}>
                  <span className={styles.stepChipIndex}>2</span>
                  {t("addAd.stepDetails")}
                </span>
                <span className={`${styles.stepChip} ${step >= 3 ? styles.stepChipActive : ""}`}>
                  <span className={styles.stepChipIndex}>3</span>
                  {t("addAd.stepLocation")}
                </span>
                <span className={`${styles.stepChip} ${step >= 4 ? styles.stepChipActive : ""}`}>
                  <span className={styles.stepChipIndex}>4</span>
                  {t("addAd.stepImages")}
                </span>
                {totalSteps >= 5 ? (
                  <span className={`${styles.stepChip} ${step >= 5 ? styles.stepChipActive : ""}`}>
                    <span className={styles.stepChipIndex}>5</span>
                    {t("addAd.stepSpotlight")}
                  </span>
                ) : null}
              </div>

              <div className={`${styles.grid} ${styles.grid2}`}>
                {step === 1 ? (
                  <>
                    <div className={`${styles.field} ${styles.fieldFull}`}>
                  <label className={styles.label} htmlFor="ad-city">
                    {t("addAd.city")}
                  </label>
                  <CustomSelect
                    id="ad-city"
                    field="city"
                    value={cityId}
                    onChange={setCityId}
                    placeholder={t("addAd.cityPh")}
                    options={activeCities.map((c) => ({
                      value: c.id,
                      label: cityLabel(c),
                    }))}
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ad-dept">
                    {t("addAd.dept")}
                  </label>
                  <CustomSelect
                    id="ad-dept"
                    field="department"
                    value={departmentId}
                    onChange={onDeptChange}
                    placeholder={t("addAd.deptPh")}
                    options={departments.map((d) => ({
                      value: d.id,
                      label: d.label,
                    }))}
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ad-cat">
                    {t("addAd.category")}
                  </label>
                  <CustomSelect
                    id="ad-cat"
                    field="category"
                    value={catCode}
                    onChange={onCategoryChange}
                    placeholder={
                      !departmentId
                        ? t("addAd.catPickDept")
                        : categoriesLoading
                          ? t("addAd.catLoading")
                          : categoryOptions.length === 0
                            ? t("addAd.catEmpty")
                            : t("addAd.catPh")
                    }
                    disabled={
                      !departmentId || categoriesLoading || categoryOptions.length === 0
                    }
                    options={categoryOptions.map((c) => ({
                      value: c.code,
                      label: c.label,
                    }))}
                  />
                </div>

                {catCode && availableTags.length > 0 ? (
                  <div className={`${styles.field} ${styles.fieldFull}`}>
                    <label className={styles.label}>
                      {t("addAd.tags")} ({selectedTags.length}/{MAX_SUBCATEGORY_TAGS})
                    </label>
                    <div className={styles.tagWrap}>
                      {availableTags.map((tag) => {
                        const active = selectedTags.includes(tag);
                        const blocked = !active && selectedTags.length >= MAX_SUBCATEGORY_TAGS;
                        return (
                          <button
                            key={tag}
                            type="button"
                            className={`${styles.tagBtn} ${active ? styles.tagBtnActive : ""}`}
                            disabled={blocked}
                            onClick={() =>
                              setSelectedTags((prev) =>
                                active
                                  ? prev.filter((x) => x !== tag)
                                  : prev.length >= MAX_SUBCATEGORY_TAGS
                                    ? prev
                                    : [...prev, tag],
                              )
                            }
                            aria-pressed={active}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                    <p className={styles.hint}>{t("addAd.tagsMax2")}</p>
                  </div>
                ) : null}

                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <span className={styles.label} id="ad-main-cat-label">
                    {t("addAd.mainCategory")}
                  </span>
                  <div
                    className={styles.mainCatOptions}
                    role="radiogroup"
                    aria-labelledby="ad-main-cat-label"
                  >
                    <label className={styles.mainCatOption}>
                      <input
                        type="radio"
                        name="ad-main-category"
                        value="goods"
                        checked={mainCategory === "goods"}
                        onChange={() => setMainCategory("goods")}
                      />
                      {t("addAd.mainCategoryGoods")}
                    </label>
                    <label className={styles.mainCatOption}>
                      <input
                        type="radio"
                        name="ad-main-category"
                        value="services"
                        checked={mainCategory === "services"}
                        onChange={() => setMainCategory("services")}
                      />
                      {t("addAd.mainCategoryServices")}
                    </label>
                  </div>
                </div>

                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <label className={styles.label} htmlFor="ad-title">
                    {t("addAd.adTitle")}
                  </label>
                  <input
                    id="ad-title"
                    className={styles.input}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t("addAd.adTitlePh")}
                    dir="auto"
                  />
                </div>
                  </>
                ) : null}

                {step === 2 ? (
                  <>
                    {mainCategory === "goods" ? (
                      <>
                        {!isFree ? (
                          <div className={`${styles.field} ${styles.fieldFull}`}>
                            <label className={styles.label} htmlFor="ad-price">
                              {t("addAd.price")} <span className={styles.optional}>({t("addAd.optional")})</span>
                            </label>
                            <div className={styles.priceInputWrap}>
                              {selectedCityCurrencySymbol ? (
                                <span className={styles.pricePrefix} aria-hidden>
                                  {selectedCityCurrencySymbol}
                                </span>
                              ) : null}
                              <input
                                id="ad-price"
                                className={`${styles.input} ${
                                  selectedCityCurrencySymbol ? styles.inputWithPrefix : ""
                                }`}
                                value={priceStr}
                                onChange={(e) => setPriceStr(e.target.value)}
                                placeholder={t("addAd.pricePh")}
                                inputMode="decimal"
                                dir="ltr"
                                autoComplete="off"
                              />
                            </div>
                          </div>
                        ) : null}

                        <div className={styles.toggleRow}>
                          <div className={styles.toggleCell}>
                            <span className={styles.toggleCellLabel}>{t("addAd.toggleNewItem")}</span>
                            <label className={styles.switch} htmlFor="ad-toggle-new">
                              <input
                                id="ad-toggle-new"
                                type="checkbox"
                                className={styles.switchInput}
                                checked={isNewItem}
                                onChange={(e) => setIsNewItem(e.target.checked)}
                              />
                              <span className={styles.switchTrack} aria-hidden />
                              <span className={styles.switchKnob} aria-hidden />
                            </label>
                          </div>
                          <div className={styles.toggleCell}>
                            <span className={styles.toggleCellLabel}>
                              {t("addAd.toggleExchangeable")}
                            </span>
                            <label className={styles.switch} htmlFor="ad-toggle-exchange">
                              <input
                                id="ad-toggle-exchange"
                                type="checkbox"
                                className={styles.switchInput}
                                checked={exchangeable}
                                onChange={(e) => setExchangeable(e.target.checked)}
                              />
                              <span className={styles.switchTrack} aria-hidden />
                              <span className={styles.switchKnob} aria-hidden />
                            </label>
                          </div>
                          <div className={styles.toggleCell}>
                            <span className={styles.toggleCellLabel}>{t("addAd.toggleFree")}</span>
                            <label className={styles.switch} htmlFor="ad-toggle-free">
                              <input
                                id="ad-toggle-free"
                                type="checkbox"
                                className={styles.switchInput}
                                checked={isFree}
                                onChange={(e) => {
                                  const on = e.target.checked;
                                  setIsFree(on);
                                  if (on) setPriceStr("");
                                }}
                              />
                              <span className={styles.switchTrack} aria-hidden />
                              <span className={styles.switchKnob} aria-hidden />
                            </label>
                          </div>
                          <div className={styles.toggleCell}>
                            <span className={styles.toggleCellLabel}>
                              {t("addAd.toggleNegotiable")}
                            </span>
                            <label className={styles.switch} htmlFor="ad-toggle-negotiable">
                              <input
                                id="ad-toggle-negotiable"
                                type="checkbox"
                                className={styles.switchInput}
                                checked={negotiable}
                                onChange={(e) => setNegotiable(e.target.checked)}
                              />
                              <span className={styles.switchTrack} aria-hidden />
                              <span className={styles.switchKnob} aria-hidden />
                            </label>
                          </div>
                        </div>
                      </>
                    ) : mainCategory === "services" ? (
                      <div className={`${styles.field} ${styles.fieldFull}`}>
                        <label className={styles.label} htmlFor="ad-services">
                          {t("addAd.services")}{" "}
                          <span className={styles.optional}>({t("addAd.optional")})</span>
                        </label>
                        <textarea
                          id="ad-services"
                          className={styles.textarea}
                          value={servicesDescription}
                          onChange={(e) => setServicesDescription(e.target.value)}
                          placeholder={t("addAd.servicesPh")}
                          dir="auto"
                        />
                      </div>
                    ) : null}

                    <div className={styles.field}>
                  <label className={styles.label} htmlFor="ad-eng">
                    {t("addAd.engName")}{" "}
                    <span className={styles.optional}>({t("addAd.optional")})</span>
                  </label>
                  <input
                    id="ad-eng"
                    className={styles.input}
                    value={engName}
                    onChange={(e) => setEngName(e.target.value)}
                    placeholder={t("addAd.engNamePh")}
                    dir="ltr"
                    lang="en"
                  />
                </div>

                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <label className={styles.label} htmlFor="ad-details">
                    {t("addAd.details")}{" "}
                    <span className={styles.optional}>({t("addAd.optional")})</span>
                  </label>
                  <textarea
                    id="ad-details"
                    className={styles.textarea}
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder={t("addAd.detailsPh")}
                    dir="auto"
                  />
                </div>

                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <label className={styles.label} htmlFor="ad-address">
                    {t("addAd.address")}{" "}
                    <span className={styles.optional}>({t("addAd.optional")})</span>
                  </label>
                  <input
                    id="ad-address"
                    className={styles.input}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={t("addAd.addressPh")}
                    dir="auto"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ad-phone">
                    {t("addAd.phone")}{" "}
                    <span className={styles.optional}>({t("addAd.optional")})</span>
                  </label>
                  <input
                    id="ad-phone"
                    className={styles.input}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+44 …"
                    dir="ltr"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ad-web">
                    {t("addAd.website")}{" "}
                    <span className={styles.optional}>({t("addAd.optional")})</span>
                  </label>
                  <input
                    id="ad-web"
                    className={styles.input}
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="example.com"
                    dir="ltr"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ad-ig">
                    {t("addAd.instagram")}{" "}
                    <span className={styles.optional}>({t("addAd.optional")})</span>
                  </label>
                  <input
                    id="ad-ig"
                    className={styles.input}
                    value={instagram}
                    onChange={(e) => setInstagram(e.target.value)}
                    placeholder="@handle or URL"
                    dir="ltr"
                  />
                </div>
                  </>
                ) : null}

                {step === 3 ? (
                  <div className={`${styles.field} ${styles.fieldFull}`}>
                  <span className={styles.label}>
                    {t("addAd.map")}{" "}
                    <span className={styles.optional}>({t("addAd.optional")})</span>
                  </span>
                  <AddAdLocationPicker
                    cityCenter={mapCenter}
                    latStr={latStr}
                    lonStr={lonStr}
                    mapsApiKey={googleMapsApiKey}
                    onCoordsChange={(lat, lng) => {
                      setLatStr(lat.toFixed(6));
                      setLonStr(lng.toFixed(6));
                    }}
                    onClear={() => {
                      setLatStr("");
                      setLonStr("");
                    }}
                  />
                </div>
                ) : null}

                {step === 4 ? (
                  <div className={`${styles.field} ${styles.fieldFull}`}>
                  <span className={styles.label}>
                    {t("addAd.images")}{" "}
                    <span className={styles.imagesRequiredHint}>({t("addAd.imagesSub")})</span>
                  </span>
                  <div className={styles.imageRow}>
                    <label
                      className={`${styles.fileBtn} ${
                        imageFiles.length >= MAX_AD_IMAGES ? styles.fileBtnMuted : ""
                      }`}
                    >
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        style={{ display: "none" }}
                        disabled={imageFiles.length >= MAX_AD_IMAGES}
                        onChange={(e) => {
                          const input = e.target;
                          const list = input.files;
                          if (!list?.length) return;
                          const additions: File[] = [];
                          for (const f of Array.from(list)) {
                            if (imageFiles.length + additions.length >= MAX_AD_IMAGES) break;
                            if (!ACCEPT_IMAGE_TYPES.has(f.type)) {
                              setErr(t("addAd.errImageType"));
                              input.value = "";
                              return;
                            }
                            if (f.size > MAX_IMAGE_FILE_BYTES) {
                              setErr(t("addAd.errImageSize", { name: f.name }));
                              input.value = "";
                              return;
                            }
                            additions.push(f);
                          }
                          if (additions.length) {
                            setErr(null);
                            setImageFiles((prev) => [...prev, ...additions]);
                          }
                          input.value = "";
                        }}
                      />
                      {imageFiles.length >= MAX_AD_IMAGES ? t("addAd.maxImages") : t("addAd.addImage")}
                    </label>
                    {imageFiles.length === 0 ? (
                      <span className={styles.fileName}>{t("addAd.noImages")}</span>
                    ) : null}
                  </div>
                  {imageFiles.length > 0 ? (
                    <ul className={styles.imageList}>
                      {imageFiles.map((f, i) => {
                        const preview = imagePreviewUrls[i];
                        return (
                          <li
                            key={`${i}-${f.name}-${f.size}-${f.lastModified}`}
                            className={styles.imageListItem}
                          >
                            <div className={styles.imageThumbWrap}>
                              {preview ? (
                                <img
                                  src={preview}
                                  alt=""
                                  className={styles.imageThumb}
                                />
                              ) : (
                                <div className={styles.imageThumbFallback} aria-hidden />
                              )}
                            </div>
                            <span className={styles.imageItemName} dir="ltr" title={f.name}>
                              {f.name}
                            </span>
                            <button
                              type="button"
                              className={styles.imageRemove}
                              onClick={() => setImageFiles((p) => p.filter((_, j) => j !== i))}
                              aria-label={t("addAd.removeFileAria", { name: f.name })}
                            >
                              ×
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  <p className={styles.hint}>
                    {t("addAd.imagesHint")}
                  </p>
                </div>
                ) : null}

                {step === 5 ? (
                  <div className={`${styles.field} ${styles.fieldFull}`}>
                    <div className={styles.promoFreeBanner} role="status">
                      {t("addAd.promoFreeBanner")}
                    </div>
                    <p className={styles.promoIntro}>{t("city.promoteIntro")}</p>
                    <p className={styles.promoLead}>{t("addAd.promoStepLead")}</p>
                    <div className={styles.promoOptions} role="group" aria-label={t("addAd.stepSpotlight")}>
                      {AD_PROMOTION_TYPES.map((ty) => {
                        const keys = PROMO_HELP[ty];
                        const checked = selectedPromotionTypes.includes(ty);
                        return (
                          <label
                            key={ty}
                            className={`${styles.promoOption} ${checked ? styles.promoOptionActive : ""}`}
                          >
                            <input
                              type="checkbox"
                              className={styles.promoCheckbox}
                              checked={checked}
                              onChange={() =>
                                setSelectedPromotionTypes((prev) =>
                                  prev.includes(ty)
                                    ? prev.filter((x) => x !== ty)
                                    : [...prev, ty],
                                )
                              }
                            />
                            <span className={styles.promoOptionText}>
                              <span className={styles.promoOptionTitle}>
                                {t(keys.title)}
                              </span>
                              <span className={styles.promoOptionBody}>
                                {t(keys.body)}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <p className={styles.hint}>{t("addAd.promoSkipHint")}</p>
                  </div>
                ) : null}
              </div>

              {err ? (
                <div className={styles.error} role="alert">
                  {err}
                </div>
              ) : null}

              <div className={styles.actions}>
                <button type="button" className={styles.navBtn} onClick={prevStep} disabled={step === 1 || busy}>
                  {t("addAd.stepBack")}
                </button>
                {step < totalSteps ? (
                  <button
                    type="button"
                    className={styles.submit}
                    onClick={nextStep}
                    disabled={busy || (step === 4 && !canProceedStep4)}
                  >
                    {t("addAd.stepNext")}
                  </button>
                ) : (
                  <>
                    {!user ? (
                      <button type="button" className={styles.signIn} onClick={() => void signIn()}>
                        {t("addAd.signInGoogle")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={styles.submit}
                      disabled={busy || !user}
                      onClick={() => void submit()}
                    >
                      {busy ? t("addAd.submitting") : t("addAd.submit")}
                    </button>
                  </>
                )}
              </div>
                </>
              ) : null}
            </>
          )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
