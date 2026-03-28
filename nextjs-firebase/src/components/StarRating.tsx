"use client";

import styles from "./StarRating.module.css";

const STAR_PATH =
  "M10 1.5l2.6 5.5 6 .9-4.3 4.1 1 5.9L10 15.9 4.7 17.9l1-5.9L1.4 7.9l6-.9L10 1.5z";

type Props = {
  /** Average or single rating (e.g. 4.3). Clamped to [0, max]. */
  value: number;
  max?: number;
  size?: "sm" | "md";
  className?: string;
  /** Accessible label for the group (e.g. "4.2 stars out of 5") */
  ariaLabel?: string;
};

export default function StarRating({
  value,
  max = 5,
  size = "md",
  className = "",
  ariaLabel,
}: Props) {
  const m = Math.max(1, Math.floor(max));
  const v = Math.min(m, Math.max(0, value));

  const stars: number[] = [];
  for (let i = 0; i < m; i++) {
    const full = i + 1;
    const frac = Math.min(1, Math.max(0, v - i));
    stars.push(frac);
  }

  const sizeClass = size === "sm" ? styles.sm : styles.md;

  return (
    <span
      className={`${styles.wrap} ${sizeClass} ${className}`.trim()}
      role="img"
      aria-label={ariaLabel ?? `${v.toFixed(1)} stars out of ${m}`}
    >
      {stars.map((frac, i) => (
        <span key={i} className={styles.starSlot} aria-hidden>
          <svg className={styles.starBg} viewBox="0 0 20 20" width="1em" height="1em">
            <path d={STAR_PATH} fill="currentColor" />
          </svg>
          {frac > 0 ? (
            <span className={styles.starFg} style={{ width: `${frac * 100}%` }}>
              <svg viewBox="0 0 20 20" width="1em" height="1em">
                <path d={STAR_PATH} fill="currentColor" />
              </svg>
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}
