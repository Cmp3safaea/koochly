import { NextResponse } from "next/server";
import {
  directoryDepartmentDisplayLabel,
  type DirectoryLocale,
} from "../../../lib/directoryDepartmentLabel";
import { getFirestoreAdmin } from "../../../lib/firebaseAdmin";

export const runtime = "nodejs";

/**
 * Lists directory departments (id + label only). Categories load per selection via
 * `GET /api/directory/[deptId]/categories`.
 *
 * Query: `locale=en` — use `engName` before `department`. Default / `fa` — use `department` first.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const locale: DirectoryLocale =
      searchParams.get("locale") === "en" ? "en" : "fa";
    const sortLocale = locale === "en" ? "en" : "fa";

    const db = getFirestoreAdmin();
    const snap = await db.collection("directory").limit(200).get();
    const departments = snap.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const label = directoryDepartmentDisplayLabel(data, doc.id, locale);
      return { id: doc.id, label };
    });
    departments.sort((a, b) => a.label.localeCompare(b.label, sortLocale));
    return NextResponse.json(
      { departments },
      {
        headers: {
          "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200",
        },
      },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
