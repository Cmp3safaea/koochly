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
  return (
    <div className={styles.detailReviewRow}>
      <StarRating
        value={avg}
        size="md"
        ariaLabel={t("adDetail.reviewsOutOf", { n: avg.toFixed(1) })}
      />
      <span className={styles.detailReviewCount} dir="ltr" lang="en">
        ({count})
      </span>
    </div>
  );
}
