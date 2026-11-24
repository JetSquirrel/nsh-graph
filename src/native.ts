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
  /**
   * The layout keeping the nodes' state between ticks (optional, so an older backend still works with
   * `tick`): `load` the whole state (7 f64 per node: x, y, vx, vy, fx, fy, r), `update` every node
   * (5 f64: x, y, fx, fy, r) or `patch` some (6 f64: index, x, y, fx, fy, r), then `run`, which returns
   * x, y per node, the alpha, and the pins it moved (a count, then index, fx, fy each).
   */
  load?(state: Uint8Array): void;
  update?(state: Uint8Array, resetVelocity: number): void;
  patch?(entries: Uint8Array): void;
  run?(iterations: number, alpha: number, alphaTarget: number): Uint8Array;
  /** vx, vy per node. */
  velocities?(): Uint8Array;
}

/** What `nsh-graph/native`'s `GraphPainter` offers: edges and nodes traced as SVG path data. */
export interface NativeGraphPainter {
  setEdges(edges: Uint8Array): void;
  setNodes(nodes: Uint8Array): void;
  /** Only the positions (x, y for each node `setNodes` gave; radii stay): the buffer `ForceLayout.run` returned. Optional. */
  setPositions?(positions: Uint8Array): void;
  /** `style`: x0, y0, x1, y1, arrows (1 or 0), arrow length, then optionally decimals (0 to 2, default 2). */
  traceEdges(states: Uint8Array, style: number[]): string[];
  /** `view`: x0, y0, x1, y1, then optionally decimals (0 to 2, default 2). */
  traceNodes(keys: Uint8Array, batches: number, view: number[]): string[];
  /**
   * The renderer's node pass in Rust (optional): `setRanks` (one u32 color rank per node) when the colors
   * change, then each frame `frameNodes(focus, colors, style)` with the focus's node indices (u32; empty:
   * no focus) and `style` = x0, y0, x1, y1, decimals, zoom, ring radius and level-of-detail radius (in
   * points). It returns 2 × colors paths, dimmed batches first; `frameInfo` then gives one u8 per node
   * (in view) and one per batch (ringed).
   */
  setRanks?(ranks: Uint8Array): void;
  frameNodes?(focus: Uint8Array, colors: number, style: number[]): string[];
  frameInfo?(): Uint8Array;
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
