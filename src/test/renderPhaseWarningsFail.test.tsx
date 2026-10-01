/**
 * Q259 guard, proven: src/test/setup.ts turns React's render-phase warnings
 * into test failures. Each case below triggers one for real and expects the
 * throw; with the hook removed nothing throws and these fail.
 *
 * @mutate src/test/setup.ts | throw new Error(`React render-phase warning (Q259): ${text.slice(0, 300)}`); | void 0;
 */
import { useState, useEffect } from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

function Child({ onRender }: { onRender: () => void }) { onRender(); return null; }
function Parent() {
  const [, set] = useState(0);
  // Bounded: with the setup.ts hook mutated away nothing throws, and an
  // unbounded set-per-render loop hung the vacuity run (vitest 5, Linux CI).
  return <Child onRender={() => set((n) => (n < 3 ? n + 1 : n))} />;
}
function Flip() {
  const [v, setV] = useState<string | undefined>(undefined);
  useEffect(() => setV("x"), []);
  return <input value={v} onChange={() => {}} />;
}

describe("React render-phase warnings fail tests (Q259)", () => {
  it("setState on another component during render throws", () => {
    expect(() => render(<Parent />)).toThrow(/render-phase warning/);
  });
  it("an input flipping uncontrolled -> controlled throws", () => {
    expect(() => render(<Flip />)).toThrow(/render-phase warning/);
  });
  it("the hook matches Radix's own wording", () => {
    expect(() => console.warn("Select is changing from uncontrolled to controlled.")).toThrow(/render-phase warning/);
  });
});
