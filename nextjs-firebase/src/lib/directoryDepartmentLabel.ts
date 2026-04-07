/** Matches UI locales; drives directory doc `department` vs `engName` preference. */
export type DirectoryLocale = "fa" | "en";

const HAS_FA = /[\u0600-\u06FF]/;

/**
 * Label for a `directory` Firestore doc: Farsi UI prefers `department`, English UI uses
 * English fields only (never Persian fallbacks).
 */
export function directoryDepartmentDisplayLabel(
  data: Record<string, unknown>,
  docId: string,
  locale: DirectoryLocale,
): string {
  // Support both legacy `directory` docs and new `dir` docs.
  const department =
    typeof data.department === "string"
      ? data.department.trim()
      : typeof data.department_fa === "string"
        ? data.department_fa.trim()
        : "";
  const engName =
    typeof data.engName === "string"
      ? data.engName.trim()
      : typeof data.department_en === "string"
        ? data.department_en.trim()
        : "";
  if (locale === "en") {
    if (engName) return engName;
    if (department && !HAS_FA.test(department)) return department;
    return docId;
  }
  return department || engName || docId;
}
