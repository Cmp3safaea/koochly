import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { defaultLocale } from "@koochly/shared";
import { getFirestoreAdmin } from "../../../../lib/firebaseAdmin";
import { directoryDepartmentDisplayLabel } from "../../../../lib/directoryDepartmentLabel";
import { resolveDirectoryCategoriesForAdmin } from "../../../../lib/directoryCategoriesAdmin";

export const runtime = "nodejs";
const ADS_SCAN_CAP = 20000;

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

function categoryLabelFromDoc(data: Record<string, unknown>, fallbackId: string): string {
  return (
    asString(data.category) ||
    asString(data.Category) ||
    asString(data.label) ||
    asString(data.name) ||
    asString(data.title) ||
    fallbackId
  );
}

async function readDepartmentCategories(
  db: ReturnType<typeof getFirestoreAdmin>,
  deptId: string,
  deptData: Record<string, unknown>,
): Promise<Array<{ code: string; label: string; engName: string; subcategories: string[] }>> {
  const sub = await db.collection("directory").doc(deptId).collection("categories").limit(500).get();
  if (!sub.empty) {
    const rows = sub.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      const rawSub = Array.isArray(data.subcategories) ? data.subcategories : [];
      const subcategories = rawSub
        .map((v) => asString(v))
        .filter((v) => v.length > 0);
      return {
        code: d.id,
        label: categoryLabelFromDoc(data, d.id),
        engName: asString(data.engName),
        subcategories,
      };
    });
    rows.sort((a, b) => a.label.localeCompare(b.label, "fa"));
    return rows;
  }
  // Fallback for legacy docs that still keep categories at root.
  return (await resolveDirectoryCategoriesForAdmin(db, deptId, deptData)).map((c) => ({
    ...c,
    engName: "",
    subcategories: [],
  }));
}

function departmentIdFromAd(data: Record<string, unknown>): string | null {
  const direct = asString(data.departmentID);
  if (direct) {
    const parts = direct.split("/").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : direct;
  }
  const maybeRef = data.departmentID as { id?: unknown; path?: unknown } | undefined;
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
  return null;
}

export async function GET(request: Request) {
  try {
    const db = getFirestoreAdmin();
    const { searchParams } = new URL(request.url);
    const locale = searchParams.get("locale") === "en" ? "en" : defaultLocale;
    const [snap, adsSnap] = await Promise.all([
      db.collection("directory").limit(300).get(),
      db.collection("ads").limit(ADS_SCAN_CAP).get(),
    ]);

    const deptUsageMap = new Map<string, number>();
    const catUsageMap = new Map<string, number>();
    const catLabelUsageMap = new Map<string, number>();
    adsSnap.docs.forEach((doc) => {
      const ad = doc.data() as Record<string, unknown>;
      const deptId = departmentIdFromAd(ad);
      if (!deptId) return;
      deptUsageMap.set(deptId, (deptUsageMap.get(deptId) ?? 0) + 1);
      const catCode =
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

    const departments = await Promise.all(
      snap.docs.map(async (doc) => {
        const data = doc.data() as Record<string, unknown>;
        const categories = (await readDepartmentCategories(db, doc.id, data)).map((c) => {
          const byCode = catUsageMap.get(`${doc.id}::${normKey(c.code)}`) ?? 0;
          if (byCode > 0) return { ...c, usageCount: byCode };
          const byLabel = catLabelUsageMap.get(`${doc.id}::${normKey(c.label)}`) ?? 0;
          return { ...c, usageCount: byLabel };
        });
        return {
          id: doc.id,
          label: directoryDepartmentDisplayLabel(data, doc.id, locale),
          department: asString(data.department),
          engName: asString(data.engName),
          image: asString(data.image),
          usageCount: deptUsageMap.get(doc.id) ?? 0,
          categories,
        };
      }),
    );

    departments.sort((a, b) => a.label.localeCompare(b.label, locale));
    return NextResponse.json({ departments });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
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
      ? db.collection("directory").doc(requestedId)
      : db.collection("directory").doc();

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
