/**
 * Scraper `cat_code` → Firestore `dir` category document slug
 * (`dir/{departmentSlug}/categories/{dir_category_slug}`), aligned with
 * `nextjs-firebase/scripts/data/koochly_taxonomy_300_clean_tags.json`.
 */
const CAT_CODE_TO_DIR_CATEGORY_SLUG = {
  restaurants: "restaurants",
  /** Grocery / سوپرمارکت → Shopping / Retail > Supermarkets */
  grocery: "supermarkets",
  dentists: "dentists",
  lawyers: "lawyers",
  accountants: "accountants",
  /** Hair salon scrape → Beauty & Personal Care > Hair Salons */
  beauty: "hair_salons",
  /** Generic real-estate listings → Real Estate > Real Estate Agents */
  real_estate: "real_estate_agents",
};

module.exports = { CAT_CODE_TO_DIR_CATEGORY_SLUG };
