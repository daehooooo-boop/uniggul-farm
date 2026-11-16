/**
 * 두 봇이 함께 쓰는 로직: 관심 상품 등록, 가격 확인, 금요일 할인 목록.
 */
import * as db from "./db";
import { discountPct, getAllOnSale, getProduct, getProducts, isOnSale, productUrl, type Product, type Ref } from "./uniqlo";

export type SaleItem = Product & { url: string; discountPct: number };
export type SaleList = { updatedAt: string | null; count: number; items: SaleItem[] };

export const SALE_KEY = "weekly_sale";
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
  const added = await db.addWatch({
    platform,
    user_id: userId,
    product_id: p.productId,
    price_group: p.priceGroup || ref.priceGroup,
    name: p.name,
    base_price: p.basePrice,
    // 이미 할인 중이면 같은 가격으로 또 알리지 않는다
    notified_price: isOnSale(p) ? p.promoPrice : null,
  });
  return { status: added ? "added" : "exists", product: p };
}

export type Alert = { watch: db.Watch; product: Product };

/** 가격을 확인해 새로 할인됐거나 더 싸진 관심 상품을 돌려주고 DB를 갱신한다. */
export async function findAlerts(): Promise<Alert[]> {
  const watches = await db.allWatches();
  if (!watches.length) return [];
  const live = await getProducts([...new Set(watches.map((w) => w.product_id))]);
  const alerts: Alert[] = [];
  for (const w of watches) {
    const p = live.get(w.product_id);
    if (!p) continue;
    if (isOnSale(p) && (w.notified_price == null || p.promoPrice! < w.notified_price)) {
      alerts.push({ watch: w, product: p });
      await db.setNotified(w, p.promoPrice, p.name, p.basePrice);
    } else if (!isOnSale(p) && w.notified_price != null) {
      // 할인이 끝나면 초기화해서 다음 할인 때 다시 알린다
      await db.setNotified(w, null, p.name, p.basePrice);
    }
  }
  return alerts;
}

export async function refreshSaleList(): Promise<SaleList> {
  const items = await getAllOnSale();
  const list: SaleList = {
    updatedAt: new Date().toISOString(),
    count: items.length,
    items: items.map((p) => ({ ...p, url: productUrl(p), discountPct: discountPct(p) })),
  };
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
