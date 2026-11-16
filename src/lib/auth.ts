/** 예약 작업·설정 주소 보호. Vercel Cron은 CRON_SECRET을 Authorization 헤더로 보낸다. */
export function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  const key = new URL(req.url).searchParams.get("key");
  return header === `Bearer ${secret}` || key === secret;
}

export const unauthorized = () => new Response("unauthorized", { status: 401 });
