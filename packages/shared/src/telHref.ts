/**
 * Build a `tel:` URL in E.164-style form where possible so OS dialers treat it as a phone
 * number (Windows may send bare numeric `tel:` to Skype as a Skype ID).
 */
export function telHref(phone: string): string {
  const raw = phone.trim();
  if (!raw) return "#";
  const lower = raw.toLowerCase();
  if (lower.startsWith("skype:") || lower.startsWith("callto:")) {
    return "#";
  }

  const sanitized = raw.replace(/[^\d+]/g, "");
  if (!sanitized) return "#";

  const hadLeadingPlus = sanitized.startsWith("+");
  const digits = sanitized.replace(/\D/g, "");
  if (!digits) return "#";

  if (/^09\d{9}$/.test(digits)) {
    return `tel:+98${digits.slice(1)}`;
  }

  if (digits.startsWith("0098") && digits.length >= 12) {
    return `tel:+98${digits.slice(4)}`;
  }

  if (/^989\d{9}$/.test(digits)) {
    return `tel:+${digits}`;
  }

  if (hadLeadingPlus) {
    return `tel:+${digits}`;
  }

  return `tel:${digits}`;
}
