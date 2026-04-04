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
