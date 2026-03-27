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

function markerPinSymbol(
  active: boolean,
  dark: boolean,
  maps: typeof google.maps,
): google.maps.Symbol {
  const fill = active
    ? dark
      ? "#2dd4bf"
      : "#0f766e"
    : dark
      ? "#94a3b8"
      : "#64748b";
  return {
    path: PIN_PATH,
    fillColor: fill,
    fillOpacity: 1,
    strokeColor: dark ? "#0f172a" : "#ffffff",
    strokeWeight: active ? 2 : 1.5,
    scale: active ? 0.92 : 0.74,
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

export default function GoogleMapView({
  points,
  center,
  activeAdId,
  showResetButton = true,
  onAdSelect,
  onAdOpened,
  className,
  style,
}: {
  points: Array<{
    id: string;
    title: string;
    link: string | null;
    image: string | null;
    lat: number;
    lon: number;
  }>;
  center?: { lat: number; lon: number } | null;
  activeAdId?: string | null;
  showResetButton?: boolean;
  onAdSelect?: (id: string | null) => void;
  /** Visit recording + optimistic bumps when opening the ad detail page from a pin. */
  onAdOpened?: (id: string) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const router = useRouter();
  const loc = useLocalizedHref();
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const mapDark = useMapThemeDark();
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
    return markerPinSymbol(false, mapDark, maps);
  }, [isLoaded, mapDark]);

  const pinIconActive = useMemo(() => {
    if (!isLoaded) return null;
    const maps = getGoogleMaps();
    if (!maps) return null;
    return markerPinSymbol(true, mapDark, maps);
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
        Missing `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (env var not set).
        <div style={{ marginTop: 8, color: "#6b7280" }}>
          Add it to `nextjs-firebase/.env` or restart the dev server.
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
          const active = p.id === activeAdId;
          return (
            <Marker
              key={p.id}
              position={{ lat: p.lat, lng: p.lon }}
              title={p.title}
              icon={(active ? pinIconActive : pinIconIdle) ?? undefined}
              zIndex={active ? 1000 : 1}
              onClick={() => {
                const href = p.link?.trim();
                if (href) {
                  onAdOpened?.(p.id);
                  router.push(loc(href));
                  setInfoWindowId(null);
                  return;
                }
                onAdSelect?.(p.id);
                setInfoWindowId(p.id);
              }}
            />
          );
        })}
        {infoWindowPoint ? (
          <InfoWindow
            position={{ lat: infoWindowPoint.lat, lng: infoWindowPoint.lon }}
            onCloseClick={() => setInfoWindowId(null)}
            options={{
              pixelOffset: mapsApi ? new mapsApi.Size(0, -40) : undefined,
            }}
          >
            <div
              style={{
                direction: "rtl",
                textAlign: "right",
                maxWidth: 220,
                padding: "2px 2px 4px",
                fontSize: 14,
                fontWeight: 700,
                lineHeight: 1.35,
                color: "var(--text-strong, #0f172a)",
              }}
            >
              {infoWindowPoint.title}
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
