/**
 * 두 봇이 함께 쓰는 로직: 관심 상품 등록, 가격 확인, 금요일 할인 목록.
 */
import * as db from "./db";
import { currentPrice, getAllOnSale, getProduct, getProducts, isOnSale, priceView, productUrl, saleFlag, type PriceView, type Product, type Ref } from "./uniqlo";

export type SaleItem = Pick<Product, "productId" | "priceGroup" | "name" | "image"> &
  PriceView & { url: string; since: number | null };
export type SaleList = { updatedAt: string | null; count: number; items: SaleItem[] };

export const SALE_KEY = "weekly_sale_v2";
export const EMPTY_SALE: SaleList = { updatedAt: null, count: 0, items: [] };

export type AddResult =
  | { status: "added"; product: Product }
  | { status: "exists"; product: Product }
  | { status: "notfound" }
  | { status: "full" };

export async function addWatch(platform: db.Platform, userId: string, ref: Ref): Promise<AddResult> {
  if ((await db.countWatches(platform, userId)) >= db.MAX_PER_USER) return { status: "full" };
  const p = await getProduct(ref.productId);
  if (!p) return { status: "notfound" };
  const price = currentPrice(p);
  const added = await db.addWatch({
    platform,
    user_id: userId,
    product_id: p.productId,
    price_group: p.priceGroup || ref.priceGroup,
    name: p.name,
    base_price: price, // 등록 시점 가격. 이후 본 가장 높은 가격으로 갱신된다
    // 이미 할인 중이면 같은 가격으로 또 알리지 않는다
    notified_price: isOnSale(p) ? price : null,
  });
  if (price != null) await db.recordPrices([{ product_id: p.productId, price }]).catch(() => {});
  return { status: added ? "added" : "exists", product: p };
}

export type Alert = { watch: db.Watch; product: Product; view: PriceView };

/**
 * 관심 상품 가격을 확인한다. 알리는 경우:
 * - 할인 표시(가격인하·기간한정)가 새로 붙었거나
 * - 등록 후 본 가장 높은 가격보다 내려갔을 때
 * 이미 알린 가격보다 더 내려가면 다시 알리고, 할인이 끝나면 초기화한다.
 */
export async function findAlerts(): Promise<Alert[]> {
  const watches = await db.allWatches();
  if (!watches.length) return [];
  const live = await getProducts([...new Set(watches.map((w) => w.product_id))]);
  await db
    .recordPrices([...live.values()].flatMap((p) => (currentPrice(p) != null ? [{ product_id: p.productId, price: currentPrice(p)! }] : [])))
    .catch((e) => console.warn("recordPrices", e));

  const alerts: Alert[] = [];
  for (const w of watches) {
    const p = live.get(w.product_id);
    const price = p ? currentPrice(p) : null;
    if (!p || price == null) continue;
    const ref = Math.max(w.base_price ?? price, price);
    const sale = isOnSale(p) || price < ref;
    if (sale && (w.notified_price == null || price < w.notified_price)) {
      alerts.push({ watch: w, product: p, view: priceView(p, ref) });
      await db.setNotified(w, price, p.name, ref);
    } else if (!sale && w.notified_price != null) {
      await db.setNotified(w, null, p.name, ref);
    } else if (ref !== w.base_price || p.name !== w.name) {
      await db.setNotified(w, w.notified_price, p.name, ref);
    }
  }
  return alerts;
}

export async function refreshSaleList(): Promise<SaleList> {
  const products = await getAllOnSale();
  const history = await db
    .recordPrices(products.flatMap((p) => (currentPrice(p) != null ? [{ product_id: p.productId, price: currentPrice(p)! }] : [])))
    .catch(() => new Map<string, number>());
  const items: SaleItem[] = products.map((p) => ({
    productId: p.productId,
    priceGroup: p.priceGroup,
    name: p.name,
    image: p.image,
    url: productUrl(p),
    since: saleFlag(p)?.start ?? null,
    ...priceView(p, history.get(p.productId)),
  }));
  // 할인율을 아는 상품을 먼저(높은 순), 그다음 최근에 가격이 내려간 순
  items.sort((a, b) => b.pct - a.pct || (b.since ?? 0) - (a.since ?? 0));
  const list: SaleList = { updatedAt: new Date().toISOString(), count: items.length, items };
  await db.putJson(SALE_KEY, list);
  return list;
}

export async function readSaleList(): Promise<SaleList> {
  try {
    return (await db.getJson<SaleList>(SALE_KEY)) ?? EMPTY_SALE;
  } catch {
    return EMPTY_SALE;
  }
}

export const WEEKLY_TOP_N = Number(process.env.WEEKLY_TOP_N ?? 40);
