/**
 * 텔레그램: 웹훅 방식. t.me 링크로 들어와 시작을 누르고, 상품 링크를 붙여넣어 등록한다.
 * 아래 키보드 버튼으로 내 목록 · 이번 주 할인 · 금요일 알림 켜기/끄기 · 사용법,
 * 내 목록의 각 상품 아래 ❌ 버튼으로 삭제.
 */
import * as core from "./core";
import * as db from "./db";
import { isOnSale, priceView, productUrl, resolveProductRef, won, type PriceView, type Product } from "./uniqlo";

const PLATFORM = "telegram" as const;
const env = () => ({
  token: process.env.TELEGRAM_BOT_TOKEN ?? "",
  secret: process.env.TELEGRAM_WEBHOOK_SECRET ?? "",
  channel: process.env.TELEGRAM_CHANNEL_ID ?? "",
});

export const BTN_LIST = "📋 내 목록";
export const BTN_SALE = "🍯 이번 주 할인";
export const BTN_WEEKLY = "🔔 금요일 알림 켜기/끄기";
export const BTN_HELP = "❓ 사용법";

const KEYBOARD = {
  keyboard: [[{ text: BTN_LIST }, { text: BTN_SALE }], [{ text: BTN_WEEKLY }, { text: BTN_HELP }]],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "유니클로 상품 링크를 붙여넣으세요",
};

const HELP =
  "<b>🍯 유니꿀로 사용법</b>\n\n" +
  "1. 유니클로 앱이나 웹에서 상품 <b>공유 → 링크 복사</b>\n" +
  "2. 여기에 링크를 붙여넣기 (상품번호 6자리도 돼요)\n" +
  "3. 할인이 시작되면 바로 알려드려요\n\n" +
  `매주 금요일 오전 9시에는 이번 주 할인 상품 목록도 보내드려요. 관심 상품은 최대 ${db.MAX_PER_USER}개까지 등록할 수 있어요.`;

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

function priceHtml(v: PriceView) {
  const main = v.original ? `<s>${won(v.original)}</s> → <b>${won(v.price)}</b> (${v.pct}% ↓)` : `<b>${won(v.price)}</b>`;
  return v.label ? `${main} · ${esc(v.label)}` : main;
}

export async function tg(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${env().token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; description?: string; error_code?: number };
  if (!json.ok) throw Object.assign(new Error(`telegram ${method}: ${json.description}`), { code: json.error_code });
  return json;
}

const send = (chatId: string | number, text: string, extra: Record<string, unknown> = {}) =>
  tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra });

export function saleMessages(sale: core.SaleList): string[] {
  const items = sale.items.slice(0, core.WEEKLY_TOP_N);
  if (!items.length) return ["🍯 이번 주 유니클로 할인 상품이 없어요."];
  const msgs: string[] = [];
  let cur = `<b>🍯 이번 주 유니클로 할인 ${sale.count}개</b> (할인율 순)\n\n`;
  for (const it of items) {
    const line = `• <a href="${it.url}">${esc(it.name)}</a>\n   ${priceHtml(it)}\n`;
    if (cur.length + line.length > 3800) {
      msgs.push(cur);
      cur = "";
    }
    cur += line;
  }
  msgs.push(cur);
  return msgs;
}

// --- notifications -------------------------------------------------------------

export async function sendSaleAlert(chatId: string, p: Product, view: PriceView = priceView(p)) {
  try {
    await send(chatId, `🔔 <b>할인 시작!</b>\n<a href="${productUrl(p)}">${esc(p.name)}</a>\n${priceHtml(view)}`, {
      link_preview_options: { is_disabled: false, url: productUrl(p) },
    });
  } catch (e) {
    if ((e as { code?: number }).code !== 403) throw e; // 403 = 사용자가 봇을 차단
  }
}

export async function sendWeekly(sale: core.SaleList) {
  if (!env().token) return;
  const msgs = saleMessages(sale);
  const targets: string[] = await db.weeklySubscribers(PLATFORM);
  if (env().channel) targets.push(env().channel);
  for (const chat of targets) {
    try {
      for (const m of msgs) await send(chat, m);
    } catch (e) {
      if ((e as { code?: number }).code === 403) await db.subscribe(PLATFORM, chat, false);
      else console.warn("weekly send failed", chat, e);
    }
    await new Promise((r) => setTimeout(r, 40)); // 초당 30건 제한
  }
}

// --- webhook ----------------------------------------------------------------------

export const checkSecret = (header: string | null) => !!env().secret && header === env().secret;

type Update = {
  message?: { chat: { id: number; type: string }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number; reply_markup?: { inline_keyboard: { text: string; callback_data?: string }[][] } } };
};

