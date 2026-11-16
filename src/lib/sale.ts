import { cacheLife, cacheTag } from "next/cache";
import { readSaleList } from "./core";

/** 웹에 보여 줄 이번 주 할인 목록. 금요일 작업이 revalidateTag("sale")로 새로 고친다. */
export async function getSaleList() {
  "use cache";
  cacheTag("sale");
  cacheLife("hours");
  return readSaleList();
}
