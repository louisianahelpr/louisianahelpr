export function liveDataSources(root: string): { name: string; file: string }[];
export function buildLiveData(
  root: string,
  builtAt: string,
): {
  manifest: { v: number; builtAt: string; files: Record<string, { hash: string; path: string }> };
  assets: { fileName: string; source: string }[];
};
