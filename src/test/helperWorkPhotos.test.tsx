import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HelperWorkPhotos } from "@/components/profile/HelperWorkPhotos";

/**
 * Guards the surface that makes profile work photos worth uploading.
 *
 * `profiles.portfolio_urls` had an uploader (Edit Profile → Recent work) and
 * was even SELECTed by useUserProfileData, but NOTHING rendered it — so the
 * photos were admin-visible only and every helper re-attached the same files
 * on every application instead. If this section stops rendering, the apply
 * step's removed file picker leaves helpers with no way to show their work.
 */
describe("HelperWorkPhotos", () => {
  it("renders each uploaded photo for posters to see", () => {
    render(
      <HelperWorkPhotos
        urls={["https://example.test/a.jpg", "https://example.test/b.jpg"]}
      />,
    );
    const imgs = screen.getAllByRole("img");
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toHaveAttribute("src", "https://example.test/a.jpg");
    expect(screen.getByText(/recent work/i)).toBeTruthy();
  });

  it("renders nothing when the helper has uploaded no photos", () => {
    const { container } = render(<HelperWorkPhotos urls={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
