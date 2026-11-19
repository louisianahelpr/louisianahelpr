export const MANIFEST: string;
export function coverDuplicates(manifest: Record<string, { section: string; items: { name: string; key: string }[] }>): string[];
