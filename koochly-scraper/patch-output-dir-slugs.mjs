/**
 * One-off / repeat: add `dir_category_slug` to each object in output.json
 * using the same map as script.js (Firestore `dir` taxonomy).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { CAT_CODE_TO_DIR_CATEGORY_SLUG } = require("./dirTaxonomyMap.js");

const outPath = join(__dirname, "output.json");
const data = JSON.parse(readFileSync(outPath, "utf8"));
let unknown = 0;
for (const row of data) {
  const slug = CAT_CODE_TO_DIR_CATEGORY_SLUG[row.cat_code];
  if (slug) row.dir_category_slug = slug;
  else {
    unknown++;
    row.dir_category_slug = null;
  }
}
writeFileSync(outPath, JSON.stringify(data, null, 2));
if (unknown) console.error(`Warning: ${unknown} row(s) had unknown cat_code`);
