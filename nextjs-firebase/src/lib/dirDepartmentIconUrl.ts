/** Matches static assets under `public/department-icons/` and Firestore `dir` field `image`. */
export const DIR_DEPARTMENT_ICON_BASE = "/department-icons";

export function dirDepartmentIconUrl(departmentSlug: string): string {
  const s = departmentSlug.trim();
  if (!s || s.includes("/")) return "";
  return `${DIR_DEPARTMENT_ICON_BASE}/${encodeURIComponent(s)}.svg`;
}
