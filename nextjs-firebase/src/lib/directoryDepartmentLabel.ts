/** Matches UI locales; drives directory doc `department` vs `engName` preference. */
export type DirectoryLocale = "fa" | "en";

/**
 * Label for a `directory` Firestore doc: Farsi UI prefers `department`, English prefers `engName`.
 */
export function directoryDepartmentDisplayLabel(
  data: Record<string, unknown>,
  docId: string,
  locale: DirectoryLocale,
): string {
  const department =
    typeof data.department === "string" ? data.department.trim() : "";
  const engName = typeof data.engName === "string" ? data.engName.trim() : "";
  if (locale === "en") {
    return engName || department || docId;
  }
  return department || engName || docId;
}
