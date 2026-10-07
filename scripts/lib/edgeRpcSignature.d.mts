export type RpcCall = { name: string; keys: string[] | null };
export type Overload = { args: string[]; ndefaults: number };
export function objectKeys(body: string): string[] | null;
export function rpcCalls(src: string): RpcCall[];
export function callMatches(keys: string[], overloads: Overload[]): boolean;
export function signatureMismatches(
  callsByFile: Map<string, RpcCall[]>,
  catalog: Map<string, Overload[]>,
): Array<{ name: string; keys: string[]; files: string[] }>;
