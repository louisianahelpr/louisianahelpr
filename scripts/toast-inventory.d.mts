/**
 * Types for scripts/toast-inventory.mjs, so src/test/toastCopy.test.ts can
 * import the scanner instead of keeping a second copy of it. Same pattern as
 * scripts/back-control-inventory.d.mts.
 */
import type ts from "typescript";

export const OUTPUT: string;
export const ERROR_MAPPERS: Record<string, number[]>;
export const ERRORISH: RegExp;

export interface CopyDescription {
  form: "literal" | "template" | "dynamic" | "jsx";
  text: string;
  branches?: CopyDescription[];
}

export interface ToastEntry {
  file: string;
  line: number;
  kind: string;
  title: CopyDescription | null;
  description?: CopyDescription;
  promise?: Record<string, CopyDescription | null>;
  renders: boolean;
  rawError?: string[];
}

export interface ToastInventory {
  what: string;
  summary: {
    calls: number;
    files: number;
    rendering: number;
    suppressedByPolicy: number;
    byKind: Record<string, number>;
    copyPiecesByForm: Record<string, number>;
  };
  toasts: ToastEntry[];
}

export interface ToastCall {
  node: ts.CallExpression;
  kind: string;
  line: number;
  copy: { slot: string; node: ts.Expression }[];
  optionsArg: ts.Expression | undefined;
}

export interface CopyLeaf {
  type: "literal" | "template" | "raw" | "opaque";
  text: string;
  node: ts.Node;
  fragment: boolean;
  line: number;
}

export function walk(dir: string, out?: string[]): string[];
export function describeCopy(node: ts.Node, sf: ts.SourceFile): CopyDescription | null;
export function toastCalls(file: string, source: string): { sf: ts.SourceFile; rel: string; calls: ToastCall[] };
export function scanFile(file: string, source: string): ToastEntry[];
export function copyLeaves(node: ts.Node, sf: ts.SourceFile, depth?: number, seen?: Set<ts.Node>, fragment?: boolean): CopyLeaf[];
export function copyPieces(entry: ToastEntry): (CopyDescription & { slot: string })[];
export function inventory(root?: string): ToastInventory;
