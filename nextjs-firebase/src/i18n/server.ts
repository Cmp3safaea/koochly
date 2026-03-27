import {
  createTranslator,
  defaultLocale,
  getMessages,
  isLocale,
  type Locale,
  type TranslateFn,
} from "@koochly/shared";

export function resolveLocale(raw: string | undefined): Locale {
  if (raw && isLocale(raw)) return raw;
  return defaultLocale;
}

export function getTranslator(rawLocale: string | undefined): TranslateFn {
  const locale = resolveLocale(rawLocale);
  return createTranslator(getMessages(locale));
}
