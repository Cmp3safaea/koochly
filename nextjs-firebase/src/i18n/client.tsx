"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  createTranslator,
  type Locale,
  type Messages,
  type TranslateFn,
  withLocale,
} from "@koochly/shared";

type I18nCtx = { locale: Locale; t: TranslateFn };

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: ReactNode;
}) {
  const t = useMemo(() => createTranslator(messages), [messages]);
  const value = useMemo(() => ({ locale, t }), [locale, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used within I18nProvider");
  return v;
}

/** Localize internal paths (default locale stays unprefixed; non-default gets `/{locale}` prefix). */
export function useLocalizedHref(): (path: string) => string {
  const { locale } = useI18n();
  return useMemo(
    () => (path: string) => {
      const p = path.trim();
      if (!p) return withLocale(locale, "/");
      if (/^https?:\/\//i.test(p)) return p;
      return withLocale(locale, p.startsWith("/") ? p : `/${p}`);
    },
    [locale],
  );
}
