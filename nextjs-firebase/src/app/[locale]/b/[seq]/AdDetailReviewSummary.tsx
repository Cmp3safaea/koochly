"use client";

import StarRating from "../../../../components/StarRating";
import { useI18n } from "../../../../i18n/client";
import styles from "./AdDetailsPage.module.css";

export default function AdDetailReviewSummary({
  avg,
  count,
}: {
  avg: number | null;
  count: number;
}) {
  const { t } = useI18n();
  if (count <= 0 || avg == null) return null;
  const countLabel =
    count === 1
      ? t("adDetail.reviewsCountOne")
      : t("adDetail.reviewsCount", { count: String(count) });
  return (
    <div className={styles.detailReviewRow}>
      <StarRating
        value={avg}
        size="md"
        ariaLabel={t("adDetail.reviewsOutOf", { n: avg.toFixed(1) })}
      />
      <span className={styles.detailReviewMeta}>
        {avg.toFixed(1)} · {countLabel}
      </span>
    </div>
  );
}
