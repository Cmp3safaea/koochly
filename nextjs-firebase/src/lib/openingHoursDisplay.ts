/**
 * Normalize Firestore / scraped opening hours into display lines (e.g. Google weekday_text).
 */
export function normalizeOpeningHours(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter((x) => x.length > 0);
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return [];
    if (t.startsWith("[")) {
      try {
        const p = JSON.parse(t) as unknown;
        if (Array.isArray(p)) return normalizeOpeningHours(p);
      } catch {
        /* use as plain string */
      }
    }
    return t
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}
