import { describe, expect, test } from "nsh/test";
import { GraphEngine, mergeGraphData } from "../src/engine";
import { convexHull, edgeShape, roundedHullPath } from "../src/geometry";
import { hierarchicalLayout, circularLayout, gridLayout } from "../src/layouts";
import { OTHER, PALETTE_LIGHT, inkOn } from "../src/palette";
import { ForceSimulation } from "../src/simulation";
import type { GraphData } from "../src/types";

function chain(n: number): GraphData {
  return {
    nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, category: i % 2 ? "B" : "A" })),
    edges: Array.from({ length: n - 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })),
  };
}

function settle(engine: GraphEngine) {
  let t = 0;
  for (let i = 0; i < 2000 && engine.step((t += 16)); i++);
}

function sized(options = {}) {
  const engine = new GraphEngine({ reduceMotion: true, ...options });
  engine.setSize(800, 600);
  return engine;
}

describe("simulation", () => {
  test("cools down and stops", () => {
    const sim = new ForceSimulation();
    const nodes = Array.from({ length: 30 }, (_, i) => ({ x: i, y: i % 5, vx: 0, vy: 0, fx: null, fy: null, r: 10, group: null }));
    sim.setGraph(nodes, nodes.slice(1).map((_, i) => ({ source: i, target: i + 1 })));
    let ticks = 0;
    while (sim.running && ticks < 1000) {
      sim.tick();
      ticks++;
    }
    expect(sim.running).toBe(false);
    expect(ticks).toBeLessThan(400);
  });

  test("keeps nodes apart and linked nodes closer than unlinked ones", () => {
    const engine = sized();
    engine.setData(chain(25));
    settle(engine);
    const nodes = engine.nodes;
    let minGap = Infinity;
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
        minGap = Math.min(minGap, d - nodes[i].r - nodes[j].r);
      }
    expect(minGap).toBeGreaterThan(0);
    const linked = engine.edges.map((e) => Math.hypot(nodes[e.source].x - nodes[e.target].x, nodes[e.source].y - nodes[e.target].y));
    const meanLinked = linked.reduce((a, b) => a + b, 0) / linked.length;
    const far = Math.hypot(nodes[0].x - nodes[24].x, nodes[0].y - nodes[24].y);
    expect(meanLinked).toBeLessThan(far);
  });

  test("pinned nodes do not move", () => {
    const engine = sized();
    const data = chain(6);
    data.nodes[2] = { ...data.nodes[2], pinned: true, x: 300, y: -200 };
    engine.setData(data);
    settle(engine);
    expect(engine.position("n2")).toEqual({ x: 300, y: -200 });
    expect(engine.isPinned("n2")).toBe(true);
  });
});

