import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SampleJobTemplates } from "./SampleJobTemplates";
import { sampleJobs } from "@/data/sampleJobs";

const trackMock = vi.fn();
vi.mock("@/lib/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

interface RenderOptions {
  open?: boolean;
}

function renderTemplates(opts: RenderOptions = {}) {
  const setters = {
    setTitle: vi.fn(),
    setDescription: vi.fn(),
    setCategory: vi.fn(),
    setBudget: vi.fn(),
    setEstimatedHours: vi.fn(),
  };
  const onClose = vi.fn();
  const result = render(
    <SampleJobTemplates open={opts.open ?? true} onClose={onClose} {...setters} />,
  );
  return { ...setters, onClose, ...result };
}

describe("SampleJobTemplates", () => {
  beforeEach(() => {
    trackMock.mockReset();
  });

  it("renders the template grid when open", () => {
    renderTemplates({ open: true });
    expect(screen.getByText(/Start from a template/i)).toBeInTheDocument();
    // Every sample should render a tappable button.
    for (const sample of sampleJobs) {
      expect(
        screen.getByRole("button", { name: new RegExp(`Use template: ${sample.title}`, "i") }),
      ).toBeInTheDocument();
    }
  });

  it("renders nothing when not open", () => {
    renderTemplates({ open: false });
    expect(screen.queryByText(/Start from a template/i)).toBeNull();
  });

  it("pre-fills every form field, fires analytics, and closes when a template is tapped", () => {
    const { setTitle, setDescription, setCategory, setBudget, setEstimatedHours, onClose } =
      renderTemplates();
    const sample = sampleJobs[0];

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`Use template: ${sample.title}`, "i") }),
    );

    expect(setCategory).toHaveBeenCalledWith(sample.category);
    expect(setTitle).toHaveBeenCalledWith(sample.title);
    expect(setDescription).toHaveBeenCalledWith(sample.description);
    expect(setBudget).toHaveBeenCalledWith(String(sample.typical_price));
    // estimatedHours is hours not minutes — verify the conversion.
    expect(setEstimatedHours).toHaveBeenCalledWith(
      (sample.typical_duration_minutes / 60).toString(),
    );
    expect(trackMock).toHaveBeenCalledWith("sample_job_template_selected", {
      template_id: sample.id,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes and tracks dismissal when the customer taps "Hide templates"', () => {
    const { onClose } = renderTemplates();
    fireEvent.click(screen.getByRole("button", { name: /Hide templates/i }));
    expect(onClose).toHaveBeenCalled();
    expect(trackMock).toHaveBeenCalledWith("sample_job_template_dismissed", {});
  });
});
