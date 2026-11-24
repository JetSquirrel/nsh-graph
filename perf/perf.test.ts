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


/**
 * The backend as it was before the layout kept its state: the same Rust, without `run`, so the
 * simulation copies every node's state both ways each tick. What the kept path is checked against.
 */
const legacy = {
  ForceLayout: function () {
    const l = new backend.ForceLayout();
    return { setConfig: (v: number[]) => l.setConfig(v), setGraph: (n: number, a: Uint8Array, b: Uint8Array) => l.setGraph(n, a, b), tick: (s: Uint8Array, i: number, a: number, t: number) => l.tick(s, i, a, t) };
  } as unknown as NativeBackend["ForceLayout"],
  GraphPainter: backend.GraphPainter,
} as NativeBackend;

function engineWith(native: NativeBackend, data: GraphData) {
  setNativeBackend(native);
  // Animated (not reduced motion), so each `step` is exactly one tick in both.
  const engine = new GraphEngine({ layout: "force", reduceMotion: false });
  setNativeBackend(null);
  engine.setSize(1000, 700);
  engine.setData(data);
  return engine;
}

describe("the Rust layout keeping its state", () => {
  test("gives what copying the state every tick gives, through drags, pins, sizing, layouts, data and groups", async () => {
    const data = datasets.find((d) => d.id === "miserables")!.data();
    const kept = engineWith(backend, data);
    const old = engineWith(legacy, data);
    expect(typeof (kept.sim as unknown as { kept: boolean }).kept).toBe("boolean");
    expect((kept.sim as unknown as { kept: boolean }).kept).toBe(true);
    expect((old.sim as unknown as { kept: boolean }).kept).toBe(false);
    let time = 0;
    const both = (f: (e: GraphEngine) => void) => {
      f(kept);
      f(old);
    };
    const frames = (n: number) => {
      for (let i = 0; i < n; i++) {
        time += 16;
        both((e) => e.step(time));
      }
    };
    const view = [-1e6, -1e6, 1e6, 1e6];
    const check = (phase: string) => {
      kept.nodes.forEach((n, i) => {
        const m = old.nodes[i];
        if (n.x !== m.x || n.y !== m.y || n.fx !== m.fx || n.fy !== m.fy) {
          throw new Error(`${phase}: node ${n.id} at ${n.x},${n.y} (pin ${n.fx},${n.fy}), not ${m.x},${m.y} (pin ${m.fx},${m.fy})`);
        }
      });
      expect(kept.sim.alpha).toBe(old.sim.alpha);
      // The painter draws the same circles, though the kept one got its positions straight from the tick.
      const keys = new Uint8Array(new Uint32Array(kept.nodes.length).buffer);
      both((e) => e.paintPositions(e.painter!));
      expect(kept.painter!.traceNodes(keys, 1, view)).toEqual(old.painter!.traceNodes(keys, 1, view));
    };
    frames(20);
    check("settling");
    expect(kept.sim.positions).not.toBeNull(); // the fast path was taken

    // Drag one of two selected nodes: both move, pinned while dragged.
    both((e) => e.selectNodes([e.nodes[3].id, e.nodes[7].id]));
    both((e) => e.dragStart(3));
    for (let i = 0; i < 5; i++) {
      both((e) => e.dragMove(400 + i * 12, 300 - i * 7));
      frames(1);
    }
    check("dragging");
    both((e) => e.dragEnd());
    frames(10);
    check("after the drag");

    both((e) => e.setPinned(e.nodes[11].id, true));
    frames(5);
    both((e) => e.setPinned(e.nodes[11].id, false));
    frames(5);
    both((e) => e.unpinAll());
    frames(5);
    check("pins");

    both((e) => e.setOptions({ nodeSizing: { kind: "fixed", radius: 12 } }));
    frames(10);
    check("sizing");

    both((e) => e.setOptions({ layout: "circular" }));
    frames(10); // part of the tween
    both((e) => e.setOptions({ layout: "force" }));
    frames(15);
    check("layouts");

    const more = { nodes: [...data.nodes, { id: "new-1", group: "1" }, { id: "new-2" }], edges: [...data.edges, { from: "new-1", to: data.nodes[0].id }, { from: "new-2", to: "new-1" }] };
    both((e) => e.setData(more));
    frames(10);
    check("data");

    const group = kept.groups()[1].id;
    both((e) => e.setGroupsCollapsed([group], true));
    frames(10);
    both((e) => e.setGroupsCollapsed([group], false));
    frames(10);
    check("groups");
  }, 120_000);

  test("cost, 5000 nodes: copying every tick against keeping the state", async () => {
    const data = scaleFree(5000, 2);
    const kept = engineWith(backend, data);
    await yieldTurn();
    const old = engineWith(legacy, data);
    await yieldTurn();
    // Alternate, so both see the same machine (other processes, the scanner), and keep the best of 5 rounds.
    const frame = (e: GraphEngine) => () => {
      e.sim.tick();
      e.geometryVersion++;
      e.paintPositions(e.painter!);
    };
    let bestOld = Infinity, bestKept = Infinity, tickOld = Infinity, tickKept = Infinity;
    for (let round = 0; round < 5; round++) {
      tickOld = Math.min(tickOld, await timed(4, () => old.sim.tick()));
      tickKept = Math.min(tickKept, await timed(4, () => kept.sim.tick()));
      bestOld = Math.min(bestOld, await timed(4, frame(old)));
      bestKept = Math.min(bestKept, await timed(4, frame(kept)));
    }
    rows.push(
      `kept state, 5000     tick ${tickOld.toFixed(1).padStart(5)} → ${tickKept.toFixed(1).padStart(5)} ms` +
        `   tick + painter positions ${bestOld.toFixed(1).padStart(5)} → ${bestKept.toFixed(1).padStart(5)} ms`,
    );
    expect(tickKept).toBeLessThan(tickOld);
    expect(bestKept).toBeLessThan(bestOld);
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
