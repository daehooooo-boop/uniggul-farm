import { getSaleList } from "@/lib/sale";

export async function GET() {
  return Response.json(await getSaleList());
}
