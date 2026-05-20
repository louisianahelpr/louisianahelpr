import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CurrencyInput } from "./currency-input";

/**
 * Small controlled-mode harness so tests can verify the round-trip:
 * user types -> onChange fires -> parent state updates -> input re-renders
 * with the new value formatted.
 */
function ControlledCurrencyInput(props: {
  initial?: number | undefined;
  min?: number;
  max?: number;
  onChange?: (value: number | undefined) => void;
}) {
  const [value, setValue] = useState<number | undefined>(props.initial);
  return (
    <CurrencyInput
      aria-label="price"
      value={value}
      onChange={(next) => {
        setValue(next);
        props.onChange?.(next);
      }}
      min={props.min}
      max={props.max}
    />
  );
}

describe("CurrencyInput", () => {
  it("formats the value as $1,234.50 on blur", () => {
    render(<ControlledCurrencyInput />);
    const input = screen.getByLabelText("price") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1234.5" } });
    expect(input.value).toBe("1234.5");

    fireEvent.blur(input);
    expect(input.value).toBe("$1,234.50");
  });

  it("strips formatting back to raw digits on focus", () => {
    render(<ControlledCurrencyInput initial={1234.5} />);
    const input = screen.getByLabelText("price") as HTMLInputElement;

    // Initial controlled value renders formatted.
    expect(input.value).toBe("$1,234.50");

    fireEvent.focus(input);
    // Focus drops the `$`, commas, and trailing zero — back to editable.
    expect(input.value).toBe("1234.5");
  });

  it("handles pasting a fully-formatted value like '$1,234.50'", () => {
    const onChange = vi.fn();
    render(<ControlledCurrencyInput onChange={onChange} />);
    const input = screen.getByLabelText("price") as HTMLInputElement;

    fireEvent.focus(input);

    // Paste a formatted USD value — the component should strip the `$`
    // and commas and report the parsed number.
    fireEvent.paste(input, {
      clipboardData: {
        getData: () => "$1,234.50",
      },
    });

    expect(input.value).toBe("1234.50");
    expect(onChange).toHaveBeenLastCalledWith(1234.5);
  });

  it("treats undefined as an empty field", () => {
    render(<ControlledCurrencyInput initial={undefined} />);
    const input = screen.getByLabelText("price") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("clears the value to undefined when the user empties the field", () => {
    const onChange = vi.fn();
    render(<ControlledCurrencyInput initial={50} onChange={onChange} />);
    const input = screen.getByLabelText("price") as HTMLInputElement;

    fireEvent.focus(input);
    expect(input.value).toBe("50");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(input.value).toBe("");
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("operates as a controlled input — re-renders when value prop changes", () => {
    const { rerender } = render(<CurrencyInput value={10} onChange={() => {}} aria-label="price" />);
    const input = screen.getByLabelText("price") as HTMLInputElement;
    expect(input.value).toBe("$10.00");

    rerender(<CurrencyInput value={99.5} onChange={() => {}} aria-label="price" />);
    expect(input.value).toBe("$99.50");

    rerender(<CurrencyInput value={undefined} onChange={() => {}} aria-label="price" />);
    expect(input.value).toBe("");
  });

  it("clamps to min on blur when the user enters a value below the floor", () => {
    const onChange = vi.fn();
    render(<ControlledCurrencyInput min={5} onChange={onChange} />);
    const input = screen.getByLabelText("price") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.blur(input);

    expect(input.value).toBe("$5.00");
    expect(onChange).toHaveBeenLastCalledWith(5);
  });

  it("clamps to max on blur when the user enters a value above the ceiling", () => {
    const onChange = vi.fn();
    render(<ControlledCurrencyInput max={100} onChange={onChange} />);
    const input = screen.getByLabelText("price") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "500" } });
    fireEvent.blur(input);

    expect(input.value).toBe("$100.00");
    expect(onChange).toHaveBeenLastCalledWith(100);
  });

  it("uses inputMode='decimal' so mobile keyboards show the numeric pad", () => {
    render(<ControlledCurrencyInput />);
    const input = screen.getByLabelText("price") as HTMLInputElement;
    expect(input.inputMode).toBe("decimal");
  });

  it("ignores non-numeric typed characters", () => {
    const onChange = vi.fn();
    render(<ControlledCurrencyInput onChange={onChange} />);
    const input = screen.getByLabelText("price") as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "abc12xyz" } });
    expect(input.value).toBe("12");
    expect(onChange).toHaveBeenLastCalledWith(12);
  });

  it("respects the disabled prop", () => {
    render(<CurrencyInput value={10} onChange={() => {}} disabled aria-label="price" />);
    const input = screen.getByLabelText("price") as HTMLInputElement;
    expect(input).toBeDisabled();
  });
});
