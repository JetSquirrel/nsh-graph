/**
 * The TypeScript layout next to the Rust one (`native/`, `nsh-graph/native`), in NSH's own runtime:
 * cost per tick, time until the layout settles, and the layouts' quality, which should match.
 *
 *   nsh test perf
 */
import { OffscreenCanvas, Path2D } from "nsh";
import { describe, expect, test } from "nsh/test";
import * as native from "nsh-graph/native";
import { GraphEngine } from "../src/engine";
import { setNativeBackend, type NativeBackend } from "../src/native";
import { OTHER, PALETTE_LIGHT } from "../src/palette";
import { renderGraph, type Ctx2D, type RenderTheme } from "../src/render";
import type { GraphData } from "../src/types";
import { datasets } from "../example/datasets";
import { scaleFree } from "./graphs";

const backend = native as unknown as NativeBackend;

function engineFor(data: GraphData, rust: boolean) {
  setNativeBackend(rust ? backend : null);
  const engine = new GraphEngine({ layout: "force", reduceMotion: true });
  setNativeBackend(null);
  engine.setSize(1000, 700);
  engine.setData(data);
  return engine;
}

// NSH stops a call into JS after 2 s, and microtasks (an `await` that does not wait) count as the same
// call: only a timer gives the host its turn. So the steps below yield to one every 100 ms.
let lastYield = Date.now();
async function breathe() {
  if (Date.now() - lastYield < 100) return;
  await new Promise((r) => setTimeout(r, 0));
  lastYield = Date.now();
}
const yieldTurn = async () => {
  await new Promise((r) => setTimeout(r, 0));
  lastYield = Date.now();
};

/** Runs `step` `n` times and returns the mean ms of one, counting only the steps. */
async function timed(n: number, step: () => void) {
  let total = 0;
  for (let i = 0; i < n; i++) {
    await breathe();
    const t0 = Date.now();
    step();
    total += Date.now() - t0;
  }
  return total / n;
}

/** Ticks until the layout settles (or `budgetMs` of ticking), counting only the time spent ticking. */
async function settle(engine: GraphEngine, budgetMs = 60_000) {
  let ms = 0;
  let ticks = 0;
  while (engine.sim.running && ms < budgetMs) {
    ms += await timed(1, () => engine.sim.tick());
    ticks++;
  }
  return { ms, ticks, done: !engine.sim.running };
}

/** Edge-length spread (std / mean) and the share of node pairs closer than 0.3 × the mean edge length. */
function quality(engine: GraphEngine) {
  const lengths = engine.edges.filter((e) => !e.self).map((e) => {
    const a = engine.nodes[e.source];
    const b = engine.nodes[e.target];
    return Math.hypot(a.x - b.x, a.y - b.y);
  });
  const mean = lengths.reduce((s, l) => s + l, 0) / Math.max(1, lengths.length);
  const sd = Math.sqrt(lengths.reduce((s, l) => s + (l - mean) ** 2, 0) / Math.max(1, lengths.length));
  const near = mean * 0.3;
  let crowded = 0;
  let pairs = 0;
  const ns = engine.nodes;
  for (let i = 0; i < ns.length; i++)
    for (let j = i + 1; j < ns.length; j += ns.length > 600 ? 7 : 1) {
      pairs++;
      if (Math.hypot(ns[i].x - ns[j].x, ns[i].y - ns[j].y) < near) crowded++;
    }
  return { cv: sd / mean, crowded: crowded / Math.max(1, pairs) };
}

const ids = ["karate", "miserables", "flare-deps", "star", "scale-free"];
const rows: string[] = [];


const THEME: RenderTheme = {
  background: "#ffffff", text: "#111111", surface: "#ffffff", edge: "#99999988", edgeHighlight: "#111111",
  edgeText: "#666666", selection: "#2563eb", palette: PALETTE_LIGHT, other: OTHER, fontFamily: "system-ui",
};
const PATHS = { path: (d: string) => new Path2D(d) };

/** Mean ms of a frame drawn into a real canvas context, the TypeScript way or with the Rust painter. */
async function drawMs(engine: GraphEngine, rust: boolean, frames = 10) {
  const canvas = new OffscreenCanvas(1000, 700);
  const cx = canvas.getContext("2d") as unknown as Ctx2D;
  engine.fit(false);
  const draw = () => renderGraph(cx, engine, THEME, 1000, 700, rust ? PATHS : undefined);
  draw(); // warm up
  await yieldTurn();
  return timed(frames, draw);
}

