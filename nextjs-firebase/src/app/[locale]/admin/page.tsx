import type { Metadata } from "next";
import { withLocale } from "@koochly/shared";
import { getTranslator, resolveLocale } from "../../../i18n/server";
import { getMapsBrowserApiKey } from "../../../lib/mapsBrowserKey";
import AdminClient from "./AdminClient";

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
    title: t("admin.metaTitle"),
    description: t("admin.metaDesc"),
    alternates: { canonical: withLocale(locale, "/admin") },
    robots: { index: false, follow: false },
  };
}

export default function AdminPage() {
  const googleMapsApiKey = getMapsBrowserApiKey();
  return <AdminClient googleMapsApiKey={googleMapsApiKey} />;
}
