/**
 * Offline stand-ins for the inbox's two server-backed thread stores, for specs
 * that render ConversationList / Messages.
 *
 * On mount ConversationList calls `loadPins(userId)` and `loadArchives(userId)`,
 * which read `thread_pins` / `thread_archives` from Supabase. Rendered unmocked
 * with the fixture id "user-1" they were the Q55(a) leak: ~4,190 requests/day
 * to PROD, each an `invalid input syntax for type uuid: "user-1"` error.
 * Unit tests never reach Supabase (src/test/prodNetworkGuard.ts).
 *
 * Only the two loaders change: they resolve from the module's own local
 * mirror, exactly what the real ones do when the server read fails. Every
 * other export is the real one, so pin/archive state still behaves.
 *
 * Usage (vi.mock is hoisted, so import the helper inside the factory):
 *   vi.mock("@/lib/pinnedConversations", async (io) =>
 *     (await import("@/test/helpers/threadStoresOffline")).pinnedConversationsOffline(io));
 *   vi.mock("@/lib/archivedConversations", async (io) =>
 *     (await import("@/test/helpers/threadStoresOffline")).archivedConversationsOffline(io));
 */
type Pinned = typeof import("@/lib/pinnedConversations");
type Archived = typeof import("@/lib/archivedConversations");

export async function pinnedConversationsOffline(importOriginal: () => Promise<unknown>): Promise<Pinned> {
  const actual = (await importOriginal()) as Pinned;
  return { ...actual, loadPins: async (userId: string) => actual.getPinnedSet(userId) };
}

export async function archivedConversationsOffline(importOriginal: () => Promise<unknown>): Promise<Archived> {
  const actual = (await importOriginal()) as Archived;
  return { ...actual, loadArchives: async () => ({}) };
}
