"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAuthClientOrNull,
  getGoogleProvider,
  isFirebaseClientConfigured,
} from "../../../../lib/firebaseClient";
import type { AdReviewSummary } from "../../../../lib/adReviewSummary";
import { onAuthStateChanged, signInWithPopup, type User } from "firebase/auth";
import { useI18n } from "../../../../i18n/client";
import StarRating from "../../../../components/StarRating";
import styles from "./AdReviewsSection.module.css";

type ApiReview = {
  id: string;
  rating: number;
  text: string;
  displayName: string;
  createdAt: number | null;
  updatedAt: number | null;
};

type Props = {
  adId: string;
  initialSummary: AdReviewSummary;
};

const STAR_PATH =
  "M10 1.5l2.6 5.5 6 .9-4.3 4.1 1 5.9L10 15.9 4.7 17.9l1-5.9L1.4 7.9l6-.9L10 1.5z";

function formatReviewDate(ms: number | null, locale: string): string {
  if (ms === null || !Number.isFinite(ms)) return "";
  try {
    return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-GB", {
      dateStyle: "medium",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleDateString();
  }
}

export default function AdReviewsSection({ adId, initialSummary }: Props) {
  const { t, locale } = useI18n();
  const configured = isFirebaseClientConfigured();

  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [summary, setSummary] = useState<AdReviewSummary>(initialSummary);
  const [reviews, setReviews] = useState<ApiReview[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [draftRating, setDraftRating] = useState(0);
  const [draftText, setDraftText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [hasMyReview, setHasMyReview] = useState(false);

  useEffect(() => {
    setSummary(initialSummary);
  }, [initialSummary.avg, initialSummary.count]);

  useEffect(() => {
    if (!configured) {
      setAuthReady(true);
      return;
    }
    const auth = getAuthClientOrNull();
    if (!auth) {
      setAuthReady(true);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, [configured]);

  const fetchReviews = useCallback(
    async (opts: { append: boolean; cursor: string | null }) => {
      const auth = getAuthClientOrNull();
      const token =
        auth?.currentUser && configured ? await auth.currentUser.getIdToken() : null;
      const headers: HeadersInit = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const q = new URLSearchParams();
      q.set("limit", "20");
      if (opts.cursor) q.set("cursor", opts.cursor);

      const res = await fetch(`/api/ads/${encodeURIComponent(adId)}/reviews?${q}`, {
        headers,
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        reviews?: ApiReview[];
        nextCursor?: string | null;
        summary?: AdReviewSummary;
        myReview?: ApiReview | null;
      };
      if (!res.ok) throw new Error(data.error ?? "failed");

      if (data.summary) setSummary(data.summary);

      if (opts.append && data.reviews) {
        setReviews((prev) => {
          const seen = new Set(prev.map((r) => r.id));
          const add = data.reviews!.filter((r) => !seen.has(r.id));
          return [...prev, ...add];
        });
      } else if (data.reviews) {
        setReviews(data.reviews);
      }

      setNextCursor(typeof data.nextCursor === "string" ? data.nextCursor : null);

      if (data.myReview && typeof data.myReview.rating === "number") {
        setHasMyReview(true);
        setDraftRating(data.myReview.rating);
        setDraftText(typeof data.myReview.text === "string" ? data.myReview.text : "");
      } else if (!opts.append) {
        setHasMyReview(false);
        setDraftRating(0);
        setDraftText("");
      }
    },
    [adId, configured],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        await fetchReviews({ append: false, cursor: null });
      } catch {
        if (!cancelled) setErr(t("adDetail.reviewsSubmitErr"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adId, user?.uid, fetchReviews, t]);

  const signIn = useCallback(async () => {
    setErr(null);
    const auth = getAuthClientOrNull();
    if (!auth) return;
    try {
      await signInWithPopup(auth, getGoogleProvider());
    } catch (e) {
      console.error(e);
      setErr(t("adDetail.reviewsSignInErr"));
    }
  }, [t]);

  const submitReview = useCallback(async () => {
    setErr(null);
    setOkMsg(null);
    if (draftRating < 1 || draftRating > 5) return;
    const auth = getAuthClientOrNull();
    if (!auth?.currentUser) {
      setErr(t("adDetail.reviewsSignInErr"));
      return;
    }
    setSubmitting(true);
    try {
      const token = await auth.currentUser.getIdToken(true);
      const res = await fetch(`/api/ads/${encodeURIComponent(adId)}/reviews`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rating: draftRating, text: draftText }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        summary?: AdReviewSummary;
      };
      if (!res.ok) {
        setErr(data.error ?? t("adDetail.reviewsSubmitErr"));
        return;
      }
      if (data.summary) setSummary(data.summary);
      setOkMsg(t("adDetail.reviewsUpdated"));
      await fetchReviews({ append: false, cursor: null });
    } catch {
      setErr(t("adDetail.reviewsSubmitErr"));
    } finally {
      setSubmitting(false);
    }
  }, [adId, draftRating, draftText, fetchReviews, t]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setErr(null);
    try {
      await fetchReviews({ append: true, cursor: nextCursor });
    } catch {
      setErr(t("adDetail.reviewsSubmitErr"));
    } finally {
      setLoadingMore(false);
    }
  }, [fetchReviews, nextCursor, loadingMore, t]);

  const countLabel =
    summary.count === 0
      ? ""
      : summary.count === 1
        ? t("adDetail.reviewsCountOne")
        : t("adDetail.reviewsCount", { count: String(summary.count) });

  const scrollToComposer = useCallback(() => {
    const el = document.getElementById("ad-review-composer");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      if (el instanceof HTMLElement) el.focus({ preventScroll: true });
    }, 500);
  }, []);

  /** Show jump button whenever the section is ready; works even if Firebase env is missing on the client. */
  const showFeedbackJump = authReady && !loading;
  const feedbackJumpLabel = hasMyReview
    ? t("adDetail.reviewsUpdateTop")
    : t("adDetail.reviewsGiveFeedback");

  return (
    <section className={styles.section} aria-labelledby="ad-reviews-heading">
      <header className={styles.head}>
        <h2 id="ad-reviews-heading" className={styles.title}>
          {t("adDetail.reviewsTitle")}
        </h2>
        <p className={styles.sub}>{t("adDetail.reviewsSubtitle")}</p>
        {summary.count > 0 && summary.avg !== null ? (
          <div className={styles.summaryRow}>
            <div className={styles.summaryBig}>
              <span className={styles.avgNum}>{summary.avg.toFixed(1)}</span>
              <StarRating
                value={summary.avg}
                size="md"
                ariaLabel={t("adDetail.reviewsOutOf", { n: summary.avg.toFixed(1) })}
              />
            </div>
            <span className={styles.summaryMeta}>
              {t("adDetail.reviewsAvgOf", { avg: summary.avg.toFixed(1) })} · {countLabel}
            </span>
          </div>
        ) : (
          <p className={styles.summaryMeta} style={{ marginTop: 12 }}>
            {countLabel || t("adDetail.reviewsEmpty")}
          </p>
        )}
        {showFeedbackJump ? (
          <button
            type="button"
            className={styles.addReviewTopBtn}
            onClick={scrollToComposer}
            aria-label={t("adDetail.reviewsAddTopAria")}
          >
            {feedbackJumpLabel}
          </button>
        ) : null}
      </header>

      <div
        id="ad-review-composer"
        className={styles.composer}
        tabIndex={-1}
        aria-label={t("adDetail.reviewsComposerAnchor")}
      >
        {authReady && configured && user ? (
          <>
          <h3 className={styles.composerTitle}>{t("adDetail.reviewsWrite")}</h3>
          <span className={styles.label}>{t("adDetail.reviewsYourRating")}</span>
          <div
            className={styles.starPick}
            role="radiogroup"
            aria-label={t("adDetail.reviewsYourRating")}
          >
            {[1, 2, 3, 4, 5].map((n) => {
              const selected = draftRating >= n && draftRating > 0;
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={draftRating === n}
                  className={`${styles.starBtn} ${selected ? styles.starBtnFilled : styles.starBtnEmpty}`}
                  aria-label={t("adDetail.reviewsStarAria", { n: String(n) })}
                  onClick={() => setDraftRating(n)}
                >
                  <svg className={styles.starBtnSvg} viewBox="0 0 20 20" aria-hidden>
                    <path d={STAR_PATH} fill="currentColor" />
                  </svg>
                  <span className={styles.starBtnNum}>{n}</span>
                </button>
              );
            })}
          </div>
          <label className={styles.label} htmlFor="ad-review-text">
            {t("adDetail.reviewsTextLabel")}
          </label>
          <textarea
            id="ad-review-text"
            className={styles.textarea}
            dir={locale === "fa" ? "rtl" : "ltr"}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder={t("adDetail.reviewsTextPh")}
            maxLength={2000}
          />
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.submit}
              disabled={submitting || draftRating < 1}
              onClick={() => void submitReview()}
            >
              {submitting ? t("adDetail.reviewsSubmitting") : t("adDetail.reviewsSubmit")}
            </button>
          </div>
          {err ? <p className={styles.err}>{err}</p> : null}
          {okMsg ? <p className={styles.ok}>{okMsg}</p> : null}
          </>
        ) : authReady && configured ? (
          <>
            <h3 className={styles.composerTitle}>{t("adDetail.reviewsWrite")}</h3>
            <p className={styles.hint}>{t("adDetail.reviewsSignInHint")}</p>
            <button type="button" className={styles.signInBtn} onClick={() => void signIn()}>
              {t("adDetail.reviewsSignIn")}
            </button>
            {err ? <p className={styles.err}>{err}</p> : null}
          </>
        ) : authReady ? (
          <>
            <h3 className={styles.composerTitle}>{t("adDetail.reviewsWrite")}</h3>
            <p className={styles.hint}>{t("adDetail.reviewsNotConfigured")}</p>
          </>
        ) : (
          <p className={styles.hint}>{t("adDetail.reviewsLoading")}</p>
        )}
      </div>

      {loading ? (
        <p className={styles.loading}>{t("adDetail.reviewsLoading")}</p>
      ) : (
        <>
          <ul className={styles.list} aria-label={t("adDetail.reviewsListAria")}>
            {reviews.map((r) => (
              <li key={r.id} className={styles.item}>
                <div className={styles.itemHead}>
                  <StarRating
                    value={r.rating}
                    size="sm"
                    ariaLabel={t("adDetail.reviewsOutOf", { n: String(r.rating) })}
                  />
                  <span className={styles.author}>{r.displayName || "—"}</span>
                  <span className={styles.date}>{formatReviewDate(r.createdAt, locale)}</span>
                </div>
                {r.text ? (
                  <p className={styles.body} dir="auto">
                    {r.text}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {nextCursor ? (
            <button
              type="button"
              className={styles.loadMore}
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? t("adDetail.reviewsLoading") : t("adDetail.reviewsLoadMore")}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

