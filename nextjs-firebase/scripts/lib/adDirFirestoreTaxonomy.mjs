/**
 * Load `dir` taxonomy and resolve `dir_id` / category slugs from ad-shaped data (cat_code, cat, …).
 * Used by backfill-ad-dir-slugs.mjs and import-ad-from-output-enriched.mjs.
 */

export function asString(v) {
  return typeof v === "string" ? v.trim() : "";
}

export function norm(s) {
  return asString(s)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replaceAll("\u200c", "")
    .replaceAll("\u200f", "")
    .trim();
}

function categoryAliasKeysFromData(cd) {
  return [
    asString(cd.code),
    asString(cd.cat_code),
    asString(cd.catCode),
    asString(cd.category_code),
    asString(cd.categoryCode),
  ].filter(Boolean);
}

function registerCategoryRow(categories, row, keys) {
  const seen = new Set();
  for (const k of keys) {
    const t = asString(k);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    categories.set(t, row);
  }
}

function uniqueCategoryRows(deptState) {
  const bySlug = new Map();
  for (const c of deptState.categories.values()) {
    const s = asString(c?.slug);
    if (s && !bySlug.has(s)) bySlug.set(s, c);
  }
  return [...bySlug.values()];
}

export async function loadDirDepartmentsState(db, dirCollection) {
  const depts = new Map();
  const snap = await db.collection(dirCollection).get();

  for (const doc of snap.docs) {
    const slug = doc.id;
    const data = doc.data();
    const department_en = asString(data.department_en);
    const department_fa = asString(data.department_fa);
    const categories = new Map();

    const raw = data.categories;
    if (Array.isArray(raw)) {
      for (const c of raw) {
        if (!c || typeof c !== "object") continue;
        const cs = asString(c.slug);
        if (!cs) continue;
        const row = {
          slug: cs,
          name_en: asString(c.name_en),
          name_fa: asString(c.name_fa),
          tags_en: Array.isArray(c.tags_en) ? c.tags_en.filter((x) => typeof x === "string") : [],
          tags_fa: Array.isArray(c.tags_fa) ? c.tags_fa.filter((x) => typeof x === "string") : [],
          subcategories: new Map(),
        };
        const keys = [cs, ...categoryAliasKeysFromData(c)];
        registerCategoryRow(categories, row, keys);
      }
    }

    const catCol = db.collection(dirCollection).doc(slug).collection("categories");
    const catSnap = await catCol.limit(600).get();
    for (const cdoc of catSnap.docs) {
      const cd = cdoc.data();
      const canonical = asString(cd.slug) || cdoc.id;
      if (!canonical) continue;
      const existing =
        categories.get(canonical) ||
        categories.get(cdoc.id) ||
        {
          slug: canonical,
          name_en: "",
          name_fa: "",
          tags_en: [],
          tags_fa: [],
          subcategories: new Map(),
        };
      existing.slug = canonical;
      existing.name_en = existing.name_en || asString(cd.name_en);
      existing.name_fa = existing.name_fa || asString(cd.name_fa);
      if (!existing.subcategories) existing.subcategories = new Map();

      const subCol = catCol.doc(cdoc.id).collection("subcategories");
      const subSnap = await subCol.limit(400).get();
      for (const sdoc of subSnap.docs) {
        const sd = sdoc.data();
        const ss = asString(sd.slug) || sdoc.id;
        if (!ss) continue;
        existing.subcategories.set(ss, {
          slug: ss,
          name_en: asString(sd.name_en) || ss,
          name_fa: asString(sd.name_fa) || asString(sd.name_en) || ss,
        });
      }
      const keys = [canonical, cdoc.id, ...categoryAliasKeysFromData(cd)];
      registerCategoryRow(categories, existing, keys);
      for (const sdoc of subSnap.docs) {
        const sd = sdoc.data();
        const ss = asString(sd.slug) || sdoc.id;
        if (!ss) continue;
        registerCategoryRow(categories, existing, [ss, ...categoryAliasKeysFromData(sd)]);
      }
    }

    depts.set(slug, { department_en, department_fa, categories });
  }
  return depts;
}

