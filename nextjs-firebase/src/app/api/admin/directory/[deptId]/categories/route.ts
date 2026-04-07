import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreAdmin } from "../../../../../../lib/firebaseAdmin";

export const runtime = "nodejs";
const ADS_SCAN_CAP = 5000;

type CategoryRow = {
  code: string;
  label: string;
  engName: string;
  subcategories: string[];
};

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeCategories(input: unknown): CategoryRow[] {
  if (!Array.isArray(input)) return [];
  const out: CategoryRow[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const code = asString(o.code);
    const label = asString(o.label);
    const engName = asString(o.engName);
    const rawSub = Array.isArray(o.subcategories) ? o.subcategories : [];
    const subcategories = rawSub
      .map((v) => asString(v))
      .filter((v) => v.length > 0);
    if (!code || !label) continue;
    out.push({ code, label, engName, subcategories });
  }
  return out;
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
  }
  return null;
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ deptId: string }> },
) {
  try {
    const { deptId: raw } = await context.params;
    const deptId = asString(raw);
    if (!deptId) {
      return NextResponse.json({ error: "Invalid department id" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const categories = normalizeCategories(body.categories);

    const db = getFirestoreAdmin();
    const deptRef = db.collection("dir").doc(deptId);
    const deptSnap = await deptRef.get();
    if (!deptSnap.exists) {
      return NextResponse.json({ error: "Department not found" }, { status: 404 });
    }

    const existingSub = await deptRef.collection("categories").limit(500).get();
    const existingCodes = new Set(existingSub.docs.map((d) => d.id));
    const nextCodes = new Set(categories.map((c) => c.code));
    const removedCodes = Array.from(existingCodes).filter((code) => !nextCodes.has(code));

    if (removedCodes.length > 0) {
      const adsSnap = await db.collection("ad").limit(ADS_SCAN_CAP).get();
      const blocked = new Set<string>();
      for (const doc of adsSnap.docs) {
        const ad = doc.data() as Record<string, unknown>;
        if (departmentIdFromAd(ad) !== deptId) continue;
        const catCode = asString(ad.cat_code);
        if (catCode && removedCodes.includes(catCode)) {
          blocked.add(catCode);
        }
      }
      if (blocked.size > 0) {
        return NextResponse.json(
          {
            error:
              "Cannot remove categories that are used by ads: " +
              Array.from(blocked).join(", "),
          },
          { status: 409 },
        );
      }
    }

    const batch = db.batch();
    for (const d of existingSub.docs) {
      if (!nextCodes.has(d.id)) {
        batch.delete(d.ref);
      }
    }
    for (const c of categories) {
      const ref = deptRef.collection("categories").doc(c.code);
      batch.set(
        ref,
        {
          code: c.code,
          category: c.label,
          engName: c.engName,
          number: 0,
          eachCityNumber: [],
          subcategories: c.subcategories,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    batch.set(
      deptRef,
      {
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await batch.commit();

    return NextResponse.json({ ok: true, id: deptId, categoriesCount: categories.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
