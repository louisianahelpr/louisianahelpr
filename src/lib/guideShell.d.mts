export declare const GUIDE_SHELL_ID: string;
export declare const GUIDE_SHELL_SHOW_RULE: string;
export interface GuideShellData {
  css: string | null;
  pages: Record<string, string>;
}
export declare function guideShellKey(pathname: string): string;
export declare function withGuideShell(html: string, pathname: string, data: GuideShellData | null | undefined): string;
