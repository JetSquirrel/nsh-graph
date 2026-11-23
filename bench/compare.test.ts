/**
 * nsh-graph's layout next to other JS layout engines, all run inside NSH's QuickJS runtime on the same
 * datasets: time to a finished layout, and layout quality measured the same way for every engine.
 *
 * Engines that can't run here:
 * - Cytoscape.js does not load in NSH, whose sandbox freezes the built-in prototypes (cytoscape assigns
 *   `indexOf` on an object whose prototype chain has Array.prototype's).
 * - ngraph.forcelayout (VivaGraph, ngraph) builds its physics with `new Function`, which NSH refuses: it runs no
 *   code from strings outside development builds.
 * - AntV G6 needs a DOM, but its layouts are @antv/layout, which runs here: G6 5's `force` and `fruchterman`.
 *
 *   nsh test bench
 *
 * Quality, after scaling each layout so its mean edge length is 1 (so engines with different units compare):
 * - edge CV: the spread of edge lengths (std / mean); lower is more even.
 * - crowded: the share of node pairs closer than 0.3 × the mean edge length; lower means fewer piled-up nodes.
 * - crossings: edge crossings per edge (graphs up to 800 edges); lower is cleaner.
 */
import { describe, test } from "nsh/test";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, forceCenter } from "d3-force";
// graphology imports Node's `events`, which NSH does not provide: vendor/graphology.js is it bundled with
// the browser polyfill (`bun build vendor/graphology-entry.js --target=browser --format=esm`).
import { Graph, forceAtlas2 } from "./vendor/graphology.js";
import { ForceLayout, FruchtermanLayout } from "@antv/layout";
import { Layout as ColaLayout } from "webcola";
import { GraphEngine } from "../src/engine";
import { datasets } from "../example/datasets";

type Pos = { x: number; y: number }[];
type Edges = [number, number][];
interface Result { engine: string; ms: number; steps: number; pos: Pos; finished?: boolean }

/** Compute time an engine may use on one dataset before it is stopped and reported as unfinished. */
const BUDGET_MS = 120_000;

const yieldTurn = () => new Promise((r) => setTimeout(r, 0));

/**
 * Times work that has to be split across turns of the event loop (NSH stops a single call after 2 s):
 * `busy()` yields once the current slice has run 300 ms and counts only the time spent computing.
 */
function stopwatch() {
  let total = 0;
  let slice = Date.now();
  return {
    async busy() {
      if (Date.now() - slice < 300) return;
      total += Date.now() - slice;
      await yieldTurn();
      slice = Date.now();
    },
    ms: () => total + (Date.now() - slice),
  };
}

/** Index edges by node position, dropping those with a missing end and self loops. */
function load(id: string) {
  const data = datasets.find((d) => d.id === id)!.data();
  const index = new Map<string, number>();
  data.nodes.forEach((n) => index.has(n.id) || index.set(n.id, index.size));
  const edges: Edges = [];
  for (const e of data.edges) {
    const s = index.get(e.from);
    const t = index.get(e.to);
    if (s !== undefined && t !== undefined && s !== t) edges.push([s, t]);
  }
  return { data, n: index.size, edges, ids: [...index.keys()] };
}

// ---- Engines

async function runNshGraph(id: string): Promise<Result & { radii: number[] }> {
  const { data } = load(id);
  const clock = stopwatch();
  const engine = new GraphEngine();
  engine.setSize(1000, 700);
  engine.setData(data);
  let steps = 0;
  while (engine.sim.running && clock.ms() < BUDGET_MS) {
    engine.sim.tick();
    steps++;
    await clock.busy();
  }
  return { engine: "nsh-graph", finished: !engine.sim.running, ms: clock.ms(), steps, pos: engine.nodes.map((n) => ({ x: n.x, y: n.y })), radii: engine.nodes.map((n) => n.r) };
}

/** d3-force set up with the same forces and parameters as nsh-graph: a check of the implementation. */
async function runD3Same(id: string, radii: number[]): Promise<Result> {
  const { n, edges } = load(id);
  const clock = stopwatch();
  const nodes = Array.from({ length: n }, (_, i) => ({ index: i, r: radii[i] }) as any);
  const sim = forceSimulation(nodes)
    .force("link", forceLink(edges.map(([s, t]) => ({ source: s, target: t }))).distance((l: any) => 90 + (l.source.r + l.target.r) / 2))
    .force("charge", forceManyBody().strength(-320).theta(0.9))
    .force("collide", forceCollide((d: any) => d.r + 5).strength(0.7))
    .force("x", forceX(0).strength(0.04))
    .force("y", forceY(0).strength(0.04))
    .stop();
  let steps = 0;
  while (sim.alpha() >= sim.alphaMin() && clock.ms() < BUDGET_MS) {
    sim.tick();
    steps++;
    await clock.busy();
  }
  return { engine: "d3-force (same forces)", finished: sim.alpha() < sim.alphaMin(), ms: clock.ms(), steps, pos: nodes.map((d: any) => ({ x: d.x, y: d.y })) };
}

