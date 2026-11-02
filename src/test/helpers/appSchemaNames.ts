/**
 * Every RPC and every table / view name the app's generated schema (src/integrations/supabase/types.ts, public schema)
 * knows, for the admin previews' inertness proofs: each is sent through a preview backend and none may reach the
 * network.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

function section(src: string, start: RegExp, end: RegExp): string {
  const a = src.search(start);
  if (a < 0) return "";
  const rest = src.slice(a + 1);
  const b = rest.search(end);
  return b < 0 ? rest : rest.slice(0, b);
}

/** The names declared at the section's first level (six-space indent, `name: {`). */
function names(block: string): string[] {
  return [...block.matchAll(/^ {6}([a-z_][a-z0-9_]*): \{/gm)].map((m) => m[1]);
}

export function appSchemaNames(): { rpcs: string[]; tables: string[] } {
  const src = readFileSync(path.join(process.cwd(), "src/integrations/supabase/types.ts"), "utf8");
  return {
    rpcs: names(section(src, /^ {4}Functions: \{/m, /^ {4}Enums: \{/m)),
    tables: [
      ...names(section(src, /^ {4}Tables: \{/m, /^ {4}Views: \{/m)),
      ...names(section(src, /^ {4}Views: \{/m, /^ {4}Functions: \{/m)),
    ],
  };
}
