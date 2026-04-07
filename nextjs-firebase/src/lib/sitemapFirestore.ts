import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { FieldPath } from "firebase-admin/firestore";
import { getFirestoreAdmin } from "./firebaseAdmin";
import { hubPathForCityDoc, isAdDocIndexable, isCityDocIndexable } from "./seoIndexable";

export type SitemapSourceEntry = {
  path: string;
  lastModified?: Date;
};

function toDateFromFirestoreValue(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? new Date(t) : undefined;
  }
  if (typeof value === "object") {
    const v = value as {
      toDate?: () => Date;
      __time__?: string;
      _seconds?: number;
      seconds?: number;
    };
    if (typeof v.toDate === "function") {
      const d = v.toDate();
      return d instanceof Date ? d : undefined;
    }
    if (typeof v.__time__ === "string") {
      const t = Date.parse(v.__time__);
      return Number.isFinite(t) ? new Date(t) : undefined;
    }
    if (typeof v._seconds === "number") return new Date(v._seconds * 1000);
    if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  }
  return undefined;
}

function adLastModified(data: Record<string, unknown>): Date | undefined {
  return (
    toDateFromFirestoreValue(data.updatedAt) ??
    toDateFromFirestoreValue(data.updated_at) ??
    toDateFromFirestoreValue(data.dateTime) ??
    toDateFromFirestoreValue(data.modifiedAt)
  );
}

function cleanPathToken(value: unknown): string {
  if (typeof value !== "string") return "";
  const t = value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim();
  return t;
}

/**
 * Fetches hub paths and ad paths suitable for `MetadataRoute.Sitemap`.
 * Callers should cache (e.g. `unstable_cache`) to avoid hammering Firestore.
 */
export async function buildSitemapEntries(): Promise<{
  staticEntries: SitemapSourceEntry[];
  adEntries: SitemapSourceEntry[];
}> {
  const db = getFirestoreAdmin();

  const staticEntries: SitemapSourceEntry[] = [{ path: "/" }];

  const citiesSnap = await db.collection("cities").get();
  const cityPaths = new Set<string>();

  for (const doc of citiesSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (!isCityDocIndexable(data)) continue;
    const path = hubPathForCityDoc(data);
    if (!path || cityPaths.has(path)) continue;
    cityPaths.add(path);
    staticEntries.push({
      path,
      lastModified: toDateFromFirestoreValue(data.updatedAt) ?? undefined,
    });
  }

  const adBySeq = new Map<number, SitemapSourceEntry>();
  const categoryByPath = new Map<string, Date | undefined>();
  let lastDoc: QueryDocumentSnapshot | undefined;
  const batchSize = 500;

  for (;;) {
    let q = db.collection("ad").orderBy(FieldPath.documentId()).limit(batchSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      if (!isAdDocIndexable(data)) continue;
      const seqRaw = data.seq;
      const seq =
        typeof seqRaw === "number"
          ? seqRaw
          : typeof seqRaw === "string"
            ? Number(seqRaw)
            : NaN;
      if (!Number.isFinite(seq)) continue;
      const lm = adLastModified(data);
      const country = cleanPathToken(data.country_eng);
      const city = cleanPathToken(data.city_eng);
      const catCode = cleanPathToken(data.cat_code);
      if (country && city && catCode) {
        const p = `/${encodeURIComponent(country)}/${encodeURIComponent(city)}/category/${encodeURIComponent(catCode)}/`;
        const existingLm = categoryByPath.get(p);
        if (!existingLm || (lm && lm.getTime() > existingLm.getTime())) {
          categoryByPath.set(p, lm);
        }
      }
      const existing = adBySeq.get(seq);
      if (
        !existing ||
        (lm &&
          (!existing.lastModified || lm.getTime() > existing.lastModified.getTime()))
      ) {
        adBySeq.set(seq, {
          path: `/b/${seq}`,
          lastModified: lm,
        });
      }
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < batchSize) break;
  }

  const adEntries = Array.from(adBySeq.values()).sort((a, b) => {
    const an = Number(a.path.replace("/b/", ""));
    const bn = Number(b.path.replace("/b/", ""));
    return an - bn;
  });

  for (const [path, lastModified] of categoryByPath.entries()) {
    staticEntries.push({ path, lastModified });
  }

  return { staticEntries, adEntries };
}
