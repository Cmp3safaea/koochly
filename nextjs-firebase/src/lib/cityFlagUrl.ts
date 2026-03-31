/**
 * Prefer Firestore `flag_url`; otherwise derive a flag image from country fields
 * so headings like "انگلستان - Manchester" still show a flag when `flag_url` is empty.
 */
const FLAG_CDN = "https://flagcdn.com/w80";

const FA_COUNTRY_TO_ISO: Record<string, string> = {
  ایران: "ir",
  انگلستان: "gb",
  انگلیس: "gb",
  بریتانیا: "gb",
  آمریکا: "us",
  امریکا: "us",
  آلمان: "de",
  فرانسه: "fr",
  کانادا: "ca",
  استرالیا: "au",
  ترکیه: "tr",
  عراق: "iq",
  امارات: "ae",
  "امارات متحده عربی": "ae",
};

const PATH_SLUG_TO_ISO: Record<string, string> = {
  uk: "gb",
  gb: "gb",
  england: "gb",
  iran: "ir",
  usa: "us",
  us: "us",
  germany: "de",
  france: "fr",
  canada: "ca",
  australia: "au",
  turkey: "tr",
  iraq: "iq",
  uae: "ae",
};

function normEn(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\./g, "");
}

/** ISO 3166-1 alpha-2 from English country name or 2-letter code. */
function isoFromEnglishCountry(raw: string): string | undefined {
  const k = normEn(raw);
  if (!k) return undefined;
  if (/^[a-z]{2}$/.test(k)) return k;

  if (
    k === "uk" ||
    k === "england" ||
    k === "scotland" ||
    k === "wales" ||
    /\bunited kingdom\b/.test(k) ||
    /\bgreat britain\b/.test(k) ||
    /\bengland\b/.test(k) ||
    /\bscotland\b/.test(k) ||
    /\bwales\b/.test(k) ||
    /\bnorthern ireland\b/.test(k)
  ) {
    return "gb";
  }
  if (k === "usa" || /\bunited states\b/.test(k) || /\bunited states of america\b/.test(k)) {
    return "us";
  }
  if (k === "iran") return "ir";
  if (k === "germany" || k === "deutschland") return "de";
  if (k === "france") return "fr";
  if (k === "canada") return "ca";
  if (k === "australia") return "au";
  if (k === "turkey" || k === "türkiye" || k === "turkiye") return "tr";
  if (k === "iraq") return "iq";
  if (k === "uae" || k === "united arab emirates") return "ae";

  return undefined;
}

export function resolveCityFlagUrl(input: {
  flagUrl?: string;
  countryEng?: string;
  countryFa?: string;
  /** Hub URL segment, e.g. `uk` from `/en/uk/manchester/` */
  pathCountrySlug?: string;
}): string | undefined {
  const explicit = typeof input.flagUrl === "string" ? input.flagUrl.trim() : "";
  if (explicit) return explicit;

  const cf = typeof input.countryFa === "string" ? input.countryFa.trim() : "";
  if (cf && FA_COUNTRY_TO_ISO[cf]) {
    return `${FLAG_CDN}/${FA_COUNTRY_TO_ISO[cf]}.png`;
  }

  const ce = typeof input.countryEng === "string" ? input.countryEng : "";
  const fromEn = isoFromEnglishCountry(ce);
  if (fromEn) return `${FLAG_CDN}/${fromEn}.png`;

  const slugRaw = typeof input.pathCountrySlug === "string" ? input.pathCountrySlug.trim() : "";
  const slug = slugRaw ? decodeURIComponent(slugRaw).toLowerCase().replace(/\s+/g, "") : "";
  if (slug && PATH_SLUG_TO_ISO[slug]) {
    return `${FLAG_CDN}/${PATH_SLUG_TO_ISO[slug]}.png`;
  }

  return undefined;
}
