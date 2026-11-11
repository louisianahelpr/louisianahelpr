/**
 * F306 (audit 11-10, Post a job step 3): pasting a long title was cut at 32 characters by maxLength with nothing said.
 * A paste that does not fit now says "Titles can be 32 characters, so the end of what you pasted was cut." until the
 * next edit. A paste that fits says nothing.
 *
 * @mutate src/components/postjob/detailsSection/TitleField.tsx |     pasteCut.current = kept + e.clipboardData.getData("text").length > TITLE_MAX; |     pasteCut.current = false;
 * @mutate src/components/postjob/detailsSection/TitleField.tsx |       {!overLimit && !leak && cut && ( |       {false && (
 */
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { TitleField } from "./TitleField";

function Harness() {
  const [title, setTitle] = useState("");
  return <TitleField title={title} setTitle={setTitle} category="handyman" />;
}

const LONG = "Hang three floating shelves in the living room";
const note = () => document.querySelector("[data-title-paste-cut]");

describe("a pasted title that does not fit says it was cut (F306)", () => {
  it("over 32: says so; the next typed edit clears it", () => {
    render(<Harness />);
    const input = screen.getByRole("textbox");
    fireEvent.paste(input, { clipboardData: { getData: () => LONG } });
    fireEvent.change(input, { target: { value: LONG.slice(0, 32) } });
    expect(note()?.textContent).toBe("Titles can be 32 characters, so the end of what you pasted was cut.");
    fireEvent.change(input, { target: { value: LONG.slice(0, 31) } });
    expect(note()).toBeNull();
  });

  it("a paste that fits says nothing", () => {
    render(<Harness />);
    const input = screen.getByRole("textbox");
    fireEvent.paste(input, { clipboardData: { getData: () => "Hang shelves" } });
    fireEvent.change(input, { target: { value: "Hang shelves" } });
    expect(note()).toBeNull();
  });
});
