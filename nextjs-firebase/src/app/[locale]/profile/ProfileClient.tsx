"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signInWithPopup, type User } from "firebase/auth";
import {
  getAuthClientOrNull,
  getGoogleProvider,
  isFirebaseClientConfigured,
} from "../../../lib/firebaseClient";
import { getCitiesCached } from "../../../lib/citiesClientCache";
import { useI18n, useLocalizedHref } from "../../../i18n/client";
import { telHref, type Locale } from "@koochly/shared";
import cityStyles from "../city/[cityId]/CityAdsViewClient.module.css";
import styles from "./ProfilePage.module.css";

type RecentVisitRow = {
  adId: string;
  seq: number | null;
  title: string;
  engName: string | null;
  category: string | null;
  description: string | null;
  subcats: string[];
  image: string | null;
  phone: string | null;
  city: string;
  viewedAtMs: number;
  hrefPath: string | null;
  missing: boolean;
  approved: boolean;
  paidAds: boolean;
  paidAdsExpiresAtMs: number | null;
};

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

function EditIcon({ className }: { className?: string }) {
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
      <path d="M12 20h9" />
      <path d="m16.5 3.5 4 4L8 20l-5 1 1-5 12.5-12.5Z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
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
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function formatViewedAgo(viewedAtMs: number, locale: Locale): string {
  const intlLocale = locale === "fa" ? "fa-IR" : "en-GB";
  const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: "auto" });
  const diffSec = Math.round((viewedAtMs - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 86400 * 45) return rtf.format(Math.round(diffSec / (86400 * 7)), "week");
  if (abs < 86400 * 335) return rtf.format(Math.round(diffSec / (86400 * 30)), "month");
  return rtf.format(Math.round(diffSec / (86400 * 365)), "year");
}

type FavoriteAdRow = Omit<RecentVisitRow, "viewedAtMs">;

type Tr = (key: string, vars?: Record<string, string | number>) => string;

