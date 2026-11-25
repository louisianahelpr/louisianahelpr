export declare const GUIDE_SHELL_ID: string;
export declare const GUIDE_SHELL_SHOW_RULE: string;
export declare const GUIDE_MEMBER_ATTR: string;
export declare const GUIDE_HINTS_ATTR: string;
export declare const MEMBER_BAR_PX: number;
export declare const MEMBER_RAIL_PX: number;
export declare const MEMBER_DESKTOP_MIN_PX: number;
export declare function guideShellHintRules(html: string): string;
export interface GuideShellData {
  css: string | null;
  pages: Record<string, string>;
}
export declare function guideShellKey(pathname: string): string;
export declare function withGuideShell(html: string, pathname: string, data: GuideShellData | null | undefined): string;
