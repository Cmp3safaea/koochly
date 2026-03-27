const BASE_URL = (process.env.SEO_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

async function checkUrl(path) {
  const url = `${BASE_URL}${path}`;
  const started = Date.now();
  const res = await fetch(url, { redirect: "follow" });
  const ms = Date.now() - started;
  return { url, status: res.status, ms };
}

async function main() {
  const checks = [
    "/robots.txt",
    "/sitemap/0.xml",
    "/en",
    "/fa",
  ];

  console.log(`SEO verify for ${BASE_URL}`);
  for (const path of checks) {
    try {
      const out = await checkUrl(path);
      console.log(`${out.status} ${out.url} (${out.ms}ms)`);
    } catch (err) {
      console.log(`ERR ${BASE_URL}${path} (${String(err)})`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
