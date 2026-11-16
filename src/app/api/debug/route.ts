import { isAuthorized, unauthorized } from "@/lib/auth";

/**
 * 유니클로 응답 구조 확인용.
 *   /api/debug?key=CRON_SECRET&id=E465185-000   한 상품의 원본 응답
 *   /api/debug?key=CRON_SECRET&probe=1          할인 목록용 여러 조회 방식을 한꺼번에 시험
 *   /api/debug?key=CRON_SECRET&q=flagCodes=discount&limit=10   원하는 조회 조건 그대로
 */
const BASE = "https://www.uniqlo.com/kr/api/commerce/v5/ko/products";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  Accept: "application/json",
};

type Item = {
  productId?: string;
  prices?: { base?: { value?: number }; promo?: { value?: number } | null };
  representative?: { flags?: { priceFlags?: { code?: string }[] } };
};

async function summarize(qs: string) {
  try {
    const res = await fetch(`${BASE}?${qs}&httpFailure=true`, { headers: HEADERS, cache: "no-store" });
    const json = (await res.json().catch(() => null)) as { result?: { items?: Item[]; pagination?: unknown; aggregations?: unknown } } | null;
    const items = json?.result?.items ?? [];
    const flags = new Set<string>();
    for (const it of items) for (const f of it.representative?.flags?.priceFlags ?? []) if (f.code) flags.add(f.code);
    return {
      qs,
      status: res.status,
      pagination: json?.result?.pagination ?? null,
      items: items.length,
      withPromo: items.filter((i) => i.prices?.promo?.value != null).length,
      priceFlags: [...flags],
      resultKeys: json?.result ? Object.keys(json.result) : null,
      sample: items.slice(0, 3).map((i) => ({ id: i.productId, base: i.prices?.base?.value, promo: i.prices?.promo?.value ?? null })),
    };
  } catch (e) {
    return { qs, error: String(e) };
  }
}

const PROBES = [
  "offset=0&limit=100",
  "offset=100&limit=100",
  "flagCodes=discount&offset=0&limit=100",
  "flagCodes=limitedOffer&offset=0&limit=100",
  "flagCodes=sale&offset=0&limit=100",
  "priceFlags=discount&offset=0&limit=100",
  "path=%2C%2C%2C&flagCodes=discount&offset=0&limit=100",
  "q=&offset=0&limit=100",
];

export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  const sp = new URL(req.url).searchParams;
  const headers = { "Content-Type": "application/json; charset=utf-8" };

  if (sp.get("probe")) {
    const out = await Promise.all(PROBES.map(summarize));
    return new Response(JSON.stringify(out, null, 2), { headers });
  }
  if (sp.get("q")) {
    // key 이외의 나머지 조건을 그대로 넘긴다
    const rest = new URLSearchParams(sp);
    rest.delete("key");
    const qs = [...rest.entries()].map(([k, v]) => (k === "q" ? v : `${k}=${encodeURIComponent(v)}`)).join("&");
    return new Response(JSON.stringify(await summarize(qs), null, 2), { headers });
  }

  const id = sp.get("id") ?? "E465185-000";
  const res = await fetch(`${BASE}?productIds=${encodeURIComponent(id)}&limit=1&httpFailure=true`, { headers: HEADERS, cache: "no-store" });
  const json = (await res.json().catch(() => null)) as { result?: { items?: unknown[] } } | null;
  return new Response(JSON.stringify({ status: res.status, firstItem: json?.result?.items?.[0] ?? null }, null, 2), { headers });
}
