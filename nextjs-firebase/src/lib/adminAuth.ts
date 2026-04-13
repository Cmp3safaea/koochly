import { NextResponse } from "next/server";
import { ADMIN_ALLOWED_GOOGLE_EMAIL } from "./adminAllowedEmail";
import { getFirebaseAuthAdmin } from "./firebaseAdmin";

/**
 * Requires `Authorization: Bearer <Firebase ID token>` and a verified email match.
 * Use on every `/api/admin/*` handler so the UI gate cannot be bypassed.
 */
export async function requireAdminRequest(request: Request): Promise<NextResponse | null> {
  const raw = request.headers.get("authorization")?.trim() ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  if (!m?.[1]) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const decoded = await getFirebaseAuthAdmin().verifyIdToken(m[1].trim());
    const email = (decoded.email ?? "").trim().toLowerCase();
    if (!email || email !== ADMIN_ALLOWED_GOOGLE_EMAIL.toLowerCase()) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return null;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
