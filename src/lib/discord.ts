/**
 * 디스코드: 웹훅(Interactions Endpoint) 방식이라 상시 실행 서버가 필요 없다.
 * 명령은 /api/discord 로 들어오고, DM과 채널 게시는 REST API로 보낸다.
 */
import { createPublicKey, verify } from "node:crypto";
import * as core from "./core";
import * as db from "./db";
import { discountPct, isOnSale, parseProductRef, productUrl, won, type Product } from "./uniqlo";

const API = "https://discord.com/api/v10";
const COLOR = 0xf5a623;
const PLATFORM = "discord" as const;
const EPHEMERAL = 64;

const env = () => ({
  token: process.env.DISCORD_BOT_TOKEN ?? "",
  appId: process.env.DISCORD_APPLICATION_ID ?? "",
  publicKey: process.env.DISCORD_PUBLIC_KEY ?? "",
  weeklyChannel: process.env.DISCORD_WEEKLY_CHANNEL_ID ?? "",
});

// --- signature -------------------------------------------------------------

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifySignature(body: string, signature: string | null, timestamp: string | null, publicKeyHex = env().publicKey) {
  if (!signature || !timestamp || !publicKeyHex) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

// --- REST --------------------------------------------------------------------

async function api(path: string, init: RequestInit & { json?: unknown } = {}) {
  const { json, ...rest } = init;
  const res = await fetch(`${API}${path}`, {
    ...rest,
    headers: { Authorization: `Bot ${env().token}`, "Content-Type": "application/json", ...(rest.headers ?? {}) },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  if (!res.ok) throw new Error(`discord ${path} ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function editOriginal(token: string, content: unknown) {
  await fetch(`${API}/webhooks/${env().appId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(content),
  });
}

// --- formatting --------------------------------------------------------------

function priceLine(base: number | null, promo: number | null) {
  const p = { basePrice: base, promoPrice: promo };
  return isOnSale(p) ? `~~${won(base)}~~ → **${won(promo)}** (${discountPct(p)}% ↓)` : won(base);
}

function productEmbed(p: Product, title = p.name, extra = "") {
  return {
    title,
    url: productUrl(p),
    description: priceLine(p.basePrice, p.promoPrice) + (extra ? `\n${extra}` : ""),
    color: COLOR,
    ...(p.image ? { thumbnail: { url: p.image } } : {}),
  };
}

export function saleEmbeds(sale: core.SaleList) {
  const items = sale.items.slice(0, core.WEEKLY_TOP_N);
  if (!items.length) return [{ title: "🍯 이번 주 유니클로 할인", description: "지금은 할인 상품이 없어요.", color: COLOR }];
  const chunks: string[] = [];
  let cur = "";
  for (const it of items) {
    const line = `[${it.name}](${it.url}) · ${priceLine(it.basePrice, it.promoPrice)}\n`;
    if (cur.length + line.length > 3900) {
      chunks.push(cur);
      cur = "";
    }
    cur += line;
  }
  chunks.push(cur);
  return chunks.map((c, i) => ({
    ...(i === 0 ? { title: `🍯 이번 주 유니클로 할인 ${sale.count}개 (할인율 순)` } : {}),
    description: c,
    color: COLOR,
  }));
}

// --- notifications -------------------------------------------------------------

export async function sendSaleAlert(userId: string, p: Product) {
  const ch = (await api("/users/@me/channels", { method: "POST", json: { recipient_id: userId } })) as { id: string };
  await api(`/channels/${ch.id}/messages`, { method: "POST", json: { embeds: [productEmbed(p, `🔔 할인 시작: ${p.name}`)] } });
}

export async function sendWeekly(sale: core.SaleList) {
  const { weeklyChannel, token } = env();
  if (!weeklyChannel || !token) return;
  const embeds = saleEmbeds(sale);
  for (let i = 0; i < embeds.length; i += 10) {
    await api(`/channels/${weeklyChannel}/messages`, { method: "POST", json: { embeds: embeds.slice(i, i + 10) } });
  }
}

// --- slash commands ------------------------------------------------------------

export const COMMANDS = [
  {
    name: "등록",
    description: "유니클로 상품을 저장하고 할인되면 DM으로 알림 받기",
    options: [{ type: 3, name: "상품", description: "상품 링크 또는 상품번호 (예: 465185)", required: true }],
  },
  { name: "목록", description: "내 관심 상품과 현재 가격 보기" },
  {
    name: "삭제",
    description: "관심 상품 삭제",
    options: [{ type: 3, name: "상품", description: "삭제할 상품", required: true, autocomplete: true }],
  },
  { name: "할인목록", description: "이번 주 할인 상품 보기" },
];

export async function registerCommands() {
  const { appId } = env();
  return api(`/applications/${appId}/commands`, { method: "PUT", json: COMMANDS });
}

type Interaction = {
  type: number;
  token: string;
  data?: { name: string; options?: { name: string; value: string; focused?: boolean }[] };
  member?: { user: { id: string } };
  user?: { id: string };
};

const reply = (content: string, embeds: unknown[] = []) => ({ type: 4, data: { content, embeds, flags: EPHEMERAL } });
const DEFERRED = { type: 5, data: { flags: EPHEMERAL } };

/**
 * 받은 interaction에 대한 즉시 응답과, 응답 뒤에 이어서 할 작업(있으면)을 돌려준다.
 * 유니클로 조회처럼 3초를 넘길 수 있는 일은 "생각 중" 응답을 먼저 보내고 later에서 처리한다.
 */
export async function handleInteraction(i: Interaction): Promise<{ response: unknown; later?: () => Promise<void> }> {
  if (i.type === 1) return { response: { type: 1 } }; // PING
  const userId = i.member?.user.id ?? i.user?.id ?? "";
  const opt = (n: string) => i.data?.options?.find((o) => o.name === n)?.value ?? "";

  if (i.type === 4 && i.data?.name === "삭제") {
    const current = opt("상품").toLowerCase();
    const rows = await db.listWatches(PLATFORM, userId);
    const choices = rows
      .filter((r) => (r.name + r.product_id).toLowerCase().includes(current))
      .slice(0, 25)
      .map((r) => ({ name: `${r.name.slice(0, 80)} (${r.product_id})`, value: r.product_id }));
    return { response: { type: 8, data: { choices } } };
  }
  if (i.type !== 2) return { response: reply("알 수 없는 요청이에요.") };

  switch (i.data?.name) {
    case "등록": {
      const ref = parseProductRef(opt("상품"));
      if (!ref) return { response: reply("상품 링크나 상품번호를 확인해주세요. 예: `465185`") };
      return {
        response: DEFERRED,
        later: async () => {
          let msg: { content: string; embeds?: unknown[] };
          try {
            const r = await core.addWatch(PLATFORM, userId, ref);
            if (r.status === "full") msg = { content: `관심 상품은 최대 ${db.MAX_PER_USER}개까지예요.` };
            else if (r.status === "notfound") msg = { content: `\`${ref.productId}\` 상품을 찾지 못했어요.` };
            else if (r.status === "exists") msg = { content: `이미 등록된 상품이에요: **${r.product.name}**` };
            else {
              const note = isOnSale(r.product) ? "지금 할인 중이에요! 더 내려가면 다시 알려드릴게요." : "할인되면 DM으로 알려드릴게요.";
              msg = { content: "✅ 등록했어요", embeds: [productEmbed(r.product, r.product.name, note)] };
            }
          } catch (e) {
            console.error(e);
            msg = { content: "유니클로 사이트 조회에 실패했어요. 잠시 후 다시 시도해주세요." };
          }
          await editOriginal(i.token, msg);
        },
      };
    }
    case "목록":
      return {
        response: DEFERRED,
        later: async () => {
          const rows = await db.listWatches(PLATFORM, userId);
          if (!rows.length) return editOriginal(i.token, { content: "등록된 상품이 없어요. `/등록`으로 추가해보세요." });
          const { getProducts } = await import("./uniqlo");
          const live = await getProducts(rows.map((r) => r.product_id)).catch(() => new Map<string, Product>());
          const lines = rows.map((r) => {
            const p = live.get(r.product_id);
            const url = productUrl({ productId: r.product_id, priceGroup: r.price_group });
            return `\`${r.product_id}\` [${r.name}](${url}) · ${p ? priceLine(p.basePrice, p.promoPrice) : won(r.base_price)}`;
          });
          await editOriginal(i.token, { embeds: [{ title: "내 관심 상품", description: lines.join("\n").slice(0, 4000), color: COLOR }] });
        },
      };
    case "삭제": {
      const ref = parseProductRef(opt("상품"));
      const ok = ref ? await db.removeWatch(PLATFORM, userId, ref.productId) : false;
      return { response: reply(ok ? "🗑️ 삭제했어요." : "등록된 상품이 아니에요.") };
    }
    case "할인목록": {
      const sale = await core.readSaleList();
      return { response: reply("", saleEmbeds(sale).slice(0, 10)) };
    }
  }
  return { response: reply("알 수 없는 명령이에요.") };
}
