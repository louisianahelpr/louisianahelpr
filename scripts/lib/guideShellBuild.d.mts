import type { GuideShellData } from "../../src/lib/guideShell.mjs";

export declare const FIRST_SCREEN_ITEMS: number;
export declare const ITEM_SELECTOR: string;
export declare function trimGuideMarkup(markup: string, phone: boolean): { html: string; css: string[]; items: number };
export declare function guideShellBlock(
  path: string,
  phoneMarkup: string,
  desktopMarkup: string,
): { block: string; html: string; css: string[]; items: number };
export declare function guideShellData(
  rendered: Record<string, { phone: string; desktop: string }>,
  appCss: string | null,
): { data: GuideShellData; counts: Record<string, number> };