describe("drawing", () => {
  test("the painter's paths are what the TypeScript would draw", () => {
    setNativeBackend(backend);
    const engine = new GraphEngine({ layout: "grid", reduceMotion: true });
    setNativeBackend(null);
    engine.setSize(400, 400);
    engine.setData({ nodes: [{ id: "a", size: 20 }, { id: "b", size: 20 }], edges: [{ from: "a", to: "b" }] });
    const painter = engine.painter!;
    const [a, b] = engine.nodes;
    painter.setNodes(new Uint8Array(new Float64Array([a.x, a.y, a.r, b.x, b.y, b.r]).buffer));
    const view = [-1e6, -1e6, 1e6, 1e6];
    const [circles] = painter.traceNodes(new Uint8Array(new Uint32Array([0, 0]).buffer), 1, view);
    const cx = new OffscreenCanvas(10, 10).getContext("2d")!;
    const path = new Path2D(circles);
    // Both circles parsed (arcs included): their centers and points just inside are in, points just outside out.
    for (const n of [a, b]) {
      expect(cx.isPointInPath(path, n.x, n.y)).toBe(true);
      expect(cx.isPointInPath(path, n.x + n.r * 0.95, n.y)).toBe(true);
      expect(cx.isPointInPath(path, n.x, n.y - n.r * 0.95)).toBe(true);
      expect(cx.isPointInPath(path, n.x + n.r * 1.05, n.y)).toBe(false);
    }
    expect(cx.isPointInPath(path, (a.x + b.x) / 2, (a.y + b.y) / 2)).toBe(false);
    // The edge runs between the circles, along the line joining the centers.
    const [, , lines] = painter.traceEdges(new Uint8Array([1]), [...view, 0, 0]);
    const edge = new Path2D(lines);
    cx.lineWidth = 2;
    expect(cx.isPointInStroke(edge, (a.x + b.x) / 2, (a.y + b.y) / 2)).toBe(true);
    expect(cx.isPointInStroke(edge, a.x, a.y)).toBe(false);
  });

  for (const [name, data] of [["scale-free 1500", () => datasets.find((d) => d.id === "scale-free")!.data()], ["scale-free 5000", () => scaleFree(5000, 2)]] as const) {
    test(name, async () => {
      const ts = engineFor(data(), false);
      await yieldTurn();
      const rs = engineFor(data(), true);
      await yieldTurn();
      await settle(rs);
      // The same positions in both, so they draw the same picture.
      rs.nodes.forEach((n, i) => {
        ts.nodes[i].x = n.x;
        ts.nodes[i].y = n.y;
      });
      ts.geometryVersion++;
      const a = await drawMs(ts, false, 5);
      const b = await drawMs(rs, true, 5);
      rows.push(`draw ${name.padEnd(16)} ${a.toFixed(1).padStart(6)} → ${b.toFixed(1).padStart(5)} ms per frame`);
      expect(b).toBeLessThan(a);
    }, 180_000);
  }

  test("tick, 5000 nodes", async () => {
    const data = scaleFree(5000, 2);
    const ts = engineFor(data, false);
    await yieldTurn();
    const rs = engineFor(data, true);
    await yieldTurn();
    const a = await timed(3, () => ts.sim.tick());
    const b = await timed(10, () => rs.sim.tick());
    const settled = await settle(rs);
    rows.push(`tick scale-free 5000  ${a.toFixed(1).padStart(6)} → ${b.toFixed(1).padStart(5)} ms   Rust settles in ${(settled.ms / 1000).toFixed(1)} s`);
    expect(settled.done).toBe(true);
  }, 180_000);
});

describe("TypeScript and Rust layouts", () => {
  for (const id of ids) {
    test(id, async () => {
      const data = datasets.find((d) => d.id === id)!.data();
      const ts = engineFor(data, false);
      await yieldTurn();
      const rs = engineFor(data, true);
      await yieldTurn();
      expect(ts.sim.isNative).toBe(false);
      expect(rs.sim.isNative).toBe(true);

      // Cost of one tick, early in the layout (when it is hottest).
      const tsTick = await timed(10, () => ts.sim.tick());
      const rsTick = await timed(10, () => rs.sim.tick());
      const a = await settle(ts);
      const b = await settle(rs);
      for (const n of rs.nodes) if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) throw new Error(`${n.id} at ${n.x},${n.y}`);
      const qa = quality(ts);
      const qb = quality(rs);
      rows.push(
        `${id.padEnd(11)} ${String(rs.nodes.length).padStart(5)} nodes  tick ${tsTick.toFixed(1).padStart(6)} → ${rsTick.toFixed(2).padStart(5)} ms` +
          `   settle ${(a.ms / 1000).toFixed(1).padStart(5)} → ${(b.ms / 1000).toFixed(2).padStart(5)} s` +
          `   edge CV ${qa.cv.toFixed(2)} / ${qb.cv.toFixed(2)}   crowded ${(qa.crowded * 100).toFixed(2)}% / ${(qb.crowded * 100).toFixed(2)}%`,
      );
      expect(b.done).toBe(true);
      // The Rust layout is at least as good: Rust keeps theta where the TypeScript coarsens it.
      expect(qb.cv).toBeLessThan(qa.cv * 1.25 + 0.05);
      expect(qb.crowded).toBeLessThan(qa.crowded * 1.5 + 0.005);
      if (rs.nodes.length >= 200) expect(rsTick).toBeLessThan(tsTick);
    }, 180_000);
  }

  test("table", () => {
    console.log("\n" + rows.join("\n"));
  });
});
