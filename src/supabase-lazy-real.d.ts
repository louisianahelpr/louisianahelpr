// "supabase-realtime-real" and "supabase-storage-real" are the realtime-js and storage-js packages themselves
// (vite.config.ts and vitest.config.ts alias them); in the production build "@supabase/realtime-js" and
// "@supabase/storage-js" are src/integrations/supabase/lazyRealtime.ts and lazyStorage.ts. See those files.
declare module "supabase-realtime-real" {
  export * from "@supabase/realtime-js";
}
declare module "supabase-storage-real" {
  export * from "@supabase/storage-js";
}
