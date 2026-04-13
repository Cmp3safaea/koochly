import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdminRequest } from "../../../../../lib/adminAuth";
import { getFirestoreAdmin } from "../../../../../lib/firebaseAdmin";

export const runtime = "nodejs";
const ADS_SCAN_CAP = 5000;

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ deptId: string }> },
) {
  const deny = await requireAdminRequest(request);
  if (deny) return deny;
  try {
    const { deptId: raw } = await context.params;
    const deptId = asString(raw);
    if (!deptId) {
      return NextResponse.json({ error: "Invalid department id" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const department = asString(body.department);
    const engName = asString(body.engName);
    const image = asString(body.image);

    if (!department && !engName) {
      return NextResponse.json(
        { error: "department or engName is required" },
        { status: 400 },
      );
    }

    const db = getFirestoreAdmin();
    await db.collection("dir").doc(deptId).set(
      {
        department,
        engName,
        image,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true, id: deptId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ deptId: string }> },
) {
  const deny = await requireAdminRequest(request);
  if (deny) return deny;
  try {
    const { deptId: raw } = await context.params;
    const deptId = asString(raw);
    if (!deptId) {
      return NextResponse.json({ error: "Invalid department id" }, { status: 400 });
    }
    const db = getFirestoreAdmin();
    const adsSnap = await db.collection("ad").limit(ADS_SCAN_CAP).get();
    const usedBy = adsSnap.docs.find((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return departmentIdFromAd(data) === deptId;
    });
    if (usedBy) {
      return NextResponse.json(
        { error: "Cannot delete this department because it is used by ads." },
        { status: 409 },
      );
    }
    await db.collection("dir").doc(deptId).delete();
    return NextResponse.json({ ok: true, id: deptId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
