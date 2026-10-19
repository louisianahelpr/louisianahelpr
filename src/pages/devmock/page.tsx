/* MOCK-ONLY dev route (wip/dashboards-mock-1019-r2 — never lands). /dev/dash?s=home-a&theme=dark */
import { useEffect } from "react";
import { SCREENS } from "./screens";

export default function DevDashMock() {
  const q = new URLSearchParams(window.location.search);
  const key = q.get("s") ?? "home-a";
  const dark = q.get("theme") === "dark";
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  const Screen = SCREENS[key];
  if (!Screen) return <ul className="p-6">{Object.keys(SCREENS).map((k) => <li key={k}><a href={`?s=${k}`}>{k}</a></li>)}</ul>;
  return <Screen />;
}
