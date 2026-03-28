/**
 * Denormalized review aggregates stored on `ads/{adId}` (see POST /api/ads/[id]/reviews).
 */
export type AdReviewSummary = {
  avg: number | null;
  count: number;
};

export function reviewSummaryFromAdData(data: Record<string, unknown> | undefined | null): AdReviewSummary {
  if (!data) return { avg: null, count: 0 };
  const sumRaw = data.reviewRatingSum;
  const countRaw = data.reviewCount;
  const sum = typeof sumRaw === "number" && Number.isFinite(sumRaw) ? sumRaw : 0;
  const count =
    typeof countRaw === "number" && Number.isFinite(countRaw) && countRaw > 0
      ? Math.floor(countRaw)
      : 0;
  if (count <= 0) return { avg: null, count: 0 };
  const avg = sum / count;
  return { avg: Math.round(avg * 10) / 10, count };
}
