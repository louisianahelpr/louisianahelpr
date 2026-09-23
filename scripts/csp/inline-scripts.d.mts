export interface ScriptElement {
  attrs: string;
  body: string;
  type: string;
  src: string | null;
  executable: boolean;
}
export function scriptElements(html: string): ScriptElement[];
export function inlineExecutableScripts(html: string): ScriptElement[];
export function sha256Source(body: string): string;
export function inlineHandlers(html: string): string[];
export function javascriptUrls(html: string): string[];
export function scriptSrcTokens(policy: string): string[];
export const FORBIDDEN_SCRIPT_SRC: string[];
export function checkHtmlAgainstPolicy(html: string, policy: string, label: string): string[];
export function metaCsp(html: string): string | null;
export function vercelCsp(vercelJson: { headers?: { source: string; headers?: { key: string; value: string }[] }[] }): string | null;
