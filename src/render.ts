/**
 * Draws a `GraphEngine` with a Canvas 2D context: community hulls, edges (batched by state) with arrows,
 * nodes with selection and hover rings, and captions. Captions and edge labels are drawn in screen space
 * so they stay the same size at every zoom.
 */
import type { GraphEngine } from "./engine";
import { roundedHullPath, convexHull, hullTop, type EdgeShape } from "./geometry";
import { inkOn, withAlpha } from "./palette";

/** The part of `CanvasRenderingContext2D` the renderer uses (NSH's `<Canvas>` and `OffscreenCanvas` give it). */
export interface Ctx2D {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  rotate(a: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void;
  closePath(): void;
  /** `path`: a `Path2D` (only passed when `renderGraph` is given `paths`). */
  fill(path?: any): void;
  stroke(path?: any): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  strokeText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: unknown;
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
  globalAlpha: unknown;
  font: string;
  textAlign: "start" | "end" | "left" | "right" | "center";
  textBaseline: "alphabetic" | "top" | "hanging" | "middle" | "ideographic" | "bottom";
}

/** The resolved colors and font the renderer draws with. */
export interface RenderTheme {
  background: string | null;
  text: string;
  surface: string;
  edge: string;
  edgeHighlight: string;
  edgeText: string;
  selection: string;
  palette: readonly string[];
  other: string;
  fontFamily: string;
}

const DIM = 0.18;
/** A super node's inner ring: how far inside its edge, and how wide, in graph units (it zooms with the node). */
const SUPER_RING_INSET = 5;
const SUPER_RING_WIDTH = 2;
/** A batch of nodes gets its separating ring when one is at least this big on screen (radius, in points). */
const RING_PX = 5;
/**
 * Level of detail with the Rust painter: nodes smaller than this on screen (radius, in points) are traced
 * as squares, once per screen pixel and color, where a circle and a square look the same.
 */
const LOD_PX = 1.5;
const widthCache = new Map<string, number>();
/** Scratch space for `renderGraph`: the straight edges' arrow tips (x, y and angle per edge). */
let tipBuffer = new Float64Array(0);

function measure(cx: Ctx2D, font: string, text: string): number {
  const key = font + "\u0000" + text;
  let w = widthCache.get(key);
  if (w === undefined) {
    if (widthCache.size > 4000) widthCache.clear();
    w = cx.measureText(text).width;
    widthCache.set(key, w);
  }
  return w;
}

/** `truncate`'s results by `max`, then text: captions are truncated again every frame. */
const truncated = new Map<number, Map<string, string>>();

/** One line of at most `max` characters: control characters become spaces, and it never cuts a character in half. */
export function truncate(text: string, max = 28): string {
  let cache = truncated.get(max);
  if (!cache) truncated.set(max, (cache = new Map()));
  let line = cache.get(text);
  if (line === undefined) {
    if (cache.size > 4000) cache.clear();
    line = truncateLine(text, max);
    cache.set(text, line);
  }
  return line;
}

function truncateLine(text: string, max: number): string {
  const line = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (line.length <= max) return line;
  const chars = Array.from(line);
  if (chars.length <= max) return line;
  let cut = chars.slice(0, max - 1);
  // Do not end on a zero-width joiner or a variation selector (a half-built emoji).
  while (cut.length && /[\u200D\uFE0F]/.test(cut[cut.length - 1])) cut = cut.slice(0, -1);
  return cut.join("").trimEnd() + "…";
}

/** An edge's stroke width: its own when it is a positive number, else the default. */
export function strokeWidth(width: number | undefined): number {
  return width !== undefined && Number.isFinite(width) && width > 0 ? width : 1.5;
}

/** How `renderGraph` builds a path from SVG path data: `(d) => new Path2D(d)` with NSH's `Path2D`. */
export interface RenderPaths {
  path: (d: string) => unknown;
}

/**
 * Draws the graph. With `paths` and an engine that has the Rust painter (`setNativeBackend`), edges and
 * nodes are traced in Rust and drawn as a few paths; without, they are traced here, call by call.
 */
export function renderGraph(cx: Ctx2D, engine: GraphEngine, theme: RenderTheme, width: number, height: number, paths?: RenderPaths) {
  const { nodes, edges, k, tx, ty, options } = engine;
  const native = engine.painter && paths ? { painter: engine.painter, path: paths.path } : null;
  if (theme.background) {
    cx.fillStyle = theme.background;
    cx.fillRect(0, 0, width, height);
  }
  if (nodes.length === 0) return;

  const { fills, distinct, rank } = engine.nodeColors(theme.palette, theme.other);
  const focus = engine.focus();
  const selectedId = engine.selected;
  const selNode =
    selectedId?.kind === "node" ? engine.drawnIndex(selectedId.id)
    : selectedId?.kind === "group" ? engine.drawnIndex(engine.superId(selectedId.id))
    : -1;
  // Every selected node (the primary one among them); a selected member of a collapsed group rings its super node.
  const selNodes = new Set<number>();
  for (const id of engine.selectedNodes) {
    const i = engine.drawnIndex(id);
    if (i >= 0) selNodes.add(i);
  }
  if (selectedId?.kind === "group" && selNode >= 0) selNodes.add(selNode);
  const hoverNode = engine.hovered?.kind === "node" ? engine.hovered.index : -1;
  const hoverEdge = engine.hovered?.kind === "edge" ? engine.hovered.index : -1;
  const selEdge = selectedId?.kind === "edge" ? edges.findIndex((e) => e.id === selectedId.id) : -1;

  // The part of the graph on screen, with room for the biggest node and loops.
  const maxR = engine.maxRadius();
  const margin = maxR * 4 + 40;
  const vx0 = -tx / k - margin;
  const vy0 = -ty / k - margin;
  const vx1 = (width - tx) / k + margin;
  const vy1 = (height - ty) / k + margin;
  // The decimals the Rust painter writes coordinates with: fewer when zoomed out, where they cannot be
  // seen (rounding moves a point 0.05 screen points at most, up to 10× zoom), for shorter paths to parse.
  const decimals = k <= 0.1 ? 0 : k <= 1 ? 1 : 2;
  const nc = distinct.length;
  const nb = nc * 2;

  // With the Rust painter, the node pass (what is in view, each node's batch, which batches get a ring, and
  // the paths, with level of detail) runs there: on QuickJS those per-node loops were most of a frame.
  let frame: { circles: string[]; ringed: Uint8Array } | null = null;
  let inView: Uint8Array;
  const p = native?.painter;
  if (p && p.frameNodes && p.frameInfo && p.setRanks) {
    engine.paintPositions(p);
    if (engine.paintedRanks !== rank) {
      p.setRanks(new Uint8Array(rank.buffer, rank.byteOffset, rank.byteLength));
      engine.paintedRanks = rank;
    }
    const focused = focus ? Uint32Array.from(focus.nodes) : new Uint32Array(0);
    const circles = p.frameNodes(new Uint8Array(focused.buffer), nc, [vx0, vy0, vx1, vy1, decimals, k, RING_PX, LOD_PX]);
    const info = p.frameInfo();
    inView = info.subarray(0, nodes.length);
    frame = { circles, ringed: info.subarray(nodes.length, nodes.length + nb) };
  } else {
    // Which nodes are in view. An edge with an end in view is too (`edgeMayTouch` says so for it), so only
    // edges with both ends out need the closer test.
    inView = new Uint8Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      const x = nodes[i].x;
      const y = nodes[i].y;
      if (x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1) inView[i] = 1;
    }
  }
  const edgeVisible = (i: number) =>
    inView[edges[i].source] === 1 || inView[edges[i].target] === 1 || engine.edgeMayTouch(i, vx0, vy0, vx1, vy1);
  const shape = (i: number) => engine.edgeShape(i);

