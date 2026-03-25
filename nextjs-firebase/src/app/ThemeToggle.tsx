"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { useI18n } from "../i18n/client";
import styles from "./ThemeToggle.module.css";

const STORAGE_KEY = "koochly-theme";

export type Theme = "light" | "dark";

function resolveInitialTheme(): Theme {
  if (typeof window === "undefined" || typeof document === "undefined") return "light";

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // Ignore storage errors (private mode, blocked storage, etc).
  }

  const dataset = document.documentElement.dataset.theme;
  if (dataset === "dark" || dataset === "light") return dataset;

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function IconMoon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function IconSun({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M19.07 4.93l-1.41 1.41M6.34 17.66l-1.41 1.41" />
    </svg>
  );
}

export function ThemeToggle() {
  const { t } = useI18n();
  // IMPORTANT:
  // Keep the initial rendered markup identical on server + first client render
  // to avoid hydration mismatches. We'll switch to the real theme in `useLayoutEffect`.
  const [theme, setTheme] = useState<Theme>("light");

  const apply = (next: Theme) => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    setTheme((prev) => (prev === next ? prev : next));
  };

  useLayoutEffect(() => {
    // Read from storage / system and apply before the first paint.
    const next = resolveInitialTheme();
    apply(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mo = new MutationObserver(() => {
      // Keep state in sync if other code updates `data-theme`.
      setTheme(resolveInitialTheme());
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => mo.disconnect();
  }, []);

  const toggle = () => apply(theme === "dark" ? "light" : "dark");

  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={toggle}
      aria-label={theme === "dark" ? t("theme.ariaLight") : t("theme.ariaDark")}
      title={theme === "dark" ? t("theme.titleLight") : t("theme.titleDark")}
    >
      {theme === "dark" ? (
        <IconSun className={styles.glyph} />
      ) : (
        <IconMoon className={styles.glyph} />
      )}
    </button>
  );
}
