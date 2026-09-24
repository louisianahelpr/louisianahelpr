/**
 * Insert in-app notification row(s) and SAY when it fails (Q358, AM-002 class).
 *
 * Edge functions wrote `await supabase.from("notifications").insert({...})` and
 * dropped the result, so an RLS refusal, a constraint or a renamed column meant
 * a user or admin was silently never told about a payout, refund or cancel.
 * This returns whether the write landed and logs the refusal with the row's
 * type/user so the edge logs name who missed what. Never throws: a notice is
 * never worth failing the money path that sent it.
 *
 * ZERO imports on purpose (like adminAuditLog.ts), so any function can use it.
 */
type Row = Record<string, unknown>;

// deno-lint-ignore no-explicit-any
export async function insertNotifications(client: any, rows: Row | Row[]): Promise<boolean> {
  try {
    const { error } = await client.from("notifications").insert(rows);
    if (error) {
      const list = Array.isArray(rows) ? rows : [rows];
      console.error("[notifications] insert failed", { // Q358 logged refusal
        code: error.code,
        message: error.message,
        count: list.length,
        types: [...new Set(list.map((r) => r.type))],
        user_ids: list.map((r) => r.user_id).slice(0, 5),
      });
      return false;
    }
    return true;
  } catch (e) {
    console.error("[notifications] insert threw", { message: e instanceof Error ? e.message : String(e) });
    return false;
  }
}
