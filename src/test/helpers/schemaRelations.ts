/** Every table and view PostgREST exposes on `public`, from the generated types.ts. */
export function relationsInSchema(typesSource: string): Set<string> {
  const tablesAt = typesSource.indexOf("    Tables: {");
  const viewsAt = typesSource.indexOf("    Views: {");
  const functionsAt = typesSource.indexOf("    Functions: {");
  if (tablesAt < 0 || viewsAt < 0 || functionsAt < 0) {
    throw new Error("types.ts no longer has the public Tables/Views/Functions blocks this guard reads");
  }
  const region = typesSource.slice(tablesAt, functionsAt);
  const names = new Set<string>();
  for (const m of region.matchAll(/^ {6}([a-z0-9_]+): \{$/gm)) names.add(m[1]);
  return names;
}
