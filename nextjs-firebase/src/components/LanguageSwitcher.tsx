"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { locales, stripLocaleFromPathname, withLocale } from "@koochly/shared";
import { useI18n } from "../i18n/client";
import styles from "./LanguageSwitcher.module.css";

export function LanguageSwitcher() {
  const pathname = usePathname() ?? "/";
  const { locale, t } = useI18n();

  const restPath = useMemo(() => stripLocaleFromPathname(pathname), [pathname]);

  return (
    <div className={styles.wrap} role="navigation" aria-label="Language">
      {locales.map((loc) => {
        const active = loc === locale;
        const href = withLocale(loc, restPath);
        return (
          <Link
            key={loc}
            href={href}
            className={`${styles.link} ${active ? styles.active : ""}`}
            hrefLang={loc === "fa" ? "fa-IR" : "en"}
            lang={loc === "fa" ? "fa-IR" : "en"}
            aria-current={active ? "true" : undefined}
          >
            {loc === "fa" ? t("lang.fa") : t("lang.en")}
          </Link>
        );
      })}
    </div>
  );
}
