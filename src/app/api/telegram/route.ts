import { after } from "next/server";
import { checkSecret, handleUpdate } from "@/lib/telegram";

export const maxDuration = 30;

export async function POST(req: Request) {
  if (!checkSecret(req.headers.get("x-telegram-bot-api-secret-token"))) return new Response("unauthorized", { status: 401 });
  const update = await req.json();
  // 텔레그램에는 바로 200을 주고, 처리는 응답 뒤에 한다
  after(() => handleUpdate(update).catch((e) => console.error("telegram update", e)));
  return new Response("ok");
}
