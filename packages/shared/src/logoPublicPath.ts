import type { Locale } from "./config";

export type LogoTheme = "light" | "dark";

/** Light mode — English vs Farsi (`/en` vs `/fa`). */
export const LOGO_ENG_PUBLIC_PATH = "/logo_eng.png";
export const LOGO_FA_PUBLIC_PATH = "/logo_fa.png";

/** Dark mode variants (`html[data-theme="dark"]`). */
export const LOGO_DM_ENG_PUBLIC_PATH = "/logo_dm_eng.png";
export const LOGO_DM_FA_PUBLIC_PATH = "/logo_dm_fa.png";

/**
 * @param theme Defaults to `"light"` (use for server metadata / JSON-LD).
 */
export function logoPublicPath(locale: Locale, theme: LogoTheme = "light"): string {
  if (theme === "dark") {
    return locale === "en" ? LOGO_DM_ENG_PUBLIC_PATH : LOGO_DM_FA_PUBLIC_PATH;
  }
  return locale === "en" ? LOGO_ENG_PUBLIC_PATH : LOGO_FA_PUBLIC_PATH;
}

/** Listing thumbnail fallback when an ad has no photos (same asset as `LOGO_ENG_PUBLIC_PATH`). */
export const AD_LISTING_IMAGE_FALLBACK = LOGO_ENG_PUBLIC_PATH;

/** First image URL from Firestore `images` / `image` fields, or English logo path. */
export function firstAdImageUrl(fields: { images?: unknown; image?: unknown }): string {
  const { images, image } = fields;
  if (Array.isArray(images) && images.length > 0 && typeof images[0] === "string") {
    const s = images[0].trim();
    if (s) return s;
  }
  if (typeof image === "string" && image.trim()) return image.trim();
  return LOGO_ENG_PUBLIC_PATH;
}