  cx.save();
  cx.translate(tx, ty);
  cx.scale(k, k);
  cx.lineCap = "round";
  cx.lineJoin = "round";
  const px = 1 / k; // one screen point, in graph units

  // ---- Community hulls
  if (options.groupHulls) {
    const groups = new Map<string, number[]>();
    nodes.forEach((n, i) => {
      if (n.group === null) return;
      const g = groups.get(n.group);
      if (g) g.push(i);
      else groups.set(n.group, [i]);
    });
    for (const [, members] of groups) {
      if (members.length < 2) continue;
      const hull = convexHull(members.map((i) => nodes[i]));
      let pad = 0;
      for (const i of members) pad = Math.max(pad, nodes[i].r);
      pad += 12;
      const color = options.colorBy === "group" ? fills[members[0]] : theme.text;
      cx.beginPath();
      roundedHullPath(cx, hull, pad);
      cx.fillStyle = withAlpha(color, 0.08);
      cx.fill();
      cx.strokeStyle = withAlpha(color, 0.35);
      cx.lineWidth = 1.5 * px;
      cx.stroke();
    }
  }

  // ---- Edges, in three passes: dimmed, normal, highlighted. Each edge's state, worked out once.
  const states = new Uint8Array(edges.length);
  if (!focus) states.fill(1);
  else for (const i of focus.edges) states[i] = 2;
  if (hoverEdge >= 0) states[hoverEdge] = 2;
  if (selEdge >= 0) states[selEdge] = 2;
  const state = (i: number) => states[i] as 0 | 1 | 2;
  const arrowLen = (w: number) => Math.max(7, w * 3.2);
  const edgeWidth = (i: number) => Math.max(strokeWidth(edges[i].edge.width), 0.75 * px);

