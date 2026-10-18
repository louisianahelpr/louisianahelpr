/**
 * MOCK-UP ONLY (wip/design-small-mocks, 2026-10-18): never lands. Lets one
 * build show today's look (no flag) and each owner option side by side.
 * localStorage "lh-mock" = {"bar":"A"|"B","gloss":"A"|"B","words":true,"more":true}
 */
export type MockFlags = { bar?: "A" | "B"; gloss?: "A" | "B"; words?: boolean; more?: boolean };

function read(): MockFlags {
  try {
    return JSON.parse(window.localStorage.getItem("lh-mock") || "{}") as MockFlags;
  } catch {
    return {};
  }
}

export const MOCK: MockFlags = typeof window === "undefined" ? {} : read();

if (typeof document !== "undefined" && MOCK.gloss) {
  document.documentElement.classList.add(`mock-gloss-${MOCK.gloss.toLowerCase()}`);
}
