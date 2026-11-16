import { after } from "next/server";
import { handleInteraction, verifySignature } from "@/lib/discord";

export const maxDuration = 30;

export async function POST(req: Request) {
  const body = await req.text();
  const ok = verifySignature(body, req.headers.get("x-signature-ed25519"), req.headers.get("x-signature-timestamp"));
  if (!ok) return new Response("invalid request signature", { status: 401 });

  const { response, later } = await handleInteraction(JSON.parse(body));
  if (later) after(() => later().catch((e) => console.error("discord later", e)));
  return Response.json(response);
}
