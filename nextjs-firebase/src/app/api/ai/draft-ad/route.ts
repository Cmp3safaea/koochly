import { NextResponse } from "next/server";
import {
  getFirebaseAuthAdmin,
  getFirestoreAdmin,
} from "../../../../lib/firebaseAdmin";
import { resolveDirectoryCategoriesForAdmin } from "../../../../lib/directoryCategoriesAdmin";
import {
  directoryDepartmentDisplayLabel,
  type DirectoryLocale,
} from "../../../../lib/directoryDepartmentLabel";

export const runtime = "nodejs";

const MAX_FIELD_LEN = 600;
const MAX_TITLE = 200;
const MAX_DETAILS = 2500;
const MAX_ENG = 160;
const MAX_SERVICES = 1200;
const MAX_TAGS = 2;

async function uidFromRequest(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!token) return null;
  try {
    const decoded = await getFirebaseAuthAdmin().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

type TaxonomyCategory = {
  code: string;
  label: string;
  subcategories: string[];
};

type TaxonomyDept = {
  id: string;
  label: string;
  categories: TaxonomyCategory[];
};

async function loadTaxonomy(locale: DirectoryLocale): Promise<TaxonomyDept[]> {
  const db = getFirestoreAdmin();
  const snap = await db.collection("dir").limit(200).get();
  const sortLocale = locale === "en" ? "en" : "fa";

  const rows = await Promise.all(
    snap.docs.map(async (doc) => {
      const data = doc.data() as Record<string, unknown>;
      const label = directoryDepartmentDisplayLabel(data, doc.id, locale);
      const base = await resolveDirectoryCategoriesForAdmin(db, doc.id, data);
      const subSnap = await db
        .collection("dir")
        .doc(doc.id)
        .collection("categories")
        .limit(500)
        .get();
      const byId = new Map(
        subSnap.docs.map((d) => [d.id, d.data() as Record<string, unknown>]),
      );
      const categories: TaxonomyCategory[] = base.map((c) => {
        const row = byId.get(c.code);
        const rawTags = row?.subcategories;
        const subcategories = Array.isArray(rawTags)
          ? rawTags
              .map((v) => (typeof v === "string" ? v.trim() : ""))
              .filter((v) => v.length > 0)
          : [];
        return { code: c.code, label: c.label, subcategories };
      });
      return { id: doc.id, label, categories };
    }),
  );

  rows.sort((a, b) => a.label.localeCompare(b.label, sortLocale));
  return rows;
}

function parseDraftJson(
  content: string,
  taxonomy: TaxonomyDept[],
): {
  departmentId: string;
  catCode: string;
  mainCategory: "goods" | "services";
  title: string;
  engName: string;
  details: string;
  services: string;
  selectedTags: string[];
} | null {
  const trimmed = content.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  const departmentId = asString(o.departmentId);
  const catCode = asString(o.catCode);
  const mainRaw = asString(o.mainCategory).toLowerCase();
  const mainCategory =
    mainRaw === "services" ? "services" : mainRaw === "goods" ? "goods" : null;
  if (!mainCategory) return null;

  const title = truncate(asString(o.title), MAX_TITLE);
  const engName = truncate(asString(o.engName), MAX_ENG);
  const details = truncate(asString(o.details), MAX_DETAILS);
  const services = truncate(asString(o.services), MAX_SERVICES);

  if (!departmentId || !catCode || title.length < 2) return null;

  const dept = taxonomy.find((d) => d.id === departmentId);
  if (!dept) return null;
  const cat = dept.categories.find((c) => c.code === catCode);
  if (!cat) return null;

  const allowedLower = new Map(
    cat.subcategories.map((t) => [t.toLowerCase(), t] as const),
  );
  const tagsRaw = o.selectedTags;
  const selectedTags: string[] = [];
  if (Array.isArray(tagsRaw)) {
    for (const x of tagsRaw) {
      if (selectedTags.length >= MAX_TAGS) break;
      const s = typeof x === "string" ? x.trim() : "";
      if (!s) continue;
      const canon = allowedLower.get(s.toLowerCase());
      if (canon && !selectedTags.includes(canon)) selectedTags.push(canon);
    }
  }

  return {
    departmentId,
    catCode,
    mainCategory,
    title,
    engName,
    details,
    services,
    selectedTags,
  };
}

/**
 * POST: Bearer Firebase id token. Body:
 * { locale?: "en"|"fa", offering: string, extra?: string }
 * Returns draft fields for the add-ad form.
 */
export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    return NextResponse.json(
      { error: "AI draft is not configured" },
      { status: 503 },
    );
  }

  const uid = await uidFromRequest(request);
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const locale: DirectoryLocale = body.locale === "en" ? "en" : "fa";
  const offering = truncate(asString(body.offering), MAX_FIELD_LEN);
  const extra = truncate(asString(body.extra), MAX_FIELD_LEN);

  if (!offering) {
    return NextResponse.json({ error: "offering is required" }, { status: 400 });
  }

  let taxonomy: TaxonomyDept[];
  try {
    taxonomy = await loadTaxonomy(locale);
  } catch (e) {
    console.error("draft-ad taxonomy", e);
    return NextResponse.json(
      { error: "Could not load directory" },
      { status: 500 },
    );
  }

  if (taxonomy.length === 0) {
    return NextResponse.json({ error: "No directory data" }, { status: 500 });
  }

  const taxonomyPayload = taxonomy.map((d) => ({
    id: d.id,
    label: d.label,
    categories: d.categories.map((c) => ({
      code: c.code,
      label: c.label,
      subcategories: c.subcategories,
    })),
  }));

  const langNote =
    locale === "en"
      ? "Use English for title and details. engName should be a clear English business or listing name (can match title if appropriate)."
      : "Use Persian (Farsi) for title and details. engName must be a short English name or transliteration suitable for URLs and international readers.";

  const systemPrompt = `You help users create a classified listing on Persiana (local businesses and goods).

You receive:
1) A JSON "taxonomy": array of departments. Each has id, label, and categories: { code, label, subcategories[] }.
2) The user's answers: what they offer, and optional extra notes.

Return ONLY a JSON object with this exact shape (no markdown, no extra keys):
{
  "departmentId": "<must be an id from taxonomy>",
  "catCode": "<must be a code from that department's categories>",
  "mainCategory": "goods" or "services",
  "title": "<short listing title>",
  "engName": "<English name, can be short>",
  "details": "<description for buyers>",
  "services": "<if mainCategory is services, 1-3 sentences on what you offer; if goods use empty string>",
  "selectedTags": ["<0 to 2 tags>"]
}

Rules:
- Pick the single best department and category by meaning (not only keywords).
- mainCategory: physical products, resale, retail items → "goods". Professional work, repairs, lessons, consulting → "services".
- selectedTags: only values from subcategories of the chosen category; max 2; use [] if none fit or subcategories empty.
- ${langNote}
- Keep title concise. details should be helpful and honest; do not invent phone numbers or addresses.`;

  const userPayload = JSON.stringify({
    taxonomy: taxonomyPayload,
    userSays: { offering, extra: extra || undefined },
  });

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
        temperature: 0.35,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPayload },
        ],
      }),
    });
  } catch {
    return NextResponse.json({ error: "AI request failed" }, { status: 502 });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("OpenAI draft-ad error", res.status, errText.slice(0, 500));
    return NextResponse.json({ error: "AI draft failed" }, { status: 502 });
  }

  const completion = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = completion.choices?.[0]?.message?.content ?? "";
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "Empty AI response" }, { status: 502 });
  }

  const draft = parseDraftJson(content, taxonomy);
  if (!draft) {
    return NextResponse.json(
      { error: "Could not build a valid draft; try different wording." },
      { status: 422 },
    );
  }

  if (draft.mainCategory === "goods") {
    draft.services = "";
  }

  return NextResponse.json({ draft });
}
