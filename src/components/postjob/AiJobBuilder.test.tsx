import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { AiJobBuilder } from "./AiJobBuilder";

const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: (...args: unknown[]) => toastInfo(...args),
  },
}));

describe("AiJobBuilder", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    toastInfo.mockReset();
  });

  it("starts collapsed (no input visible)", () => {
    render(<AiJobBuilder onGenerated={vi.fn()} />);
    expect(screen.queryByPlaceholderText(/I need help/i)).toBeNull();
    expect(screen.getByText(/Try the AI Job Builder/)).toBeInTheDocument();
  });

  it("expands on clicking the toggle", () => {
    render(<AiJobBuilder onGenerated={vi.fn()} />);
    fireEvent.click(screen.getByText(/Try the AI Job Builder/));
    expect(screen.getByPlaceholderText(/I need help/i)).toBeInTheDocument();
  });

  it("toasts an error when prompt is empty", () => {
    render(<AiJobBuilder onGenerated={vi.fn()} />);
    fireEvent.click(screen.getByText(/Try the AI Job Builder/));
    fireEvent.click(screen.getByRole("button", { name: /Generate Job Posting/ }));
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("Describe what you need"));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("calls ai-job-builder with prompt + locationContext, fires onGenerated", async () => {
    const generated = {
      title: "Yard cleanup",
      description: "Clear leaves",
      category: "yard_work",
      budget_max: 75,
    };
    invokeMock.mockResolvedValue({ data: generated, error: null });
    const onGenerated = vi.fn();
    render(<AiJobBuilder onGenerated={onGenerated} locationContext="New Orleans, LA" />);
    fireEvent.click(screen.getByText(/Try the AI Job Builder/));
    const textarea = screen.getByPlaceholderText(/I need help/i);
    fireEvent.change(textarea, { target: { value: "Need help raking my yard" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Job Posting/ }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalled());
    expect(invokeMock).toHaveBeenCalledWith("ai-job-builder", {
      body: {
        messages: [{ role: "user", content: "Need help raking my yard" }],
        jobContext: { location: "New Orleans, LA" },
      },
    });
    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(generated));
  });

  it("translates an upstream 503 body into a calm 'busy' toast, never the raw JSON", async () => {
    // What the SDK actually hands back on a non-2xx: a FunctionsHttpError
    // whose `.context` is the Response, and whose body carries the function's
    // verbatim forward of the model gateway's failure.
    const body = { error: 'AI service error (503): [{ "error": { "code": 503, "message": "This model is currently experiencing high demand." } }]' };
    const err = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: new Response(JSON.stringify(body), { status: 500, headers: { "Content-Type": "application/json" } }),
    });
    invokeMock.mockResolvedValue({ data: null, error: err });
    const onGenerated = vi.fn();
    render(<AiJobBuilder onGenerated={onGenerated} />);
    fireEvent.click(screen.getByText(/Try the AI Job Builder/));
    fireEvent.change(screen.getByPlaceholderText(/I need help/i), {
      target: { value: "anything" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate Job Posting/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const msg = toastError.mock.calls[0][0] as string;
    expect(msg).toMatch(/busy right now/);
    expect(msg).not.toMatch(/503|\{/);
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it("surfaces a plain, human edge-function error message as-is", async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error("Describe the job in a bit more detail.") });
    const onGenerated = vi.fn();
    render(<AiJobBuilder onGenerated={onGenerated} />);
    fireEvent.click(screen.getByText(/Try the AI Job Builder/));
    fireEvent.change(screen.getByPlaceholderText(/I need help/i), {
      target: { value: "anything" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate Job Posting/ }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("bit more detail"));
    expect(onGenerated).not.toHaveBeenCalled();
  });
});
