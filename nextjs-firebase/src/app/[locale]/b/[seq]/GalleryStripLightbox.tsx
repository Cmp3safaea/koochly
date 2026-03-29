"use client";

import { useEffect, useState } from "react";
import { useI18n } from "../../../../i18n/client";
import styles from "./AdDetailsPage.module.css";

type Props = {
  images: string[];
  title: string;
};

function EnlargeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

export default function GalleryStripLightbox({ images, title }: Props) {
  const { t } = useI18n();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    if (openIndex === null) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [openIndex]);

  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIndex(null);
      if (e.key === "ArrowRight") {
        setOpenIndex((prev) => (prev === null ? 0 : (prev + 1) % images.length));
      }
      if (e.key === "ArrowLeft") {
        setOpenIndex((prev) => (prev === null ? 0 : (prev - 1 + images.length) % images.length));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex, images.length]);

  if (images.length === 0) return null;

  return (
    <>
      <div className={styles.galleryBlock}>
        <div
          className={styles.galleryStrip}
          role="list"
          aria-label={t("adDetail.galleryListAria")}
        >
          {images.map((src, idx) => (
            <button
              key={`${src}-${idx}`}
              type="button"
              className={styles.galleryThumbBtn}
              onClick={() => setOpenIndex(idx)}
              role="listitem"
              title={t("adDetail.galleryHint")}
              aria-label={`${t("adDetail.galleryOpenImage", {
                n: String(idx + 1),
                total: String(images.length),
              })}. ${t("adDetail.galleryHint")}`}
            >
              <span className={styles.galleryThumbInner}>
                <img src={src} alt="" className={styles.galleryThumb} loading="lazy" />
                <span className={styles.galleryThumbOverlay}>
                  <EnlargeIcon className={styles.galleryEnlargeGlyph} />
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {openIndex !== null ? (
        <div className={styles.lightbox} onClick={() => setOpenIndex(null)} role="dialog" aria-modal="true">
          <button
            type="button"
            className={styles.lightboxClose}
            onClick={() => setOpenIndex(null)}
            aria-label="Close"
          >
            x
          </button>
          <button
            type="button"
            className={styles.lightboxNavLeft}
            onClick={(e) => {
              e.stopPropagation();
              setOpenIndex((prev) => (prev === null ? 0 : (prev - 1 + images.length) % images.length));
            }}
            aria-label="Previous image"
          >
            {"<"}
          </button>
          <img
            src={images[openIndex]}
            alt={title}
            className={styles.lightboxImg}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className={styles.lightboxNavRight}
            onClick={(e) => {
              e.stopPropagation();
              setOpenIndex((prev) => (prev === null ? 0 : (prev + 1) % images.length));
            }}
            aria-label="Next image"
          >
            {">"}
          </button>
        </div>
      ) : null}
    </>
  );
}
