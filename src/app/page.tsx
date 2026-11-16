import { ThemeDot } from "@/components/ThemeDot";
import { getSaleList } from "@/lib/sale";
import { won } from "@/lib/uniqlo";

const DISCORD_URL = process.env.NEXT_PUBLIC_DISCORD_INVITE_URL ?? "";
const TELEGRAM_URL = process.env.NEXT_PUBLIC_TELEGRAM_URL ?? "";
const SHOW = 60;

function kstDate(iso: string | null) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" }).format(new Date(iso));
}

const CHANNELS = [
  {
    id: "discord",
    name: "디스코드로 받기",
    url: DISCORD_URL,
    icon: "/discord.svg",
  },
  {
    id: "telegram",
    name: "텔레그램으로 받기",
    url: TELEGRAM_URL,
    icon: "/telegram.svg",
  },
];

const STEPS = [
  "아래에서 디스코드나 텔레그램 중 편한 쪽으로 들어가요.",
  "유니클로 앱이나 웹에서 갖고 싶은 상품의 링크를 복사해 보내요. 상품번호 6자리도 돼요.",
  "할인이 시작되거나 가격이 더 내려가면 바로 알려 드려요.",
];

export default async function Home() {
  const sale = await getSaleList();
  const updated = kstDate(sale.updatedAt);
  const items = sale.items.slice(0, SHOW);

  return (
    <main className="wrap">
      <header className="top">
        <div className="who">
          <strong>유니꿀로</strong>
          <span>{updated ? `${updated} 업데이트` : "매주 금요일 업데이트"}</span>
        </div>
        <ThemeDot />
      </header>

      <section className="body">
        <p>
          갖고 싶은 유니클로 상품을 저장해 두면 할인이 시작될 때 바로 알려 드려요. 매주 금요일 아침에는 그 주에 할인하는 상품만
          골라 할인율 순으로 모아 보여 드려요.
        </p>
      </section>

      <section className="sec">
        <h2 className="label">알림 받기</h2>
        <div className="grid">
          {CHANNELS.map((c) => {
            const inner = (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.icon} width={64} height={64} alt="" />
                <b className="ch-name">{c.name}</b>
              </>
            );
            return c.url ? (
              <a className="card link" key={c.id} href={c.url} target="_blank" rel="noopener">
                {inner}
              </a>
            ) : (
              <div className="card" key={c.id}>
                {inner}
              </div>
            );
          })}
        </div>
      </section>

      <section className="sec">
        <h2 className="label">사용 방법</h2>
        <ol className="body steps">
          {STEPS.map((s, i) => (
            <li key={i}>
              <span className="n">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="sec" id="sale">
        <h2 className="label">
          <span>이번 주 할인</span>
          {sale.count > 0 && <span>{sale.count.toLocaleString("ko-KR")}개 · 할인율 순</span>}
        </h2>
        {items.length ? (
          <div className="items">
            {items.map((it) => (
              <a className="item" key={it.productId} href={it.url} target="_blank" rel="noopener">
                <div className="thumb">
                  {it.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.image} alt="" loading="lazy" />
                  )}
                  <span className="off">{it.discountPct}%</span>
                </div>
                <div className="meta">
                  <span className="name">{it.name}</span>
                  <span className="price">
                    <b>{won(it.promoPrice)}</b>
                    <s>{won(it.basePrice)}</s>
                  </span>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <p className="empty">이번 주 할인 목록을 준비하고 있어요. 금요일 아침에 다시 들러 주세요.</p>
        )}
        {sale.count > SHOW && (
          <p className="more sub">
            할인율이 높은 {SHOW}개만 보여 드려요. 나머지는 봇에서 이번 주 할인을 눌러 보세요.
          </p>
        )}
      </section>

      <footer className="foot">
        <p>가격은 유니클로 공식 온라인 스토어 기준이며 매장 가격이나 실제 결제 금액과 다를 수 있어요.</p>
        <p>
          유니클로와 관련 없는 개인 프로젝트예요. 만든 사람 <a href="https://rey-farm.vercel.app" target="_blank" rel="noopener">Rey.K</a>
        </p>
      </footer>
    </main>
  );
}
