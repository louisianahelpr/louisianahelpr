/**
 * Entry budget (11-10): after #4297 the entry chunk measured 5.4 KB gz, over its 5 KB band (critical-path.mjs --check
 * on main 1a32c733f9), and land.sh refused every landing. /messages' page import carried a 103-file preload list inside
 * the entry; it now starts through profileRoute's boot chunk (the /profile and /admin trade): entry 5.4 -> 4.7 KB gz.
 * This holds the shape: the entry table names no page import for /messages, and the boot chunk starts Messages.
 *
 * @mutate src/boot/routePreload.ts | "/messages": {\n    guest: [protectedRoute],\n    signedIn: [profileRoute, protectedRoute], | "/messages": {\n    guest: [protectedRoute],\n    signedIn: [() => import("@/pages/messages/Messages"), protectedRoute],
 * @mutate src/boot/profileRoute.ts |   if (path === "/messages") return [() => import("@/pages/messages/Messages")]; |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const read = (f: string) => blankComments(readFileSync(resolve(__dirname, f), "utf8"));

describe("/messages starts its page through a boot chunk, not from the entry", () => {
  it("the entry table's /messages row names no page import; profileRoute starts Messages", () => {
    const table = read("routePreload.ts");
    const row = /"\/messages": \{([\s\S]*?)\n {2}\},/.exec(table)?.[1] ?? "";
    expect(row.length).toBeGreaterThan(10);
    expect(row).not.toMatch(/import\(/);
    expect(row).toMatch(/signedIn: \[profileRoute, protectedRoute\]/);
    expect(read("profileRoute.ts")).toMatch(/if \(path === "\/messages"\) return \[\(\) => import\("@\/pages\/messages\/Messages"\)\];/);
  });
});
