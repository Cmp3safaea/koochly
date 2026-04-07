import type { DirectoryLocale } from "./directoryDepartmentLabel";
import taxonomyJson from "../../scripts/data/koochly_taxonomy_300_clean_tags.json";

type TaxonomyCategory = {
  slug?: string;
  name_en?: string;
  name_fa?: string;
};

type TaxonomyDepartment = {
  categories?: TaxonomyCategory[];
};

export const hasPersianScript = (s: string) => /[\u0600-\u06FF]/.test(s);

/** Same cat key as city listing cards: `dir_category_slug` then `cat_code`. */
export function adCatCodeKey(ad: {
  cat_code?: unknown;
  dir_category_slug?: unknown;
}): string | null {
  const d =
    typeof ad.dir_category_slug === "string" && ad.dir_category_slug.trim()
      ? ad.dir_category_slug.trim()
      : null;
  if (d) return d;
  const c =
    typeof ad.cat_code === "string" && ad.cat_code.trim()
      ? ad.cat_code.trim()
      : null;
  return c;
}

/** First Persian `cat` label among ads for this category code (scraper / legacy rows). */
export function firstPersianAdCatForCatCode(
  ads: Array<{ cat?: unknown; cat_code?: unknown; dir_category_slug?: unknown }>,
  catCode: string,
): string | null {
  for (const ad of ads) {
    if (adCatCodeKey(ad) !== catCode) continue;
    const cat = typeof ad.cat === "string" ? ad.cat.trim() : "";
    if (cat && hasPersianScript(cat)) return cat;
  }
  return null;
}

const taxonomyBySlug = (() => {
  const m = new Map<string, { name_en: string; name_fa: string }>();
  for (const dept of taxonomyJson as TaxonomyDepartment[]) {
    for (const c of dept.categories ?? []) {
      const slug = typeof c.slug === "string" ? c.slug.trim() : "";
      if (!slug) continue;
      const name_en = typeof c.name_en === "string" ? c.name_en.trim() : "";
      const name_fa = typeof c.name_fa === "string" ? c.name_fa.trim() : "";
      m.set(slug, { name_en, name_fa });
    }
  }
  return m;
})();

/**
 * Resolves a directory category slug to a display label using Firestore-built `categoryMap`
 * plus bundled taxonomy JSON. For Farsi UI, Persian text from either source wins over
 * English placeholders (many legacy rows used English for `name_fa`).
 */
export function resolveDirCategoryLabel(
  slug: string,
  locale: DirectoryLocale,
  categoryMap: Map<string, string>,
): string {
  const code = slug.trim();
  if (!code) return slug;
  const fsLabel = categoryMap.get(code);
  const tax = taxonomyBySlug.get(code);

  if (locale === "en") {
    return (
      fsLabel ??
      (tax?.name_en && tax.name_en.length > 0 ? tax.name_en : null) ??
      (tax?.name_fa && tax.name_fa.length > 0 ? tax.name_fa : null) ??
      code
    );
  }

  const fsFa = fsLabel && hasPersianScript(fsLabel) ? fsLabel : null;
  const taxFa =
    tax?.name_fa && tax.name_fa.length > 0 && hasPersianScript(tax.name_fa)
      ? tax.name_fa
      : null;
  if (fsFa) return fsFa;
  if (taxFa) return taxFa;

  return (
    fsLabel ??
    (tax?.name_fa && tax.name_fa.length > 0 ? tax.name_fa : null) ??
    (tax?.name_en && tax.name_en.length > 0 ? tax.name_en : null) ??
    code
  );
}

/**
 * For Farsi UI: if directory/taxonomy only yields English or a raw slug, use the ad's Persian `cat`
 * when present so filters and "popular categories" match listing cards.
 */
export function resolveDirCategoryLabelPreferPersianCatField(
  slug: string,
  locale: DirectoryLocale,
  categoryMap: Map<string, string>,
  adCat?: string | null,
): string {
  const base = resolveDirCategoryLabel(slug, locale, categoryMap);
  if (locale !== "fa") return base;
  const fromAd = typeof adCat === "string" ? adCat.trim() : "";
  if (!fromAd || !hasPersianScript(fromAd)) return base;
  if (hasPersianScript(base)) return base;
  return fromAd;
}
