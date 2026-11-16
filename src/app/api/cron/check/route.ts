import { isAuthorized, unauthorized } from "@/lib/auth";
import { findAlerts } from "@/lib/core";
import * as discord from "@/lib/discord";
import * as telegram from "@/lib/telegram";

export const maxDuration = 60;

/** 관심 상품 가격 확인. GitHub Actions가 3시간마다, Vercel Cron이 하루 한 번 부른다. */
export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  const alerts = await findAlerts();
  let sent = 0;
  for (const { watch, product, view } of alerts) {
    try {
      if (watch.platform === "discord") await discord.sendSaleAlert(watch.user_id, product, view);
      else await telegram.sendSaleAlert(watch.user_id, product, view);
      sent++;
    } catch (e) {
      console.warn("alert failed", watch.platform, watch.user_id, e);
    }
  }
  return Response.json({ alerts: alerts.length, sent });
}
