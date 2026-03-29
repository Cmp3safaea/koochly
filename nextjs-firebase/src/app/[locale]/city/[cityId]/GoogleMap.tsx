"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { GoogleMap, InfoWindow, Marker, useLoadScript } from "@react-google-maps/api";
import type { Libraries } from "@react-google-maps/api";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useLocalizedHref } from "../../../../i18n/client";
import { MAP_STYLES_DARK, MAP_STYLES_LIGHT } from "./mapStyles";

// Must be stable across renders so @react-google-maps/api doesn't reload the script.
// Classic `Marker` does not need the `marker` library (that is for AdvancedMarkerElement);
// loading it can cause loader issues in some setups.
const GOOGLE_MAP_LIBRARIES: Libraries = [];

/** Teardrop pin in user space; tip near (24, 51). Use with `google.maps.Symbol`, not SVG data URLs (gradients/filters often render blank as map icons). */
const PIN_PATH =
  "M24 3C12.8 3 5 11.1 5 20c0 8.5 7.5 18.5 19 31 11.5-12.5 19-22.5 19-31C43 11.1 35.2 3 24 3z";

function getGoogleMaps(): typeof google.maps | null {
  if (typeof globalThis === "undefined") return null;
  const w = globalThis as typeof globalThis & {
    google?: { maps?: typeof google.maps };
  };
  return w.google?.maps ?? null;
}

type PinVariant = "idle" | "hover" | "active";

/** Idle = slate gray; hover = warm amber (list hover); active = teal (selected / details). */
function markerPinSymbolVariant(
  variant: PinVariant,
  dark: boolean,
  maps: typeof google.maps,
): google.maps.Symbol {
  const strokeColor = dark ? "#0f172a" : "#ffffff";
  if (variant === "idle") {
    return {
      path: PIN_PATH,
      fillColor: dark ? "#94a3b8" : "#64748b",
      fillOpacity: 1,
      strokeColor,
      strokeWeight: 1.5,
      scale: 0.74,
      anchor: new maps.Point(24, 51),
    };
  }
  if (variant === "hover") {
    return {
      path: PIN_PATH,
      fillColor: dark ? "#fbbf24" : "#d97706",
      fillOpacity: 1,
      strokeColor,
      strokeWeight: 2,
      scale: 0.88,
      anchor: new maps.Point(24, 51),
    };
  }
  return {
    path: PIN_PATH,
    fillColor: dark ? "#2dd4bf" : "#0f766e",
    fillOpacity: 1,
    strokeColor,
    strokeWeight: 2,
    scale: 0.92,
    anchor: new maps.Point(24, 51),
  };
}

