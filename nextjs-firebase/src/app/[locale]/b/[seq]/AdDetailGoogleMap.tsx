"use client";

import dynamic from "next/dynamic";
import styles from "./AdDetailsPage.module.css";

const GoogleMapView = dynamic(() => import("../../city/[cityId]/GoogleMap"), {
  ssr: false,
});

export default function AdDetailGoogleMap({
  adId,
  title,
  lat,
  lon,
  heroImage,
}: {
  adId: string;
  title: string;
  lat: number;
  lon: number;
  heroImage: string | null;
}) {
  return (
    <GoogleMapView
      className={styles.mapFrame}
      points={[
        {
          id: adId,
          title,
          link: null,
          image: heroImage,
          lat,
          lon,
        },
      ]}
      center={{ lat, lon }}
      activeAdId={adId}
    />
  );
}
