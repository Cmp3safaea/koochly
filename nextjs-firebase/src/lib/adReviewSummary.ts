/**
 * User-submitted reviews update `reviewRatingSum` / `reviewCount` on `ad` (see POST /api/ads/[id]/reviews).
 * Imported listings may also have `GoogleRate` + `total_reviews` from Places — we merge both for display.
 */
export type AdReviewSummary = {
  avg: number | null;
  count: number;
};

const IMPORT_PLACEHOLDER_RE = /^imported from google$/i;

export function isGoogleImportPlaceholderDescription(text: unknown): boolean {
  if (typeof text !== "string") return false;
  return IMPORT_PLACEHOLDER_RE.test(text.trim());
}

function parseUserReviewTotals(data: Record<string, unknown>): { sum: number; count: number } {
  const sumRaw = data.reviewRatingSum;
  const countRaw = data.reviewCount;
  const sum = typeof sumRaw === "number" && Number.isFinite(sumRaw) ? sumRaw : 0;
  const count =
    typeof countRaw === "number" && Number.isFinite(countRaw) && countRaw > 0
      ? Math.floor(countRaw)
      : 0;
  return { sum, count };
}

/** External / Places-style aggregate on the ad document (not the `reviews` subcollection). */
function parseExternalReviewTotals(data: Record<string, unknown>): { sum: number; count: number } {
  const rateRaw =
    data.GoogleRate ?? data.google_rate ?? data.googleRating ?? data.googleRatingAvg;
  const rate =
    typeof rateRaw === "number" && Number.isFinite(rateRaw)
      ? rateRaw
      : typeof rateRaw === "string" && rateRaw.trim()
        ? Number(rateRaw)
        : NaN;
  if (!Number.isFinite(rate)) return { sum: 0, count: 0 };

  const countRaw =
    data.total_reviews ??
    data.totalReviews ??
    data.google_review_count ??
    data.googleReviewCount;
  let count =
    typeof countRaw === "number" && Number.isFinite(countRaw)
      ? Math.floor(countRaw)
      : typeof countRaw === "string" && countRaw.trim()
        ? Math.floor(Number(countRaw))
        : 0;

  const clampedRate = Math.min(5, Math.max(0, rate));
  if (count <= 0) {
    if (clampedRate >= 1 && clampedRate <= 5) {
      return { sum: clampedRate, count: 1 };
    }
    return { sum: 0, count: 0 };
  }
  return { sum: clampedRate * count, count };
}

/**
 * Combined average for UI: weighted merge of external (e.g. Google) aggregate + Persiana user reviews.
 * User POST only mutates `reviewRatingSum` / `reviewCount`; external fields stay fixed.
 */
export function reviewSummaryFromAdData(data: Record<string, unknown> | undefined | null): AdReviewSummary {
  if (!data) return { avg: null, count: 0 };
  const ext = parseExternalReviewTotals(data);
  const user = parseUserReviewTotals(data);
  const totalCount = ext.count + user.count;
  if (totalCount <= 0) return { avg: null, count: 0 };
  const totalSum = ext.sum + user.sum;
  const avg = totalSum / totalCount;
  return { avg: Math.round(avg * 10) / 10, count: totalCount };
}
