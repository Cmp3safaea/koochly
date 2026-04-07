"use client";

import { useEffect, useState, useCallback } from "react";
import { logoPublicPathUi } from "@koochly/shared";
import { useI18n } from "../../i18n/client";
import { useDocumentTheme } from "../../lib/useDocumentTheme";
import styles from "./HomeSplash.module.css";

const HOLD_MS = 2400;
const EXIT_MS = 720;

export function HomeSplash() {
  const { t, locale } = useI18n();
  const docTheme = useDocumentTheme();
  const logoSrc = logoPublicPathUi(locale, docTheme);
  const [exiting, setExiting] = useState(false);
  const [gone, setGone] = useState(false);

  const dismiss = useCallback(() => {
    setExiting(true);
  }, []);

  useEffect(() => {
    if (gone) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [gone]);

  useEffect(() => {
    const id = window.setTimeout(dismiss, HOLD_MS);
    return () => clearTimeout(id);
  }, [dismiss]);

  useEffect(() => {
    if (!exiting) return;
    const id = window.setTimeout(() => setGone(true), EXIT_MS);
    return () => clearTimeout(id);
  }, [exiting]);

  if (gone) return null;

  return (
    <div
      className={`${styles.root} ${exiting ? styles.rootExit : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={t("home.splashAria")}
    >
      <div className={styles.scrim} aria-hidden />
      <div className={styles.shine} aria-hidden />
      <div className={styles.content}>
        <img
          src={logoSrc}
          alt={t("home.brand")}
          className={styles.logo}
          decoding="async"
          fetchPriority="high"
        />
      </div>
      <button type="button" className={styles.skip} onClick={dismiss}>
        {t("home.splashSkip")}
      </button>
    </div>
  );
}
