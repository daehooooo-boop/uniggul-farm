import { isAuthorized, unauthorized } from "@/lib/auth";
import { registerCommands } from "@/lib/discord";
import { setWebhook } from "@/lib/telegram";

/**
 * 배포 후 한 번만 열면 되는 설정 주소: /api/setup?key=CRON_SECRET
 * 디스코드 슬래시 명령을 등록하고 텔레그램 웹훅을 이 사이트로 연결한다.
 */
export async function GET(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  const base = process.env.SITE_URL ?? new URL(req.url).origin;
  const result: Record<string, string> = {};
  try {
    await registerCommands();
    result.discord = "ok";
  } catch (e) {
    result.discord = String(e);
  }
  try {
    await setWebhook(base);
    result.telegram = "ok";
  } catch (e) {
    result.telegram = String(e);
  }
  return Response.json(result);
}
