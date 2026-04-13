import { NextResponse } from "next/server";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { defaultLocale } from "@koochly/shared";
import { requireAdminRequest } from "../../../../lib/adminAuth";
import { getFirestoreAdmin } from "../../../../lib/firebaseAdmin";
import {
  directoryDepartmentDisplayLabel,
  type DirectoryLocale,
} from "../../../../lib/directoryDepartmentLabel";
import { resolveDirectoryCategoriesForAdmin } from "../../../../lib/directoryCategoriesAdmin";
import {
  categoriesFromDirectoryData,
  displayLabelForCategoryFirestoreDoc,
} from "../../../../lib/directoryMetadata";

export const runtime = "nodejs";
/** Large scans can time out serverless routes; dashboard still gets a useful sample. */
const ADS_SCAN_CAP = 12000;
/** Load every `dir` doc (paginated); cap avoids runaway reads if collection grows huge. */
const DIR_DOC_PAGE = 400;
const DIR_DOC_MAX = 8000;

type CategoryRow = {
  code: string;
  label: string;
  engName?: string;
  subcategories?: string[];
  usageCount?: number;
};

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asLooseString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function normKey(v: unknown): string {
  return asLooseString(v).toLowerCase();
}

function categoryEngNameFromDoc(data: Record<string, unknown>): string {
  return (
    asString(data.engName) ||
    asString(data.name_en) ||
    asString(data.Category_en) ||
    asString(data.category_en) ||
    asString(data.label_en) ||
    asString(data.title_en)
  );
}

async function fetchAllDirDocumentSnapshots(
  db: ReturnType<typeof getFirestoreAdmin>,
): Promise<QueryDocumentSnapshot[]> {
  const out: QueryDocumentSnapshot[] = [];
  let last: QueryDocumentSnapshot | undefined;
  while (out.length < DIR_DOC_MAX) {
    let q = db.collection("dir").orderBy(FieldPath.documentId()).limit(DIR_DOC_PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    out.push(...snap.docs);
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < DIR_DOC_PAGE) break;
  }
  return out;
}

async function readDepartmentCategories(
  db: ReturnType<typeof getFirestoreAdmin>,
  deptId: string,
  deptData: Record<string, unknown>,
  locale: DirectoryLocale,
): Promise<Array<{ code: string; label: string; engName: string; subcategories: string[] }>> {
  const sub = await db.collection("dir").doc(deptId).collection("categories").limit(500).get();
  if (!sub.empty) {
    const rows = sub.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const rawSub = Array.isArray(data.subcategories) ? data.subcategories : [];
      const subcategories = rawSub
        .map((v) => asString(v))
        .filter((v) => v.length > 0);
      return {
        code: d.id,
        label: displayLabelForCategoryFirestoreDoc(data, d.id, locale),
        engName: categoryEngNameFromDoc(data),
        subcategories,
      };
    });
    const sortLoc = locale === "en" ? "en" : "fa";
    rows.sort((a, b) => a.label.localeCompare(b.label, sortLoc));
    return rows;
  }
  // Fallback for legacy docs that still keep categories at root.
  return (await resolveDirectoryCategoriesForAdmin(db, deptId, deptData, locale)).map((c) => ({
    ...c,
    engName: "",
    subcategories: [],
  }));
}

/**
 * Same resolution as public app: `departmentID` ref/string, then `dir_id`, then `dir_department_slug`.
 */
function departmentIdFromAd(data: Record<string, unknown>): string | null {
  const direct = asString(data.departmentID);
  if (direct) {
    const parts = direct.split("/").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : direct;
  }
  const maybeRef = data.departmentID as { id?: unknown; path?: unknown; __ref__?: unknown } | undefined;
  if (maybeRef && typeof maybeRef === "object") {
    const refId = asString(maybeRef.id);
    if (refId) return refId;
    const path = asString(maybeRef.path);
    if (path) {
      const parts = path.split("/").filter(Boolean);
      return parts.length > 0 ? parts[parts.length - 1] : null;
    }
    const ref = asString((maybeRef as Record<string, unknown>).__ref__);
    if (ref) {
      const parts = ref.split("/").filter(Boolean);
      return parts.length > 0 ? parts[parts.length - 1] : null;
    }
  }
  const dirId = asString(data.dir_id);
  if (dirId) return dirId;
  const dirSlug = asString(data.dir_department_slug);
  if (dirSlug) {
    const parts = dirSlug.split("/").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : dirSlug;
  }
  return null;
}

function categoriesFromParentDocOnly(
  data: Record<string, unknown>,
  locale: DirectoryLocale,
  deptId: string,
  catUsageMap: Map<string, number>,
  catLabelUsageMap: Map<string, number>,
): CategoryRow[] {
  const rows = categoriesFromDirectoryData(data, locale).map((c) => ({
    code: c.code,
    label: c.label,
    engName: "",
    subcategories: [] as string[],
  }));
  return rows.map((c) => {
    const byCode = catUsageMap.get(`${deptId}::${normKey(c.code)}`) ?? 0;
    if (byCode > 0) return { ...c, usageCount: byCode };
    const byLabel = catLabelUsageMap.get(`${deptId}::${normKey(c.label)}`) ?? 0;
    return { ...c, usageCount: byLabel };
  });
}

