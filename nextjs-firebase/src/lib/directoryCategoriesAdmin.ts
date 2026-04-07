import type { Firestore } from "firebase-admin/firestore";
import type { DirectoryLocale } from "./directoryDepartmentLabel";
import {
  categoriesFromDirectoryData,
  displayLabelForCategoryFirestoreDoc,
} from "./directoryMetadata";

/**
 * Same category resolution as `GET /api/directory` (embedded fields + subcollections).
 */
export async function resolveDirectoryCategoriesForAdmin(
  db: Firestore,
  directoryDocId: string,
  data: Record<string, unknown>,
  locale: DirectoryLocale = "fa",
): Promise<{ code: string; label: string }[]> {
  let categories = categoriesFromDirectoryData(data, locale);
  if (categories.length > 0) return categories;

  for (const name of [
    "categories",
    "category",
    "subcategories",
    "subcategory",
    "Categories",
    "Category",
    "all_categories",
    "tags",
    "types",
  ]) {
    const sub = await db
      .collection("dir")
      .doc(directoryDocId)
      .collection(name)
      .limit(400)
      .get();
    if (sub.empty) continue;
    const rows = sub.docs.map((d) => {
      const dt = d.data() as Record<string, unknown>;
      const label = displayLabelForCategoryFirestoreDoc(dt, d.id, locale);
      return { code: d.id, label };
    });
    if (rows.length > 0) {
      const sortLoc = locale === "en" ? "en" : "fa";
      return rows.sort((a, b) => a.label.localeCompare(b.label, sortLoc));
    }
  }
  return [];
}
