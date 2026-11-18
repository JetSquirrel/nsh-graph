import { describe, expect, test } from "nsh/test";
import { GraphEngine } from "../src/engine";
import { renderGraph, type Ctx2D, type RenderTheme } from "../src/render";
import { PALETTE_LIGHT, OTHER } from "../src/palette";
import type { LayoutKind } from "../src/types";
import { datasets } from "./datasets";

const THEME: RenderTheme = {
  background: "#ffffff", text: "#111111", surface: "#ffffff", edge: "#99999988", edgeHighlight: "#111111",
  edgeText: "#666666", selection: "#2563eb", palette: PALETTE_LIGHT, other: OTHER, fontFamily: "system-ui",
};

/** A context that records calls and flags any non-finite number it is given. */
function recorder() {
  const bad: string[] = [];
  let ops = 0;
  const check = (name: string, args: unknown[]) => {
    ops++;
    for (const a of args) if (typeof a === "number" && !Number.isFinite(a)) bad.push(`${name}(${args.join(", ")})`);
  };
  const props: Record<string, unknown> = {};
  const ctx = new Proxy({} as Ctx2D, {
    get(_, key: string) {
      if (key === "measureText") return (t: string) => ({ width: t.length * 6 });
      if (key in props) return props[key];
      return (...args: unknown[]) => check(key, args);
    },
    set(_, key: string, value) {
      check(`${key}=`, [value]);
      props[key] = value;
      return true;
    },
  });
  return { ctx, bad, ops: () => ops };
}

/** Settles the way the frame loop does: one tick per turn of the event loop. */
async function settleAsync(engine: GraphEngine, maxFrames = 1000) {
  let t = 0;
  let frames = 0;
  while (frames < maxFrames && engine.step((t += 16))) {
    frames++;
    if (frames % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return frames;
}

const layouts: LayoutKind[] = ["force", "hierarchical", "circular", "grid"];

describe("every dataset in every layout", () => {
  for (const ds of datasets) {
    for (const layout of layouts) {
      if (ds.id === "scale-free" && layout === "force") continue; // the perf test settles it
      test(`${ds.id} / ${layout}`, async () => {
        const engine = new GraphEngine({ layout, groupHulls: true, edgeLabels: true, labelMode: "auto" });
        engine.setSize(1000, 700);
        engine.setData(ds.data());
        await settleAsync(engine);
        for (const n of engine.nodes) {
          if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) throw new Error(`${n.id} at ${n.x},${n.y}`);
          if (!(n.r > 0)) throw new Error(`${n.id} radius ${n.r}`);
        }
        expect(Number.isFinite(engine.k) && engine.k > 0).toBe(true);
        expect(Number.isFinite(engine.tx) && Number.isFinite(engine.ty)).toBe(true);
        const rec = recorder();
        renderGraph(rec.ctx, engine, THEME, 1000, 700);
        expect(rec.bad.slice(0, 5)).toEqual([]);
        expect(engine.animating).toBe(false);
        // Every node is on screen after the layout settles (the view fits it).
        for (const n of engine.nodes) {
          const p = engine.graphToScreen(n.x, n.y);
          if (p.x < -1 || p.y < -1 || p.x > 1001 || p.y > 701) throw new Error(`${n.id} off screen at ${p.x},${p.y}`);
        }
      }, 120000);
    }
  }
});

/** A context with plain methods, close to what a real one costs on the JS side. */
function plainCtx(): { ctx: Ctx2D; ops: () => number } {
  let ops = 0;
  const f = () => { ops++; };
  const ctx = {
    save: f, restore: f, translate: f, scale: f, rotate: f, beginPath: f, moveTo: f, lineTo: f, quadraticCurveTo: f,
    bezierCurveTo: f, arc: f, closePath: f, fill: f, stroke: f, fillRect: f, fillText: f, strokeText: f,
    measureText: (t: string) => ({ width: t.length * 6 }),
    fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "butt", lineJoin: "miter", globalAlpha: 1, font: "",
    textAlign: "start", textBaseline: "alphabetic",
  } as Ctx2D;
  return { ctx, ops: () => ops };
}

describe("performance (QuickJS)", () => {
  for (const id of ["karate", "miserables", "flare-deps", "star", "scale-free"]) {
    test(`${id}: tick and draw cost`, async () => {
      const ds = datasets.find((d) => d.id === id)!;
      const engine = new GraphEngine({ layout: "force" });
      engine.setSize(1000, 700);
      let t0 = Date.now();
      engine.setData(ds.data());
      const load = Date.now() - t0;
      t0 = Date.now();
      for (let i = 0; i < 10; i++) engine.sim.tick();
      const tick = (Date.now() - t0) / 10;
      const c = plainCtx();
      t0 = Date.now();
      for (let i = 0; i < 5; i++) {
        engine.geometryVersion++;
        renderGraph(c.ctx, engine, THEME, 1000, 700);
      }
      const draw = (Date.now() - t0) / 5;
      t0 = Date.now();
      const frames = await settleAsync(engine);
      const settleMs = Date.now() - t0;
      console.log(
        `${id}: ${engine.nodes.length} nodes / ${engine.edges.length} edges · load ${load} ms · tick ${tick.toFixed(1)} ms · draw ${draw.toFixed(1)} ms (${c.ops() / 5} ops) · settles in ${frames} frames (${settleMs} ms)`,
      );
      expect(frames).toBeLessThan(600);
    }, 300000);
  }
});
