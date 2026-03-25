/**
 * Walks nested `directory.categories` trees (and similar) and collects code → label pairs.
 * Supports: JSON strings, UUID-keyed maps ({ [uuid]: { name } }), alternate field names, subcollections (via API).
 */

function parseCategoriesField(raw: unknown): unknown {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return null;
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  }
  return raw;
}

function stringFrom(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Firestore doc id (20 chars), UUID, or numeric map key (Flutter map-as-list). */
function isLikelyCategoryMapKey(key: string): boolean {
  const k = key.trim();
  if (!k) return false;
  if (/^[0-9a-f-]{36}$/i.test(k)) return true;
  if (/^[a-zA-Z0-9]{20}$/.test(k)) return true;
  if (/^\d+$/.test(k)) return true;
  return false;
}

function categoryCodeFrom(obj: Record<string, unknown>): string | null {
  const c = stringFrom(obj, [
    "code",
    "cat_code",
    "catCode",
    "Cat_code",
    "category_code",
    "categoryCode",
  ]);
  if (c) return c;
  const id = obj.id;
  if (typeof id === "string") {
    const t = id.trim();
    if (/^[0-9a-f-]{36}$/i.test(t)) return t;
    if (/^[a-zA-Z0-9]{20}$/.test(t)) return t;
  }
  return null;
}

function categoryLabelFrom(obj: Record<string, unknown>): string | null {
  const s = stringFrom(obj, [
    "category",
    "category_fa",
    "Category",
    "engName",
    "name",
    "title",
    "label",
    "faName",
    "persianName",
    "displayName",
    "groupName",
    "subcategory",
  ]);
  return s || null;
}

/** For `/directory/{id}/categories/{catId}` documents — pick a human-readable label. */
export function displayLabelForCategoryFirestoreDoc(
  data: Record<string, unknown>,
  fallbackId: string,
): string {
  return categoryLabelFrom(data) || fallbackId;
}

/**
 * Many directory docs store categories as a map: `{ "[uuid]": { name: "…" } }` or `{ "[uuid]": "…" }`.
 * The generic recursion only visits values and then misses using the key as `code`.
 */
function collectFromKeyedCategoryMap(
  obj: Record<string, unknown>,
  output: Map<string, string>,
) {
  for (const [k, v] of Object.entries(obj)) {
    if (!isLikelyCategoryMapKey(k)) continue;
    if (typeof v === "string") {
      const t = v.trim();
      if (t) output.set(k, t);
      continue;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = v as Record<string, unknown>;
      const lbl = categoryLabelFrom(inner);
      const innerCode = categoryCodeFrom(inner);
      const code = innerCode ?? k.trim();
      if (lbl && code) output.set(code, lbl);
    }
  }
}

export function collectCategoryCodes(
  node: unknown,
  output: Map<string, string>,
) {
  if (node == null) return;
  if (typeof node !== "object") return;

  if (Array.isArray(node)) {
    node.forEach((item) => collectCategoryCodes(item, output));
    return;
  }

  const obj = node as Record<string, unknown>;
  collectFromKeyedCategoryMap(obj, output);

  const code = categoryCodeFrom(obj);
  const label = categoryLabelFrom(obj);
  if (code && label) {
    output.set(code, label);
  }

  Object.values(obj).forEach((v) => collectCategoryCodes(v, output));
}

export function categoriesFromDirectoryData(
  data: Record<string, unknown>,
): { code: string; label: string }[] {
  const map = new Map<string, string>();
  const d = data as Record<string, unknown>;
  const candidateRoots: unknown[] = [
    parseCategoriesField(d.categories),
    parseCategoriesField(d.Categories),
    parseCategoriesField(d.subcategories),
    parseCategoriesField(d.Subcategories),
    parseCategoriesField(d.categoryList),
    parseCategoriesField(d.CategoryList),
    parseCategoriesField(d.results),
    parseCategoriesField(d.items),
    parseCategoriesField(d.children),
    parseCategoriesField(d.category_map),
    parseCategoriesField(d.cats),
    parseCategoriesField(d.allCategories),
  ];

  for (const root of candidateRoots) {
    if (root != null) collectCategoryCodes(root, map);
  }

  collectFromKeyedCategoryMap(d, map);

  if (map.size === 0) {
    collectCategoryCodes(d, map);
  }

  return Array.from(map.entries())
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "fa"));
}
