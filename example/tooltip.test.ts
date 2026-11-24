// What the built-in tooltip says about nodes, edges, groups and bundles.
import { describe, expect, test } from "nsh/test";
import { GraphEngine } from "../src/engine";
import { PALETTE_LIGHT } from "../src/palette";
import { tooltipInfo, type TooltipTarget } from "../src/tooltip";

function engine() {
  const e = new GraphEngine({ reduceMotion: true });
  e.setSize(800, 600);
  e.setData({
    nodes: [
      { id: "a", caption: "Alice", category: "Person", group: "g" },
      { id: "b", caption: "Bob", category: "Person", group: "g" },
      { id: "x", caption: "Acme", category: "Company" },
      { id: "y" },
    ],
    edges: [
      { id: "e1", from: "a", to: "x", caption: "WORKS_AT" },
      { id: "e2", from: "b", to: "x", caption: "OWNS" },
      { id: "e3", from: "a", to: "b" },
      { id: "e4", from: "y", to: "x" },
    ],
  });
  return e;
}

const info = (e: GraphEngine, t: TooltipTarget) => tooltipInfo(e, t, PALETTE_LIGHT);

describe("tooltip", () => {
  test("a node: its category and group, caption, relationship count and fill", () => {
    const e = engine();
    const a = info(e, { kind: "node", node: e.node("a")! });
    expect(a).toEqual({
      kicker: "Person · g",
      title: "Alice",
      detail: "2 relationships",
      swatch: e.nodeColors(PALETTE_LIGHT).fills[e.engineNode("a")!.index],
    });
    expect(a.swatch).toBe(PALETTE_LIGHT[0]);
    // Without a category, group or caption.
    expect(info(e, { kind: "node", node: e.node("y")! })).toMatchObject({ kicker: "Node", title: "y", detail: "1 relationship" });
  });

  test("a group's label shows in its members' tooltips", () => {
    const e = engine();
    e.setGroupLabel("g", "Founders");
    expect(info(e, { kind: "node", node: e.node("b")! }).kicker).toBe("Person · Founders");
  });

  test("an edge: its type and the nodes it joins, no swatch", () => {
    const e = engine();
    expect(info(e, { kind: "edge", edge: e.edgesOf("x")[0] })).toEqual({
      kicker: "Relationship",
      title: "WORKS_AT",
      detail: "Alice → Acme",
      swatch: null,
    });
    expect(info(e, { kind: "edge", edge: e.edgesOf("y")[0] }).title).toBe("Edge");
  });

  test("a collapsed group: its label, member count and fill; a bundle: its count, types and ends as drawn", () => {
    const e = engine();
    e.setGroupLabel("g", "Founders");
    e.setGroupsCollapsed(["g"], true);
    const group = e.group("g")!;
    const g = info(e, { kind: "group", group });
    expect(g.kicker).toBe("Group");
    expect(g.title).toBe("Founders");
    expect(g.detail).toBe("2 members");
    expect(g.swatch).toBe(e.nodeColors(PALETTE_LIGHT).fills[e.engineNode(e.superId("g"))!.index]);

    const bundle = e.edges.find((ed) => ed.bundle !== null && ed.bundle.length > 1)!.bundle!;
    expect(info(e, { kind: "bundle", edges: bundle })).toEqual({
      kicker: "WORKS_AT, OWNS",
      title: "2 relationships",
      detail: "Founders → Acme",
      swatch: null,
    });
    // An edge hidden in a collapsed group still names its own nodes.
    expect(info(e, { kind: "edge", edge: e.edgesOf("a")[0] }).detail).toBe("Alice → Acme");
  });

  test("a bundle of more than three types says only how many", () => {
    const e = new GraphEngine({ reduceMotion: true });
    e.setData({
      nodes: [{ id: "a", group: "g" }, { id: "b", group: "g" }, { id: "x" }],
      edges: ["P", "Q", "R", "S"].map((caption, i) => ({ from: i % 2 ? "a" : "b", to: "x", caption })),
    });
    e.setGroupsCollapsed(["g"], true);
    const bundle = e.edges[0].bundle!;
    expect(info(e, { kind: "bundle", edges: bundle })).toMatchObject({ kicker: "Relationships", title: "4 relationships" });
  });
});
