/* MOCK-ONLY dev route (wip/dashboards-mock-1019-r2 — never lands). /dev/dash?s=home-a&theme=dark */
import { useEffect } from "react";
import { SCREENS } from "./screens";
import { SCREENS_V2 } from "./v2";

// Every section OPENS ON BROWSE (owner 10-19): the bare section key is its Browse view.
const ALL: Record<string, () => JSX.Element> = { ...SCREENS, ...SCREENS_V2, home: SCREENS["home-d"], jobs: SCREENS_V2["v2-jobs-browse"], declutter: SCREENS_V2["v2-declutter-browse"], shops: SCREENS_V2["v2-shops-browse"], homes: SCREENS_V2["v2-homes-browse"] };

export default function DevDashMock() {
  const q = new URLSearchParams(window.location.search);
  const key = q.get("s") ?? "home";
  const dark = q.get("theme") === "dark";
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  const Screen = ALL[key];
  if (!Screen) return <ul className="p-6">{Object.keys(ALL).map((k) => <li key={k}><a href={`?s=${k}`}>{k}</a></li>)}</ul>;
  return <Screen />;
}
