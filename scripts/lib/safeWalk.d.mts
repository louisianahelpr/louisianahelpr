export function walkFiles(
  root: string,
  keep?: (path: string) => boolean,
): { files: string[]; broken: { path: string; reason: string }[]; cycles: string[] };