/** d3-force as most examples write it: link, many-body and center with d3's defaults. */
async function runD3Default(id: string): Promise<Result> {
  const { n, edges } = load(id);
  const clock = stopwatch();
  const nodes = Array.from({ length: n }, (_, i) => ({ index: i }) as any);
  const sim = forceSimulation(nodes)
    .force("link", forceLink(edges.map(([s, t]) => ({ source: s, target: t }))))
    .force("charge", forceManyBody())
    .force("center", forceCenter(0, 0))
    .stop();
  let steps = 0;
  while (sim.alpha() >= sim.alphaMin() && clock.ms() < BUDGET_MS) {
    sim.tick();
    steps++;
    await clock.busy();
  }
  return { engine: "d3-force (defaults)", finished: sim.alpha() < sim.alphaMin(), ms: clock.ms(), steps, pos: nodes.map((d: any) => ({ x: d.x, y: d.y })) };
}

/** ForceAtlas2 (graphology), Gephi's layout, with its inferred settings, 300 iterations. */
async function runFA2(id: string): Promise<Result> {
  const { n, edges } = load(id);
  const clock = stopwatch();
  const g = new Graph();
  let seed = 1;
  const rand = () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) g.addNode(`${i}`, { x: rand() * 1000, y: rand() * 1000 });
  for (const [s, t] of edges) if (!g.hasEdge(`${s}`, `${t}`) && !g.hasEdge(`${t}`, `${s}`)) g.addEdge(`${s}`, `${t}`);
  // inferSettings turns Barnes–Hut on only past 2000 nodes; without it an iteration is O(n²), which on 1500
  // nodes takes more than NSH allows one call. Large graphs get it on, as one would use FA2 there.
  const settings = { ...forceAtlas2.inferSettings(g), ...(n > 500 ? { barnesHutOptimize: true } : {}) };
  const total = 300;
  let done = 0;
  for (; done < total && clock.ms() < BUDGET_MS; done++) {
    forceAtlas2.assign(g, { iterations: 1, settings });
    await clock.busy();
  }
  return {
    engine: "ForceAtlas2 (graphology)",
    finished: done === total,
    ms: clock.ms(),
    steps: done,
    pos: Array.from({ length: n }, (_, i) => ({ x: g.getNodeAttribute(`${i}`, "x"), y: g.getNodeAttribute(`${i}`, "y") })),
  };
}

/**
 * A layout of @antv/layout, the engine of AntV G6 5, with G6's defaults on a 1000 × 700 canvas. Without a
 * `window` its simulation runs to the end in one call, which NSH stops after 2 s, so `execute` only sets it up
 * (no iterations) and the loop below ticks it until the simulation's own rule says it is done: `maxIteration`
 * steps, or a step that moves the nodes less than `minMovement`.
 */
async function runAntV(id: string, kind: "force" | "fruchterman"): Promise<Result> {
  const { n, edges, ids } = load(id);
  const clock = stopwatch();
  const Kind = kind === "force" ? ForceLayout : FruchtermanLayout;
  const defaults = kind === "force" ? { maxIteration: 500, minMovement: 0.4 } : { maxIteration: 1000, minMovement: 0 };
  const layout = new (Kind as any)({ width: 1000, height: 700, animate: false, maxIteration: 0 });
  await layout.execute({
    nodes: ids.map((nid) => ({ id: nid })),
    edges: edges.map(([s, t], i) => ({ id: `e${i}`, source: ids[s], target: ids[t] })),
  });
  const sim = layout.simulation;
  let steps = 0;
  const running = () => steps < defaults.maxIteration && (sim.judgingDistance > defaults.minMovement || steps < 1);
  while (running() && clock.ms() < BUDGET_MS) {
    layout.tick(1);
    steps++;
    await clock.busy();
  }
  const at = new Map<string, Pos[number]>();
  layout.forEachNode((node: any) => at.set(node.id, { x: node.x, y: node.y }));
  return {
    engine: kind === "force" ? "AntV force (G6 5)" : "AntV Fruchterman (G6 5)",
    finished: !running(),
    ms: clock.ms(),
    steps,
    pos: Array.from({ length: n }, (_, i) => at.get(ids[i])!),
  };
}

