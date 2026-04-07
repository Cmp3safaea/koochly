import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isGoogleImportPlaceholderDescription } from "../../../../lib/adReviewSummary";
import { coerceAdSeq, isAdDocIndexable } from "../../../../lib/seoIndexable";
import { withLocale } from "@koochly/shared";
import { getTranslator, resolveLocale } from "../../../../i18n/server";
import { loadAdByDocId } from "../../../../lib/firebaseAdmin";
import AdDetailMain from "../../b/[seq]/AdDetailMain";

export const dynamic = "force-dynamic";

export default async function AdDetailsByIdPage({
  params,
}: {
  params: Promise<{ locale: string; adId: string }>;
}) {
  const { adId: adIdRaw, locale: localeRaw } = await params;
  const locale = resolveLocale(localeRaw);
  const id = decodeURIComponent(adIdRaw.trim());
  if (!id) return notFound();

  const ad = await loadAdByDocId(id);
  if (!ad) return notFound();
  if (ad.approved !== true) return notFound();

  const seq = coerceAdSeq(ad.seq);
  if (seq !== null) {
    redirect(withLocale(locale, `/b/${seq}`));
  }

  return (
    <AdDetailMain
      ad={ad}
      localeRaw={localeRaw}
      pathForLogAndQr={`/ad/${encodeURIComponent(ad.id)}`}
      seqForLabel={null}
    />
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; adId: string }>;
}): Promise<Metadata> {
  const { adId: adIdRaw, locale: localeRaw } = await params;
  const locale = resolveLocale(localeRaw);
  const t = getTranslator(localeRaw);
  const id = decodeURIComponent(adIdRaw.trim());
  if (!id) return { title: "Persiana" };
  const ad = await loadAdByDocId(id);
  if (!ad) return { title: "Persiana" };
  const seq = coerceAdSeq(ad.seq);
  if (seq !== null) {
    return { title: "Persiana" };
  }
  const title =
    (typeof ad.title === "string" && ad.title.trim()) ||
    (typeof ad.engName === "string" && ad.engName.trim()) ||
    `Ad ${ad.id.slice(0, 8)}`;
  const indexable = isAdDocIndexable(ad as Record<string, unknown>);
  const path = `/ad/${encodeURIComponent(ad.id)}`;
  return {
    title: `${title}${t("adDetail.metaTitleSuffix")}`,
    description: (() => {
      const d = typeof ad.details === "string" ? ad.details.trim() : "";
      if (d && !isGoogleImportPlaceholderDescription(d)) return d.slice(0, 160);
      return t("adDetail.metaDescFallback");
    })(),
    alternates: indexable
      ? {
          canonical: withLocale(locale, path),
          languages: {
            fa: withLocale("fa", path),
            en: withLocale("en", path),
            "x-default": withLocale("en", path),
          },
        }
      : undefined,
    robots: indexable ? undefined : { index: false, follow: false },
  };
}
