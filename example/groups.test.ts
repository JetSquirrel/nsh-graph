// Collapsing groups (communities) into super nodes.
import { describe, expect, test } from "nsh/test";
import { GraphEngine, type EngineEvent } from "../src/engine";
import { OTHER, PALETTE_LIGHT } from "../src/palette";
import { renderGraph, type Ctx2D, type RenderTheme } from "../src/render";
import type { GraphData } from "../src/types";

const THEME: RenderTheme = {
  background: null, text: "#111111", surface: "#ffffff", edge: "#999999", edgeHighlight: "#111111",
  edgeText: "#666666", selection: "#2563eb", palette: PALETTE_LIGHT, other: OTHER, fontFamily: "system-ui",
};

function sized(options = {}) {
  const engine = new GraphEngine({ reduceMotion: true, ...options });
  engine.setSize(800, 600);
  return engine;
}

function settle(engine: GraphEngine) {
  let t = 0;
  for (let i = 0; i < 2000 && engine.step((t += 16)); i++);
}

/** Group g has a1–a3 (a triangle), group h has b1–b2; x has no group. */
function communities(): GraphData {
  return {
    nodes: [
      { id: "a1", group: "g", category: "Person" },
      { id: "a2", group: "g", category: "Person" },
      { id: "a3", group: "g", category: "Film" },
      { id: "b1", group: "h", category: "Film" },
      { id: "b2", group: "h", category: "Film" },
      { id: "x", category: "Studio" },
    ],
    edges: [
      { id: "e1", from: "a1", to: "a2" },
      { id: "e2", from: "a2", to: "a3" },
      { id: "e3", from: "a3", to: "a1" },
      { id: "e4", from: "a1", to: "x" },
      { id: "e5", from: "a2", to: "x" },
      { id: "e6", from: "x", to: "a3" },
      { id: "e7", from: "a1", to: "b1" },
      { id: "e8", from: "b1", to: "b2" },
    ],
  };
}

const drawnIds = (e: GraphEngine) => e.nodes.map((n) => n.id).sort();

/** Draws `engine` and returns the texts given to fillText. */
function drawnTexts(e: GraphEngine): string[] {
  const texts: string[] = [];
  const f = () => {};
  const ctx = {
    save: f, restore: f, translate: f, scale: f, rotate: f, beginPath: f, moveTo: f, lineTo: f, quadraticCurveTo: f,
    bezierCurveTo: f, arc: f, closePath: f, fill: f, stroke: f, fillRect: f, strokeText: f,
    fillText: (t: string) => texts.push(t),
    measureText: (t: string) => ({ width: t.length * 6 }),
    fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "butt", lineJoin: "miter", globalAlpha: 1, font: "",
    textAlign: "start", textBaseline: "alphabetic",
  } as unknown as Ctx2D;
  renderGraph(ctx, e, THEME, 800, 600);
  return texts;
}

