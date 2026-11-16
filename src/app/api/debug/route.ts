import { isAuthorized, unauthorized } from "@/lib/auth";

/**
 * 유니클로 응답 구조 확인용: /api/debug?key=CRON_SECRET&id=E465185-000
 * 원본 응답의 첫 상품과 상위 키를 그대로 보여 준다.
 */
export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  const id = new URL(req.url).searchParams.get("id");
  const qs = id ? `productIds=${encodeURIComponent(id)}&limit=1` : "offset=0&limit=2";
  const url = `https://www.uniqlo.com/kr/api/commerce/v5/ko/products?${qs}&httpFailure=true`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {}
    const result = (json as { result?: { items?: unknown[]; pagination?: unknown } } | null)?.result;
    return new Response(JSON.stringify({
      status: res.status,
      topKeys: json && typeof json === "object" ? Object.keys(json) : null,
      pagination: result?.pagination ?? null,
      firstItem: result?.items?.[0] ?? null,
      contentType: res.headers.get("content-type"),
      raw: json ? undefined : text.slice(0, 2000),
    }, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
