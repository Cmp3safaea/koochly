import { NextResponse } from "next/server";
import { getFirestoreAdmin } from "../../../../../lib/firebaseAdmin";

export const runtime = "nodejs";
/** Smaller cap keeps admin dashboard responsive; breakdowns are still representative. */
const SCAN_CAP = 12000;

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => asString(x))
    .filter((x, i, arr) => x.length > 0 && arr.indexOf(x) === i);
}

function topEntries(map: Map<string, number>, limit = 12) {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export async function GET() {
  try {
    const db = getFirestoreAdmin();
    const snap = await db.collection("activitylog").limit(SCAN_CAP).get();
    const today = new Date().toISOString().slice(0, 10);

    const users = new Set<string>();
    let totalEvents = 0;
    let todayEvents = 0;
    const byPage = new Map<string, number>();
    const byCity = new Map<string, number>();
    const byDept = new Map<string, number>();
    const byCat = new Map<string, number>();
    const recent: Array<{
      uid: string;
      page: string;
      city: string;
      atMs: number;
      day: string;
    }> = [];

    snap.docs.forEach((doc) => {
      const d = doc.data() as Record<string, unknown>;
      totalEvents += 1;
      const uid = asString(d.uid);
      if (uid) users.add(uid);
      const page = asString(d.page) || "unknown";
      const city = asString(d.city);
      const day = asString(d.day);
      const at = d.at as { toDate?: () => Date; _seconds?: number; seconds?: number } | undefined;
      const atMs =
        typeof at?.toDate === "function"
          ? at.toDate().getTime()
          : typeof at?._seconds === "number"
            ? at._seconds * 1000
            : typeof at?.seconds === "number"
              ? at.seconds * 1000
              : 0;

      byPage.set(page, (byPage.get(page) ?? 0) + 1);
      if (city) byCity.set(city, (byCity.get(city) ?? 0) + 1);
      if (day === today) todayEvents += 1;

      asStringList(d.departmentIds).forEach((x) => byDept.set(x, (byDept.get(x) ?? 0) + 1));
      asStringList(d.categoryCodes).forEach((x) => byCat.set(x, (byCat.get(x) ?? 0) + 1));

      recent.push({ uid, page, city, atMs, day });
    });

    recent.sort((a, b) => b.atMs - a.atMs);

    return NextResponse.json({
      summary: {
        totalEvents,
        uniqueUsers: users.size,
        todayEvents,
        byPage: topEntries(byPage, 8),
        byCity: topEntries(byCity, 12),
        byDepartment: topEntries(byDept, 12),
        byCategory: topEntries(byCat, 16),
        recent: recent.slice(0, 20),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

