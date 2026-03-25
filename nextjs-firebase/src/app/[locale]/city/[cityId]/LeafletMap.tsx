"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CityAdCard } from "./CityAdsViewClient";
import styles from "./CityAdsViewClient.module.css";
import "leaflet/dist/leaflet.css";

// Leaflet imports
// This component is no longer used (Google Maps replaced Leaflet).
// Kept in the repo in case you want to switch back.
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import type { LatLngExpression } from "leaflet";

function FitBounds({ points }: { points: any[] }) {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length === 0) return;
    const bounds = L.latLngBounds(
      points.map((p) => [p.lat, p.lon] as [number, number]),
    );
    map.fitBounds(bounds, { padding: [28, 28] });
  }, [map, points]);
  return null;
}

export default function LeafletMap({
  points,
  className,
}: {
  points: Array<{
    id: string;
    title: string;
    link: string | null;
    image: string | null;
    lat: number;
    lon: number;
  }>;
  className?: string;
  style?: any;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const center = useMemo<LatLngExpression>(() => {
    const first = points[0];
    return [first.lat, first.lon];
  }, [points]);

  const markerIcon = useMemo(() => {
    // Use a simple DivIcon to avoid marker image asset issues.
    return L.divIcon({
      className: styles.leafletMarker,
      html: `<div class="${styles.leafletMarkerInner}"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
  }, []);

  return (
    <div ref={containerRef} className={className}>
      <MapContainer
        center={center}
        zoom={6}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} />

        {points.map((p) => (
          <Marker
            key={p.id}
            position={[p.lat, p.lon]}
            icon={markerIcon}
          >
            <Popup>
              <div style={{ minWidth: 190 }}>
                {p.image ? (
                  <img
                    src={p.image}
                    alt={p.title}
                    width={140}
                    height={80}
                    style={{
                      borderRadius: 12,
                      objectFit: "cover",
                      display: "block",
                      marginBottom: 8,
                    }}
                    loading="lazy"
                  />
                ) : null}
                <div style={{ fontWeight: 800, marginBottom: 6 }}>
                  {p.title}
                </div>
                {p.link ? (
                  <a
                    href={p.link}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#0f766e", textDecoration: "none" }}
                  >
                    مشاهده
                  </a>
                ) : null}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

