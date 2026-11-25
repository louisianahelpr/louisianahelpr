import { useEffect, useState } from "react";
import { loadModule } from "@/lib/loadModule";
import { report } from "@/lib/errorLogger";
import type { GuideQaProps } from "./GuideQa";

/**
 * The guide pages' "Common questions" (GuideQa.tsx), loaded after the page draws so its code and data never sit on the
 * /gift-guides/:slug first load (critical-path budget). Until it is in, or if it fails (reported), nothing shows: the
 * pre-JS body already carries the same questions for readers without JavaScript (api/share.ts).
 */
/**
 * The catalog guides with a Q&A (guideQa.mjs QA_PAGES' catalog ones; kept here so the guide chunk never imports it).
 * The themed kids guides have one too (guideQa.mjs hasGuideQa; GiftGuideView asks isThemeGuide).
 */
export const QA_CATALOG_GUIDES: readonly string[] = ["her", "him", "kids", "25-days-sponsors"];

const loadQa =() => loadModule(() => import("./GuideQa"));
type QaModule = typeof import("./GuideQa");

export function LazyGuideQa(props: GuideQaProps) {
  const [Qa, setQa] = useState<QaModule["GuideQa"] | null>(null);
  useEffect(() => {
    let live = true;
    void loadQa().then(
      (m) => {
        if (m && live) setQa(() => (m as QaModule).GuideQa);
      },
      (e) => report(e as Error, { tags: { source: "LazyGuideQa.load" } }),
    );
    return () => {
      live = false;
    };
  }, []);
  return Qa ? <Qa {...props} /> : null;
}
