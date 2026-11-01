/**
 * A Supabase client fake for screen tests whose own module mocks are the real fixture: every read, RPC, function call,
 * auth call and channel answers "nothing" ({ data: [], error: null, count: 0 }) and nothing ever leaves the process.
 *
 * Why (B44, 10-31): B84's /home bundle cut (458 -> 400 KB gz) moved Home's Declutter/Shops/Rentals reads behind
 * dynamic imports and was backed out because dashboardsShell and centerCreateNav then made real prod requests
 * (prodNetworkGuard). vi.mock DOES reach a dynamic import made inside a source module (measured: alias and relative
 * paths both return the mock), so the leak was a data module those tests never mocked falling through to the real
 * client. With this backstop, a read moved into a new module answers "nothing" instead of reaching prod.
 *
 *   vi.mock("@/integrations/supabase/client", async () => (await import("./helpers/emptySupabaseClient")).emptySupabaseModule());
 */
const EMPTY = { data: [], error: null, count: 0 };

function chain(): unknown {
  return new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve(EMPTY).then(resolve);
      // A callable proxy, not a bare arrow: `supabase.auth.onAuthStateChange(...)` reads a property of a property.
      return chain();
    },
    apply: () => chain(),
  });
}

export function emptySupabaseModule() {
  return { supabase: chain() };
}
