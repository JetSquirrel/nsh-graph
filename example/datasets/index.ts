/**
 * Graphs for trying the view against: four open datasets and synthetic edge cases.
 *
 * - karate: Zachary's karate club (W. Zachary, 1977), via networkx's `karate_club_graph`.
 * - miserables: character co-occurrence in Les Misérables (D. Knuth, The Stanford GraphBase), via the d3 gallery.
 * - flare-tree / flare-deps: the Flare ActionScript library's class tree and imports, via vega-datasets.
 */
import type { GraphData } from "nsh-graph";
import karate from "./karate.json";
import miserables from "./miserables.json";
import flareTree from "./flare-tree.json";
import flareDeps from "./flare-deps.json";

/** A seeded generator, so synthetic graphs are the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 4294967296);
}

/** Barabási–Albert preferential attachment: a few hubs, many leaves. */
export function scaleFree(n: number, m = 2, seed = 1): GraphData {
  const rand = rng(seed);
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `v${i}`, caption: `v${i}`, category: `c${i % 5}` }));
  const edges: GraphData["edges"] = [];
  const targets: number[] = [];
  for (let i = 0; i < n; i++) {
    const picked = new Set<number>();
    if (i <= m) {
      for (let j = 0; j < i; j++) picked.add(j);
    } else {
      while (picked.size < m) picked.add(targets[Math.floor(rand() * targets.length)]);
    }
    for (const j of picked) {
      edges.push({ from: `v${i}`, to: `v${j}` });
      targets.push(i, j);
    }
  }
  return { nodes, edges };
}

function star(leaves: number): GraphData {
  return {
    nodes: [{ id: "hub", caption: "Hub", category: "hub" }, ...Array.from({ length: leaves }, (_, i) => ({ id: `l${i}`, caption: `Leaf ${i}`, category: "leaf" }))],
    edges: Array.from({ length: leaves }, (_, i) => ({ from: "hub", to: `l${i}` })),
  };
}

function complete(n: number): GraphData {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `k${i}`, caption: `K${i}`, category: "k" }));
  const edges: GraphData["edges"] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) edges.push({ from: `k${i}`, to: `k${j}` });
  return { nodes, edges };
}

function chain(n: number): GraphData {
  return {
    nodes: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, caption: `Step ${i}`, category: i % 10 === 0 ? "milestone" : "step" })),
    edges: Array.from({ length: n - 1 }, (_, i) => ({ from: `s${i}`, to: `s${i + 1}` })),
  };
}

/** Disconnected parts: two triangles, a pair, and isolated nodes. */
function islands(): GraphData {
  const ids = ["a1", "a2", "a3", "b1", "b2", "b3", "c1", "c2", "x", "y", "z"];
  return {
    nodes: ids.map((id) => ({ id, category: id[0] })),
    edges: [
      { from: "a1", to: "a2" }, { from: "a2", to: "a3" }, { from: "a3", to: "a1" },
      { from: "b1", to: "b2" }, { from: "b2", to: "b3" }, { from: "b3", to: "b1" },
      { from: "c1", to: "c2" },
    ],
  };
}

/** Many parallel edges both ways, self loops, and a loop on a node with no other edge. */
function multi(): GraphData {
  const edges: GraphData["edges"] = [];
  for (let i = 0; i < 5; i++) edges.push({ from: "a", to: "b", caption: `a→b ${i}` });
  for (let i = 0; i < 3; i++) edges.push({ from: "b", to: "a", caption: `b→a ${i}` });
  for (let i = 0; i < 3; i++) edges.push({ from: "a", to: "a", caption: `loop ${i}` });
  edges.push({ from: "c", to: "c", caption: "alone" }, { from: "b", to: "c", caption: "b→c" });
  return { nodes: [{ id: "a", category: "x" }, { id: "b", category: "y" }, { id: "c", category: "z" }], edges };
}

/** Captions in many scripts and lengths. */
function captions(): GraphData {
  const names = [
    "张三", "李四的朋友们", "東京都庁", "서울특별시", "Ελληνικά", "Русский текст", "עברית", "العربية",
    "👩‍💻 Developer", "🚀🔥✨", "A", "", "An extremely long caption that should be truncated somewhere sensible",
    "mixed 中文 English 混排", "Tab\tand\nnewline",
  ];
  const nodes = names.map((caption, i) => ({ id: `t${i}`, caption, category: ["中文", "日本語", "other"][i % 3] }));
  return { nodes, edges: nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id, caption: ["关系", "知り合い", "KNOWS"][i % 3] })) };
}

/** Data a host might send by mistake: duplicate ids, edges to missing nodes, odd sizes and positions. */
function malformed(): GraphData {
  return {
    nodes: [
      { id: "ok", caption: "OK" },
      { id: "dup", caption: "First dup" },
      { id: "dup", caption: "Second dup" },
      { id: "zero", caption: "size 0", size: 0 },
      { id: "neg", caption: "size -5", size: -5 },
      { id: "huge", caption: "size 400", size: 400 },
      { id: "nan", caption: "NaN pos", x: NaN, y: NaN },
      { id: "inf", caption: "Infinite pos", x: Infinity, y: -Infinity },
      { id: "same1", caption: "Same place 1", x: 10, y: 10 },
      { id: "same2", caption: "Same place 2", x: 10, y: 10 },
      { id: "", caption: "empty id" },
    ],
    edges: [
      { from: "ok", to: "dup" },
      { from: "ok", to: "missing" },
      { from: "ghost", to: "ok" },
      { from: "zero", to: "neg", width: -3 },
      { from: "huge", to: "ok", width: 0 },
      { from: "same1", to: "same2" },
      { from: "nan", to: "inf" },
      { from: "", to: "ok" },
    ],
  };
}

export interface Dataset {
  id: string;
  name: string;
  data: () => GraphData;
}

export const datasets: Dataset[] = [
  { id: "karate", name: "Karate club (34)", data: () => karate as GraphData },
  { id: "miserables", name: "Les Misérables (77)", data: () => miserables as GraphData },
  { id: "flare-tree", name: "Flare tree (252)", data: () => flareTree as GraphData },
  { id: "flare-deps", name: "Flare imports (220/764)", data: () => flareDeps as GraphData },
  { id: "scale-free", name: "Scale-free (1500)", data: () => scaleFree(1500) },
  { id: "star", name: "Star (300 leaves)", data: () => star(300) },
  { id: "complete", name: "Complete K30", data: () => complete(30) },
  { id: "chain", name: "Chain (200)", data: () => chain(200) },
  { id: "islands", name: "Islands", data: islands },
  { id: "multi", name: "Multi-edges & loops", data: multi },
  { id: "captions", name: "Captions (CJK, emoji…)", data: captions },
  { id: "malformed", name: "Malformed data", data: malformed },
  { id: "empty", name: "Empty", data: () => ({ nodes: [], edges: [] }) },
  { id: "single", name: "Single node", data: () => ({ nodes: [{ id: "only", caption: "Only node" }], edges: [] }) },
];
