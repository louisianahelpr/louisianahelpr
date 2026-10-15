export const OPEN_JOB_CAP_REFUSAL: RegExp;
export function upsertJobsPastOpenJobCap(
  chunk: Array<Record<string, unknown> & { id: string }>,
  io: {
    post: (rows: object[]) => Promise<object[]>;
    existingIds: (ids: string[]) => Promise<string[]>;
    patch: (id: string, values: Record<string, unknown>) => Promise<object[]>;
  },
): Promise<object[]>;