export async function GET(request: Request) {
  const deny = await requireAdminRequest(request);
  if (deny) return deny;
  try {
    const db = getFirestoreAdmin();
    const { searchParams } = new URL(request.url);
    const locale: DirectoryLocale = searchParams.get("locale") === "en" ? "en" : defaultLocale;
    const brief =
      searchParams.get("brief") === "1" || searchParams.get("brief")?.toLowerCase() === "true";
    const [dirDocs, adsSnap] = await Promise.all([
      fetchAllDirDocumentSnapshots(db),
      db.collection("ad").limit(ADS_SCAN_CAP).get(),
    ]);

    const dirDocIds = new Set(dirDocs.map((d) => d.id));
    const deptUsageMap = new Map<string, number>();
    const catUsageMap = new Map<string, number>();
    const catLabelUsageMap = new Map<string, number>();
    let adsNoDepartment = 0;
    let adsUnknownDirRef = 0;
    adsSnap.docs.forEach((doc) => {
      const ad = doc.data() as Record<string, unknown>;
      const deptId = departmentIdFromAd(ad);
      if (!deptId) {
        adsNoDepartment += 1;
        return;
      }
      if (!dirDocIds.has(deptId)) adsUnknownDirRef += 1;
      deptUsageMap.set(deptId, (deptUsageMap.get(deptId) ?? 0) + 1);
      const catCode =
        asLooseString(ad.dir_category_slug) ||
        asLooseString(ad.cat_code) ||
        asLooseString(ad.catCode) ||
        asLooseString(ad.category_code) ||
        asLooseString(ad.categoryCode);
      if (!catCode) return;
      const key = `${deptId}::${normKey(catCode)}`;
      catUsageMap.set(key, (catUsageMap.get(key) ?? 0) + 1);
      const catLabel = asLooseString(ad.cat);
      if (catLabel) {
        const labelKey = `${deptId}::${normKey(catLabel)}`;
        catLabelUsageMap.set(labelKey, (catLabelUsageMap.get(labelKey) ?? 0) + 1);
      }
    });

    /** Full mode: parallel subcollection reads per chunk. Brief: parent doc only (much faster). */
    const DEPT_FETCH_CHUNK = brief ? 120 : 36;
    const departments: Array<{
      id: string;
      label: string;
      department: string;
      engName: string;
      image: string;
      usageCount: number;
      categories: CategoryRow[];
    }> = [];
    if (brief) {
      for (const doc of dirDocs) {
        const data = doc.data() as Record<string, unknown>;
        const categories = categoriesFromParentDocOnly(
          data,
          locale,
          doc.id,
          catUsageMap,
          catLabelUsageMap,
        );
        const departmentFa =
          asString(data.department) || asString(data.department_fa) || asString(data.Department);
        const engNameVal =
          asString(data.engName) || asString(data.department_en) || asString(data.Department_en);
        departments.push({
          id: doc.id,
          label: directoryDepartmentDisplayLabel(data, doc.id, locale),
          department: departmentFa,
          engName: engNameVal,
          image: asString(data.image),
          usageCount: deptUsageMap.get(doc.id) ?? 0,
          categories,
        });
      }
    } else {
      for (let i = 0; i < dirDocs.length; i += DEPT_FETCH_CHUNK) {
        const chunk = dirDocs.slice(i, i + DEPT_FETCH_CHUNK);
        const part = await Promise.all(
          chunk.map(async (doc) => {
            const data = doc.data() as Record<string, unknown>;
            const categories = (
              await readDepartmentCategories(db, doc.id, data, locale)
            ).map((c) => {
              const byCode = catUsageMap.get(`${doc.id}::${normKey(c.code)}`) ?? 0;
              if (byCode > 0) return { ...c, usageCount: byCode };
              const byLabel = catLabelUsageMap.get(`${doc.id}::${normKey(c.label)}`) ?? 0;
              return { ...c, usageCount: byLabel };
            });
            const departmentFa =
              asString(data.department) || asString(data.department_fa) || asString(data.Department);
            const engNameVal =
              asString(data.engName) || asString(data.department_en) || asString(data.Department_en);
            return {
              id: doc.id,
              label: directoryDepartmentDisplayLabel(data, doc.id, locale),
              department: departmentFa,
              engName: engNameVal,
              image: asString(data.image),
              usageCount: deptUsageMap.get(doc.id) ?? 0,
              categories,
            };
          }),
        );
        departments.push(...part);
      }
    }

    departments.sort((a, b) => a.label.localeCompare(b.label, locale));
    const totalScanned = adsSnap.size;
    const adsInKnownDir = Math.max(0, totalScanned - adsNoDepartment - adsUnknownDirRef);
    const adScanSummary = {
      totalScanned,
      adsInKnownDir,
      adsUnknownDirRef,
      adsNoDepartment,
      scanLimit: ADS_SCAN_CAP,
      isCapped: totalScanned >= ADS_SCAN_CAP,
    };
    return NextResponse.json({
      departments,
      adScanSummary,
      dirMeta: {
        docCount: dirDocs.length,
        fetchCap: DIR_DOC_MAX,
        isDirCapped: dirDocs.length >= DIR_DOC_MAX,
        brief,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const deny = await requireAdminRequest(request);
  if (deny) return deny;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const department = asString(body.department);
    const engName = asString(body.engName);
    const image = asString(body.image);
    const requestedId = asString(body.id);

    if (!department && !engName) {
      return NextResponse.json(
        { error: "department or engName is required" },
        { status: 400 },
      );
    }

    const db = getFirestoreAdmin();
    const ref = requestedId
      ? db.collection("dir").doc(requestedId)
      : db.collection("dir").doc();

    await ref.set(
      {
        department,
        engName,
        image,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true, id: ref.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
