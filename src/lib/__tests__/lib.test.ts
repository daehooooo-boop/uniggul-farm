import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "../discord";
import { discountPct, isOnSale, parseItem, parseProductRef, productUrl } from "../uniqlo";

describe("parseProductRef", () => {
  it("reads product links", () => {
    expect(parseProductRef("https://www.uniqlo.com/kr/ko/products/E465185-000/01?colorDisplayCode=09")).toEqual({ productId: "E465185-000", priceGroup: "01" });
    expect(parseProductRef("보세요 https://www.uniqlo.com/kr/ko/products/E465185-000")).toEqual({ productId: "E465185-000", priceGroup: "00" });
  });
  it("reads ids and 6-digit numbers", () => {
    expect(parseProductRef("e465185-000")).toEqual({ productId: "E465185-000", priceGroup: "00" });
    expect(parseProductRef("465185-000")).toEqual({ productId: "E465185-000", priceGroup: "00" });
    expect(parseProductRef(" 465185 ")).toEqual({ productId: "E465185-000", priceGroup: "00" });
  });
  it("rejects other text", () => {
    expect(parseProductRef("안녕")).toBeNull();
    expect(parseProductRef("1234567")).toBeNull();
  });
});

describe("parseItem", () => {
  it("parses prices and image (object form)", () => {
    const p = parseItem({
      productId: "E465185-000", priceGroup: "00", name: "히트텍",
      prices: { base: { value: 19900 }, promo: { value: 14900 } },
      images: { main: { "09": { image: "https://img/09.jpg" } } },
    });
    expect(p).toMatchObject({ basePrice: 19900, promoPrice: 14900, image: "https://img/09.jpg" });
    expect(isOnSale(p)).toBe(true);
    expect(discountPct(p)).toBe(25);
    expect(productUrl(p)).toBe("https://www.uniqlo.com/kr/ko/products/E465185-000/00");
  });
  it("handles no promo and array images", () => {
    const p = parseItem({ productId: "E1-000", name: "x", prices: { base: { value: 9900 }, promo: null }, images: { main: [{ url: "u" }] } });
    expect(isOnSale(p)).toBe(false);
    expect(discountPct(p)).toBe(0);
    expect(p.image).toBe("u");
  });
});

describe("real response shape (2026-11)", () => {
  it("parses the live /products item", () => {
    const p = parseItem({
      productId: "E465185-000", priceGroup: "00", name: "AIRism코튼오버사이즈크루넥T(5부)",
      representativeColorDisplayCode: "69",
      prices: { base: { currency: { code: "KRW", symbol: "₩" }, value: 19900 }, promo: null, isDualPrice: false },
      images: { main: { "17": { image: "https://img/17.jpg" }, "69": { image: "https://img/69.jpg" }, "00": { image: "https://img/00.jpg" } } },
    });
    expect(p).toEqual({ productId: "E465185-000", priceGroup: "00", name: "AIRism코튼오버사이즈크루넥T(5부)", basePrice: 19900, promoPrice: null, image: "https://img/69.jpg" });
    expect(isOnSale(p)).toBe(false);
  });
});

describe("discord signature", () => {
  it("accepts valid and rejects tampered bodies", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
    const ts = "1700000000";
    const body = '{"type":1}';
    const sig = sign(null, Buffer.from(ts + body), privateKey).toString("hex");
    expect(verifySignature(body, sig, ts, raw)).toBe(true);
    expect(verifySignature(body + " ", sig, ts, raw)).toBe(false);
    expect(verifySignature(body, null, ts, raw)).toBe(false);
  });
});
