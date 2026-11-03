export const MAPKIT_CSR_URL: string;
export const EXPECTED_WASM: string[];
export function mapkitWasmVerdict(source: string): {
  ok: boolean;
  wasmNames: string[];
  uses: number;
  problems: string[];
};