/**
 * WebCola, the constraint-based layout often used with d3: stress majorization on all-pairs shortest paths,
 * with its defaults (link length 20, convergence threshold 0.01). `start` only sets it up; the loop ticks it
 * until it converges, as `start` would in one call.
 */
const COLA_MAX_NODES = 1000;

async function runCola(id: string): Promise<Result> {
  const { n, edges } = load(id);
  const clock = stopwatch();
  let seed = 1;
  const rand = () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296);
  const nodes = Array.from({ length: n }, () => ({ x: rand() * 1000, y: rand() * 700 }) as any);
  const layout: any = new ColaLayout().size([1000, 700]).nodes(nodes).links(edges.map(([s, t]) => ({ source: s, target: t })));
  layout.start(0, 0, 0, 0, false);
  await clock.busy();
  // What `resume()` does, without its run to convergence in one call.
  layout._alpha = 0.1;
  layout._running = true;
  let steps = 0;
  let converged = false;
  while (!converged && clock.ms() < BUDGET_MS) {
    converged = layout.tick();
    if (!converged) steps++;
    await clock.busy();
  }
  return { engine: "WebCola", finished: converged, ms: clock.ms(), steps, pos: nodes.map((d: any) => ({ x: d.x, y: d.y })) };
}

// ---- Quality

async function quality(pos: Pos, edges: Edges) {
  const lengths = edges.map(([s, t]) => Math.hypot(pos[s].x - pos[t].x, pos[s].y - pos[t].y));
  const mean = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
  const sd = Math.sqrt(lengths.reduce((a, l) => a + (l - mean) ** 2, 0) / Math.max(1, lengths.length));
  const p = pos.map((q) => ({ x: q.x / mean, y: q.y / mean }));
  let close = 0;
  let pairs = 0;
  for (let i = 0; i < p.length; i++) {
    for (let j = i + 1; j < p.length; j++) {
      pairs++;
      if (Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y) < 0.3) close++;
    }
    if (i % 200 === 0) await yieldTurn();
  }
  let crossings: number | null = null;
  if (edges.length <= 800) {
    crossings = 0;
    const cross = (a: number, b: number, c: number, d: number) => {
      if (a === c || a === d || b === c || b === d) return false; // edges sharing a node do not cross
      const o = (p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }) =>
        Math.sign((p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x));
      return o(p[a], p[b], p[c]) !== o(p[a], p[b], p[d]) && o(p[c], p[d], p[a]) !== o(p[c], p[d], p[b]);
    };
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) if (cross(edges[i][0], edges[i][1], edges[j][0], edges[j][1])) crossings++;
      if (i % 100 === 0) await yieldTurn();
    }
  }
  return { edgeCV: sd / mean, crowded: close / Math.max(1, pairs), crossingsPerEdge: crossings === null ? null : crossings / edges.length };
}

const rows: string[] = [];

describe("layout engines on QuickJS", () => {
  for (const id of ["karate", "miserables", "flare-deps", "scale-free"]) {
    test(id, async () => {
      const { edges } = load(id);
      const ours = await runNshGraph(id);
      const results: Result[] = [
        ours,
        await runD3Same(id, ours.radii),
        await runD3Default(id),
        await runFA2(id),
        await runAntV(id, "force"),
        await runAntV(id, "fruchterman"),
      ];
      // WebCola's setup (all-pairs shortest paths) is one call that can't be split. On the 1500-node graph it runs
      // past NSH's 2 s limit and NSH interrupts the test, so there it is reported as unable to run.
      const colaRuns = load(id).n <= COLA_MAX_NODES;
      if (colaRuns) results.push(await runCola(id));
      for (const r of results) {
        const q = await quality(r.pos, edges);
        const row = (
          [
            id.padEnd(11),
            r.engine.padEnd(25),
            `${r.ms} ms`.padStart(9),
            `${r.steps}`.padStart(5),
            q.edgeCV.toFixed(2).padStart(6),
            (q.crowded * 100).toFixed(2).padStart(6) + "%",
            q.crossingsPerEdge === null ? "     -" : q.crossingsPerEdge.toFixed(2).padStart(6),
            r.finished === false ? "stopped at budget" : "",
          ].join(" | ")
        );
        rows.push(row);
        console.log(row);
      }
      if (!colaRuns) {
        const row = [id.padEnd(11), "WebCola".padEnd(25), "can't run: its setup is one call past NSH's 2 s limit"].join(" | ");
        rows.push(row);
        console.log(row);
      }
    }, 1_800_000);
  }

  test("table", () => {
    console.log(["dataset    ", "engine                   ", "     time", "steps", "edgeCV", "crowded", "x/edge"].join(" | "));
    for (const r of rows) console.log(r);
  });
});
