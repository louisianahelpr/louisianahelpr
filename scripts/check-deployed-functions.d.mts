export function repoFunctions(dir?: string): string[];
export function compareFunctions(repo: string[], deployed: string[]): { notDeployed: string[]; notInRepo: string[] };
