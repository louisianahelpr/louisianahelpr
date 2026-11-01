export const SHARED_DIR_RE: RegExp;
export function stripComments(text: string): string;
export function staticReach(root: string, roots: string[]): Set<string>;
export function publicRoots(root: string): string[];
export function signedInOnlyModules(root: string): {
  signedInOnly: Set<string>;
  reachable: Set<string>;
  sharedModules: number;
};
export const EVERY_PAGE_ROOTS: string[];
export function firstScreenRoots(root: string): string[];
export function signedInSplit(root: string): {
  signedInOnly: Set<string>;
  firstScreen: Set<string>;
  deep: Set<string>;
  declutterOnly: Set<string>;
  homeOff: Set<string>;
};
export function homeFirstScreenRoots(root: string): string[];
export function guestBrowseOnlyModules(root: string): Set<string>;
export function guestBrowseSplit(root: string): { browseOnly: Set<string>; homeShared: Set<string> };
export const DECLUTTER_ITEM_ROOT: string;
export function declutterItemSplit(root: string, split?: { deep: Set<string>; homeOff: Set<string> }): { itemDeep: Set<string>; itemPages: Set<string> };
