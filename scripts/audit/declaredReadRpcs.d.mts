export function functionHeader(sqlFromCreate: string): string;
export function declaredVolatility(header: string): "s" | "i" | "v";
export function declaredReadRpcs(dir?: string): Set<string>;
export function declaredReadRpcSet(): Set<string>;
export function isDeclaredReadRpcPath(pathname: string, reads?: Set<string>): boolean;