function subscribeDataTheme(cb: () => void) {
  const el = document.documentElement;
  const mo = new MutationObserver(cb);
  mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

function snapshotIsDark() {
  return document.documentElement.dataset.theme === "dark";
}

function useMapThemeDark() {
  return useSyncExternalStore(subscribeDataTheme, snapshotIsDark, () => false);
}

const COMPACT_MAP_POPUP_MQ = "(max-width: 640px)";

function subscribeCompactMapPopup(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(COMPACT_MAP_POPUP_MQ);
  const handler = () => cb();
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}

function snapshotCompactMapPopup() {
  if (typeof window === "undefined") return false;
  return window.matchMedia(COMPACT_MAP_POPUP_MQ).matches;
}

/** Narrow viewports: smaller marker InfoWindow (image + type). SSR default false for hydration. */
function useCompactMapPopup() {
  return useSyncExternalStore(
    subscribeCompactMapPopup,
    snapshotCompactMapPopup,
    () => false,
  );
}

export default function GoogleMapView({
  points,
  center,
  activeAdId,
  hoverAdId,
  showResetButton = true,
  onAdSelect,
  onAdOpened,
  popupViewLabel,
  popupIsRtl = true,
  className,
  style,
  mapsApiKey: mapsApiKeyProp,
}: {
  points: Array<{
    id: string;
    title: string;
    category?: string | null;
    link: string | null;
    image: string | null;
    lat: number;
    lon: number;
  }>;
  center?: { lat: number; lon: number } | null;
  activeAdId?: string | null;
  /** Desktop list hover: highlight the matching pin without changing selection. */
  hoverAdId?: string | null;
  showResetButton?: boolean;
  onAdSelect?: (id: string | null) => void;
  /** Visit recording + optimistic bumps when opening the ad detail page from a pin. */
  onAdOpened?: (id: string) => void;
  /** Label for the detail CTA inside the marker popup (i18n). */
  popupViewLabel: string;
  popupIsRtl?: boolean;
  className?: string;
  style?: CSSProperties;
  mapsApiKey?: string;
}) {
  const router = useRouter();
  const loc = useLocalizedHref();
  const apiKey =
    (mapsApiKeyProp?.trim() ||
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
      "") || "";
  const mapDark = useMapThemeDark();
  const compactPopup = useCompactMapPopup();
  const mapStyles = mapDark ? MAP_STYLES_DARK : MAP_STYLES_LIGHT;
  const mapBackgroundColor = mapDark ? "#0f172a" : "#e8ecf1";

  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: apiKey,
    libraries: GOOGLE_MAP_LIBRARIES,
    // Prevent script from reloading; safe default.
    id: "koochly-google-maps",
  });

  const mapRef = useRef<google.maps.Map | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  /** Which marker’s name popup is open (marker click only; closes on map click or ✕). */
  const [infoWindowId, setInfoWindowId] = useState<string | null>(null);

  const mapStateRef = useRef({
    activeAdId: activeAdId ?? null,
    points,
  });
  mapStateRef.current = {
    activeAdId: activeAdId ?? null,
    points,
  };

  const infoWindowPoint = useMemo(
    () => (infoWindowId ? points.find((p) => p.id === infoWindowId) : undefined),
    [infoWindowId, points],
  );

  const initialCenter = useMemo(() => {
    if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon)) {
      return { lat: center.lat, lng: center.lon };
    }
    const first = points[0];
    return { lat: first?.lat ?? 0, lng: first?.lon ?? 0 };
  }, [points, center]);

  /**
   * After resize: when an ad is selected from the list (or map), center that pin and
   * zoom in so the location is readable. Single-ad cities use a slightly wider zoom.
   */
  const SELECTED_AD_ZOOM_SINGLE = 14;
  const SELECTED_AD_ZOOM_MULTI = 16;

  const resetToDefaultView = () => {
    const map = mapRef.current;
    if (!map) return;
    setInfoWindowId(null);
    onAdSelect?.(null);

    if (points.length === 0) {
      if (center) {
        map.setCenter({ lat: center.lat, lng: center.lon });
        map.setZoom(11);
      }
      return;
    }

    if (points.length === 1) {
      const p = points[0];
      map.setCenter({ lat: p.lat, lng: p.lon });
      map.setZoom(14);
      return;
    }

    if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon)) {
      map.setCenter({ lat: center.lat, lng: center.lon });
      map.setZoom(12);
      return;
    }

    const p = points[0];
    map.setCenter({ lat: p.lat, lng: p.lon });
    map.setZoom(12);
  };

  const resizeAndFocusSelection = (map: google.maps.Map) => {
    const maps = getGoogleMaps();
    maps?.event.trigger(map, "resize");
    requestAnimationFrame(() => {
      if (!maps) return;
      const { activeAdId: id, points: pts } = mapStateRef.current;
      if (!id || pts.length === 0) return;

      const selected = pts.find((p) => p.id === id);
      if (!selected) return;

      map.setCenter({ lat: selected.lat, lng: selected.lon });
      map.setZoom(
        pts.length === 1 ? SELECTED_AD_ZOOM_SINGLE : SELECTED_AD_ZOOM_MULTI,
      );
    });
  };

  useEffect(() => {
    if (!isLoaded || !mapLoaded) return;

    if (!mapRef.current) return;

    if (points.length === 0) {
      if (center) {
        mapRef.current.setCenter({ lat: center.lat, lng: center.lon });
        mapRef.current.setZoom(11);
      }
      return;
    }

    if (points.length === 1) {
      const p = points[0];
      mapRef.current.setCenter({ lat: p.lat, lng: p.lon });
      mapRef.current.setZoom(14);
      return;
    }

    // City center when available; otherwise first ad. No fitBounds — fixed zoom for a calmer panel.
    if (center && Number.isFinite(center.lat) && Number.isFinite(center.lon)) {
      mapRef.current.setCenter({ lat: center.lat, lng: center.lon });
      mapRef.current.setZoom(12);
      return;
    }

    const p = points[0];
    mapRef.current.setCenter({ lat: p.lat, lng: p.lon });
    mapRef.current.setZoom(12);
  }, [isLoaded, mapLoaded, points, center]);

  useEffect(() => {
    if (!isLoaded || !mapLoaded || !mapRef.current) return;
    const map = mapRef.current;
    const div = map.getDiv();
    const ro = new ResizeObserver(() => resizeAndFocusSelection(map));
    ro.observe(div);
    return () => ro.disconnect();
  }, [isLoaded, mapLoaded]);

  // When user selects an ad from the list, pan after resize so markers are visible.
  useEffect(() => {
    if (!isLoaded || !mapLoaded || !mapRef.current || !activeAdId) return;
    resizeAndFocusSelection(mapRef.current);
  }, [activeAdId, isLoaded, mapLoaded, points]);

  useEffect(() => {
    if (!isLoaded || !mapLoaded || !mapRef.current) return;
    mapRef.current.setOptions({
      styles: mapDark ? MAP_STYLES_DARK : MAP_STYLES_LIGHT,
      backgroundColor: mapBackgroundColor,
    });
  }, [isLoaded, mapLoaded, mapDark, mapBackgroundColor]);

  const pinIconIdle = useMemo(() => {
    if (!isLoaded) return null;
    const maps = getGoogleMaps();
    if (!maps) return null;
    return markerPinSymbolVariant("idle", mapDark, maps);
  }, [isLoaded, mapDark]);

  const pinIconHover = useMemo(() => {
    if (!isLoaded) return null;
    const maps = getGoogleMaps();
    if (!maps) return null;
    return markerPinSymbolVariant("hover", mapDark, maps);
  }, [isLoaded, mapDark]);

  const pinIconActive = useMemo(() => {
    if (!isLoaded) return null;
    const maps = getGoogleMaps();
    if (!maps) return null;
    return markerPinSymbolVariant("active", mapDark, maps);
  }, [isLoaded, mapDark]);

  if (loadError) {
    return (
      <div className={className} style={{ width: "100%" }}>
        Failed to load Google Maps.
        <div style={{ marginTop: 8, color: "#b91c1c", fontWeight: 700 }}>
          {loadError.message}
        </div>
      </div>
    );
  }

  if (!apiKey) {
    return (
      <div className={className} style={{ width: "100%" }}>
        Maps API key is not set. Pass <code>mapsApiKey</code> from the server, or set{" "}
        <code>GOOGLE_MAPS_BROWSER_KEY</code> (recommended on Cloud Run) or{" "}
        <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> in <code>.env</code> for local dev.
        <div style={{ marginTop: 8, color: "#6b7280" }}>
          Rebuild the image after changing build-time env; runtime-only{" "}
          <code>NEXT_PUBLIC_*</code> may be empty if it was not present at{" "}
          <code>next build</code>.
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className={className} style={{ width: "100%" }}>
        Loading map...
      </div>
    );
  }

  const mapsApi = getGoogleMaps();

  return (
    <div
      className={className}
      style={{
        width: "100%",
        minHeight: 280,
        ...(style ?? {}),
      }}
    >
      <GoogleMap
        onLoad={(map) => {
          mapRef.current = map;
          setMapLoaded(true);
        }}
        onClick={() => setInfoWindowId(null)}
        mapContainerStyle={{
          width: "100%",
          height: "100%",
          minHeight: 280,
        }}
        center={initialCenter}
        zoom={points.length === 1 ? 14 : points.length === 0 ? 11 : 6}
        options={{
          disableDefaultUI: true,
          zoomControl: true,
          zoomControlOptions: mapsApi
            ? {
                position: mapsApi.ControlPosition.LEFT_BOTTOM,
              }
            : undefined,
          mapTypeControl: false,
          streetViewControl: false,
          styles: mapStyles,
          backgroundColor: mapBackgroundColor,
          gestureHandling: "greedy",
          clickableIcons: false,
        }}
      >
        {points.map((p) => {
          const variant: PinVariant =
            p.id === activeAdId
              ? "active"
              : p.id === hoverAdId
                ? "hover"
                : "idle";
          const icon =
            variant === "active"
              ? pinIconActive
              : variant === "hover"
                ? pinIconHover
                : pinIconIdle;
          const z =
            p.id === hoverAdId ? 1002 : p.id === activeAdId ? 1000 : 1;
          return (
            <Marker
              key={p.id}
              position={{ lat: p.lat, lng: p.lon }}
              title={p.title}
              icon={icon ?? undefined}
              zIndex={z}
              onClick={() => {
                onAdSelect?.(p.id);
                setInfoWindowId(p.id);
              }}
            />
          );
        })}
        {infoWindowPoint ? (
          <InfoWindow
            key={infoWindowPoint.id}
            position={{ lat: infoWindowPoint.lat, lng: infoWindowPoint.lon }}
            onCloseClick={() => setInfoWindowId(null)}
            options={{
              pixelOffset: mapsApi
                ? new mapsApi.Size(0, compactPopup ? -36 : -40)
                : undefined,
            }}
          >
            <div
              style={{
                direction: popupIsRtl ? "rtl" : "ltr",
                textAlign: popupIsRtl ? "right" : "left",
                maxWidth: compactPopup ? 188 : 240,
                padding: compactPopup ? "2px 0 4px" : "4px 2px 6px",
                fontFamily: "var(--font-app)",
                fontSize: "inherit",
                lineHeight: 1.5,
                color: "var(--text-strong)",
                WebkitFontSmoothing: "antialiased",
                MozOsxFontSmoothing: "grayscale",
              }}
            >
              {infoWindowPoint.image ? (
                <img
                  src={infoWindowPoint.image}
                  alt=""
                  width={compactPopup ? 180 : 220}
                  height={compactPopup ? 68 : 100}
                  style={{
                    display: "block",
                    width: "100%",
                    maxWidth: compactPopup ? 188 : 220,
                    height: compactPopup ? 68 : 100,
                    objectFit: "cover",
                    borderRadius: compactPopup ? 10 : 12,
                    marginBottom: compactPopup ? 6 : 8,
                  }}
                  loading="lazy"
                />
              ) : null}
              <div
                style={{
                  margin: 0,
                  fontSize: compactPopup ? "0.82rem" : "0.94rem",
                  fontWeight: 900,
                  lineHeight: 1.32,
                  color: "var(--text-strong)",
                  wordBreak: "break-word",
                  marginBottom:
                    infoWindowPoint.category?.trim() || infoWindowPoint.link?.trim()
                      ? compactPopup
                        ? 4
                        : 6
                      : 0,
                }}
              >
                {infoWindowPoint.title}
              </div>
              {infoWindowPoint.category?.trim() ? (
                <div
                  style={{
                    margin: 0,
                    marginTop: 2,
                    padding: 0,
                    fontSize: compactPopup ? "0.65rem" : "0.72rem",
                    fontWeight: 600,
                    lineHeight: 1.4,
                    color: "var(--text-muted)",
                    letterSpacing: "0.01em",
                    marginBottom: infoWindowPoint.link?.trim()
                      ? compactPopup
                        ? 6
                        : 8
                      : 0,
                  }}
                >
                  {infoWindowPoint.category.trim()}
                </div>
              ) : null}
              {infoWindowPoint.link?.trim() ? (
                <button
                  type="button"
                  style={{
                    width: "100%",
                    margin: 0,
                    padding: compactPopup ? "6px 8px" : "8px 10px",
                    borderRadius: compactPopup ? 8 : 10,
                    border: "1px solid var(--accent-border-mid)",
                    background: "var(--accent-soft-10)",
                    color: "var(--accent)",
                    fontWeight: 800,
                    fontSize: compactPopup ? "0.78rem" : "0.875rem",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                  onClick={() => {
                    onAdOpened?.(infoWindowPoint.id);
                    router.push(loc(infoWindowPoint.link!.trim()));
                    setInfoWindowId(null);
                  }}
                >
                  {popupViewLabel}
                </button>
              ) : null}
            </div>
          </InfoWindow>
        ) : null}
      </GoogleMap>
      {showResetButton && activeAdId ? (
        <button
          type="button"
          onClick={resetToDefaultView}
          title="Reset map view"
          aria-label="Reset map view"
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 10,
            width: 34,
            height: 34,
            borderRadius: 8,
            border: "1px solid rgba(15,23,42,0.18)",
            background: "rgba(255,255,255,0.95)",
            color: "#0f172a",
            fontSize: 18,
            lineHeight: 1,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          ↺
        </button>
      ) : null}
    </div>
  );
}
