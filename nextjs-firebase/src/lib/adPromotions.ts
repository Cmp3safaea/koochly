/** Listing promotion kinds (city page + add-ad flow). Stored under `ads/{id}/promotions/{type}`. */
export const AD_PROMOTION_TYPES = ["featured", "spotlight", "bump", "urgent"] as const;

export type AdPromotionType = (typeof AD_PROMOTION_TYPES)[number];

/** Default visibility window for new promos (free tier). */
export const AD_PROMOTION_DURATION_MS = 90 * 24 * 60 * 60 * 1000;

export function normalizePromotionTypes(raw: unknown): AdPromotionType[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>([...AD_PROMOTION_TYPES]);
  const seen = new Set<string>();
  const out: AdPromotionType[] = [];
  for (const x of raw) {
    const t = typeof x === "string" ? x.trim().toLowerCase() : "";
    if (!allowed.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t as AdPromotionType);
  }
  return out;
}
