/**
 * Owner, 2026-10-07, on Post a Job: "dont auto select other" (the Category
 * picker opened with Other already ticked), and "make time fill that empty
 * space on the right" (Start Time sat in a 10.5rem box beside a full-width
 * Date Needed).
 *
 * @mutate src/pages/post-job/usePostJobForm.ts | const [category, setCategory] = useState<string>(""); | const [category, setCategory] = useState<string>("other");
 * @mutate src/components/postjob/LogisticsSection.tsx | ariaLabel="Start time" className="max-w-none w-full" /> | ariaLabel="Start time" />
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));

describe("Post a Job opens with nothing chosen for the poster", () => {
  it("no category is pre-selected (submit already asks for one)", () => {
    const form = read("src/pages/post-job/usePostJobForm.ts");
    expect(form).toMatch(/const \[category, setCategory\] = useState<string>\(""\);/);
    expect(read("src/pages/post-job/useJobSubmit.ts")).toMatch(/if \(!category\) \{ toast\.error\("Pick a category\."\)/);
  });

  it("Start Time fills its column (no 10.5rem cap) on Post a Job", () => {
    const logistics = read("src/components/postjob/LogisticsSection.tsx");
    expect(logistics).toMatch(/<TimePickerWheel value=\{startTime\} onChange=\{setStartTime\} ariaLabel="Start time" className="max-w-none w-full" \/>/);
  });
});