describe("data", () => {
  test("keeps positions by id and places new nodes next to a neighbor", () => {
    const engine = sized();
    engine.setData(chain(5));
    settle(engine);
    const before = engine.position("n4")!;
    engine.setData(mergeGraphData(chain(5), { nodes: [{ id: "x" }], edges: [{ from: "n4", to: "x" }] }));
    expect(engine.position("n4")).toEqual(before);
    const x = engine.position("x")!;
    expect(Math.hypot(x.x - before.x, x.y - before.y)).toBeLessThan(200);
  });

  test("drops edges whose ends are missing and numbers parallel edges", () => {
    const engine = sized();
    engine.setData({
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [
        { from: "a", to: "b" },
        { from: "a", to: "b" },
        { from: "b", to: "a" },
        { from: "a", to: "a" },
        { from: "a", to: "ghost" },
      ],
    });
    expect(engine.edges.length).toBe(4);
    const bends = engine.edges.filter((e) => !e.self).map((e) => e.bend);
    // Three parallel edges spread symmetrically: offsets -s, 0, +s (the reversed one flipped back).
    expect(bends.map((b) => Math.abs(b)).sort((x, y) => x - y)).toEqual([0, 22, 22]);
    expect(new Set(engine.edges.map((e) => e.id)).size).toBe(4);
    expect(engine.edges.filter((e) => e.self).length).toBe(1);
    expect(engine.degree("a")).toBe(4);
  });

  test("keeps the selection while its node exists and clears it after", () => {
    const engine = sized();
    const events: string[] = [];
    engine.onEvent = (e) => e.type === "selection" && events.push(e.selection?.kind ?? "none");
    engine.setData(chain(3));
    engine.setSelected({ kind: "node", id: "n1" });
    engine.setData(chain(3));
    expect(engine.selection()?.kind).toBe("node");
    engine.setData({ nodes: [{ id: "n0" }], edges: [] });
    expect(engine.selection()).toBeNull();
    expect(events).toEqual(["node", "none"]);
  });

  test("mergeGraphData merges by id", () => {
    const merged = mergeGraphData(
      { nodes: [{ id: "a", caption: "A" }], edges: [{ id: "e", from: "a", to: "a" }] },
      { nodes: [{ id: "a", category: "X" }, { id: "b" }], edges: [{ id: "e", from: "a", to: "b" }] },
    );
    expect(merged.nodes).toEqual([{ id: "a", caption: "A", category: "X" }, { id: "b" }]);
    expect(merged.edges).toEqual([{ id: "e", from: "a", to: "b" }]);
  });
});

describe("viewport and hits", () => {
  test("zoomAt keeps the point under the pointer still", () => {
    const engine = sized();
    engine.setData(chain(4));
    const before = engine.screenToGraph(123, 456);
    engine.zoomAt(1.7, 123, 456);
    const after = engine.screenToGraph(123, 456);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-9);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1e-9);
    expect(engine.autoFit).toBe(false);
  });

  test("fit puts every node on screen", () => {
    const engine = sized();
    engine.setData(chain(30));
    settle(engine);
    engine.panBy(5000, 5000);
    engine.fit(false);
    for (const n of engine.nodes) {
      const p = engine.graphToScreen(n.x, n.y);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(800);
      expect(p.y).toBeLessThanOrEqual(600);
    }
  });

  test("hit tests nodes, edges and the background", () => {
    const engine = sized({ layout: "grid" });
    engine.setData({ nodes: [{ id: "a", size: 10, x: 0, y: 0 }, { id: "b", size: 10 }], edges: [{ from: "a", to: "b", caption: "R" }] });
    const a = engine.position("a")!;
    const b = engine.position("b")!;
    const sa = engine.graphToScreen(a.x, a.y);
    const mid = engine.graphToScreen((a.x + b.x) / 2, (a.y + b.y) / 2);
    expect(engine.hitTest(sa.x, sa.y)).toMatchObject({ kind: "node", node: { id: "a" } });
    expect(engine.hitTest(mid.x, mid.y)).toMatchObject({ kind: "edge", edge: { caption: "R" } });
    expect(engine.hitTest(mid.x, mid.y + 200)).toEqual({ kind: "background" });
  });

  test("dragging pins only with stickyDrag", () => {
    const engine = sized();
    engine.setData(chain(3));
    engine.dragStart(1);
    engine.dragMove(10, 10);
    engine.dragEnd();
    expect(engine.isPinned("n1")).toBe(false);
    engine.setOptions({ stickyDrag: true });
    engine.dragStart(1);
    engine.dragMove(20, 20);
    engine.dragEnd();
    expect(engine.isPinned("n1")).toBe(true);
    expect(engine.position("n1")).toEqual(engine.screenToGraph(20, 20));
  });

  test("arrow keys walk to the nearest node in that direction", () => {
    const engine = sized({ layout: "grid" });
    engine.setData({ nodes: ["a", "b", "c", "d"].map((id) => ({ id })), edges: [] });
    // Grid of 2x2: a b / c d
    engine.setSelected({ kind: "node", id: "a" });
    expect(engine.nearestInDirection(1, 0)?.id).toBe("b");
    expect(engine.nearestInDirection(0, 1)?.id).toBe("c");
    expect(engine.nearestInDirection(-1, 0)).toBeNull();
  });
});