  const tracePath = (s: EdgeShape, i: number) => {
    let bx = s.b.x;
    let by = s.b.y;
    if (arrows && !s.c && !s.c1) {
      // Stop the line under the arrow head, so its butt does not poke through the tip.
      const back = arrowLen(edgeWidth(i)) * 0.7;
      bx -= Math.cos(s.endAngle) * back;
      by -= Math.sin(s.endAngle) * back;
    }
    cx.moveTo(s.a.x, s.a.y);
    if (s.c1 && s.c2) cx.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, bx, by);
    else if (s.c) cx.quadraticCurveTo(s.c.x, s.c.y, bx, by);
    else cx.lineTo(bx, by);
  };
  /** An arrow head with its tip at (x, y), pointing along angle `a`. */
  const arrowAt = (x: number, y: number, a: number, len: number) => {
    const spread = 0.42;
    cx.moveTo(x, y);
    cx.lineTo(x - Math.cos(a - spread) * len, y - Math.sin(a - spread) * len);
    cx.lineTo(x - Math.cos(a + spread) * len, y - Math.sin(a + spread) * len);
    cx.closePath();
  };
  const traceArrow = (s: EdgeShape, i: number) => arrowAt(s.b.x, s.b.y, s.endAngle, arrowLen(edgeWidth(i)));

  const arrows = options.arrows && arrowLen(1.5) * k >= 3.5;
  if (arrows && tipBuffer.length < edges.length * 3) tipBuffer = new Float64Array(edges.length * 3);
  const tips = tipBuffer;
  /**
   * Traces edge i's line, stopped `back` short of its tip under an arrow. A straight edge (most are) is
   * traced as `edgeShape` and `tracePath` would, without building its shape: on QuickJS that is most of
   * what drawing an edge costs. Its tip and angle go to `tips`, for `traceHead`.
   */
  const traceLine = (i: number, back: number) => {
    const e = edges[i];
    if (e.self || e.bend !== 0) return tracePath(shape(i), i);
    const s = nodes[e.source];
    const t = nodes[e.target];
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const len = Math.hypot(dx, dy) || 1e-6;
    const ux = dx / len;
    const uy = dy / len;
    let bx = t.x - ux * t.r;
    let by = t.y - uy * t.r;
    if (arrows) {
      const a = Math.atan2(dy, dx);
      tips[i * 3] = bx;
      tips[i * 3 + 1] = by;
      tips[i * 3 + 2] = a;
      bx -= Math.cos(a) * back;
      by -= Math.sin(a) * back;
    }
    cx.moveTo(s.x + ux * s.r, s.y + uy * s.r);
    cx.lineTo(bx, by);
  };
  /** Traces edge i's arrow head, `len` long, after `traceLine` traced its line. */
  const traceHead = (i: number, len: number) => {
    const e = edges[i];
    if (e.self || e.bend !== 0) traceArrow(shape(i), i);
    else arrowAt(tips[i * 3], tips[i * 3 + 1], tips[i * 3 + 2], len);
  };
  // The batched edges all have the default width, so the same arrow.
  const batchArrow = arrowLen(Math.max(1.5, 0.75 * px));
  const batchBack = batchArrow * 0.7;

  // Edges with a color or width of their own are drawn one by one; the others share a path per pass.
  const customs = engine.customEdges;
  let traced: string[] | null = null;
  const batches: number[][] = [[], [], []];
  if (native) {
    // The Rust painter traces each pass's default-look edges into two SVG paths (lines, arrow heads).
    engine.paintPositions(native.painter);
    let sent = states;
    if (customs.length > 0) {
      sent = states.slice();
      for (const i of customs) sent[i] = 255;
    }
    // The zoom turns on level of detail: edges hidden under their nodes, too short to see, or (zoomed out) on
    // the same pixels as another are left out.
    traced = native.painter.traceEdges(sent, [vx0, vy0, vx1, vy1, arrows ? 1 : 0, arrowLen(Math.max(1.5, 0.75 * px)), decimals, frame ? k : 0]);
  } else {
    const isCustom = new Uint8Array(edges.length);
    for (const i of customs) isCustom[i] = 1;
    for (let i = 0; i < edges.length; i++) {
      if (isCustom[i] === 0 && edgeVisible(i)) batches[states[i]].push(i);
    }
  }
  for (const pass of [0, 1, 2] as const) {
    const color = pass === 2 ? theme.edgeHighlight : theme.edge;
    cx.globalAlpha = pass === 0 ? DIM : 1;
    for (const i of customs) {
      if (states[i] !== pass || !edgeVisible(i)) continue;
      const e = edges[i].edge;
      const len = arrowLen(edgeWidth(i));
      cx.beginPath();
      traceLine(i, len * 0.7);
      cx.strokeStyle = pass === 2 && !e.color ? color : (e.color ?? color);
      cx.lineWidth = edgeWidth(i) * (pass === 2 ? 1.4 : 1);
      cx.stroke();
      if (arrows) {
        cx.beginPath();
        traceHead(i, len);
        cx.fillStyle = cx.strokeStyle;
        cx.fill();
      }
    }
    if (traced && native) {
      const lines = traced[pass * 2];
      const heads = traced[pass * 2 + 1];
      if (lines) {
        cx.strokeStyle = color;
        cx.lineWidth = Math.max(1.5, 0.75 * px) * (pass === 2 ? 1.4 : 1);
        cx.stroke(native.path(lines));
      }
      if (arrows && heads) {
        cx.fillStyle = color;
        cx.fill(native.path(heads));
      }
      continue;
    }
    const batch = batches[pass];
    if (batch.length === 0) continue;
    cx.beginPath();
    for (const i of batch) traceLine(i, batchBack);
    cx.strokeStyle = color;
    cx.lineWidth = Math.max(1.5, 0.75 * px) * (pass === 2 ? 1.4 : 1);
    cx.stroke();
    if (arrows) {
      cx.beginPath();
      for (const i of batch) traceHead(i, batchArrow);
      cx.fillStyle = color;
      cx.fill();
    }
  }
  cx.globalAlpha = 1;

  // ---- Nodes: one path per color (dimmed ones first, beneath), not a fill and a stroke per node. Batch b
  // holds the dimmed nodes of color `distinct[b]` for b < nc, the others of `distinct[b - nc]` after them.
  // With the Rust painter's node pass, `frame` has the batches' paths already.
  const counts = new Uint32Array(nb);
  // Whether a batch has a node big enough on screen for a ring.
  let ringed: Uint8Array = new Uint8Array(nb);
  let circles: string[] | null = null;
  let members: number[][] | null = null;
  if (frame) {
    circles = frame.circles;
    ringed = frame.ringed;
    for (let b = 0; b < nb; b++) if (circles[b]) counts[b] = 1;
  } else {
    const keys = native ? new Uint32Array(nodes.length) : null;
    members = native ? null : Array.from({ length: nb }, () => []);
    for (let i = 0; i < nodes.length; i++) {
      if (inView[i] === 0) {
        if (keys) keys[i] = 0xffffffff;
        continue;
      }
      const n = nodes[i];
      const b = (focus !== null && !focus.nodes.has(i) ? 0 : nc) + rank[i];
      if (keys) keys[i] = b;
      else members![b].push(i);
      counts[b]++;
      if (n.r * k >= RING_PX) ringed[b] = 1;
    }
    // The Rust painter traces each batch's circles into one path.
    if (native && keys) circles = native.painter.traceNodes(new Uint8Array(keys.buffer), nb, [vx0, vy0, vx1, vy1, decimals]);
  }
  for (let b = 0; b < nb; b++) {
    if (counts[b] === 0) continue;
    cx.globalAlpha = b < nc ? DIM + 0.1 : 1;
    cx.fillStyle = distinct[b % nc];
    let path: unknown;
    if (circles && native) {
      if (!circles[b]) continue;
      path = native.path(circles[b]);
      cx.fill(path);
    } else {
      cx.beginPath();
      for (const i of members![b]) {
        const n = nodes[i];
        cx.moveTo(n.x + n.r, n.y);
        cx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      }
      cx.fill();
    }
    // A thin ring of the surface color keeps touching nodes apart (not worth drawing on specks).
    if (ringed[b]) {
      cx.strokeStyle = theme.surface;
      cx.lineWidth = 1.5 * px;
      if (path !== undefined) cx.stroke(path);
      else cx.stroke();
    }
  }
  // Super nodes (collapsed groups) are drawn as a double ring: a ring of the surface color inside the fill.
  const supers: number[] = [];
  if (engine.supersShown > 0) {
    for (let i = 0; i < nodes.length; i++) if (nodes[i].superOf !== null && inView[i] === 1) supers.push(i);
  }
  for (const i of supers) {
    const n = nodes[i];
    cx.globalAlpha = focus !== null && !focus.nodes.has(i) ? DIM + 0.1 : 1;
    cx.beginPath();
    cx.arc(n.x, n.y, Math.max(1, n.r - SUPER_RING_INSET), 0, Math.PI * 2);
    cx.strokeStyle = theme.surface;
    cx.lineWidth = SUPER_RING_WIDTH;
    cx.stroke();
  }
  cx.globalAlpha = 1;
  // Rings and badges: only the selected, hovered and pinned nodes, not a look at every node.
  const marked = new Set<number>(selNodes);
  if (hoverNode >= 0) marked.add(hoverNode);
  for (const i of engine.pinnedIndices()) marked.add(i);
  for (const i of [...marked].sort((a, b) => a - b)) {
    const n = nodes[i];
    if (!n || inView[i] === 0) continue;
    if (selNodes.has(i)) {
      cx.beginPath();
      cx.arc(n.x, n.y, n.r + 3.5 * px, 0, Math.PI * 2);
      cx.strokeStyle = theme.selection;
      cx.lineWidth = 2.5 * px;
      cx.stroke();
    } else if (i === hoverNode) {
      cx.beginPath();
      cx.arc(n.x, n.y, n.r + 3 * px, 0, Math.PI * 2);
      cx.strokeStyle = withAlpha(theme.selection, 0.55);
      cx.lineWidth = 2 * px;
      cx.stroke();
    }
    if (n.fx !== null && i !== engine.dragging) {
      // Pinned: a small badge at the top right.
      const bx = n.x + n.r * 0.72;
      const by = n.y - n.r * 0.72;
      cx.beginPath();
      cx.arc(bx, by, 3.5 * px, 0, Math.PI * 2);
      cx.fillStyle = theme.text;
      cx.fill();
      cx.strokeStyle = theme.surface;
      cx.lineWidth = 1.5 * px;
      cx.stroke();
    }
  }
  cx.globalAlpha = 1;
  cx.restore();

  // ---- Hull labels, edge labels and captions, in screen space.
  cx.lineJoin = "round";
  if (options.groupHulls && options.colorBy === "group") {
    const font = `600 11px ${theme.fontFamily}`;
    cx.font = font;
    cx.textAlign = "center";
    cx.textBaseline = "bottom";
    const groups = new Map<string, number[]>();
    nodes.forEach((n, i) => n.group !== null && (groups.get(n.group) ?? groups.set(n.group, []).get(n.group)!).push(i));
    for (const [group, members] of groups) {
      if (members.length < 2) continue;
      let pad = 0;
      for (const i of members) pad = Math.max(pad, nodes[i].r);
      const top = hullTop(convexHull(members.map((i) => nodes[i])), pad + 12);
      const p = engine.graphToScreen(top.x, top.y);
      haloText(cx, truncate(engine.groupLabel(group), 32), p.x, p.y - 3, theme.text, theme.surface);
    }
  }

  // In "auto", a caption or edge label that would cover a node or another label is left out. Node captions
  // go first (emphasized nodes, then the bigger, busier ones), edge labels after them.
  const auto = options.labelMode === "auto";
  const emphasized = (i: number) => selNodes.has(i) || i === hoverNode || (focus !== null && focus.nodes.has(i));
  const onScreen: number[] = [];
  // The captions by priority, highest first, in node order within one. Nodes are grouped by priority and only
  // the priorities are sorted: there are few (a node's radius comes from its degree), and on QuickJS a sort of
  // every node with a comparator took longer than the rest of the frame.
  const byPriority = new Map<number, number[]>();
  const emphasizedAny = selNode >= 0 || hoverNode >= 0 || focus !== null;
  const anyCaption = options.labelMode !== "never" && (!auto || emphasizedAny || maxR * k >= 9);
  // Edge bundles are captioned with their count even without edgeLabels.
  const edgeText = options.edgeLabels || engine.bundleCount > 0;
  if (anyCaption || edgeText) {
    for (let i = 0; i < nodes.length; i++) {
      if (inView[i] === 0) continue;
      onScreen.push(i);
      if (!anyCaption) continue;
      const strong = emphasized(i);
      if (auto && (focus !== null ? !strong : nodes[i].r * k < 9 && !strong)) continue;
      const priority = (strong ? 1e6 : 0) + nodes[i].r;
      const group = byPriority.get(priority);
      if (group) group.push(i);
      else byPriority.set(priority, [i]);
    }
  }
  const order: number[] = [];
  for (const priority of [...byPriority.keys()].sort((a, b) => b - a)) for (const i of byPriority.get(priority)!) order.push(i);
  // More captions than this cannot be read anyway; the busiest nodes keep theirs.
  if (auto && order.length > 300) order.length = 300;
  const occupied = new RectGrid(48);
  if (auto && (order.length > 0 || edgeText)) {
    // Nodes are obstacles (a little smaller than drawn, so captions may graze them).
    for (const i of onScreen) {
      const r = nodes[i].r * k * 0.85;
      const x = nodes[i].x * k + tx;
      const y = nodes[i].y * k + ty;
      occupied.add({ x0: x - r, y0: y - r, x1: x + r, y1: y + r, owner: i });
    }
  }

  // A super node shows how many nodes it holds, inside it (its caption goes under it).
  for (const i of supers) {
    const n = nodes[i];
    const sr = n.r * k;
    if (sr < 7) continue;
    const size = Math.max(9, Math.min(18, sr * 0.55));
    cx.font = `700 ${size.toFixed(1)}px ${theme.fontFamily}`;
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    cx.globalAlpha = focus !== null && !focus.nodes.has(i) ? DIM + 0.3 : 1;
    cx.fillStyle = inkOn(fills[i]);
    cx.fillText(String(n.members), n.x * k + tx, n.y * k + ty, sr * 1.4);
  }
  cx.globalAlpha = 1;

  if (anyCaption) {
    for (const i of order) {
      const n = nodes[i];
      const sr = n.r * k;
      const strong = emphasized(i);
      if (auto && focus !== null && !strong) continue;
      if (auto && sr < 9 && !strong) continue;
      const caption = truncate(n.node.caption ?? n.id);
      const p = { x: n.x * k + tx, y: n.y * k + ty };
      // Inside the node when it is big enough to hold the caption, under it otherwise.
      if (sr >= 16 && n.superOf === null) {
        const size = Math.max(10, Math.min(14, sr * 0.36));
        const font = `600 ${size.toFixed(1)}px ${theme.fontFamily}`;
        cx.font = font;
        if (measure(cx, font, caption) <= sr * 1.7) {
          cx.textAlign = "center";
          cx.textBaseline = "middle";
          cx.fillStyle = inkOn(fills[i]);
          cx.fillText(caption, p.x, p.y);
          continue;
        }
      }
      const font = `${strong ? "600 " : ""}11px ${theme.fontFamily}`;
      cx.font = font;
      const w = measure(cx, font, caption);
      const y = p.y + sr + 4;
      const rect = { x0: p.x - w / 2 - 2, y0: y - 1, x1: p.x + w / 2 + 2, y1: y + 14, owner: i };
      if (auto && !strong && occupied.hits(rect)) continue;
      occupied.add(rect);
      cx.textAlign = "center";
      cx.textBaseline = "top";
      haloText(cx, caption, p.x, y, theme.text, theme.surface);
    }
  }

  if (edgeText) {
    const font = `10px ${theme.fontFamily}`;
    cx.font = font;
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    // Highlighted edges first, so theirs win the space.
    const candidates: number[] = [];
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (!e.edge.caption || state(i) === 0) continue;
      if (options.edgeLabels || (e.bundle !== null && e.bundle.length > 1)) candidates.push(i);
    }
    candidates.sort((a, b) => state(b) - state(a) || a - b);
    for (const i of candidates) {
      const st = state(i);
      if (k < 0.55 && st !== 2) continue;
      if (!edgeVisible(i)) continue;
      const s = shape(i);
      const p = engine.graphToScreen(s.mid.x, s.mid.y);
      const text = truncate(edges[i].edge.caption!, 24);
      const w = measure(cx, font, text) + 4;
      // Only when the edge is long enough on screen to carry it.
      const span = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) * k;
      if (span < w + 12 && st !== 2) continue;
      let a = s.angle;
      if (a > Math.PI / 2) a -= Math.PI;
      if (a < -Math.PI / 2) a += Math.PI;
      // The rotated label's bounding box.
      const hx = (Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * 12) / 2;
      const hy = (Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * 12) / 2;
      const rect = { x0: p.x - hx, y0: p.y - hy, x1: p.x + hx, y1: p.y + hy, owner: -2 - i };
      if (auto && occupied.hits(rect)) continue;
      occupied.add(rect);
      cx.save();
      cx.translate(p.x, p.y);
      cx.rotate(a);
      haloText(cx, text, 0, 0, st === 2 ? theme.text : theme.edgeText, theme.surface);
      cx.restore();
    }
  }

  // ---- The selection box being dragged, over everything.
  const m = engine.marquee;
  if (m) {
    const x = Math.min(m.x0, m.x1);
    const y = Math.min(m.y0, m.y1);
    const w = Math.abs(m.x1 - m.x0);
    const h = Math.abs(m.y1 - m.y0);
    cx.fillStyle = withAlpha(theme.selection, 0.1);
    cx.fillRect(x, y, w, h);
    cx.strokeStyle = withAlpha(theme.selection, 0.8);
    cx.lineWidth = 1;
    cx.beginPath();
    cx.moveTo(x + 0.5, y + 0.5);
    cx.lineTo(x + w + 0.5, y + 0.5);
    cx.lineTo(x + w + 0.5, y + h + 0.5);
    cx.lineTo(x + 0.5, y + h + 0.5);
    cx.closePath();
    cx.stroke();
  }
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The node the rect belongs to: a caption does not collide with its own node. */
  owner: number;
}

