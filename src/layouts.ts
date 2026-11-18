/**
 * Static layouts: each computes a target position per node, which the view then animates toward.
 * Pure TypeScript, no NSH imports.
 */
import type { HierarchicalConfig } from "./types";

export interface LayoutNode {
  r: number;
  category: string;
  group: string | null;
  degree: number;
}

export interface LayoutEdge {
  source: number;
  target: number;
}

export type Positions = { x: number; y: number }[];

export const DEFAULT_HIERARCHICAL: HierarchicalConfig = {
  direction: "down",
  layerGap: 110,
  nodeGap: 70,
};

/**
 * A layered (Sugiyama-style) layout: cycles are broken by reversing back edges, nodes are put on layers by
 * longest path from the sources, and each layer is ordered by barycenter sweeps to cut edge crossings.
 */
export function hierarchicalLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  config: Partial<HierarchicalConfig> = {},
): Positions {
  const c = { ...DEFAULT_HIERARCHICAL, ...config };
  const n = nodes.length;
  if (n === 0) return [];

  const out: number[][] = Array.from({ length: n }, () => []);
  for (const e of edges) if (e.source !== e.target) out[e.source].push(e.target);

  // 1. Break cycles: DFS, dropping edges that go back to a node on the stack.
  const state = new Uint8Array(n); // 0 new, 1 on stack, 2 done
  const dag: number[][] = Array.from({ length: n }, () => []);
  for (let root = 0; root < n; root++) {
    if (state[root]) continue;
    const stack: [number, number][] = [[root, 0]];
    state[root] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [v, k] = top;
      if (k < out[v].length) {
        top[1]++;
        const w = out[v][k];
        if (state[w] === 1) {
          dag[w].push(v); // reverse the back edge
        } else {
          dag[v].push(w);
          if (state[w] === 0) {
            state[w] = 1;
            stack.push([w, 0]);
          }
        }
      } else {
        state[v] = 2;
        stack.pop();
      }
    }
  }

  // 2. Layers by longest path, in topological order (Kahn).
  const indeg = new Array<number>(n).fill(0);
  for (let v = 0; v < n; v++) for (const w of dag[v]) indeg[w]++;
  const layer = new Array<number>(n).fill(0);
  const queue: number[] = [];
  for (let v = 0; v < n; v++) if (indeg[v] === 0) queue.push(v);
  for (let h = 0; h < queue.length; h++) {
    const v = queue[h];
    for (const w of dag[v]) {
      layer[w] = Math.max(layer[w], layer[v] + 1);
      if (--indeg[w] === 0) queue.push(w);
    }
  }
  // A node whose children all sit deep moves down to just above the highest of them, so short chains
  // that join a long one late do not stretch edges across many layers.
  for (let i = queue.length - 1; i >= 0; i--) {
    const v = queue[i];
    if (dag[v].length === 0) continue;
    let min = Infinity;
    for (const w of dag[v]) min = Math.min(min, layer[w]);
    layer[v] = Math.max(layer[v], min - 1);
  }

  const layerCount = Math.max(...layer) + 1;
  const layers: number[][] = Array.from({ length: layerCount }, () => []);
  for (let v = 0; v < n; v++) layers[layer[v]].push(v);

  // 3. Order within layers: barycenter sweeps, down then up.
  const undirected: number[][] = Array.from({ length: n }, () => []);
  for (let v = 0; v < n; v++) for (const w of dag[v]) {
    undirected[v].push(w);
    undirected[w].push(v);
  }
  const pos = new Array<number>(n).fill(0);
  const reindex = (l: number[]) => l.forEach((v, i) => (pos[v] = i));
  layers.forEach(reindex);
  const sweep = (l: number, ref: number) => {
    const bary = new Map<number, number>();
    for (const v of layers[l]) {
      let sum = 0;
      let count = 0;
      for (const w of undirected[v]) if (layer[w] === ref) { sum += pos[w]; count++; }
      bary.set(v, count ? sum / count : pos[v]);
    }
    layers[l].sort((a, b) => bary.get(a)! - bary.get(b)! || pos[a] - pos[b]);
    reindex(layers[l]);
  };
  for (let iter = 0; iter < 6; iter++) {
    for (let l = 1; l < layerCount; l++) sweep(l, l - 1);
    for (let l = layerCount - 2; l >= 0; l--) sweep(l, l + 1);
  }

  // 4. Coordinates, keeping each layer's order. A layer much wider than the graph is deep (a star's 300
  // leaves) deals its nodes round-robin onto S staggered sub-rows, like bricks: every node keeps the place
  // its rank gives it, so the crossing-reduced order survives, and the layer gets S times narrower.
  const perRow = Math.max(8, Math.ceil(2 * Math.sqrt(n)));
  const result: Positions = new Array(n);
  const placed: { layer: number[]; across: number; subRows: number; subGap: number }[] = [];
  let across = 0;
  for (const layer of layers) {
    const subRows = Math.ceil(layer.length / perRow) || 1;
    // Far enough apart that neighbors on adjacent sub-rows never touch.
    const subGap = Math.max(c.layerGap * 0.45, Math.max(...layer.map((v) => nodes[v].r)) * 2 + 8);
    placed.push({ layer, across, subRows, subGap });
    across += (subRows - 1) * subGap + c.layerGap;
  }
  const depth = across - c.layerGap;
  for (const { layer, across: top, subRows, subGap } of placed) {
    const widths = layer.map((v) => nodes[v].r * 2);
    const total = widths.reduce((sum, w) => sum + w, 0) + c.nodeGap * Math.max(0, layer.length - 1);
    let cursor = 0;
    layer.forEach((v, j) => {
      const center = cursor + widths[j] / 2;
      cursor += widths[j] + c.nodeGap;
      const along = (center - total / 2) / subRows;
      result[v] = orient(along, top + (j % subRows) * subGap - depth / 2, c.direction);
    });
  }
  return result;
}

