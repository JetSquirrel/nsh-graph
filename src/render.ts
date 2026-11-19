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
const widthCache = new Map<string, number>();

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

/** One line of at most `max` characters: control characters become spaces, and it never cuts a character in half. */
export function truncate(text: string, max = 28): string {
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
  const selNode = selectedId?.kind === "node" ? engine.engineNode(selectedId.id)?.index ?? -1 : -1;
  // Every selected node (the primary one among them).
  const selNodes = new Set<number>();
  for (const id of engine.selectedNodes) {
    const i = engine.engineNode(id)?.index;
    if (i !== undefined) selNodes.add(i);
  }
  const hoverNode = engine.hovered?.kind === "node" ? engine.hovered.index : -1;
  const hoverEdge = engine.hovered?.kind === "edge" ? engine.hovered.index : -1;
  const selEdge = selectedId?.kind === "edge" ? edges.findIndex((e) => e.id === selectedId.id) : -1;

  // The part of the graph on screen, with room for the biggest node and loops.
  let maxR = 0;
  for (const n of nodes) if (n.r > maxR) maxR = n.r;
  const margin = maxR * 4 + 40;
  const vx0 = -tx / k - margin;
  const vy0 = -ty / k - margin;
  const vx1 = (width - tx) / k + margin;
  const vy1 = (height - ty) / k + margin;
  const visible = (x: number, y: number) => x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1;
  const edgeVisible = (i: number) => engine.edgeMayTouch(i, vx0, vy0, vx1, vy1);
  const shape = (i: number) => engine.edgeShape(i);

  cx.save();
  cx.translate(tx, ty);
  cx.scale(k, k);
  cx.lineCap = "round";
  cx.lineJoin = "round";
  const px = 1 / k; // one screen point, in graph units
  // The decimals the Rust painter writes coordinates with: fewer when zoomed out, where they cannot be
  // seen (rounding moves a point 0.05 screen points at most, up to 10× zoom), for shorter paths to parse.
  const decimals = k <= 0.1 ? 0 : k <= 1 ? 1 : 2;

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
  const traceArrow = (s: EdgeShape, i: number) => {
    const len = arrowLen(edgeWidth(i));
    const a = s.endAngle;
    const spread = 0.42;
    cx.moveTo(s.b.x, s.b.y);
    cx.lineTo(s.b.x - Math.cos(a - spread) * len, s.b.y - Math.sin(a - spread) * len);
    cx.lineTo(s.b.x - Math.cos(a + spread) * len, s.b.y - Math.sin(a + spread) * len);
    cx.closePath();
  };

  const arrows = options.arrows && arrowLen(1.5) * k >= 3.5;
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
    traced = native.painter.traceEdges(sent, [vx0, vy0, vx1, vy1, arrows ? 1 : 0, arrowLen(Math.max(1.5, 0.75 * px)), decimals]);
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
      cx.beginPath();
      tracePath(shape(i), i);
      cx.strokeStyle = pass === 2 && !e.color ? color : (e.color ?? color);
      cx.lineWidth = edgeWidth(i) * (pass === 2 ? 1.4 : 1);
      cx.stroke();
      if (arrows) {
        cx.beginPath();
        traceArrow(shape(i), i);
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
    for (const i of batch) tracePath(shape(i), i);
    cx.strokeStyle = color;
    cx.lineWidth = Math.max(1.5, 0.75 * px) * (pass === 2 ? 1.4 : 1);
    cx.stroke();
    if (arrows) {
      cx.beginPath();
      for (const i of batch) traceArrow(shape(i), i);
      cx.fillStyle = color;
      cx.fill();
    }
  }
  cx.globalAlpha = 1;

  // ---- Nodes: one path per color (dimmed ones first, beneath), not a fill and a stroke per node. Batch b
  // holds the dimmed nodes of color `distinct[b]` for b < nc, the others of `distinct[b - nc]` after them.
  const nc = distinct.length;
  const nb = nc * 2;
  const counts = new Uint32Array(nb);
  // Whether a batch has a node big enough on screen for a ring.
  const ringed = new Uint8Array(nb);
  const keys = native ? new Uint32Array(nodes.length) : null;
  const members: number[][] | null = native ? null : Array.from({ length: nb }, () => []);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const x = n.x;
    const y = n.y;
    if (!(x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1)) {
      if (keys) keys[i] = 0xffffffff;
      continue;
    }
    const b = (focus !== null && !focus.nodes.has(i) ? 0 : nc) + rank[i];
    if (keys) keys[i] = b;
    else members![b].push(i);
    counts[b]++;
    if (n.r * k >= 5) ringed[b] = 1;
  }
  // The Rust painter traces each batch's circles into one path.
  const circles = native && keys ? native.painter.traceNodes(new Uint8Array(keys.buffer), nb, [vx0, vy0, vx1, vy1, decimals]) : null;
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
  cx.globalAlpha = 1;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!selNodes.has(i) && i !== hoverNode && n.fx === null) continue;
    if (!visible(n.x, n.y)) continue;
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
      haloText(cx, truncate(group, 32), p.x, p.y - 3, theme.text, theme.surface);
    }
  }

  // In "auto", a caption or edge label that would cover a node or another label is left out. Node captions
  // go first (emphasized nodes, then the bigger, busier ones), edge labels after them.
  const auto = options.labelMode === "auto";
  const emphasized = (i: number) => selNodes.has(i) || i === hoverNode || (focus !== null && focus.nodes.has(i));
  const onScreen: number[] = [];
  const order: number[] = [];
  const priority = new Map<number, number>();
  const emphasizedAny = selNode >= 0 || hoverNode >= 0 || focus !== null;
  const anyCaption = options.labelMode !== "never" && (!auto || emphasizedAny || maxR * k >= 9);
  if (anyCaption || options.edgeLabels) {
    for (let i = 0; i < nodes.length; i++) {
      if (!visible(nodes[i].x, nodes[i].y)) continue;
      onScreen.push(i);
      if (!anyCaption) continue;
      const strong = emphasized(i);
      if (auto && (focus !== null ? !strong : nodes[i].r * k < 9 && !strong)) continue;
      order.push(i);
      priority.set(i, (strong ? 1e6 : 0) + nodes[i].r);
    }
  }
  order.sort((a, b) => priority.get(b)! - priority.get(a)! || a - b);
  // More captions than this cannot be read anyway; the busiest nodes keep theirs.
  if (auto && order.length > 300) order.length = 300;
  const occupied = new RectGrid(48);
  if (auto && (order.length > 0 || options.edgeLabels)) {
    // Nodes are obstacles (a little smaller than drawn, so captions may graze them).
    for (const i of onScreen) {
      const r = nodes[i].r * k * 0.85;
      const x = nodes[i].x * k + tx;
      const y = nodes[i].y * k + ty;
      occupied.add({ x0: x - r, y0: y - r, x1: x + r, y1: y + r, owner: i });
    }
  }

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
      if (sr >= 16) {
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

  if (options.edgeLabels) {
    const font = `10px ${theme.fontFamily}`;
    cx.font = font;
    cx.textAlign = "center";
    cx.textBaseline = "middle";
    // Highlighted edges first, so theirs win the space.
    const candidates: number[] = [];
    for (let i = 0; i < edges.length; i++) if (edges[i].edge.caption && state(i) !== 0) candidates.push(i);
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

  private each(r: Rect, fn: (key: number) => boolean | void): boolean {
    const s = this.size;
    for (let cx = Math.floor(r.x0 / s); cx <= Math.floor(r.x1 / s); cx++)
      for (let cy = Math.floor(r.y0 / s); cy <= Math.floor(r.y1 / s); cy++) if (fn(((cx & 0xffff) << 16) | (cy & 0xffff))) return true;
    return false;
  }

  add(r: Rect) {
    this.each(r, (key) => {
      const cell = this.cells.get(key);
      if (cell) cell.push(r);
      else this.cells.set(key, [r]);
    });
  }

  hits(r: Rect): boolean {
    return this.each(r, (key) =>
      (this.cells.get(key) ?? []).some((o) => o.owner !== r.owner && o.x0 < r.x1 && o.x1 > r.x0 && o.y0 < r.y1 && o.y1 > r.y0),
    );
  }
}

function haloText(cx: Ctx2D, text: string, x: number, y: number, ink: string, halo: string) {
  cx.strokeStyle = halo;
  cx.lineWidth = 3;
  cx.strokeText(text, x, y);
  cx.fillStyle = ink;
  cx.fillText(text, x, y);
}
