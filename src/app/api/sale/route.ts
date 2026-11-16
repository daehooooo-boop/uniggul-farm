import { getSaleList } from "@/lib/sale";

export async function GET() {
  return new Response(JSON.stringify(await getSaleList()), { headers: { "Content-Type": "application/json; charset=utf-8" } });
}
