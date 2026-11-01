// "sonner-real" is the sonner package itself (vite.config.ts and vitest.config.ts alias it); "sonner" is
// src/lib/sonnerFacade.ts in the production build. See that file.
declare module "sonner-real" {
  export * from "sonner";
}
