export const MONEY_STATE_SOURCE: string;
export function classifyVerifyRow(row: { n: number; min: number; err: string; source: string }): {
  ok: boolean;
  expectedUnseeded: boolean;
};
