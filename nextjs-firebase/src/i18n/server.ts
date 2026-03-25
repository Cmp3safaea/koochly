import { createTranslator, type TranslateFn } from "./createTranslator";
import { defaultLocale, isLocale, type Locale } from "./config";
import { getMessages } from "./getMessages";

export function resolveLocale(raw: string | undefined): Locale {
  if (raw && isLocale(raw)) return raw;
  return defaultLocale;
}

export function getTranslator(rawLocale: string | undefined): TranslateFn {
  const locale = resolveLocale(rawLocale);
  return createTranslator(getMessages(locale));
}
