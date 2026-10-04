export const SHARED_DIR_RE: RegExp;
export function stripComments(text: string): string;
export function staticReach(root: string, roots: string[]): Set<string>;
export function publicRoots(root: string): string[];
export function signedInOnlyModules(root: string): {
  signedInOnly: Set<string>;
  reachable: Set<string>;
  sharedModules: number;
};