/** Rectangles bucketed by cell, for quick overlap tests. */
class RectGrid {
  private cells = new Map<number, Rect[]>();
  constructor(private size: number) {}

  // Every rect is added and tested once per frame, so these loop inline rather than through callbacks.
  add(r: Rect) {
    const s = this.size;
    const cx1 = Math.floor(r.x1 / s);
    const cy0 = Math.floor(r.y0 / s);
    const cy1 = Math.floor(r.y1 / s);
    for (let cx = Math.floor(r.x0 / s); cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = ((cx & 0xffff) << 16) | (cy & 0xffff);
        const cell = this.cells.get(key);
        if (cell) cell.push(r);
        else this.cells.set(key, [r]);
      }
    }
  }

  hits(r: Rect): boolean {
    const s = this.size;
    const cx1 = Math.floor(r.x1 / s);
    const cy0 = Math.floor(r.y0 / s);
    const cy1 = Math.floor(r.y1 / s);
    for (let cx = Math.floor(r.x0 / s); cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = this.cells.get(((cx & 0xffff) << 16) | (cy & 0xffff));
        if (!cell) continue;
        for (const o of cell) if (o.owner !== r.owner && o.x0 < r.x1 && o.x1 > r.x0 && o.y0 < r.y1 && o.y1 > r.y0) return true;
      }
    }
    return false;
  }
}

function haloText(cx: Ctx2D, text: string, x: number, y: number, ink: string, halo: string) {
  cx.strokeStyle = halo;
  cx.lineWidth = 3;
  cx.strokeText(text, x, y);
  cx.fillStyle = ink;
  cx.fillText(text, x, y);
}