function WorkspaceAdCard({
  row,
  mode,
  locale,
  t,
  loc,
  router,
  phonesOpen,
  setPhonesOpen,
  onRemoveFavorite,
  removingId,
}: {
  row: RecentVisitRow | FavoriteAdRow;
  mode: "recent" | "favorite";
  locale: Locale;
  t: Tr;
  loc: (path: string) => string;
  router: ReturnType<typeof useRouter>;
  phonesOpen: Record<string, boolean>;
  setPhonesOpen: Dispatch<SetStateAction<Record<string, boolean>>>;
  onRemoveFavorite?: (adId: string) => void;
  removingId?: string | null;
}) {
  const paidValid =
    row.paidAds === true &&
    typeof row.paidAdsExpiresAtMs === "number" &&
    Number.isFinite(row.paidAdsExpiresAtMs) &&
    row.paidAdsExpiresAtMs > Date.now();
  const valid = row.approved === true && !row.missing;
  const catLine = [row.category, row.city].filter(Boolean).join(" · ");
  const canOpen = Boolean(row.hrefPath && !row.missing);
  const viewedAtMs = mode === "recent" && "viewedAtMs" in row ? row.viewedAtMs : 0;

  const showFavoriteRemove = mode === "favorite" && onRemoveFavorite;
  const showLinkOrPhone = !row.missing && (row.hrefPath || row.phone);

  return (
    <article
      className={`${cityStyles.card} ${paidValid ? cityStyles.cardPaidValid : valid ? cityStyles.cardValid : ""}`}
      style={canOpen ? { cursor: "pointer" } : undefined}
      onClick={() => {
        if (!canOpen) return;
        router.push(loc(row.hrefPath!));
      }}
    >
      <div className={cityStyles.cardTop}>
        <div className={cityStyles.cardThumb}>
          {row.image && !row.missing ? (
            <img
              className={cityStyles.cardImg}
              src={row.image}
              alt={row.title}
              loading="lazy"
            />
          ) : (
            <div className={cityStyles.cardImgPlaceholder} />
          )}
        </div>
        <div className={cityStyles.cardBody}>
          <h3 className={cityStyles.cardTitle}>
            {row.missing ? t("profile.recentRemoved") : row.title}
          </h3>
          {row.engName && !row.missing ? (
            <p className={cityStyles.cardEngName} dir="ltr" lang="en">
              {row.engName}
            </p>
          ) : null}
          {catLine ? <div className={cityStyles.cardCat}>{catLine}</div> : null}
          {!row.missing && row.subcats.length > 0 ? (
            <div className={cityStyles.cardSubcatWrap}>
              {row.subcats.map((tag) => (
                <span key={`${row.adId}-${tag}`} className={cityStyles.cardSubcatChip}>
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          {row.description && !row.missing ? (
            <p className={cityStyles.cardDesc}>{row.description}</p>
          ) : null}
        </div>
      </div>

      <div className={cityStyles.cardFoot}>
        {showLinkOrPhone || showFavoriteRemove ? (
          <div className={cityStyles.cardFootActions}>
            {row.hrefPath ? (
              <Link
                className={`${cityStyles.cardLink} ${cityStyles.cardFootBtn}`}
                href={loc(row.hrefPath)}
                title={t("city.view")}
                aria-label={t("city.view")}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <CardOpenIcon className={cityStyles.cardLinkIcon} />
              </Link>
            ) : null}
            {row.phone ? (
              phonesOpen[row.adId] ? (
                <a
                  href={telHref(row.phone)}
                  dir="ltr"
                  className={`${cityStyles.cardPhoneLink} ${cityStyles.cardPhoneLinkFoot}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  {row.phone}
                </a>
              ) : (
                <button
                  type="button"
                  className={cityStyles.cardPhoneShowBtn}
                  title={t("city.showPhoneTitle")}
                  aria-label={t("city.showPhoneAria", { title: row.title })}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPhonesOpen((p) => ({ ...p, [row.adId]: true }));
                  }}
                >
                  <CardRevealEyeIcon className={cityStyles.cardPhoneShowBtnIcon} />
                  <span>{t("city.showPhone")}</span>
                </button>
              )
            ) : null}
            {mode === "favorite" && onRemoveFavorite ? (
              <button
                type="button"
                className={styles.favoriteRemoveBtn}
                disabled={removingId === row.adId}
                title={t("profile.removeFavorite")}
                aria-label={t("profile.removeFavoriteAria", { title: row.title })}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveFavorite(row.adId);
                }}
              >
                {t("profile.removeFavorite")}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className={cityStyles.cardFootMeta}>
          {mode === "recent" && viewedAtMs > 0 ? (
            <>
              <span className={cityStyles.cardVisits}>{t("profile.recentVisitLabel")}</span>
              <div className={cityStyles.cardAddedAgo} suppressHydrationWarning>
                {formatViewedAgo(viewedAtMs, locale)}
              </div>
            </>
          ) : (
            <span className={cityStyles.cardVisits}>{t("profile.favoriteSavedLabel")}</span>
          )}
        </div>
      </div>
    </article>
  );
}

type ProfileRow = {
  display_name: string;
  email: string;
  phone_number: string;
  city: string;
  address: string;
  website: string;
  instogram: string;
  isBusiness: boolean;
  photo_url: string;
  location: { lat: number; lng: number };
};

type CityOption = { id: string; city_fa?: string; city_eng?: string; active?: boolean };

type MyAdRow = {
  adId: string;
  seq: number | null;
  title: string;
  approved: boolean;
  image: string | null;
  city: string;
};

function resolveWorkspaceBackPath(profileCity: string, cities: CityOption[]): string {
  const selected = profileCity.trim();
  if (!selected) return "/";
  const match = cities.find((c) => {
    const fa = (c.city_fa ?? "").trim();
    const en = (c.city_eng ?? "").trim();
    const id = c.id.trim();
    return selected === fa || selected === en || selected === id;
  });
  const cityKey = (match?.city_eng ?? match?.city_fa ?? match?.id ?? selected).trim();
  return cityKey ? `/city/${encodeURIComponent(cityKey)}` : "/";
}

const EMPTY_PROFILE: ProfileRow = {
  display_name: "",
  email: "",
  phone_number: "",
  city: "",
  address: "",
  website: "",
  instogram: "",
  isBusiness: false,
  photo_url: "",
  location: { lat: 0, lng: 0 },
};

export default function ProfileClient({ showWorkspaceHeader = false }: { showWorkspaceHeader?: boolean }) {
  const { t, locale } = useI18n();
  const loc = useLocalizedHref();
  const router = useRouter();
  const configured = isFirebaseClientConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<ProfileRow>(EMPTY_PROFILE);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [tab, setTab] = useState<"profile" | "recent" | "favorites" | "myAds" | "billing">(
    "profile",
  );
  const [cities, setCities] = useState<CityOption[]>([]);
  const [recentVisits, setRecentVisits] = useState<RecentVisitRow[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentErr, setRecentErr] = useState<string | null>(null);
  const [recentTick, setRecentTick] = useState(0);
  const [cardPhonesOpen, setCardPhonesOpen] = useState<Record<string, boolean>>({});
  const [favoriteAds, setFavoriteAds] = useState<FavoriteAdRow[]>([]);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [favoriteErr, setFavoriteErr] = useState<string | null>(null);
  const [favoriteRemovingId, setFavoriteRemovingId] = useState<string | null>(null);
  const [myAds, setMyAds] = useState<MyAdRow[]>([]);
  const [myAdsLoading, setMyAdsLoading] = useState(false);
  const [myAdsErr, setMyAdsErr] = useState<string | null>(null);
  const [myAdDeletingId, setMyAdDeletingId] = useState<string | null>(null);
  const [confirmDeleteAd, setConfirmDeleteAd] = useState<{ adId: string; title: string } | null>(
    null,
  );

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
        const json = await getCitiesCached();
        if (cancelled) return;
        const rows = Array.isArray(json.cities) ? (json.cities as CityOption[]) : [];
        setCities(rows.filter((c) => c.active === true));
      } catch {
        // Keep UI usable even when cities can't load.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/user/profile", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json().catch(() => ({}))) as {
          profile?: Partial<ProfileRow>;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? "Failed to load profile");
        if (cancelled) return;
        const p = json.profile ?? {};
        setProfile({
          display_name: p.display_name ?? user.displayName ?? "",
          email: p.email ?? user.email ?? "",
          phone_number: p.phone_number ?? "",
          city: p.city ?? "",
          address: p.address ?? "",
          website: p.website ?? "",
          instogram: p.instogram ?? "",
          isBusiness: p.isBusiness === true,
          photo_url: p.photo_url ?? user.photoURL ?? "",
          location: {
            lat: typeof p.location?.lat === "number" ? p.location.lat : 0,
            lng: typeof p.location?.lng === "number" ? p.location.lng : 0,
          },
        });
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (tab !== "recent") return;
    const id = window.setInterval(() => {
      setRecentTick((n) => n + 1);
    }, 60_000);
    return () => window.clearInterval(id);
  }, [tab]);

  useEffect(() => {
    if (!user || tab !== "recent") return;
    let cancelled = false;
    (async () => {
      setRecentLoading(true);
      setRecentErr(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/user/recent-visits", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json().catch(() => ({}))) as {
          visits?: RecentVisitRow[];
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? t("profile.recentLoadErr"));
        if (cancelled) return;
        setRecentVisits(Array.isArray(json.visits) ? json.visits : []);
      } catch (e) {
        if (!cancelled) {
          setRecentVisits([]);
          setRecentErr(e instanceof Error ? e.message : t("profile.recentLoadErr"));
        }
      } finally {
        if (!cancelled) setRecentLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, tab, t]);

  useEffect(() => {
    if (!user || tab !== "favorites") return;
    let cancelled = false;
    (async () => {
      setFavoriteLoading(true);
      setFavoriteErr(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/user/bookmarked-ads", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json().catch(() => ({}))) as {
          ads?: FavoriteAdRow[];
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? t("profile.favoriteLoadErr"));
        if (cancelled) return;
        setFavoriteAds(Array.isArray(json.ads) ? json.ads : []);
      } catch (e) {
        if (!cancelled) {
          setFavoriteAds([]);
          setFavoriteErr(e instanceof Error ? e.message : t("profile.favoriteLoadErr"));
        }
      } finally {
        if (!cancelled) setFavoriteLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, tab, t]);

  useEffect(() => {
    if (!user || tab !== "myAds") return;
    let cancelled = false;
    (async () => {
      setMyAdsLoading(true);
      setMyAdsErr(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/user/my-ads", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json().catch(() => ({}))) as {
          ads?: MyAdRow[];
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? t("profile.myAdsLoadErr"));
        if (cancelled) return;
        setMyAds(Array.isArray(json.ads) ? json.ads : []);
      } catch (e) {
        if (!cancelled) {
          setMyAds([]);
          setMyAdsErr(e instanceof Error ? e.message : t("profile.myAdsLoadErr"));
        }
      } finally {
        if (!cancelled) setMyAdsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, tab, t]);

  const removeFavorite = useCallback(
    async (adId: string) => {
      if (!user) return;
      setFavoriteRemovingId(adId);
      setFavoriteErr(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/user/bookmarks", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ adId, bookmark: false }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "remove");
        setFavoriteAds((prev) => prev.filter((r) => r.adId !== adId));
        setCardPhonesOpen((p) => {
          const next = { ...p };
          delete next[adId];
          return next;
        });
      } catch (e) {
        setFavoriteErr(e instanceof Error ? e.message : t("profile.favoriteLoadErr"));
      } finally {
        setFavoriteRemovingId(null);
      }
    },
    [user, t],
  );

  const save = async () => {
    if (!user) return;
    setLoading(true);
    setErr(null);
    setOk(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(profile),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setOk(t("admin.saved"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLoading(false);
    }
  };

  const deleteMyAd = useCallback(
    async (adId: string) => {
      if (!user) return;
      setMyAdDeletingId(adId);
      setMyAdsErr(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch(`/api/user/my-ads/${encodeURIComponent(adId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? t("profile.myAdsDeleteErr"));
        setMyAds((prev) => prev.filter((r) => r.adId !== adId));
      } catch (e) {
        setMyAdsErr(e instanceof Error ? e.message : t("profile.myAdsDeleteErr"));
      } finally {
        setMyAdDeletingId(null);
        setConfirmDeleteAd((prev) => (prev?.adId === adId ? null : prev));
      }
    },
    [user, t],
  );

  if (!configured) return <p className={styles.msg}>{t("addAd.notConfigured")}</p>;
  if (!authReady) return <p className={styles.msg}>{t("addAd.checkingAuth")}</p>;
  if (!user) {
    return (
      <main className={styles.page}>
        <p className={styles.msg}>{t("addAd.authTitle")}</p>
        <button
          type="button"
          className={styles.btn}
          onClick={async () => {
            const auth = getAuthClientOrNull();
            if (!auth) return;
            await signInWithPopup(auth, getGoogleProvider());
          }}
        >
          {t("addAd.signInGoogle")}
        </button>
      </main>
    );
  }

  const workspaceBackPath = resolveWorkspaceBackPath(profile.city, cities);

  return (
    <main className={styles.page}>
      {showWorkspaceHeader ? (
        <header className={styles.workspaceHeader}>
          <Link href={loc("/")} className={styles.workspaceBrand}>
            <img
              src="/divaro.png"
              alt={t("home.brand")}
              className={styles.workspaceLogo}
              decoding="async"
            />
          </Link>
          <Link href={loc(workspaceBackPath)} className={styles.workspaceBackLink}>
            {t("admin.backHome")}
          </Link>
        </header>
      ) : null}
      <div className={styles.head}>
        <h1>{t("profile.workspaceTitle")}</h1>
        {!showWorkspaceHeader ? (
          <Link href={loc(workspaceBackPath)} className={styles.link}>
            {t("admin.backHome")}
          </Link>
        ) : null}
      </div>
      <section className={styles.tabRow}>
        <button
          type="button"
          className={tab === "profile" ? styles.tabBtnActive : styles.tabBtn}
          onClick={() => setTab("profile")}
        >
          👤 {t("profile.tabProfile")}
        </button>
        <button
          type="button"
          className={tab === "recent" ? styles.tabBtnActive : styles.tabBtn}
          onClick={() => setTab("recent")}
        >
          🕘 {t("profile.tabRecent")}
        </button>
        <button
          type="button"
          className={tab === "favorites" ? styles.tabBtnActive : styles.tabBtn}
          onClick={() => setTab("favorites")}
        >
          ❤️ {t("profile.tabFavorites")}
        </button>
        <button
          type="button"
          className={tab === "myAds" ? styles.tabBtnActive : styles.tabBtn}
          onClick={() => setTab("myAds")}
        >
          📋 {t("profile.tabMyAds")}
        </button>
        <button
          type="button"
          className={tab === "billing" ? styles.tabBtnActive : styles.tabBtn}
          onClick={() => setTab("billing")}
        >
          💳 {t("profile.tabBilling")}
        </button>
      </section>

      <section className={styles.panel}>
        {tab === "profile" ? (
          <>
            <div className={styles.grid}>
              <label>
                {t("profile.displayName")}
                <input
                  dir="auto"
                  value={profile.display_name}
                  onChange={(e) => setProfile((p) => ({ ...p, display_name: e.target.value }))}
                />
              </label>
              <label>
                {t("profile.email")}
                <input value={profile.email} disabled />
              </label>
              <label>
                {t("profile.city")}
                <select
                  value={profile.city}
                  onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))}
                >
                  <option value="">{t("addAd.cityPh")}</option>
                  {cities.map((c) => {
                    const label = c.city_fa && c.city_eng ? `${c.city_fa} · ${c.city_eng}` : c.city_fa || c.city_eng || c.id;
                    const value = c.city_fa || c.city_eng || c.id;
                    return (
                      <option key={c.id} value={value}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label>
                {t("profile.phone")}
                <input
                  dir="auto"
                  value={profile.phone_number}
                  onChange={(e) => setProfile((p) => ({ ...p, phone_number: e.target.value }))}
                />
              </label>
              <label>
                {t("profile.address")}
                <input
                  dir="auto"
                  value={profile.address}
                  onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))}
                />
              </label>
              <label>
                {t("profile.website")}
                <input
                  dir="auto"
                  value={profile.website}
                  onChange={(e) => setProfile((p) => ({ ...p, website: e.target.value }))}
                />
              </label>
              <label>
                {t("profile.instagram")}
                <input
                  dir="auto"
                  value={profile.instogram}
                  onChange={(e) => setProfile((p) => ({ ...p, instogram: e.target.value }))}
                />
              </label>
            </div>
            {err ? <p className={styles.err}>{err}</p> : null}
            {ok ? <p className={styles.ok}>{ok}</p> : null}
            <button type="button" className={styles.btn} onClick={() => void save()} disabled={loading}>
              {loading ? t("addAd.submitting") : t("profile.save")}
            </button>
          </>
        ) : null}

        {tab === "recent" ? (
          <>
            {recentLoading ? (
              <p className={styles.msg}>{t("profile.recentLoading")}</p>
            ) : recentErr ? (
              <p className={styles.err}>{recentErr}</p>
            ) : recentVisits.length === 0 ? (
              <p className={styles.msg}>{t("profile.recentEmpty")}</p>
            ) : (
              <div className={cityStyles.cards} data-recent-tick={recentTick}>
                {recentVisits.map((row) => (
                  <WorkspaceAdCard
                    key={row.adId}
                    row={row}
                    mode="recent"
                    locale={locale}
                    t={t}
                    loc={loc}
                    router={router}
                    phonesOpen={cardPhonesOpen}
                    setPhonesOpen={setCardPhonesOpen}
                  />
                ))}
              </div>
            )}
          </>
        ) : null}

        {tab === "favorites" ? (
          <>
            {favoriteLoading ? (
              <p className={styles.msg}>{t("profile.favoriteLoading")}</p>
            ) : favoriteErr ? (
              <p className={styles.err}>{favoriteErr}</p>
            ) : favoriteAds.length === 0 ? (
              <p className={styles.msg}>{t("profile.favoriteEmpty")}</p>
            ) : (
              <div className={cityStyles.cards}>
                {favoriteAds.map((row) => (
                  <WorkspaceAdCard
                    key={row.adId}
                    row={row}
                    mode="favorite"
                    locale={locale}
                    t={t}
                    loc={loc}
                    router={router}
                    phonesOpen={cardPhonesOpen}
                    setPhonesOpen={setCardPhonesOpen}
                    onRemoveFavorite={removeFavorite}
                    removingId={favoriteRemovingId}
                  />
                ))}
              </div>
            )}
          </>
        ) : null}

        {tab === "myAds" ? (
          <>
            {myAdsLoading ? (
              <p className={styles.msg}>{t("profile.myAdsLoading")}</p>
            ) : myAdsErr ? (
              <p className={styles.err}>{myAdsErr}</p>
            ) : myAds.length === 0 ? (
              <p className={styles.msg}>{t("profile.myAdsEmpty")}</p>
            ) : (
              <div className={styles.myAdsList}>
                {myAds.map((row) => (
                  <div key={row.adId} className={styles.myAdRow}>
                    <div className={styles.myAdThumb}>
                      {row.image ? (
                        <img src={row.image} alt="" loading="lazy" />
                      ) : null}
                    </div>
                    <div className={styles.myAdBody}>
                      <h3 className={styles.myAdTitle}>{row.title}</h3>
                      <div className={styles.myAdMeta}>
                        {row.city ? `${row.city}` : ""}
                        {row.seq != null ? (row.city ? " · " : "") + `#${row.seq}` : ""}
                      </div>
                    </div>
                    <div className={styles.myAdActions}>
                      <span
                        className={`${styles.approvalBadge} ${
                          row.approved ? styles.approvalBadgeOk : styles.approvalBadgeWait
                        }`}
                      >
                        {row.approved ? t("profile.myAdsApproved") : t("profile.myAdsPending")}
                      </span>
                      <div className={styles.myAdActionButtons}>
                        <Link
                          href={loc(`/add-ad?edit=${encodeURIComponent(row.adId)}`)}
                          className={`${styles.adActionIconBtn} ${styles.adActionEdit}`}
                          title={t("profile.myAdsEdit")}
                          aria-label={t("profile.myAdsEditAria", { title: row.title })}
                        >
                          <EditIcon className={styles.adActionIcon} />
                        </Link>
                        <button
                          type="button"
                          className={`${styles.adActionIconBtn} ${styles.adActionDelete}`}
                          title={t("profile.myAdsDelete")}
                          aria-label={t("profile.myAdsDeleteAria", { title: row.title })}
                          disabled={myAdDeletingId === row.adId}
                          onClick={() => setConfirmDeleteAd({ adId: row.adId, title: row.title })}
                        >
                          <TrashIcon className={styles.adActionIcon} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}

        {tab === "billing" ? (
          <div className={styles.comingSoon}>
            <div className={styles.comingIcon}>✨</div>
            <h3>{t("profile.comingSoonTitle")}</h3>
            <p>{t("profile.comingSoonBody")}</p>
          </div>
        ) : null}
      </section>
      {confirmDeleteAd ? (
        <div
          className={styles.confirmOverlay}
          role="presentation"
          onClick={() => {
            if (!myAdDeletingId) setConfirmDeleteAd(null);
          }}
        >
          <div
            className={styles.confirmModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-ad-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-ad-confirm-title" className={styles.confirmTitle}>
              {t("profile.myAdsDelete")}
            </h3>
            <p className={styles.confirmText}>
              {t("profile.myAdsDeleteConfirm", { title: confirmDeleteAd.title })}
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.confirmCancelBtn}
                onClick={() => setConfirmDeleteAd(null)}
                disabled={myAdDeletingId === confirmDeleteAd.adId}
              >
                {locale === "fa" ? "انصراف" : "Cancel"}
              </button>
              <button
                type="button"
                className={styles.confirmDeleteBtn}
                onClick={() => void deleteMyAd(confirmDeleteAd.adId)}
                disabled={myAdDeletingId === confirmDeleteAd.adId}
              >
                {myAdDeletingId === confirmDeleteAd.adId
                  ? t("addAd.submitting")
                  : t("profile.myAdsDelete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
