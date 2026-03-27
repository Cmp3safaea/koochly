"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { GoogleMap, Marker, useLoadScript } from "@react-google-maps/api";
import type { Libraries } from "@react-google-maps/api";
import { MAP_STYLES_DARK, MAP_STYLES_LIGHT } from "../city/[cityId]/mapStyles";
import { useI18n } from "../../../i18n/client";
import styles from "./AddAdLocationPicker.module.css";

const LIBRARIES: Libraries = [];
const SCRIPT_ID = "koochly-google-maps";

const DEFAULT_CENTER = { lat: 54.25, lng: -2.75 }; /* rough UK centroid */

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

function parseCoord(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

type Props = {
  /** When set (e.g. from selected city), map defaults here before a marker exists. */
  cityCenter: { lat: number; lng: number } | null;
  latStr: string;
  lonStr: string;
  onCoordsChange: (lat: number, lon: number) => void;
  onClear?: () => void;
  mapsApiKey?: string;
};

export default function AddAdLocationPicker({
  cityCenter,
  latStr,
  lonStr,
  onCoordsChange,
  onClear,
  mapsApiKey: mapsApiKeyProp,
}: Props) {
  const { t } = useI18n();
  const apiKey =
    (mapsApiKeyProp?.trim() ||
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
      "") || "";
  const mapDark = useMapThemeDark();
  const mapStyles = mapDark ? MAP_STYLES_DARK : MAP_STYLES_LIGHT;
  const mapBackgroundColor = mapDark ? "#0f172a" : "#e8ecf1";

  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: apiKey,
    libraries: LIBRARIES,
    id: SCRIPT_ID,
  });

  const markerPos = useMemo(() => {
    const lat = parseCoord(latStr);
    const lng = parseCoord(lonStr);
    if (lat === null || lng === null) return null;
    return { lat, lng };
  }, [latStr, lonStr]);

  const center = useMemo(() => {
    if (markerPos) return markerPos;
    if (cityCenter && Number.isFinite(cityCenter.lat) && Number.isFinite(cityCenter.lng)) {
      return cityCenter;
    }
    return DEFAULT_CENTER;
  }, [markerPos, cityCenter]);

  const zoom = markerPos ? 15 : cityCenter ? 11 : 6;

  const onMapClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      const ll = e.latLng;
      if (!ll) return;
      onCoordsChange(ll.lat(), ll.lng());
    },
    [onCoordsChange],
  );

  const onDragEnd = useCallback(
    (e: google.maps.MapMouseEvent) => {
      const ll = e.latLng;
      if (!ll) return;
      onCoordsChange(ll.lat(), ll.lng());
    },
    [onCoordsChange],
  );

  if (loadError) {
    return (
      <div className={styles.shell}>
        <div className={styles.fallback}>
          {t("addAdMap.loadErr")}
          <div className={styles.fallbackErr}>{loadError.message}</div>
        </div>
      </div>
    );
  }

  if (!apiKey) {
    return (
      <div className={styles.shell}>
        <div className={styles.fallback}>
          {t("addAdMap.needKey")}
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className={styles.shell}>
        <div className={styles.fallback}>{t("addAdMap.loading")}</div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <p className={styles.hint}>
        {t("addAdMap.hint")}
      </p>
      <div className={styles.mapWrap}>
        <GoogleMap
          mapContainerClassName={styles.mapInner}
          center={center}
          zoom={zoom}
          onClick={onMapClick}
          options={{
            disableDefaultUI: true,
            zoomControl: true,
            mapTypeControl: false,
            streetViewControl: false,
            styles: mapStyles,
            backgroundColor: mapBackgroundColor,
            gestureHandling: "greedy",
            clickableIcons: false,
          }}
        >
          {markerPos ? (
            <Marker
              position={markerPos}
              draggable
              onDragEnd={onDragEnd}
            />
          ) : null}
        </GoogleMap>
      </div>
      {markerPos ? (
        <div className={styles.actions}>
          <span className={styles.selectedStatus} role="status">
            <span className={styles.selectedIcon} aria-hidden>✓</span>
            {t("addAdMap.selected")}
          </span>
          {onClear ? (
            <button type="button" className={styles.clearBtn} onClick={onClear}>
              {t("addAdMap.clearMarker")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
