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

export type SaleFlag = { code: string; name: string; start: number | null; end: number | null };

export type Product = {
  productId: string;
  priceGroup: string;
  name: string;
  basePrice: number | null;
  promoPrice: number | null;
  image: string | null;
  flags: SaleFlag[];
};

/**
 * 유니클로 한국의 할인 표시.
 * discount = "가격인하"(정가 자체를 내림), limitedOffer = 기간한정가격, colorSizeLimitedPrice = 일부 색상·사이즈만.
 * 가격인하 상품은 API가 내린 가격만 주고 원래 가격은 주지 않는다. 그래서 원래 가격은 우리가 본 가격 기록으로 계산한다.
 */
export const SALE_FLAG_CODES = ["discount", "limitedOffer", "colorSizeLimitedPrice"];

export const currentPrice = (p: Pick<Product, "basePrice" | "promoPrice">) => p.promoPrice ?? p.basePrice;

export const saleFlag = (p: Pick<Product, "flags">) => p.flags.find((f) => SALE_FLAG_CODES.includes(f.code)) ?? null;

export const isOnSale = (p: Pick<Product, "basePrice" | "promoPrice" | "flags">) =>
  !!saleFlag(p) || (p.promoPrice != null && p.basePrice != null && p.promoPrice < p.basePrice);

/** 표시용 가격. ref는 우리가 기록해 둔 이전 최고 가격. */
export type PriceView = { price: number | null; original: number | null; pct: number; label: string | null };

export function priceView(p: Pick<Product, "basePrice" | "promoPrice" | "flags">, ref?: number | null): PriceView {
  const price = currentPrice(p);
  const top = Math.max(p.basePrice ?? 0, ref ?? 0);
  const original = price != null && top > price ? top : null;
  const pct = original && price != null ? Math.round((1 - price / original) * 100) : 0;
  const f = saleFlag(p);
  return { price, original, pct, label: f ? flagLabel(f) : null };
}

export function flagLabel(f: SaleFlag) {
  const name = f.name.replace(/^\d{4}\//, "").trim();
  if (name) return name;
  return f.code === "discount" ? "가격인하" : f.code === "limitedOffer" ? "기간한정가격" : "일부 색상·사이즈 할인";
}

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
  if (!main || typeof main !== "object") return null;
  // 대표 색상 이미지를 먼저, 없으면 아무거나 하나
  const rep = String(item.representativeColorDisplayCode ?? "");
  const pick = Array.isArray(main) ? main[0] : ((main as Json)[rep] ?? Object.values(main)[0]);
  if (!pick || typeof pick !== "object") return null;
  const f = pick as Json;
  return (f.image as string) ?? (f.url as string) ?? null;
}

function parseFlags(item: Json): SaleFlag[] {
  const rep = item.representative as Json | undefined;
  const raw = ((rep?.flags as Json | undefined)?.priceFlags as Json[] | undefined) ?? [];
  return raw.map((f) => {
    const t = (f.effectiveTime as Json | undefined) ?? {};
    const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
    return { code: String(f.code ?? ""), name: String(f.name ?? ""), start: num(t.start), end: num(t.end) };
  });
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
    flags: parseFlags(item),
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

/**
 * 할인 표시(가격인하·기간한정)가 붙은 상품을 모두 모은다.
 * 유니클로는 조건 없는 전체 목록을 주지 않아서 flagCodes로 걸러 받아야 한다.
 */
export async function getAllOnSale(pageSize = 100, maxPages = 30): Promise<Product[]> {
  const byId = new Map<string, Product>();
  for (const flag of ["discount", "limitedOffer"]) {
    for (let page = 0; page < maxPages; page++) {
      const data = await get("/products", { flagCodes: flag, offset: page * pageSize, limit: pageSize });
      const items = itemsOf(data);
      for (const p of items.map(parseItem)) if (!byId.has(p.productId)) byId.set(p.productId, p);
      const total = Number(((data.result as Json | undefined)?.pagination as Json | undefined)?.total ?? NaN);
      if (items.length < pageSize || (!Number.isNaN(total) && (page + 1) * pageSize >= total)) break;
    }
  }
  return [...byId.values()];
}
