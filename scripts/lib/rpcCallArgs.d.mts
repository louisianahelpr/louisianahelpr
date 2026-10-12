export interface RpcCall {
  name: string;
  /** Argument names; [] for no arguments; null when the source does not say. */
  keys: string[] | null;
}
export interface RpcOverload {
  args: string[];
  required: number;
  types?: string[];
}
export function extractRpcCalls(src: string): RpcCall[];
export function overloadAccepts(keys: string[], overloads: RpcOverload[]): boolean;
