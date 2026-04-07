type CitiesResponse = {
  cities: Array<Record<string, unknown>>;
};

type CitiesCacheVariant = "all" | "withAds";

const cacheData: Record<CitiesCacheVariant, CitiesResponse | null> = {
  all: null,
  withAds: null,
};
const cacheAt: Record<CitiesCacheVariant, number> = {
  all: 0,
  withAds: 0,
};
const inflight: Partial<Record<CitiesCacheVariant, Promise<CitiesResponse>>> = {};

async function fetchCities(variant: CitiesCacheVariant): Promise<CitiesResponse> {
  const q = variant === "withAds" ? "?onlyWithAds=1" : "";
  const res = await fetch(`/api/cities${q}`, { method: "GET" });
  const data = (await res.json().catch(() => ({}))) as Partial<CitiesResponse> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? "Failed to load cities");
  }
  return { cities: Array.isArray(data.cities) ? data.cities : [] };
}

/**
 * @param variant `withAds` — home / discovery: cities that have at least one approved ad.
 * `all` — forms (add-ad, profile): full active city list.
 */
export async function getCitiesCached(
  ttlMs = 5 * 60 * 1000,
  variant: CitiesCacheVariant = "all",
): Promise<CitiesResponse> {
  const now = Date.now();
  if (cacheData[variant] && now - cacheAt[variant] < ttlMs) {
    return cacheData[variant]!;
  }
  if (inflight[variant]) return inflight[variant]!;

  inflight[variant] = fetchCities(variant)
    .then((data) => {
      cacheData[variant] = data;
      cacheAt[variant] = Date.now();
      return data;
    })
    .finally(() => {
      delete inflight[variant];
    });

  return inflight[variant]!;
}

export function clearCitiesCache() {
  cacheData.all = null;
  cacheData.withAds = null;
  cacheAt.all = 0;
  cacheAt.withAds = 0;
}
