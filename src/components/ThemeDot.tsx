"use client";

/** rey-farm과 같은 점 버튼. 기본은 라이트, 누르면 다크, 선택은 기억한다. */
export function ThemeDot() {
  const toggle = () => {
    const el = document.documentElement;
    const next = el.getAttribute("data-theme") === "dark" ? "light" : "dark";
    el.setAttribute("data-theme", next);
    try {
      localStorage.setItem("ggul-theme", next);
    } catch {}
  };
  return <button className="dot" type="button" aria-label="다크 모드 전환" title="다크 모드 전환" onClick={toggle} />;
}