export async function handleUpdate(u: Update) {
  if (u.callback_query) return onCallback(u.callback_query);
  const m = u.message;
  if (!m?.text || m.chat.type !== "private") return;
  const chat = String(m.chat.id);
  const text = m.text.trim();

  if (text.startsWith("/start")) {
    await db.subscribe(PLATFORM, chat, true);
    return send(chat, "안녕하세요! 🍯 <b>유니꿀로</b>예요.\n유니클로 상품 링크를 보내주시면 할인될 때 알려드릴게요.\n\n" + HELP, { reply_markup: KEYBOARD });
  }
  if (text === BTN_HELP || text.startsWith("/help")) return send(chat, HELP, { reply_markup: KEYBOARD });
  if (text === BTN_LIST || text.startsWith("/list")) return myList(chat);
  if (text === BTN_SALE || text.startsWith("/sale")) {
    for (const msg of saleMessages(await core.readSaleList())) await send(chat, msg);
    return;
  }
  if (text === BTN_WEEKLY || text.startsWith("/weekly")) {
    const on = !(await db.isWeekly(PLATFORM, chat));
    await db.subscribe(PLATFORM, chat, on);
    return send(chat, on ? "🔔 금요일 할인 목록을 받아요." : "🔕 금요일 할인 목록을 껐어요. 관심 상품 할인 알림은 계속 와요.", { reply_markup: KEYBOARD });
  }

  const ref = await resolveProductRef(text);
  if (!ref) {
    return send(chat, "유니클로 상품 링크나 상품번호(6자리)를 보내주세요.\n예: https://www.uniqlo.com/kr/ko/products/E465185-000/00", { reply_markup: KEYBOARD });
  }
  await tg("sendChatAction", { chat_id: chat, action: "typing" }).catch(() => {});
  let out: string;
  try {
    const r = await core.addWatch(PLATFORM, chat, ref);
    if (r.status === "full") out = `관심 상품은 최대 ${db.MAX_PER_USER}개까지예요. ${BTN_LIST}에서 정리해주세요.`;
    else if (r.status === "notfound") out = `<code>${ref.productId}</code> 상품을 찾지 못했어요.`;
    else if (r.status === "exists") out = `이미 등록된 상품이에요: <b>${esc(r.product.name)}</b>`;
    else {
      const p = r.product;
      const note = isOnSale(p) ? "지금 할인 중이에요! 더 내려가면 다시 알려드릴게요." : "할인되면 바로 알려드릴게요.";
      out = `✅ 등록했어요\n<a href="${productUrl(p)}">${esc(p.name)}</a>\n${priceHtml(priceView(p))}\n\n${note}`;
    }
  } catch (e) {
    console.error(e);
    out = "유니클로 사이트 조회에 실패했어요. 잠시 후 다시 시도해주세요.";
  }
  await send(chat, out, { reply_markup: KEYBOARD });
}

async function myList(chat: string) {
  const rows = await db.listWatches(PLATFORM, chat);
  if (!rows.length) return send(chat, "등록된 상품이 없어요. 유니클로 상품 링크를 보내보세요.", { reply_markup: KEYBOARD });
  const { getProducts } = await import("./uniqlo");
  const live = await getProducts(rows.map((r) => r.product_id)).catch(() => new Map<string, Product>());
  const lines = [`<b>📋 내 관심 상품 ${rows.length}개</b>\n`];
  const buttons = rows.map((r, idx) => {
    const p = live.get(r.product_id);
    const url = productUrl({ productId: r.product_id, priceGroup: r.price_group });
    lines.push(`${idx + 1}. <a href="${url}">${esc(r.name)}</a>\n   ${p ? priceHtml(priceView(p, r.base_price)) : won(r.base_price)}`);
    return [{ text: `❌ ${idx + 1}. ${r.name.slice(0, 28)}`, callback_data: `del:${r.product_id}` }];
  });
  return send(chat, lines.join("\n"), { reply_markup: { inline_keyboard: buttons } });
}

async function onCallback(q: NonNullable<Update["callback_query"]>) {
  if (!q.data?.startsWith("del:") || !q.message) return tg("answerCallbackQuery", { callback_query_id: q.id });
  const pid = q.data.slice(4);
  const ok = await db.removeWatch(PLATFORM, String(q.message.chat.id), pid);
  await tg("answerCallbackQuery", { callback_query_id: q.id, text: ok ? "삭제했어요" : "이미 삭제된 상품이에요" });
  const rest = (q.message.reply_markup?.inline_keyboard ?? []).filter((row) => row[0]?.callback_data !== q.data);
  await tg("editMessageReplyMarkup", {
    chat_id: q.message.chat.id,
    message_id: q.message.message_id,
    reply_markup: { inline_keyboard: rest },
  }).catch(() => {});
}

export async function setWebhook(baseUrl: string) {
  await tg("setWebhook", {
    url: `${baseUrl}/api/telegram`,
    secret_token: env().secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  await tg("setMyCommands", {
    commands: [
      { command: "start", description: "시작하기" },
      { command: "list", description: "내 관심 상품" },
      { command: "sale", description: "이번 주 할인 상품" },
      { command: "weekly", description: "금요일 알림 켜기/끄기" },
      { command: "help", description: "사용법" },
    ],
  });
}
