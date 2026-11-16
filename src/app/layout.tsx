import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "유니꿀로 · 유니클로 할인 알림",
  description: "유니클로 관심 상품이 할인되면 디스코드나 텔레그램으로 알려 주고, 매주 금요일 할인 상품만 모아 보여 줘요.",
  openGraph: {
    title: "유니꿀로",
    description: "유니클로 관심 상품 할인 알림 · 매주 금요일 할인 모아보기",
    locale: "ko_KR",
    type: "website",
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

const THEME_SCRIPT = `(function(){try{if(localStorage.getItem("ggul-theme")==="dark")document.documentElement.setAttribute("data-theme","dark")}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
