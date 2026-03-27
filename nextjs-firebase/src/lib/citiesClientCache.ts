type CitiesResponse = {
  cities: Array<Record<string, unknown>>;
};

let cacheData: CitiesResponse | null = null;
let cacheAt = 0;
let inflight: Promise<CitiesResponse> | null = null;

async function fetchCities(): Promise<CitiesResponse> {
  const res = await fetch("/api/cities", { method: "GET" });
  const data = (await res.json().catch(() => ({}))) as Partial<CitiesResponse> & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? "Failed to load cities");
  }
  return { cities: Array.isArray(data.cities) ? data.cities : [] };
}

export async function getCitiesCached(ttlMs = 5 * 60 * 1000): Promise<CitiesResponse> {
  const now = Date.now();
  if (cacheData && now - cacheAt < ttlMs) {
    return cacheData;
  }
  if (inflight) return inflight;

  inflight = fetchCities()
    .then((data) => {
      cacheData = data;
      cacheAt = Date.now();
      return data;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function clearCitiesCache() {
  cacheData = null;
  cacheAt = 0;
}
