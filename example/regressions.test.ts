// Regressions for issues found by drawing the open datasets in ./datasets.
import { describe, expect, test } from "nsh/test";
import { GraphEngine } from "../src/engine";
import { hierarchicalLayout } from "../src/layouts";
import { OTHER, PALETTE_LIGHT, naturalCompare } from "../src/palette";
import { truncate, strokeWidth, renderGraph, type Ctx2D, type RenderTheme } from "../src/render";

const THEME: RenderTheme = {
  background: null, text: "#111111", surface: "#ffffff", edge: "#999999", edgeHighlight: "#111111",
  edgeText: "#666666", selection: "#2563eb", palette: PALETTE_LIGHT, other: OTHER, fontFamily: "system-ui",
};
import { datasets } from "./datasets";

const sized = (o = {}) => {
  const e = new GraphEngine({ reduceMotion: true, ...o });
  e.setSize(1000, 700);
  return e;
};
const cats = (names: string[], perCat = (i: number) => 1) => ({
  nodes: names.flatMap((c, i) => Array.from({ length: perCat(i) }, (_, j) => ({ id: `${c}-${j}`, category: c }))),
  edges: [],
});

describe("colors", () => {
  test("a new dataset gets palette colors even after earlier ones used every slot", () => {
    const e = sized();
    e.setData(cats(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]));
    e.setData(cats(["v", "w", "x"]));
    const legend = e.legend(PALETTE_LIGHT);
    expect(legend.every((l) => l.color !== OTHER)).toBe(true);
    expect(legend.map((l) => l.color)).toEqual(PALETTE_LIGHT.slice(0, 3));
  });

  test("with more categories than colors, the biggest get colors and the smallest fold into Other", () => {
    const e = sized();
    // Ten categories; the last two are the biggest.
    e.setData(cats(["a", "b", "c", "d", "e", "f", "g", "h", "big1", "big2"], (i) => (i >= 8 ? 20 : 1 + i)));
    const legend = e.legend(PALETTE_LIGHT);
    const colorOf = (k: string) => legend.find((l) => l.key === k)!.color;
    expect(colorOf("big1")).not.toBe(OTHER);
    expect(colorOf("big2")).not.toBe(OTHER);
    expect(colorOf("a")).toBe(OTHER);
    expect(colorOf("b")).toBe(OTHER);
  });

  test("categories that stay keep their color when others come and go", () => {
    const e = sized();
    e.setData(cats(["a", "b", "c"]));
    const before = e.legend(PALETTE_LIGHT).find((l) => l.key === "c")!.color;
    e.setData(cats(["c", "z"]));
    expect(e.legend(PALETTE_LIGHT).find((l) => l.key === "c")!.color).toBe(before);
  });

  test("switching colorBy starts the palette over", () => {
    const e = sized();
    e.setData({ nodes: [{ id: "1", category: "A", group: "g1" }, { id: "2", category: "B", group: "g2" }], edges: [] });
    e.setOptions({ colorBy: "group" });
    expect(e.legend(PALETTE_LIGHT).map((l) => l.color)).toEqual(PALETTE_LIGHT.slice(0, 2));
  });

  test("the legend orders numbered names by number", () => {
    expect(["Group 10", "Group 9", "Group 8", "Group 1"].sort(naturalCompare)).toEqual(["Group 1", "Group 8", "Group 9", "Group 10"]);
  });
});

describe("data", () => {
  test("NaN, infinite positions and bad sizes do not spread", () => {
    const e = sized();
    e.setData(datasets.find((d) => d.id === "malformed")!.data());
    for (let i = 0; i < 50; i++) e.sim.tick();
    for (const n of e.nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true);
      expect(n.r).toBeGreaterThan(0);
    }
    expect(e.nodes.length).toBe(10); // the duplicate id is dropped
  });

  test("edge widths that are not positive numbers fall back to the default", () => {
    expect([strokeWidth(-3), strokeWidth(0), strokeWidth(NaN), strokeWidth(undefined), strokeWidth(4)]).toEqual([1.5, 1.5, 1.5, 1.5, 4]);
  });

  test("captions become one line and never split a character", () => {
    expect(truncate("Tab\tand\nnewline")).toBe("Tab and newline");
    const emoji = truncate("🚀".repeat(40), 10);
    expect(Array.from(emoji).length).toBe(10);
    expect(emoji.endsWith("…")).toBe(true);
    expect(truncate("张三")).toBe("张三");
  });
});

