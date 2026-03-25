/** Fire-and-forget: increments `visits` on the ad doc via the Admin API. */
export function recordAdVisit(adDocumentId: string): void {
  if (typeof adDocumentId !== "string" || !adDocumentId.trim()) return;
  const id = encodeURIComponent(adDocumentId.trim());
  void fetch(`/api/ads/${id}/visit`, { method: "POST" }).catch(() => {});
}
