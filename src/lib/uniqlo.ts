/**
 * 유니클로 한국 상품·가격 조회.
 *
 * uniqlo.com/kr 웹이 내부적으로 쓰는 JSON API를 그대로 호출한다.
 * 응답 구조가 바뀌면 parseItem만 고치면 된다.
 */

const BASE = "https://www.uniqlo.com/kr/api/commerce/v5/ko";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "ko-KR,ko;q=0.9",
};

export type Product = {
  productId: string;
  priceGroup: string;
  name: string;
  basePrice: number | null;
  promoPrice: number | null;
  image: string | null;
};

export const isOnSale = (p: Pick<Product, "basePrice" | "promoPrice">) =>
  p.promoPrice != null && p.basePrice != null && p.promoPrice < p.basePrice;

export const discountPct = (p: Pick<Product, "basePrice" | "promoPrice">) =>
  isOnSale(p) ? Math.round((1 - p.promoPrice! / p.basePrice!) * 100) : 0;

export const productUrl = (p: Pick<Product, "productId" | "priceGroup">) =>
  `https://www.uniqlo.com/kr/ko/products/${p.productId}/${p.priceGroup || "00"}`;

export const won = (v: number | null | undefined) => (v == null ? "-" : `${v.toLocaleString("ko-KR")}원`);

// e.g. https://www.uniqlo.com/kr/ko/products/E465185-000/00?colorDisplayCode=09
const URL_RE = /products\/([A-Z]?\d{6}-\d{3})(?:\/(\d{2}))?/i;
const ID_RE = /^([A-Z]?\d{6}-\d{3})$/i;
const SHORT_RE = /^(\d{6})$/;

export type Ref = { productId: string; priceGroup: string };

/** 상품 링크, 전체 상품번호(E465185-000), 6자리 번호를 받는다. */
export function parseProductRef(text: string): Ref | null {
  const t = text.trim();
  let m = t.match(URL_RE);
  if (m) return { productId: normalizeId(m[1]), priceGroup: m[2] ?? "00" };
  m = t.match(ID_RE);
  if (m) return { productId: normalizeId(m[1]), priceGroup: "00" };
  m = t.match(SHORT_RE);
  if (m) return { productId: `E${m[1]}-000`, priceGroup: "00" };
  return null;
}

function normalizeId(id: string) {
  const up = id.toUpperCase();
  return /^\d/.test(up) ? `E${up}` : up;
}

/** 앱 공유용 짧은 링크처럼 상품번호가 바로 안 보이면 리다이렉트를 따라가 본다. */
export async function resolveProductRef(text: string): Promise<Ref | null> {
  const direct = parseProductRef(text);
  if (direct) return direct;
  const url = text.match(/https?:\/\/\S+/)?.[0];
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(8000) });
    const fromUrl = parseProductRef(res.url);
    if (fromUrl) return fromUrl;
    const html = await res.text();
    return parseProductRef(html.match(URL_RE)?.[0] ?? "");
  } catch {
    return null;
  }
}

type Json = Record<string, unknown>;

function priceValue(x: unknown): number | null {
  const v = (x as Json | null | undefined)?.value;
  return typeof v === "number" ? v : typeof v === "string" && v ? Number(v) : null;
}

function firstImage(item: Json): string | null {
  const main = (item.images as Json | undefined)?.main;
  const first = Array.isArray(main) ? main[0] : main && typeof main === "object" ? Object.values(main)[0] : null;
  if (!first || typeof first !== "object") return null;
  const f = first as Json;
  return (f.image as string) ?? (f.url as string) ?? null;
}

export function parseItem(item: Json): Product {
  const prices = (item.prices as Json | undefined) ?? {};
  return {
    productId: String(item.productId ?? ""),
    priceGroup: String(item.priceGroup ?? "00"),
    name: String(item.name ?? ""),
    basePrice: priceValue(prices.base),
    promoPrice: priceValue(prices.promo),
    image: firstImage(item),
  };
}

async function get(path: string, params: Record<string, string | number>): Promise<Json> {
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), httpFailure: "true" });
  const res = await fetch(`${BASE}${path}?${qs}`, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`uniqlo ${path} ${res.status}`);
  return (await res.json()) as Json;
}

const itemsOf = (data: Json) => (((data.result as Json | undefined)?.items as Json[] | undefined) ?? []);

export async function getProducts(ids: string[]): Promise<Map<string, Product>> {
  const out = new Map<string, Product>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const data = await get("/products", { productIds: chunk.join(","), limit: chunk.length });
    for (const p of itemsOf(data).map(parseItem)) out.set(p.productId, p);
  }
  return out;
}

export async function getProduct(id: string): Promise<Product | null> {
  return (await getProducts([id])).get(id) ?? null;
}

/** 전체 상품을 훑어 정가보다 싼 상품만 할인율 순으로 돌려준다. */
export async function getAllOnSale(pageSize = 100, maxPages = 60): Promise<Product[]> {
  const sale: Product[] = [];
  for (let page = 0; page < maxPages; page++) {
    const data = await get("/products", { offset: page * pageSize, limit: pageSize });
    const items = itemsOf(data);
    sale.push(...items.map(parseItem).filter(isOnSale));
    const total = Number(((data.result as Json | undefined)?.pagination as Json | undefined)?.total ?? NaN);
    if (items.length < pageSize || (!Number.isNaN(total) && (page + 1) * pageSize >= total)) break;
  }
  const seen = new Set<string>();
  return sale
    .filter((p) => !seen.has(p.productId) && seen.add(p.productId))
    .sort((a, b) => discountPct(b) - discountPct(a));
}