describe("layouts", () => {
  const nodes = (n: number) => Array.from({ length: n }, () => ({ r: 10, category: "", group: null, degree: 1 }));

  test("hierarchical puts every edge of a DAG pointing down", () => {
    const edges = [
      { source: 0, target: 1 }, { source: 0, target: 2 }, { source: 1, target: 3 },
      { source: 2, target: 3 }, { source: 3, target: 4 }, { source: 5, target: 4 },
    ];
    const p = hierarchicalLayout(nodes(6), edges);
    for (const e of edges) expect(p[e.target].y).toBeGreaterThan(p[e.source].y);
  });

  test("hierarchical survives cycles and directions", () => {
    const edges = [{ source: 0, target: 1 }, { source: 1, target: 2 }, { source: 2, target: 0 }];
    const p = hierarchicalLayout(nodes(3), edges, { direction: "right" });
    expect(p.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))).toBe(true);
    expect(new Set(p.map((q) => q.x)).size).toBe(3);
  });

  test("circular and grid place nodes apart", () => {
    for (const p of [circularLayout(nodes(12)), gridLayout(nodes(12))]) {
      for (let i = 0; i < p.length; i++)
        for (let j = i + 1; j < p.length; j++) expect(Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y)).toBeGreaterThan(20);
    }
  });
});

describe("colors and geometry", () => {
  test("categories keep their colors; the ninth shares the neutral one", () => {
    const engine = sized();
    const data = (cats: string[]) => ({ nodes: cats.map((c, i) => ({ id: `${i}`, category: c })), edges: [] });
    engine.setData(data(["A", "B", "C"]));
    const before = engine.legend(PALETTE_LIGHT);
    engine.setData(data(["C"]));
    expect(engine.legend(PALETTE_LIGHT)[0]).toMatchObject({ key: "C", color: before[2].color });
    engine.setData(data(["A", "B", "C", "D", "E", "F", "G", "H", "I"]));
    const legend = engine.legend(PALETTE_LIGHT);
    expect(legend.find((e) => e.key === "I")?.color).toBe(OTHER);
    expect(new Set(legend.slice(0, 8).map((e) => e.color)).size).toBe(8);
  });

  test("nodes without a category or group share the neutral color", () => {
    const engine = sized({ colorBy: "group" });
    engine.setData({ nodes: [{ id: "a", group: "g1" }, { id: "b" }, { id: "c", group: "g2" }], edges: [] });
    const legend = engine.legend(PALETTE_LIGHT);
    expect(legend.map((e) => [e.key, e.color])).toEqual([["g1", PALETTE_LIGHT[0]], ["g2", PALETTE_LIGHT[1]], ["", OTHER]]);
  });

  test("captions inside nodes are white except on yellow", () => {
    expect(PALETTE_LIGHT.map(inkOn)).toEqual(PALETTE_LIGHT.map((c) => (c === "#eda100" ? "#0b0b0b" : "#ffffff")));
  });

  test("edge shapes end on the node circles", () => {
    const s = edgeShape({ x: 0, y: 0 }, 10, { x: 100, y: 0 }, 20, 0, false);
    expect(s.a).toEqual({ x: 10, y: 0 });
    expect(s.b).toEqual({ x: 80, y: 0 });
    const curved = edgeShape({ x: 0, y: 0 }, 10, { x: 100, y: 0 }, 10, 20, false);
    expect(Math.abs(curved.mid.y)).toBeGreaterThan(15);
  });

  test("hulls are convex and their outline closes", () => {
    const hull = convexHull([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }, { x: 0, y: 10 }]);
    expect(hull.length).toBe(4);
    const calls: string[] = [];
    roundedHullPath({ moveTo: () => calls.push("m"), arc: () => calls.push("a"), closePath: () => calls.push("z") }, hull, 8);
    expect(calls).toEqual(["m", "a", "a", "a", "a", "z"]);
  });
});
