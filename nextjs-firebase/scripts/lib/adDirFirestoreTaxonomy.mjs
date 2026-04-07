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
    .replace(/\u200c/g, "")
    .replace(/\u200f/g, "")
    .trim();
}

function categoryAliasKeysFromData(cd) {
  return [
    asString(cd.code),
    asString(cd.cat_code),
    asString(cd.catCode),
    asString(cd.category_code),
    asString(cd.Category_code),
  ].filter(Boolean);
}

function registerCategoryRow(categories, row, keys) {
  for (const raw of keys) {
    const k = norm(raw);
    if (!k) continue;
    if (!categories.has(k)) categories.set(k, row);
  }
}

function mergeTags(target, fromField) {
  if (!Array.isArray(fromField)) return;
  for (const x of fromField) {
    if (typeof x === "string" && x.trim() && !target.includes(x.trim())) target.push(x.trim());
  }
}

export function uniqueCategoryRows(deptState) {
  if (!deptState?.categories) return [];
  const seen = new Set();
  const out = [];
  for (const c of deptState.categories.values()) {
    const s = c?.slug;
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(c);
  }
  return out;
}

function allCategoryRowsFlat(deptState) {
  const rows = uniqueCategoryRows(deptState);
  const out = [...rows];
  for (const r of rows) {
    if (r.subcategories?.size) {
      for (const s of r.subcategories.values()) {
        if (s?.slug) out.push(s);
      }
    }
  }
  return out;
}

export async function loadDirDepartmentsState(db, dirCollection = "dir") {
  const depts = new Map();
  const snap = await db.collection(dirCollection).get();

  for (const doc of snap.docs) {
    const slug = doc.id;
    const data = doc.data();
    const department_fa = asString(data.department_fa) || asString(data.department);
    const department_en = asString(data.department_en) || asString(data.engName);
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
          tags_en: Array.isArray(c.tags_en)
            ? c.tags_en.filter((x) => typeof x === "string")
            : [],
          tags_fa: Array.isArray(c.tags_fa)
            ? c.tags_fa.filter((x) => typeof x === "string")
            : [],
          subcategories: new Map(),
        };
        registerCategoryRow(categories, row, [cs, ...categoryAliasKeysFromData(c)]);
      }
    }

    const catSnap = await db
      .collection(dirCollection)
      .doc(slug)
      .collection("categories")
      .limit(600)
      .get();

    for (const cdoc of catSnap.docs) {
      const cd = cdoc.data();
      const canonical = asString(cd.slug) || cdoc.id;
      let existing =
        categories.get(canonical) || categories.get(norm(canonical)) || null;
      if (!existing) {
        existing = {
          slug: canonical,
          name_en: "",
          name_fa: "",
          tags_en: [],
          tags_fa: [],
          subcategories: new Map(),
        };
      }
      existing.slug = canonical;
      existing.name_en =
        existing.name_en ||
        asString(cd.name_en) ||
        asString(cd.engName) ||
        asString(cd.Category);
      existing.name_fa =
        existing.name_fa ||
        asString(cd.name_fa) ||
        asString(cd.category_fa) ||
        asString(cd.category);
      mergeTags(existing.tags_en, cd.tags_en);
      mergeTags(existing.tags_fa, cd.tags_fa);
      registerCategoryRow(categories, existing, [canonical, cdoc.id, ...categoryAliasKeysFromData(cd)]);

      const subSnap = await cdoc.ref.collection("subcategories").limit(400).get();
      for (const sdoc of subSnap.docs) {
        const sd = sdoc.data();
        const subSlug = asString(sd.slug) || sdoc.id;
        const subRow = {
          slug: subSlug,
          name_en: asString(sd.name_en) || asString(sd.engName),
          name_fa: asString(sd.name_fa),
          tags_en: [],
          tags_fa: [],
          subcategories: new Map(),
        };
        existing.subcategories.set(subSlug, subRow);
        registerCategoryRow(categories, subRow, [subSlug, sdoc.id, ...categoryAliasKeysFromData(sd)]);
      }
    }

    depts.set(slug, {
      department_en,
      department_fa,
      categories,
    });
  }

  return depts;
}

export function matchDirCategoryInDept(deptState, dirRow) {
  const list = allCategoryRowsFlat(deptState);
  const code = norm(dirRow.code);
  const label = norm(dirRow.label);
  const engName = norm(dirRow.engName);

  let found = list.find((c) => c.slug && norm(c.slug) === code);
  if (found) return found;

  if (engName) {
    found = list.find((c) => norm(c.name_en) === engName);
    if (found) return found;
  }
  if (label) {
    found = list.find(
      (c) =>
        norm(c.name_fa) === label ||
        norm(c.name_en) === label ||
        (c.tags_fa && c.tags_fa.some((t) => norm(t) === label)) ||
        (c.tags_en && c.tags_en.some((t) => norm(t) === label)),
    );
    if (found) return found;
  }
  return null;
}

export function buildCatCodeToDeptSlug(depts) {
  const m = new Map();
  let conflicts = 0;
  for (const [deptSlug, st] of depts) {
    for (const k of st.categories.keys()) {
      const key = asString(k);
      if (!key) continue;
      if (m.has(key) && m.get(key) !== deptSlug) {
        conflicts++;
        continue;
      }
      if (!m.has(key)) m.set(key, deptSlug);
    }
  }
  if (conflicts > 0) {
    console.warn(
      `buildCatCodeToDeptSlug: ${conflicts} key(s) map to multiple departments (first wins).`,
    );
  }
  return m;
}

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

  if (catRaw && deptState.categories.has(catRaw)) {
    const row = deptState.categories.get(catRaw);
    return row?.slug || catRaw;
  }

  if (directoryDeptId && catKeyToDirCat && catKeyToDirCat.size > 0) {
    const row = catKeyToDirCat.get(`${directoryDeptId}|${catRaw}`);
    if (row && row.slug) return asString(row.slug);
  }

  if (catRaw) {
    for (const cat of uniqueCategoryRows(deptState)) {
      if (cat.subcategories && cat.subcategories.has(catRaw)) return catRaw;
      if (cat.subcategories) {
        for (const sub of cat.subcategories.values()) {
          if (sub.slug === catRaw) return sub.slug;
        }
      }
    }
  }

  const label = asString(data.cat);
  const engName = asString(data.engName) || label;
  const matched = matchDirCategoryInDept(deptState, {
    code: catRaw,
    label,
    engName,
  });
  if (matched && matched.slug) return matched.slug;
  return catRaw || null;
}
