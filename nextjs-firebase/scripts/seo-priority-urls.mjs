const BASE_URL = (process.env.SEO_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const LIMIT = Number(process.env.SEO_URL_LIMIT || 50);

function extractLocs(xml) {
  const matches = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)];
  return matches.map((m) => m[1]).filter(Boolean);
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function main() {
  const sitemapIndexUrl = `${BASE_URL}/sitemap.xml`;
  const indexXml = await fetchText(sitemapIndexUrl);
  let urls = extractLocs(indexXml);

  if (urls.length === 0) {
    const indexCandidates = [
      `${BASE_URL}/sitemap.xml`,
      `${BASE_URL}/sitemap/0.xml`,
    ];
    for (const candidate of indexCandidates) {
      try {
        const xml = await fetchText(candidate);
        urls = extractLocs(xml);
        if (urls.length > 0) break;
      } catch {
        // keep trying
      }
    }
  }

  const dedup = Array.from(new Set(urls));
  const priority = dedup
    .filter((u) => /\/(fa|en)(\/?$|\/[^/]+\/[^/]+\/?$|\/b\/\d+\/?$)/.test(u))
    .slice(0, LIMIT);

  console.log(`# Priority URLs for Search Console (${priority.length})`);
  for (const u of priority) {
    console.log(u);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
