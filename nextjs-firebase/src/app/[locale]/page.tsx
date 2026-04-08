import { unstable_cache } from "next/cache";
import { listPublicCities, listPublicEvents } from "../../lib/citiesWithApprovedAds";
import HomePageClient, { type HomePageClientProps } from "./HomePageClient";

const loadHomePayload = unstable_cache(
  async () => {
    const [citiesRes, eventsRes] = await Promise.all([
      listPublicCities({ onlyWithAds: true }),
      listPublicEvents(),
    ]);
    return { citiesRes, eventsRes };
  },
  ["home-root-payload"],
  { revalidate: 120 },
);

export default async function Page() {
  let initialCities: NonNullable<HomePageClientProps["initialCities"]> = [];
  let initialEvents: NonNullable<HomePageClientProps["initialEvents"]> = [];

  try {
    const { citiesRes, eventsRes } = await loadHomePayload();
    initialCities = JSON.parse(JSON.stringify(citiesRes.cities)) as NonNullable<
      HomePageClientProps["initialCities"]
    >;
    initialEvents = JSON.parse(JSON.stringify(eventsRes.events)) as NonNullable<
      HomePageClientProps["initialEvents"]
    >;
  } catch {
    // `HomePageClient` falls back to `/api/cities` and `/api/events`.
  }

  return <HomePageClient initialCities={initialCities} initialEvents={initialEvents} />;
}
