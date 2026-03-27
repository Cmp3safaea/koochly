import type { Metadata } from "next";
import { getMapsBrowserApiKey } from "../../../lib/mapsBrowserKey";
import AddAdClient from "./AddAdClient";
import { withLocale } from "@koochly/shared";
import { getTranslator, resolveLocale } from "../../../i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: localeRaw } = await params;
  const locale = resolveLocale(localeRaw);
  const t = getTranslator(localeRaw);
  return {
    title: t("addAd.metaTitle"),
    description: t("addAd.metaDesc"),
    alternates: { canonical: withLocale(locale, "/add-ad") },
    robots: { index: false, follow: false },
  };
}

export default function AddAdPage() {
  const googleMapsApiKey = getMapsBrowserApiKey();
  return <AddAdClient googleMapsApiKey={googleMapsApiKey} />;
}
