/**
 * Audit 1b D2-7 (1b-b-order-click-375, 1b-b-refund-form-375): the problem form and the refund form had no photo input,
 * so "It's damaged" could only be words. The picker: up to 3 photos, thumbnails with Remove, uploaded when the form is
 * sent, one by one, into the member's problem folder. Whether each form shows it is bound to the server by
 * src/test/problemPhotosWaitForServer.test.ts.
 *
 * @mutate src/components/declutter/DeclutterProblemPhotos.tsx |   return [...current, ...images].slice(0, PROBLEM_PHOTO_MAX); |   return [...current, ...images];
 * @mutate src/components/declutter/DeclutterProblemPhotos.tsx | .filter((f) => f.type.startsWith("image/")) | .filter(() => true)
 * @mutate src/components/declutter/DeclutterProblemPhotos.tsx |               onClick={() => onChange(files.filter((_, j) => j !== i))}> |               onClick={() => onChange(files)}>
 * @mutate src/components/declutter/DeclutterProblemPhotos.tsx |         {!full && ( |         {true && (
 * @mutate src/components/declutter/DeclutterProblemPhotos.tsx |   for (const f of files.slice(0, PROBLEM_PHOTO_MAX)) paths.push(await uploadProblemPhoto(orderId, f)); |   for (const f of files.slice(0, 1)) paths.push(await uploadProblemPhoto(orderId, f));
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

const uploads = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/lib/declutter/handover", () => ({
  uploadProblemPhoto: async (orderId: string, f: File) => { uploads.push([orderId, f.name]); return `me/declutter/problem/${orderId}/${f.name}`; },
}));

import { addProblemPhotos, ProblemPhotoPicker, uploadProblemPhotos } from "./DeclutterProblemPhotos";
import { PROBLEM_PHOTO_MAX } from "@/lib/declutter/problemPhotos";

const img = (name: string) => new File(["x"], name, { type: "image/jpeg" });

function Harness() {
  const [files, setFiles] = useState<File[]>([]);
  return <ProblemPhotoPicker files={files} onChange={setFiles} />;
}

beforeEach(() => {
  uploads.length = 0;
  let n = 0;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:p${n++}`, revokeObjectURL: () => undefined }));
});

describe("D2-7: problem and refund photos", () => {
  it("keeps at most 3, images only", () => {
    expect(PROBLEM_PHOTO_MAX).toBe(3);
    const four = [img("a.jpg"), img("b.jpg"), img("c.jpg"), img("d.jpg")];
    expect(addProblemPhotos([], four).map((f) => f.name)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(addProblemPhotos([img("a.jpg")], [new File(["x"], "n.pdf", { type: "application/pdf" }), img("b.jpg")]).map((f) => f.name)).toEqual(["a.jpg", "b.jpg"]);
    expect(addProblemPhotos([], null)).toEqual([]);
  });

  it("shows a thumbnail per photo with Remove, and no Add once there are 3", () => {
    const { container } = render(<Harness />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    // The camera roll is allowed (evidence, not a handover photo): no capture attribute.
    expect(input.hasAttribute("capture")).toBe(false);
    expect(input.getAttribute("accept")).toBe("image/*");
    fireEvent.change(input, { target: { files: [img("a.jpg"), img("b.jpg")] } });
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add a photo" })).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [img("c.jpg"), img("d.jpg")] } });
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Add a photo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 2" }));
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add a photo" })).toBeInTheDocument();
  });

  it("uploads each photo into the order's problem folder, in order, at most 3", async () => {
    const paths = await uploadProblemPhotos("o1", [img("a.jpg"), img("b.jpg"), img("c.jpg"), img("d.jpg")]);
    expect(paths).toEqual(["me/declutter/problem/o1/a.jpg", "me/declutter/problem/o1/b.jpg", "me/declutter/problem/o1/c.jpg"]);
    expect(uploads).toEqual([["o1", "a.jpg"], ["o1", "b.jpg"], ["o1", "c.jpg"]]);
  });
});
