import type { GraphData } from "nsh-graph";

/** A preferential-attachment graph of `n` nodes, `m` edges each: hubs and long tails, like most real networks. */
export function scaleFree(n: number, m: number): GraphData {
  let s = 99;
  const rand = () => (s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 4294967296;
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `v${i}`, caption: `v${i}`, category: `c${i % 7}` }));
  const ends: number[] = [0];
  const edges: { from: string; to: string }[] = [];
  for (let i = 1; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const t = ends[Math.floor(rand() * ends.length)];
      edges.push({ from: `v${i}`, to: `v${t}` });
      ends.push(t);
    }
    ends.push(i);
  }
  return { nodes, edges };
}
