"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { onAuthStateChanged, type User } from "firebase/auth";
import styles from "./page.module.css";
import { AuthWelcome } from "../AuthWelcome";
import { useI18n, useLocalizedHref } from "../../i18n/client";
import { logoPublicPath } from "@koochly/shared";
import { getAuthClientOrNull, isFirebaseClientConfigured } from "../../lib/firebaseClient";
import { useDocumentTheme } from "../../lib/useDocumentTheme";
import { getCitiesCached } from "../../lib/citiesClientCache";
import { HomeSplash } from "./HomeSplash";

type City = {
  id: string;
  active?: boolean;
  city_fa?: string;
  city_eng?: string;
  country_fa?: string;
  country_eng?: string;
  flag_url?: string;
} & Record<string, unknown>;

type EventItem = {
  id: string;
  event: string;
  desc: string;
  event_image: string;
};

export default function HomePage() {
  const { t, locale } = useI18n();
  const docTheme = useDocumentTheme();
  const loc = useLocalizedHref();
  const [cities, setCities] = useState<City[]>([]);
  const [citiesStatus, setCitiesStatus] = useState<string | null>(null);
  const [openCountry, setOpenCountry] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [profileCity, setProfileCity] = useState("");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventsStatus, setEventsStatus] = useState<string | null>(null);
  const [eventIndex, setEventIndex] = useState(0);
  const authConfigured = isFirebaseClientConfigured();
  // We only show cities where `active === true` (or `active` is missing).

  function getCityDisplayName(city: City): string {
    const cityFa = city.city_fa;
    if (typeof cityFa === "string" && cityFa.trim().length > 0) return cityFa;

    const cityEn = city.city_eng;
    if (typeof cityEn === "string" && cityEn.trim().length > 0) return cityEn;

    // Generic fallbacks for other schemas.
    return city.id;
  }

  function getCountryDisplayName(city: City): string {
    const countryFa = city.country_fa;
    if (typeof countryFa === "string" && countryFa.trim().length > 0) return countryFa;

    const countryEn = city.country_eng;
    if (typeof countryEn === "string" && countryEn.trim().length > 0) return countryEn;

    return "—";
  }

  async function loadCities({ silent }: { silent?: boolean } = {}) {
    const data = await getCitiesCached(5 * 60 * 1000, "withAds");
    setCities((data.cities as City[]) ?? []);
    if (!silent) setCitiesStatus(null);
    setHasLoaded(true);
  }

  async function loadEvents() {
    const res = await fetch("/api/events", { method: "GET" });
    const data = (await res.json().catch(() => ({}))) as {
      events?: Array<Record<string, unknown>>;
      error?: string;
    };
    if (!res.ok) throw new Error(data?.error ?? "Failed to load events");
    const normalized = Array.isArray(data.events)
      ? data.events
          .map((raw, idx) => {
            const id =
              typeof raw.id === "string" && raw.id.trim()
                ? raw.id.trim()
                : String(idx);
            const event = typeof raw.event === "string" ? raw.event.trim() : "";
            const desc = typeof raw.desc === "string" ? raw.desc.trim() : "";
            const event_image =
              typeof raw.event_image === "string" ? raw.event_image.trim() : "";
            return { id, event, desc, event_image };
          })
          .filter((e) => e.event || e.desc || e.event_image)
      : [];
    setEvents(normalized);
    setEventsStatus(null);
    setEventIndex((prev) => (normalized.length === 0 ? 0 : Math.min(prev, normalized.length - 1)));
  }

  const activeCities = useMemo(
    () => cities.filter((c) => c.active === true),
    [cities],
  );

  const countries = useMemo(() => {
    type CountryGroup = {
      country: string;
      flagUrl?: string;
      cities: City[];
      // Used to order the accordion list for countries.
      // We pick the minimum city order value inside the country.
      order: number;
    };

    const q = search.trim().toLowerCase();

    const map = new Map<string, CountryGroup>();

    const matchesQuery = (city: City): boolean => {
      if (!q) return true;
      const cityFa = city.city_fa;
      const cityEn = city.city_eng;
      const candidates: string[] = [];
      if (typeof cityFa === "string" && cityFa.trim().length > 0) {
        candidates.push(cityFa);
      }
      if (typeof cityEn === "string" && cityEn.trim().length > 0) {
        candidates.push(cityEn);
      }
      return candidates.some((c) => c.toLowerCase().includes(q));
    };

    for (const city of activeCities) {
      if (!matchesQuery(city)) continue;
      const country = getCountryDisplayName(city);
      if (!map.has(country)) {
        map.set(country, {
          country,
          flagUrl: city.flag_url,
          cities: [],
          order: Number.POSITIVE_INFINITY,
        });
      }

      const group = map.get(country)!;
      if (!group.flagUrl && city.flag_url) group.flagUrl = city.flag_url;
      group.cities.push(city);

      // Update group order as the smallest numeric `order` we see.
      const raw = (city.order as unknown) ?? null;
      const n = raw === null ? NaN : Number(raw);
      if (Number.isFinite(n)) group.order = Math.min(group.order, n);
    }

    const groups = Array.from(map.values());
    groups.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.country.localeCompare(b.country);
    });

    for (const g of groups) {
      g.cities.sort((x, y) => {
        const xoRaw = (x.order as unknown) ?? null;
        const yoRaw = (y.order as unknown) ?? null;

        const xo =
          xoRaw === null
            ? Infinity
            : (() => {
                const n = Number(xoRaw);
                return Number.isFinite(n) ? n : Infinity;
              })();
        const yo =
          yoRaw === null
            ? Infinity
            : (() => {
                const n = Number(yoRaw);
                return Number.isFinite(n) ? n : Infinity;
              })();

        if (xo !== yo) return xo - yo;
        // Tie-breaker for deterministic UI.
        return String(x.id).localeCompare(String(y.id));
      });
    }

    return groups;
  }, [activeCities, search]);

  const profileCityHref = useMemo(() => {
    if (!profileCity.trim()) return null;
    const q = profileCity.trim().toLowerCase();
    const matched = activeCities.find((c) => {
      const fa = typeof c.city_fa === "string" ? c.city_fa.trim().toLowerCase() : "";
      const en = typeof c.city_eng === "string" ? c.city_eng.trim().toLowerCase() : "";
      const id = typeof c.id === "string" ? c.id.trim().toLowerCase() : "";
      return fa === q || en === q || id === q;
    });
    if (!matched) return null;
    const country =
      typeof matched.country_eng === "string" && matched.country_eng.trim()
        ? matched.country_eng
        : getCountryDisplayName(matched);
    const city =
      typeof matched.city_eng === "string" && matched.city_eng.trim()
        ? matched.city_eng
        : typeof matched.city_fa === "string" && matched.city_fa.trim()
          ? matched.city_fa
          : matched.id;
    return loc(`/${encodeURIComponent(country)}/${encodeURIComponent(city)}/`);
  }, [profileCity, activeCities, loc]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async (silent: boolean) => {
      try {
        await loadCities({ silent });
      } catch (e: unknown) {
        if (cancelled) return;
        const msg =
          e instanceof Error ? e.message : typeof e === "string" ? e : "";
        setCitiesStatus(String(msg || e));
        setHasLoaded(true);
      }
    };

    // Initial load (show loading/errors)
    void refresh(false);

    // Refresh occasionally and when tab regains focus.
    const intervalMs = 120000;
    const id = window.setInterval(() => {
      void refresh(true);
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh(true);
      }
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadEvents();
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "Failed to load events";
        setEventsStatus(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (events.length <= 1) return;
    const id = setInterval(() => {
      setEventIndex((prev) => (prev + 1) % events.length);
    }, 5000);
    return () => clearInterval(id);
  }, [events]);

  useEffect(() => {
    if (!authConfigured) return;
    const auth = getAuthClientOrNull();
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, [authConfigured]);

  useEffect(() => {
    if (!user) {
      setProfileCity("");
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
          profile?: { city?: string };
        };
        if (!res.ok || cancelled) return;
        setProfileCity(typeof json.profile?.city === "string" ? json.profile.city.trim() : "");
      } catch {
        if (!cancelled) setProfileCity("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (countries.length === 0) {
      setOpenCountry(null);
      return;
    }

    if (openCountry && !countries.some((c) => c.country === openCountry)) {
      setOpenCountry(null);
    }
  }, [countries, openCountry]);

  return (
    <>
      <HomeSplash />
      <div
        className={styles.pageBackground}
        style={{ backgroundImage: "url(/background.png)" }}
        aria-hidden="true"
      />
      <header className={styles.topBar}>
        <div className={styles.brand}>
          <div className={styles.brandLockup}>
            <div className={styles.brandRow}>
              <img
                src={logoPublicPath(locale, docTheme)}
                alt={t("home.brand")}
                className={styles.logo}
                decoding="async"
                fetchPriority="high"
              />
            </div>
            <AuthWelcome />
          </div>
        </div>
      </header>

      <main className={styles.container}>
        {!hasLoaded ? (
          <div className={styles.loadingOverlay} aria-hidden="true">
            <div className={styles.loadingSpinner} />
            <div className={styles.loadingWelcome}>
              {t("home.loadingWelcome")}
              <div className={styles.loadingSubtitle}>
                {t("home.loadingSubtitle")}
              </div>
            </div>
          </div>
        ) : null}
        <div className={styles.twoPanelLayout}>
          <div className={styles.rightPanel}>
        <div className={styles.hero}>
          <h1 className={styles.heroTitle}>
            {user && profileCity ? (
              profileCityHref ? (
                <Link href={profileCityHref} className={styles.heroCityLink}>
                  {t("home.heroTitleWithCity", { city: profileCity })}
                </Link>
              ) : (
                t("home.heroTitleWithCity", { city: profileCity })
              )
            ) : (
              t("home.heroTitle")
            )}
          </h1>
          {user && profileCity ? (
            <p className={styles.sub}>
              {t("home.heroExploreMoreCities")}
            </p>
          ) : null}
          {user ? (
            <div className={styles.heroActions}>
              <Link href={loc("/add-ad")} className={styles.heroAddAd}>
                {t("auth.addYourAd")}
              </Link>
            </div>
          ) : null}
          <div className={styles.searchRow}>
            <input
              className={styles.searchInput}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("home.searchPlaceholder")}
              aria-label={t("home.searchAria")}
            />
          </div>
        </div>

        <section className={styles.section}>
          {citiesStatus ? <p className={styles.status}>{citiesStatus}</p> : null}
          {!citiesStatus && hasLoaded && countries.length === 0 ? (
            <p className={styles.status}>{t("home.noCountry")}</p>
          ) : null}
        <div className={styles.countriesStack}>
          {countries.map((countryGroup) => {
            const isOpen = openCountry === countryGroup.country;
            return (
              <div key={countryGroup.country} className={styles.countryCard}>
                <button
                  type="button"
                  className={styles.accordionHeader}
                  onClick={() =>
                    setOpenCountry(
                      isOpen ? null : countryGroup.country,
                    )
                  }
                  aria-expanded={isOpen}
                >
                  {countryGroup.flagUrl ? (
                    <img
                      className={styles.flag}
                      src={countryGroup.flagUrl}
                      alt={countryGroup.country}
                      loading="lazy"
                    />
                  ) : null}

                  <h2 className={styles.countryTitle}>{countryGroup.country}</h2>

                  <span
                    className={`${styles.chevron} ${
                      isOpen ? styles.chevronOpen : ""
                    }`}
                    aria-hidden="true"
                  />
                </button>

                <div
                  className={`${styles.countryBody} ${
                    isOpen ? styles.countryBodyOpen : ""
                  }`}
                >
                  <ul className={styles.cityList}>
                    {countryGroup.cities.map((c) => (
                      <li key={c.id} className={styles.cityItem}>
                        <Link
                          href={loc(
                            `/${encodeURIComponent(
                              typeof c.country_eng === "string" && c.country_eng.trim()
                                ? c.country_eng
                                : countryGroup.country,
                            )}/${encodeURIComponent(
                              typeof c.city_eng === "string" && c.city_eng.trim()
                                ? c.city_eng
                                : typeof c.city_fa === "string" &&
                                    c.city_fa.trim().length > 0
                                  ? c.city_fa
                                  : c.id,
                            )}/`,
                          )}
                          className={styles.cityLink}
                          prefetch={false}
                        >
                          {getCityDisplayName(c)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </section>
          </div>

          <div className={styles.leftPanel}>
            <section className={styles.infoSection}>
          <h2 className={styles.infoHeading} id="about">
            {t("home.infoWhatTitle")}
          </h2>
          <p className={styles.infoParagraph}>
            {t("home.infoWhatBody")}
          </p>
          <section className={styles.eventsPanel} aria-label="Persiana events">
            <h3 className={styles.eventsHeading}>Events</h3>
            {eventsStatus ? <p className={styles.eventsStatus}>{eventsStatus}</p> : null}
            {!eventsStatus && events.length === 0 ? (
              <p className={styles.eventsStatus}>No events yet.</p>
            ) : null}
            {events.length > 0 ? (
              <>
                <div className={styles.eventSlide}>
                  {events[eventIndex]?.event_image ? (
                    <img
                      src={events[eventIndex].event_image}
                      alt={events[eventIndex].event || "Event image"}
                      className={styles.eventImage}
                      loading="lazy"
                    />
                  ) : null}
                  <h4 className={styles.eventTitle}>{events[eventIndex]?.event}</h4>
                  <p className={styles.eventDesc}>{events[eventIndex]?.desc}</p>
                </div>
                {events.length > 1 ? (
                  <div className={styles.eventDots} aria-hidden="true">
                    {events.map((e, idx) => (
                      <button
                        key={e.id}
                        type="button"
                        className={`${styles.eventDot} ${idx === eventIndex ? styles.eventDotActive : ""}`}
                        onClick={() => setEventIndex(idx)}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </section>

          <h2 className={styles.infoHeading2} id="help">
            {t("home.infoHowTitle")}
          </h2>
          <p className={styles.infoParagraph}>
            {t("home.infoHowBody")}
          </p>

          <div className={styles.infoCards}>
            <div className={styles.infoCard}>
              <div className={styles.infoIcon} aria-hidden="true">
                {/* Search icon */}
                <svg viewBox="0 0 64 64" width="48" height="48" fill="none">
                  <circle cx="28" cy="28" r="14" stroke="currentColor" strokeWidth="4" />
                  <path
                    d="M39.5 39.5L52 52"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  <path
                    d="M18 24c2-4 6-6 10-6"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <h3 className={styles.infoCardTitle}>{t("home.cardSearchTitle")}</h3>
              <p className={styles.infoCardText}>
                {t("home.cardSearchBody")}
              </p>
            </div>

            <div className={styles.infoCard}>
              <div className={styles.infoIcon} aria-hidden="true">
                {/* Document/register icon */}
                <svg viewBox="0 0 64 64" width="48" height="48" fill="none">
                  <rect
                    x="14"
                    y="12"
                    width="36"
                    height="44"
                    rx="4"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    d="M22 24h20M22 32h20M22 40h12"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  <circle cx="26" cy="20" r="2.8" fill="currentColor" />
                  <circle cx="32" cy="20" r="2.8" fill="currentColor" />
                </svg>
              </div>
              <h3 className={styles.infoCardTitle}>{t("home.cardRegisterTitle")}</h3>
              <p className={styles.infoCardText}>
                {t("home.cardRegisterBody")}
              </p>
            </div>

            <div className={styles.infoCard}>
              <div className={styles.infoIcon} aria-hidden="true">
                {/* Handshake icon */}
                <svg viewBox="0 0 64 64" width="48" height="48" fill="none">
                  <path
                    d="M18 34l10-10c2-2 5-2 7 0l2 2"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  <path
                    d="M30 24l6 6"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  <path
                    d="M20 38l-6 6"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  <path
                    d="M42 26l8-8"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  <path
                    d="M28 40l8 8c2 2 5 2 7 0l5-5"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  <path
                    d="M24 30l-4-4"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <h3 className={styles.infoCardTitle}>{t("home.cardConnectTitle")}</h3>
              <p className={styles.infoCardText}>
                {t("home.cardConnectBody")}
              </p>
            </div>
          </div>
        </section>
          </div>
        </div>
      </main>
    </>
  );
}