describe("reduced motion", () => {
  test("a frame never blocks for long, and steps are not drawn until the layout settles", async () => {
    const e = new GraphEngine({ reduceMotion: true });
    e.setSize(1000, 700);
    e.setData(datasets.find((d) => d.id === "flare-deps")!.data());
    e.consumeDirty();
    let t = 0;
    let longest = 0;
    let draws = 0;
    let frames = 0;
    for (let more = true; more; ) {
      const s0 = Date.now();
      more = e.step((t += 16));
      longest = Math.max(longest, Date.now() - s0);
      if (e.consumeDirty()) draws++;
      if (++frames % 20 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    // One tick of this graph takes ~15 ms on QuickJS; a frame used to take 120 ms here.
    expect(longest).toBeLessThan(45);
    // Progress shows at most every 500 ms of frame time, plus the settled result.
    expect(draws).toBeLessThanOrEqual(Math.ceil((frames * 16) / 500) + 2);
    expect(e.sim.running).toBe(false);
  }, 60000);
});

describe("labels", () => {
  /** Draws `engine` and returns the texts given to fillText. */
  const drawnTexts = (e: GraphEngine) => {
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
    renderGraph(ctx, e, THEME, 1000, 700);
    return texts;
  };

  test("crossing edges do not draw their labels over each other", () => {
    const e = sized({ layout: "grid", edgeLabels: true, labelMode: "never" });
    // An X: a–d and b–c cross at the same midpoint.
    e.setData({
      nodes: [
        { id: "a", x: -200, y: -200, pinned: true }, { id: "b", x: 200, y: -200, pinned: true },
        { id: "c", x: -200, y: 200, pinned: true }, { id: "d", x: 200, y: 200, pinned: true },
      ],
      edges: [{ from: "a", to: "d", caption: "FIRST" }, { from: "b", to: "c", caption: "SECOND" }],
    });
    e.setOptions({ labelMode: "auto" });
    const texts = drawnTexts(e).filter((t) => t === "FIRST" || t === "SECOND");
    expect(texts.length).toBe(1);
  });
});

describe("viewport", () => {
  test("the first frame of a big graph is already fitted", () => {
    const e = new GraphEngine();
    e.setSize(1000, 700);
    e.setData(datasets.find((d) => d.id === "scale-free")!.data());
    expect(e.k).toBeLessThan(0.6);
    const off = e.nodes.filter((n) => {
      const p = e.graphToScreen(n.x, n.y);
      return p.x < 0 || p.y < 0 || p.x > 1000 || p.y > 700;
    });
    expect(off.length).toBe(0);
  });

  test("fit shows layouts that need less than minZoom, and zooming out stops there", () => {
    const e = sized({ layout: "hierarchical" });
    e.setData(datasets.find((d) => d.id === "chain")!.data());
    const fitted = e.k;
    expect(fitted).toBeLessThan(0.05);
    e.zoomAt(0.5, 500, 350);
    expect(e.k).toBeGreaterThanOrEqual(fitted * 0.8 - 1e-9);
  });
});

describe("hierarchical", () => {
  const overlaps = (id: string) => {
    const e = sized({ layout: "hierarchical" });
    e.setData(datasets.find((d) => d.id === id)!.data());
    let count = 0;
    for (let i = 0; i < e.nodes.length; i++)
      for (let j = i + 1; j < e.nodes.length; j++) {
        const a = e.nodes[i];
        const b = e.nodes[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) count++;
      }
    return { e, count };
  };

  test("a 300-leaf star wraps into a compact block without overlaps", () => {
    const { e, count } = overlaps("star");
    expect(count).toBe(0);
    const xs = e.nodes.map((n) => n.x);
    const ys = e.nodes.map((n) => n.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    expect(w / h).toBeLessThan(12);
  });

  test("the flare tree has no overlapping nodes", () => {
    expect(overlaps("flare-tree").count).toBe(0);
  });

  test("wrapping keeps each layer's order from left to right", () => {
    const nodes = Array.from({ length: 41 }, () => ({ r: 10, category: "", group: null, degree: 1 }));
    const edges = Array.from({ length: 40 }, (_, i) => ({ source: 0, target: i + 1 }));
    const p = hierarchicalLayout(nodes, edges);
    for (let i = 2; i <= 40; i++) expect(p[i].x).toBeGreaterThan(p[i - 1].x);
  });
});
