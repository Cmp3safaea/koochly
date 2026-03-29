import { NextResponse } from "next/server";
import { getFirebaseAuthAdmin } from "../../../../lib/firebaseAdmin";

export const runtime = "nodejs";

const MAX_ITEMS = 120;
const MAX_QUERY_LEN = 500;
const DESC_TRUNC = 400;

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
  return s.slice(0, max) + "…";
}

type IncomingItem = {
  id: string;
  title: string;
  category?: string | null;
  description?: string | null;
};

function normalizeItems(raw: unknown): IncomingItem[] {
  if (!Array.isArray(raw)) return [];
  const out: IncomingItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = asString(o.id);
    if (!id) continue;
    const title = asString(o.title) || id;
    const category =
      o.category === null || o.category === undefined
        ? null
        : asString(o.category) || null;
    const description =
      o.description === null || o.description === undefined
        ? null
        : asString(o.description) || null;
    out.push({ id, title, category, description });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function parseIdsFromModelContent(
  content: string,
  allowed: Set<string>,
): string[] {
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
        return [];
      }
    } else {
      return [];
    }
  }
  if (!parsed || typeof parsed !== "object") return [];
  const idsRaw = (parsed as Record<string, unknown>).ids;
  if (!Array.isArray(idsRaw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of idsRaw) {
    const id = typeof x === "string" ? x.trim() : "";
    if (!id || seen.has(id) || !allowed.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * POST body: { query: string, items: { id, title, category?, description? }[] }
 * Returns { ids: string[] } — ad ids best matching the query, in order (subset of provided ids).
 */
export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    return NextResponse.json(
      { error: "AI search is not configured" },
      { status: 503 },
    );
  }

  const uid = await uidFromRequest(request);
  if (!uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const query = truncate(asString(body.query), MAX_QUERY_LEN);
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const items = normalizeItems(body.items);
  if (items.length === 0) {
    return NextResponse.json({ error: "items must be a non-empty array" }, { status: 400 });
  }

  const allowedIds = new Set(items.map((i) => i.id));
  const corpus = items.map((i) => ({
    id: i.id,
    title: i.title,
    category: i.category ?? "",
    description: i.description ? truncate(i.description, DESC_TRUNC) : "",
  }));

  const systemPrompt = `You help users find classified ads and business listings. You receive a user question and a JSON array of listings, each with id, title, category, and description (may be empty).

Return ONLY a JSON object with this exact shape, no other text:
{"ids":["id1","id2",...]}

Rules:
- Include only ids from the provided listings.
- Order ids from best match to weakest.
- If nothing matches, return {"ids":[]}.
- Prefer semantic fit (e.g. "second hand sofa" matches furniture/sofa/Couch listings) not literal substring.
- The user may write in English, Persian (Farsi), or mixed; match by meaning.`;

  const userPayload = JSON.stringify({
    query: query,
    listings: corpus,
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
        temperature: 0.2,
        max_tokens: 4096,
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
    console.error("OpenAI error", res.status, errText.slice(0, 500));
    return NextResponse.json({ error: "AI search failed" }, { status: 502 });
  }

  const completion = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = completion.choices?.[0]?.message?.content ?? "";
  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "Empty AI response" }, { status: 502 });
  }

  const ids = parseIdsFromModelContent(content, allowedIds);
  return NextResponse.json({ ids });
}
