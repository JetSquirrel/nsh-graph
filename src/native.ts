/**
 * The optional Rust backend (`native/`, imported as `nsh-graph/native`). An app that adds the nsh-graph nshm
 * registers it once; from then on new `ForceSimulation`s tick in Rust:
 *
 * ```ts
 * import * as native from "nsh-graph/native";
 * import { setNativeBackend } from "nsh-graph";
 * setNativeBackend(native);
 * ```
 *
 * Without it nothing changes: the TypeScript layout runs. nsh-graph never imports the crate itself, so
 * apps without Rust (and pure-TS hosts such as the tests) keep working.
 */

/** What `nsh-graph/native`'s `ForceLayout` offers (see `native/src/lib.rs`). */
export interface NativeForceLayout {
  setConfig(values: number[]): void;
  setGraph(count: number, links: Uint8Array, groups: Uint8Array): void;
  tick(state: Uint8Array, iterations: number, alpha: number, alphaTarget: number): Uint8Array;
}

/** What `nsh-graph/native`'s `GraphPainter` offers: edges and nodes traced as SVG path data. */
export interface NativeGraphPainter {
  setEdges(edges: Uint8Array): void;
  setNodes(nodes: Uint8Array): void;
  /** `style`: x0, y0, x1, y1, arrows (1 or 0), arrow length, then optionally decimals (0 to 2, default 2). */
  traceEdges(states: Uint8Array, style: number[]): string[];
  /** `view`: x0, y0, x1, y1, then optionally decimals (0 to 2, default 2). */
  traceNodes(keys: Uint8Array, batches: number, view: number[]): string[];
}

/** The module `nsh-graph/native` exports. */
export interface NativeBackend {
  ForceLayout: new () => NativeForceLayout;
  /** Optional, so a backend with the layout alone still works. */
  GraphPainter?: new () => NativeGraphPainter;
}

let backend: NativeBackend | null = null;

/**
 * Uses the Rust backend for the layouts made from now on (null goes back to TypeScript). Views mounted
 * before keep what they started with.
 */
export function setNativeBackend(native: NativeBackend | null) {
  backend = native;
}

/** The registered backend, or null. */
export function nativeBackend(): NativeBackend | null {
  return backend;
}
