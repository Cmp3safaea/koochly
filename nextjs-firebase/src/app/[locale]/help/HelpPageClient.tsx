"use client";

import Link from "next/link";
import { useI18n, useLocalizedHref } from "../../../i18n/client";
import { CITY_HELP_SECTION_KEYS } from "./cityHelpSections";
import styles from "./helpPage.module.css";

export default function HelpPageClient() {
  const { t, locale } = useI18n();
  const loc = useLocalizedHref();

  return (
    <main className={styles.wrap} lang={locale === "fa" ? "fa" : "en"}>
      <Link href={loc("/")} className={styles.back}>
        {t("city.helpPageBackHome")}
      </Link>
      <h1 className={styles.title}>{t("city.helpPageTitle")}</h1>
      <p className={styles.intro}>{t("city.helpPageIntro")}</p>
      <ol className={styles.list}>
        {CITY_HELP_SECTION_KEYS.map(([titleKey, bodyKey], index) => (
          <li key={titleKey} className={styles.item}>
            <div className={styles.itemHead}>
              <span className={styles.step}>{index + 1}</span>
              <h2 className={styles.itemTitle}>{t(`city.${titleKey}`)}</h2>
            </div>
            <p className={styles.itemBody}>{t(`city.${bodyKey}`)}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