function orient(along: number, across: number, direction: HierarchicalConfig["direction"]) {
  switch (direction) {
    case "down": return { x: along, y: across };
    case "up": return { x: along, y: -across };
    case "right": return { x: across, y: along };
    case "left": return { x: -across, y: along };
  }
}

/** Nodes in order on one circle, sorted by group, then category, then degree, so related nodes sit together. */
export function circularLayout(nodes: LayoutNode[]): Positions {
  const n = nodes.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: 0, y: 0 }];
  const order = sortedIndices(nodes);
  const circumference = nodes.reduce((sum, v) => sum + v.r * 2 + 18, 0);
  const radius = Math.max(80, circumference / (2 * Math.PI));
  const result: Positions = new Array(n);
  let angle = -Math.PI / 2;
  order.forEach((v) => {
    const share = ((nodes[v].r * 2 + 18) / circumference) * Math.PI * 2;
    angle += share / 2;
    result[v] = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    angle += share / 2;
  });
  return result;
}

/** Nodes in rows and columns, in the same order as the circular layout. */
export function gridLayout(nodes: LayoutNode[]): Positions {
  const n = nodes.length;
  if (n === 0) return [];
  const order = sortedIndices(nodes);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const maxR = Math.max(...nodes.map((v) => v.r));
  const step = maxR * 2 + 48;
  const result: Positions = new Array(n);
  order.forEach((v, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    result[v] = { x: (col - (cols - 1) / 2) * step, y: (row - (rows - 1) / 2) * step };
  });
  return result;
}

function sortedIndices(nodes: LayoutNode[]): number[] {
  return nodes
    .map((_, i) => i)
    .sort((a, b) => {
      const A = nodes[a];
      const B = nodes[b];
      return (
        (A.group ?? "").localeCompare(B.group ?? "") ||
        A.category.localeCompare(B.category) ||
        B.degree - A.degree ||
        a - b
      );
    });
}
