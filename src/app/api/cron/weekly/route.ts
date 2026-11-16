import { revalidateTag } from "next/cache";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { refreshSaleList } from "@/lib/core";
import * as discord from "@/lib/discord";
import * as telegram from "@/lib/telegram";

export const maxDuration = 300;

/**
 * 금요일 오전 9시(KST) 할인 목록. ?send=0 이면 웹 목록만 갱신하고 알림은 보내지 않는다.
 */
export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  const sale = await refreshSaleList();
  revalidateTag("sale", "max");
  if (new URL(req.url).searchParams.get("send") !== "0") {
    await Promise.allSettled([discord.sendWeekly(sale), telegram.sendWeekly(sale)]);
  }
  return Response.json({ count: sale.count, updatedAt: sale.updatedAt });
}
