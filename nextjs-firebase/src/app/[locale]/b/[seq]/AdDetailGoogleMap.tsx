"use client";

import dynamic from "next/dynamic";
import styles from "./AdDetailsPage.module.css";
import { useI18n } from "../../../../i18n/client";

const GoogleMapView = dynamic(() => import("../../city/[cityId]/GoogleMap"), {
  ssr: false,
});

export default function AdDetailGoogleMap({
  adId,
  title,
  category,
  lat,
  lon,
  heroImage,
  googleMapsApiKey,
}: {
  adId: string;
  title: string;
  /** Display category label (e.g. `ad.cat` on the detail page). */
  category?: string | null;
  lat: number;
  lon: number;
  heroImage: string | null;
  googleMapsApiKey?: string;
}) {
  const { t, locale } = useI18n();
  return (
    <GoogleMapView
      className={styles.mapFrame}
      mapsApiKey={googleMapsApiKey}
      popupViewLabel={t("city.view")}
      popupIsRtl={locale === "fa"}
      points={[
        {
          id: adId,
          title,
          category: category?.trim() ? category.trim() : null,
          link: null,
          image: heroImage,
          lat,
          lon,
        },
      ]}
      center={{ lat, lon }}
      activeAdId={adId}
      showResetButton={false}
    />
  );
}
