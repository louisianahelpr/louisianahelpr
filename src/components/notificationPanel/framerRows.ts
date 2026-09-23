/**
 * The ONLY framer-motion exports the bell's panel uses, behind the dynamic
 * import in useFramerMotion.ts.
 *
 * Why a re-export module instead of `import("framer-motion")` directly: a
 * dynamic import of the package namespace keeps EVERY export alive, so the
 * bundler cannot tree-shake it. Measured on the built graph 2026-09-22: the
 * namespace import merged framer into one 58.8 kB gzip chunk, against 44 kB
 * for the named-import chunks every other consumer shared before. Named
 * re-exports here keep the tree-shaken shape.
 */
export { AnimatePresence, motion } from "framer-motion";
