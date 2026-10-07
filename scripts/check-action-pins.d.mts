export interface ActionPin {
  file: string;
  line: number;
  action: string;
  repo?: string;
  sha?: string;
  tag?: string;
  problem?: string;
}
export function pinsFromText(file: string, text: string): ActionPin[];
export function verifyPins(pins: ActionPin[], resolveTag: (repo: string, tag: string) => Promise<string> | string): Promise<string[]>;
export function ghResolveTag(repo: string, tag: string): string;
export function repoPins(root: string): ActionPin[];