describe("groups", () => {
  test("lists the groups in the data in order, with their members", () => {
    const e = sized();
    e.setData(communities());
    expect(e.groups().map((g) => [g.id, g.label, g.collapsed, g.nodes.map((n) => n.id)])).toEqual([
      ["g", "g", false, ["a1", "a2", "a3"]],
      ["h", "h", false, ["b1", "b2"]],
    ]);
    expect(e.group("nope")).toBeUndefined();
  });

  test("collapsing draws one super node, bundles edges per direction and hides edges inside", () => {
    const e = sized();
    e.setData(communities());
    settle(e);
    e.setGroupsCollapsed(["g"], true);
    const sup = e.superId("g");
    expect(drawnIds(e)).toEqual([sup, "b1", "b2", "x"].sort());
    const s = e.engineNode(sup)!;
    expect(s.superOf).toBe("g");
    expect(s.members).toBe(3);
    expect(s.node.caption).toBe("g");
    // Bigger than any node.
    for (const n of e.nodes) if (n !== s) expect(s.r).toBeGreaterThan(n.r);

    // g → x twice (e4, e5) bundles; x → g once (e6) stays itself; g → b1 once (e7); e1–e3 are inside.
    const byEnds = new Map(e.edges.map((ed) => [`${e.nodes[ed.source].id}>${e.nodes[ed.target].id}`, ed]));
    expect(e.edges.length).toBe(4);
    const out = byEnds.get(`${sup}>x`)!;
    expect(out.bundle!.map((b) => b.id)).toEqual(["e4", "e5"]);
    expect(out.edge.caption).toBe("×2");
    expect(out.edge.width).toBeGreaterThan(1.5);
    const back = byEnds.get(`x>${sup}`)!;
    expect(back.id).toBe("e6");
    expect(back.edge.id).toBe("e6");
    expect(back.bend).not.toBe(0); // the two directions curve apart
    expect(byEnds.get(`${sup}>b1`)!.id).toBe("e7");
    expect(e.bundleCount).toBe(1);
    expect(e.customEdges.length).toBe(1); // the thicker bundle is drawn on its own
  });

  test("the data, degrees, neighbors and legend still describe the whole graph", () => {
    const e = sized();
    e.setData(communities());
    const legend = e.legend(PALETTE_LIGHT);
    e.setGroupsCollapsed(null, true);
    expect(e.nodeCount).toBe(6);
    expect(e.edgeCount).toBe(8);
    expect(e.node("a1")?.id).toBe("a1");
    expect(e.degree("a1")).toBe(4);
    expect(e.neighborsOf("a1").map((n) => n.id).sort()).toEqual(["a2", "a3", "b1", "x"]);
    expect(e.edgesOf("x").map((ed) => ed.id)).toEqual(["e4", "e5", "e6"]);
    expect(e.legend(PALETTE_LIGHT)).toEqual(legend);
  });

  test("a super node starts at its members' center, and expanding brings them back around where it went", () => {
    const e = sized();
    e.setData(communities());
    settle(e);
    const before = ["a1", "a2", "a3"].map((id) => e.position(id)!);
    const cx = (before[0].x + before[1].x + before[2].x) / 3;
    const cy = (before[0].y + before[1].y + before[2].y) / 3;
    e.setGroupsCollapsed(["g"], true);
    const s = e.engineNode(e.superId("g"))!;
    expect(Math.abs(s.x - cx)).toBeLessThan(1e-6);
    expect(Math.abs(s.y - cy)).toBeLessThan(1e-6);
    // Hidden members are drawn at the super node.
    expect(e.position("a1")).toEqual({ x: s.x, y: s.y });

    // Move the super node, then expand.
    s.x += 200;
    s.y -= 50;
    e.setGroupsCollapsed(["g"], false);
    expect(e.engineNode(e.superId("g"))).toBeUndefined();
    const after = ["a1", "a2", "a3"].map((id) => e.position(id)!);
    after.forEach((p, i) => {
      expect(Math.abs(p.x - (before[i].x + 200))).toBeLessThan(1e-6);
      expect(Math.abs(p.y - (before[i].y - 50))).toBeLessThan(1e-6);
    });
    expect(drawnIds(e)).toEqual(["a1", "a2", "a3", "b1", "b2", "x"]);
    expect(e.edges.length).toBe(8);
    expect(e.edges.every((ed) => ed.bundle === null)).toBe(true);
  });

  test("hits and selections tell groups and bundles apart from nodes and edges", () => {
    const e = sized();
    e.setData(communities());
    settle(e);
    e.setGroupsCollapsed(["g"], true);
    const s = e.engineNode(e.superId("g"))!;
    const p = e.graphToScreen(s.x, s.y);
    const hit = e.hitTest(p.x, p.y);
    expect(hit.kind === "group" && hit.group.id).toBe("g");
    expect(hit.kind === "group" && hit.group.nodes.length).toBe(3);

    const target = e.selectAt(p.x, p.y);
    expect(target.kind).toBe("group");
    const sel = e.selection();
    expect(sel?.kind === "group" && sel.group.collapsed).toBe(true);
    expect(e.focus()!.nodes.has(s.index)).toBe(true);

    const bundle = e.edges.find((ed) => ed.bundle !== null && ed.bundle.length > 1)!;
    e.setSelected({ kind: "edge", id: bundle.id });
    const bs = e.selection();
    expect(bs?.kind === "bundle" && bs.edges.map((ed) => ed.id)).toEqual(["e4", "e5"]);
  });

  test("selected members stay selected while collapsed; a selected group or bundle goes when it does", () => {
    const e = sized();
    e.setData(communities());
    const events: EngineEvent[] = [];
    e.onEvent = (ev) => events.push(ev);
    e.selectNodes(["a1", "x"]);
    e.setGroupsCollapsed(["g"], true);
    const sel = e.selection();
    expect(sel?.kind === "node" && sel.nodes.map((n) => n.id)).toEqual(["a1", "x"]);
    expect(e.drawnIndex("a1")).toBe(e.engineNode(e.superId("g"))!.index);
    // A selection box does not pick super nodes.
    expect(e.nodesInRect(-1e6, -1e6, 1e6, 1e6).sort()).toEqual(["b1", "b2", "x"]);

    e.setSelected({ kind: "group", id: "g" });
    e.setGroupsCollapsed(["g"], false);
    expect(e.selection()).toBeNull();

    e.setSelected({ kind: "edge", id: "e4" });
    e.setGroupsCollapsed(["g"], true);
    expect(e.selection()).toBeNull(); // e4 went into a bundle

    const toggles = events.filter((ev) => ev.type === "group").map((ev) => ev.type === "group" && [ev.group.id, ev.collapsed]);
    expect(toggles).toEqual([["g", true], ["g", false], ["g", true]]);
  });

  test("arrow keys reach super nodes", () => {
    const e = sized({ layout: "grid" });
    e.setData(communities());
    e.setGroupsCollapsed(["h"], true);
    e.setSelected({ kind: "group", id: "h" });
    // From the super node somewhere, some direction leads to another node.
    const next = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => e.nearestInDirection(dx, dy)).find(Boolean);
    expect(next).toBeTruthy();
    expect(e.groupOfSuper(e.superId("h"))).toBe("h");
    expect(e.groupOfSuper("x")).toBeNull();
  });

  test("data changes keep groups collapsed; new members join hidden; a group that is gone expands", () => {
    const e = sized();
    const data = communities();
    e.setData(data);
    settle(e);
    e.setGroupsCollapsed(["g"], true);
    e.setData({
      nodes: [...data.nodes, { id: "a4", group: "g" }],
      edges: [...data.edges, { id: "e9", from: "a4", to: "b2" }],
    });
    expect(e.isCollapsed("g")).toBe(true);
    expect(e.engineNode("a4")).toBeUndefined();
    expect(e.engineNode(e.superId("g"))!.members).toBe(4);
    expect(e.edges.some((ed) => ed.id === "e9" && e.nodes[ed.source].superOf === "g")).toBe(true);

    // Expanding places the member that was never drawn next to a neighbor.
    e.setGroupsCollapsed(["g"], false);
    const a4 = e.position("a4")!;
    expect(Number.isFinite(a4.x) && Number.isFinite(a4.y)).toBe(true);

    e.setGroupsCollapsed(["h"], true);
    e.setData({ nodes: data.nodes.filter((n) => n.group !== "h"), edges: data.edges });
    expect(e.isCollapsed("h")).toBe(false);
    expect(e.groups().map((g) => g.id)).toEqual(["g"]);
    // Collapsing a group that is not there does nothing.
    e.setGroupsCollapsed(["h"], true);
    expect(e.isCollapsed("h")).toBe(false);
  });

  test("labels caption the super node; the count is drawn inside and bundles are captioned without edgeLabels", () => {
    const e = sized({ labelMode: "always" });
    e.setData(communities());
    settle(e);
    e.setGroupLabel("g", "Gang");
    e.setGroupsCollapsed(["g"], true);
    expect(e.group("g")!.label).toBe("Gang");
    expect(e.engineNode(e.superId("g"))!.node.caption).toBe("Gang");
    e.fit(false);
    const texts = drawnTexts(e);
    expect(texts).toContain("Gang");
    expect(texts).toContain("3");
    expect(texts).toContain("×2");
    e.setGroupLabel("g", null);
    expect(e.engineNode(e.superId("g"))!.node.caption).toBe("g");
  });

  test("with colorBy group a super node takes its group's color; with category its members' most common one", () => {
    const e = sized({ colorBy: "group" });
    e.setData(communities());
    const before = e.nodeColors(PALETTE_LIGHT).fills[e.engineNode("a1")!.index];
    e.setGroupsCollapsed(["g"], true);
    const s = e.engineNode(e.superId("g"))!;
    expect(e.nodeColors(PALETTE_LIGHT).fills[s.index]).toBe(before);

    const c = sized();
    c.setData(communities());
    const person = c.nodeColors(PALETTE_LIGHT).fills[c.engineNode("a1")!.index];
    c.setGroupsCollapsed(["g"], true);
    expect(c.nodeColors(PALETTE_LIGHT).fills[c.engineNode(c.superId("g"))!.index]).toBe(person);
  });

  test("every layout runs with groups collapsed", () => {
    for (const layout of ["force", "hierarchical", "circular", "grid"] as const) {
      const e = sized({ layout });
      e.setData(communities());
      e.setGroupsCollapsed(null, true);
      settle(e);
      for (const n of e.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
      e.setGroupsCollapsed(null, false);
      settle(e);
      for (const n of e.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
    }
  });
});