export function matchDirCategoryInDept(deptState, dirRow) {
  const list = uniqueCategoryRows(deptState);
  const code = dirRow.code;
  const label = norm(dirRow.label);
  const eng = norm(dirRow.engName);

  let found = list.find((c) => c.slug && c.slug === code);
  if (found) return found;

  if (eng) {
    found = list.find((c) => norm(c.name_en) === eng);
    if (found) return found;
  }
  if (label) {
    found = list.find((c) => norm(c.name_fa) === label);
    if (found) return found;
    found = list.find((c) => norm(c.name_en) === label);
    if (found) return found;
  }
  return null;
}

export function buildCatCodeToDeptSlug(depts) {
  const m = new Map();
  let conflicts = 0;
  for (const [deptSlug, st] of depts) {
    for (const key of st.categories.keys()) {
      const k = asString(key);
      if (!k) continue;
      if (m.has(k) && m.get(k) !== deptSlug) {
        conflicts++;
        continue;
      }
      if (!m.has(k)) m.set(k, deptSlug);
    }
  }
  if (conflicts > 0) {
    console.warn(
      `buildCatCodeToDeptSlug: ${conflicts} key(s) map to multiple departments (first wins).`,
    );
  }
  return m;
}

/** e.g. cat_code "beauty" → single dept "beauty_personal_care" (unique prefix match). */
export function resolveDeptSlugByCatPrefix(catRaw, depts) {
  if (!catRaw) return null;
  if (depts.has(catRaw)) return catRaw;
  const p = `${catRaw}_`;
  const hits = [];
  for (const slug of depts.keys()) {
    if (slug === catRaw || slug.startsWith(p)) hits.push(slug);
  }
  if (hits.length === 1) return hits[0];
  return null;
}

/** Match `cat` / `engName` / `cat_code` labels against embedded dir category names (unique dept only). */
export function resolveDeptSlugFromAdLabels(data, depts) {
  const catRaw =
    asString(data.cat_code) || asString(data.catCode) || asString(data.category_code);
  const label = asString(data.cat);
  const engName = asString(data.engName) || label;
  if (!label && !engName && !catRaw) return null;

  const dirRow = { code: catRaw, label, engName };
  const hits = [];
  for (const [slug, st] of depts) {
    if (matchDirCategoryInDept(st, dirRow)) hits.push(slug);
  }
  if (hits.length === 1) return hits[0];
  return null;
}

export function resolveCategorySlug(data, deptState, directoryDeptId, catKeyToDirCat) {
  const catRaw =
    asString(data.cat_code) || asString(data.catCode) || asString(data.category_code);
  if (!deptState) return null;

  if (!catRaw) {
    const matched = matchDirCategoryInDept(deptState, {
      code: "",
      label: asString(data.cat),
      engName: asString(data.engName) || asString(data.cat),
    });
    return matched?.slug || null;
  }

  const byKey = deptState.categories.get(catRaw);
  if (byKey?.slug) return asString(byKey.slug);

  if (directoryDeptId && catKeyToDirCat.has(`${directoryDeptId}|${catRaw}`)) {
    const row = catKeyToDirCat.get(`${directoryDeptId}|${catRaw}`);
    if (row?.slug) return row.slug;
  }

  for (const cat of uniqueCategoryRows(deptState)) {
    if (!cat.subcategories || cat.subcategories.size === 0) continue;
    if (cat.subcategories.has(catRaw)) return cat.slug;
  }

  const matched = matchDirCategoryInDept(deptState, {
    code: catRaw,
    label: asString(data.cat),
    engName: asString(data.engName) || asString(data.cat),
  });
  return matched?.slug || null;
}
