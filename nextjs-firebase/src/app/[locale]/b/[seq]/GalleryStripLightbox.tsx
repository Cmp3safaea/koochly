"use client";

import { useEffect, useState } from "react";
import styles from "./AdDetailsPage.module.css";

type Props = {
  images: string[];
  title: string;
};

export default function GalleryStripLightbox({ images, title }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

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
      <div className={styles.galleryStrip} role="list" aria-label="Ad images">
        {images.map((src, idx) => (
          <button
            key={`${src}-${idx}`}
            type="button"
            className={styles.galleryThumbBtn}
            onClick={() => setOpenIndex(idx)}
            role="listitem"
            aria-label={`Open image ${idx + 1}`}
          >
            <img src={src} alt={title} className={styles.galleryThumb} loading="lazy" />
          </button>
        ))}
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
