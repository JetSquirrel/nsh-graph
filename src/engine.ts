/**
 * The graph view's state and behavior, apart from NSH: the nodes and edges with their positions, the
 * layouts, the viewport (pan and zoom), hit testing, hover, selection, dragging and pinning.
 * `GraphView` connects it to a canvas and input; it can also be driven and tested on its own.
 */
import { edgeDistance, edgeShape, type EdgeShape, type Pt } from "./geometry";
import { nativeBackend, type NativeGraphPainter } from "./native";
import { circularLayout, gridLayout, hierarchicalLayout, type LayoutNode, type Positions } from "./layouts";
import { OTHER, SlotAssigner, naturalCompare } from "./palette";
import { strokeWidth } from "./render";
import { ForceSimulation, lcg, phyllotaxis, type SimNode } from "./simulation";
import type {
  ColorBy,
  ForceConfig,
  GraphData,
  GraphEdge,
  GraphNode,
  HierarchicalConfig,
  HitTarget,
  LabelMode,
  LayoutKind,
  NodeSizing,
  ResolvedEdge,
  Selection,
} from "./types";

export interface EngineNode extends SimNode {
  id: string;
  index: number;
  node: GraphNode;
  degree: number;
  category: string;
  /** Neighbor indices (either direction, self excluded). */
  neighbors: Set<number>;
  /** Whether `pinned` came from the data (so a later `pinned: false` releases it). */
  pinnedByData: boolean;
}

export interface EngineEdge {
  id: string;
  edge: ResolvedEdge;
  source: number;
  target: number;
  /** Sideways offset of the curve, for parallel edges. */
  bend: number;
  self: boolean;
  loopIndex: number;
}

export interface EngineOptions {
  layout: LayoutKind;
  force: Partial<ForceConfig>;
  hierarchical: Partial<HierarchicalConfig>;
  nodeSizing: NodeSizing;
  colorBy: ColorBy;
  labelMode: LabelMode;
  arrows: boolean;
  edgeLabels: boolean;
  groupHulls: boolean;
  /** A dragged node stays pinned where it is dropped. */
  stickyDrag: boolean;
  minZoom: number;
  maxZoom: number;
  /** Settle layouts and viewport moves without animating them. */
  reduceMotion: boolean;
  /** Padding around the graph when fitting, in points. */
  fitPadding: number;
}

export const DEFAULT_OPTIONS: EngineOptions = {
  layout: "force",
  force: {},
  hierarchical: {},
  nodeSizing: { kind: "degree", min: 14, max: 30 },
  colorBy: "category",
  labelMode: "auto",
  arrows: true,
  edgeLabels: false,
  groupHulls: false,
  stickyDrag: false,
  minZoom: 0.05,
  maxZoom: 6,
  reduceMotion: false,
  fitPadding: 40,
};

/** What the engine reports to its host. */
export type EngineEvent =
  | { type: "selection"; selection: Selection }
  | { type: "hover"; target: HitTarget | null };

interface Viewport {
  k: number;
  tx: number;
  ty: number;
}

/** How long the first load may tick before its first frame, in ms. */
const WARM_UP_MS = 60;
const PARALLEL_SPACING = 22;
const TWEEN_MS = 450;
const VIEW_TWEEN_MS = 300;

export class GraphEngine {
  nodes: EngineNode[] = [];
  edges: EngineEdge[] = [];
  options: EngineOptions;
  readonly sim: ForceSimulation;

  /** The canvas size in points. */
  width = 0;
  height = 0;
  /** Viewport: screen = graph * k + (tx, ty). */
  k = 1;
  tx = 0;
  ty = 0;
  /** The viewport follows the layout until the user pans or zooms. */
  autoFit = true;

  /** The hovered target (pointer over it), or null. */
  hovered: { kind: "node"; index: number } | { kind: "edge"; index: number } | null = null;
  /**
   * The primary selection, by id: the edge selected, or the node selected last. With several nodes
   * selected, `selectedNodes` holds them all.
   */
  selected: { kind: "node" | "edge"; id: string } | null = null;
  /** The selected nodes' ids, in the order they were selected: the primary one is last. Empty for an edge. */
  selectedNodes: ReadonlySet<string> = new Set();
  /** The selection box being dragged, in screen points, or null. */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** The node being dragged, or -1. */
  dragging = -1;

  /** Something changed that the next frame must draw. */
  dirty = true;
  /** Bumped whenever positions change, to invalidate cached edge shapes. */
  geometryVersion = 0;

  onEvent: ((e: EngineEvent) => void) | null = null;

  private byId = new Map<string, EngineNode>();
  private edgeById = new Map<string, EngineEdge>();
  private slots = new SlotAssigner(8);
  private random = lcg(42);
  private loaded = false;
  private tween: { from: Positions; to: Positions; start: number } | null = null;
  private viewTween: { from: Viewport; to: Viewport; start: number } | null = null;
  private shapes: EdgeShape[] = [];
  private shapeStamp: number[] = [];
  private dragWasPinned = false;
  /** The other selected nodes that move with the dragged one: index, offset, and whether it was pinned. */
  private dragGroup: { index: number; dx: number; dy: number; wasPinned: boolean }[] = [];
  /** The selection a box drag started from (it adds to it), or null for a fresh one. */
  private marqueeBase: string[] | null = null;
  /** Layout ticks wait until then (ms, `performance.now`) while the user pans or zooms. */
  private layoutHold = 0;
  /** What the last layout tick cost, in ms. */
  lastTickMs = 0;
  /** When the last reduced-motion progress was shown (ms). */
  private lastQuietDraw = -Infinity;

  /** Traces edges and nodes into batched paths in Rust, when `setNativeBackend` registered a backend. */
  readonly painter: NativeGraphPainter | null;

  constructor(options: Partial<EngineOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.sim = new ForceSimulation(this.options.force);
    const native = nativeBackend();
    this.painter = native?.GraphPainter ? new native.GraphPainter() : null;
  }

  // -------------------------------------------------------------------------------------------
  // Data

  /**
   * Shows `data`. Nodes are matched by id with what is shown already: they keep their positions, pins
   * and selection; new ones start next to a neighbor that is already placed.
   */
  setData(data: GraphData) {
    const previous = this.byId;
    const nodes: EngineNode[] = [];
    const byId = new Map<string, EngineNode>();
    let added = 0;
    for (const node of data.nodes) {
      if (byId.has(node.id)) continue; // first one wins
      let n = previous.get(node.id);
      if (n) {
        n.node = node;
      } else {
        n = {
          id: node.id,
          index: 0,
          node,
          x: NaN,
          y: NaN,
          vx: 0,
          vy: 0,
          fx: null,
          fy: null,
          r: 0,
          group: null,
          degree: 0,
          category: "",
          neighbors: new Set(),
          pinnedByData: false,
        };
        added++;
      }
      n.index = nodes.length;
      n.group = node.group ?? null;
      n.category = node.category ?? "";
      n.degree = 0;
      n.neighbors = new Set();
      nodes.push(n);
      byId.set(node.id, n);
    }
    const removed = previous.size - (nodes.length - added);

    // Edges: drop those with a missing end; number parallel edges and loops.
    const edges: EngineEdge[] = [];
    const edgeById = new Map<string, EngineEdge>();
    const pairCount = new Map<string, number>();
    const pairs: string[] = [];
    for (const edge of data.edges) {
      const s = byId.get(edge.from);
      const t = byId.get(edge.to);
      if (!s || !t) continue;
      const pair = edge.from < edge.to ? `${edge.from}\u0000${edge.to}` : `${edge.to}\u0000${edge.from}`;
      const nth = pairCount.get(pair) ?? 0;
      pairCount.set(pair, nth + 1);
      let id = edge.id ?? `${edge.from}->${edge.to}#${nth}`;
      if (edgeById.has(id)) id = `${id}~${edges.length}`;
      const e: EngineEdge = {
        id,
        edge: edge.id === id ? (edge as ResolvedEdge) : { ...edge, id },
        source: s.index,
        target: t.index,
        bend: 0,
        self: s === t,
        loopIndex: nth,
      };
      edges.push(e);
      pairs.push(pair);
      edgeById.set(id, e);
      if (s !== t) {
        s.degree++;
        t.degree++;
        s.neighbors.add(t.index);
        t.neighbors.add(s.index);
      } else {
        s.degree++;
      }
    }
    edges.forEach((e, i) => {
      if (e.self) return;
      const m = pairCount.get(pairs[i])!;
      if (m < 2) return;
      // Spread m parallel edges symmetrically; flip for edges drawn the other way round.
      const offset = (e.loopIndex - (m - 1) / 2) * PARALLEL_SPACING;
      e.bend = e.edge.from < e.edge.to ? offset : -offset;
    });

    this.nodes = nodes;
    this.edges = edges;
    this.byId = byId;
    this.edgeById = edgeById;
    this.updateRadii();
    this.placeNewNodes();
    for (const n of nodes) {
      if (n.node.pinned === true) {
        n.fx = n.x;
        n.fy = n.y;
        n.pinnedByData = true;
      } else if (n.node.pinned === false && n.pinnedByData) {
        n.fx = n.fy = null;
        n.pinnedByData = false;
      }
    }
    this.sim.setGraph(nodes, edges.map((e) => ({ source: e.source, target: e.target })));

    // Keep hover and selection when their target is still there.
    this.hovered = null;
    if (this.selected?.kind === "edge") {
      if (!edgeById.has(this.selected.id)) this.setSelected(null);
    } else if (this.selected) {
      const kept = [...this.selectedNodes].filter((id) => byId.has(id));
      if (kept.length !== this.selectedNodes.size) this.commitNodes(kept);
    }
    if (this.dragging >= 0) this.dragging = -1;
    this.dragGroup = [];

    this.prepareColors();
    const first = !this.loaded;
    this.loaded = this.loaded || nodes.length > 0;
    if (first || added > 0 || removed > 0) this.runLayout(first ? 1 : added > 0 ? 0.6 : 0.3, first);
    this.geometryVersion++;
    this.dirty = true;
    if (this.painter) {
      const packed = new Float64Array(edges.length * 5);
      edges.forEach((e, i) => {
        packed.set([e.source, e.target, e.bend, e.self ? 1 : 0, e.loopIndex], i * 5);
      });
      this.painter.setEdges(new Uint8Array(packed.buffer));
    }
  }

  /** Gives palette slots to the categories (or groups) shown, biggest first. */
  private prepareColors(reset = false) {
    const counts = new Map<string, number>();
    for (const n of this.nodes) {
      const key = this.colorKey(n);
      if (key !== "") counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const keys = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || naturalCompare(a, b));
    if (reset) this.slots.reset();
    this.slots.prepare(keys);
  }

  private updateRadii() {
    const sizing = this.options.nodeSizing;
    let maxDeg = 1;
    for (const n of this.nodes) maxDeg = Math.max(maxDeg, n.degree);
    for (const n of this.nodes) {
      const own = n.node.size;
      n.r =
        own !== undefined && Number.isFinite(own) && own > 0
          ? own
          : (sizing.kind === "fixed"
          ? sizing.radius
          : sizing.min + (sizing.max - sizing.min) * Math.sqrt(n.degree / maxDeg));
      if (!(n.r > 0)) n.r = 1;
    }
  }

  private placeNewNodes() {
    const fresh = this.nodes.filter((n) => Number.isNaN(n.x));
    if (fresh.length === 0) return;
    const placedBefore = this.nodes.length - fresh.length;
    const center = placedBefore > 0 ? this.screenToGraph(this.width / 2, this.height / 2) : { x: 0, y: 0 };
    const linkDistance = this.sim.config.linkDistance;
    let spiral = 0;
    // Several passes, so chains of new nodes each start next to the one before.
    for (let pass = 0; pass < 3; pass++) {
      for (const n of fresh) {
        if (!Number.isNaN(n.x)) continue;
        if (Number.isFinite(n.node.x) && Number.isFinite(n.node.y)) {
          n.x = n.node.x!;
          n.y = n.node.y!;
          continue;
        }
        let anchor: EngineNode | null = null;
        for (const j of n.neighbors) {
          const m = this.nodes[j];
          if (!Number.isNaN(m.x)) { anchor = m; break; }
        }
        if (anchor && (placedBefore > 0 || pass > 0)) {
          const angle = this.random() * Math.PI * 2;
          const d = linkDistance * (0.4 + this.random() * 0.4) + anchor.r;
          n.x = anchor.x + Math.cos(angle) * d;
          n.y = anchor.y + Math.sin(angle) * d;
        } else if (pass === 2 || placedBefore === 0) {
          const p = phyllotaxis(spiral++, center.x, center.y, 18);
          n.x = p.x;
          n.y = p.y;
        }
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Options and layout

  setOptions(options: Partial<EngineOptions>) {
    const prev = this.options;
    this.options = { ...prev, ...options };
    const o = this.options;
    if (options.force) this.sim.setConfig(options.force);
    if (options.nodeSizing && JSON.stringify(options.nodeSizing) !== JSON.stringify(prev.nodeSizing)) {
      this.updateRadii();
      if (o.layout === "force") this.sim.reheat(0.3);
    }
    if (options.colorBy && options.colorBy !== prev.colorBy) this.prepareColors(true);
    const layoutChanged =
      (options.layout !== undefined && options.layout !== prev.layout) ||
      (options.hierarchical !== undefined && JSON.stringify(options.hierarchical) !== JSON.stringify(prev.hierarchical));
    if (layoutChanged) this.runLayout(0.8, false);
    else if (options.force && o.layout === "force") this.sim.reheat(0.5);
    this.geometryVersion++;
    this.dirty = true;
  }

  /** Runs the current layout again from where the nodes are. */
  relayout() {
    this.autoFit = true;
    this.runLayout(1, false);
  }

  private runLayout(alpha: number, first: boolean) {
    const o = this.options;
    if (o.layout === "force") {
      this.tween = null;
      this.sim.reheat(alpha);
      if (first) {
        this.warmUp();
        if (this.autoFit) this.fit(false);
      }
      return;
    }
    this.sim.stop();
    const layoutNodes: LayoutNode[] = this.nodes.map((n) => ({
      r: n.r,
      category: n.category,
      group: n.group,
      degree: n.degree,
    }));
    const layoutEdges = this.edges.map((e) => ({ source: e.source, target: e.target }));
    const targets =
      o.layout === "hierarchical"
        ? hierarchicalLayout(layoutNodes, layoutEdges, o.hierarchical)
        : o.layout === "circular"
          ? circularLayout(layoutNodes)
          : gridLayout(layoutNodes);
    // Pinned nodes stay where they are.
    this.nodes.forEach((n, i) => {
      if (n.fx !== null) targets[i] = { x: n.fx, y: n.fy! };
    });
    const from = this.nodes.map((n) => ({ x: n.x, y: n.y }));
    if (o.reduceMotion || first) {
      this.applyPositions(targets);
      this.tween = null;
    } else {
      this.tween = { from, to: targets, start: -1 };
    }
    if (this.autoFit) this.fitTo(targets, !first);
  }

  /** On the first load, settle the roughest part of the layout before the first frame. */
  private warmUp() {
    // A TypeScript tick costs about 0.055 ms per node on QuickJS: past ~1000 nodes even the first one would
    // overrun the budget and hold the first frame (a 5000-node tick takes a quarter of a second or more).
    if (!this.sim.isNative && this.nodes.length * 0.055 > WARM_UP_MS) return;
    const start = now();
    while (this.sim.alpha > 0.35 && now() - start < WARM_UP_MS) this.sim.tick();
    this.geometryVersion++;
  }

  private applyPositions(p: Positions) {
    this.nodes.forEach((n, i) => {
      n.x = p[i].x;
      n.y = p[i].y;
      n.vx = n.vy = 0;
    });
    this.geometryVersion++;
  }

  // -------------------------------------------------------------------------------------------
  // Frames

  /**
   * Advances the layout and the viewport animations to `time` (ms). Returns whether another frame is
   * needed. Call `consumeDirty()` to learn whether to redraw.
   */
  step(time: number): boolean {
    let busy = false;
    if (this.tween) {
      const t = this.tween;
      if (t.start < 0) t.start = time;
      const u = Math.min(1, (time - t.start) / TWEEN_MS);
      const e = easeInOut(u);
      this.nodes.forEach((n, i) => {
        if (n.index === this.dragging) return;
        n.x = t.from[i].x + (t.to[i].x - t.from[i].x) * e;
        n.y = t.from[i].y + (t.to[i].y - t.from[i].y) * e;
      });
      this.geometryVersion++;
      this.dirty = true;
      if (u >= 1) this.tween = null;
      else busy = true;
    }
    const held = this.lastTickMs > 8 && now() < this.layoutHold;
    if (this.options.layout === "force" && this.sim.running && held) {
      busy = true;
    } else if (this.options.layout === "force" && this.sim.running && this.options.reduceMotion && this.dragging < 0) {
      // No animation: settle in slices small enough to keep the app responsive (on QuickJS a whole settle
      // can take seconds), without drawing the steps. The result shows once it settles, as a jump, or every
      // half second when settling takes long.
      const start = now();
      let ticks = 0;
      do {
        this.sim.tick();
        ticks++;
      } while (this.sim.running && now() - start < 10);
      this.lastTickMs = (now() - start) / ticks;
      this.geometryVersion++;
      if (!this.sim.running || time - this.lastQuietDraw >= 500) {
        this.lastQuietDraw = time;
        this.dirty = true;
        if (this.autoFit) this.fit(false);
      }
      busy = busy || this.sim.running;
    } else if (this.options.layout === "force" && this.sim.running) {
      const t0 = now();
      this.sim.tick();
      this.lastTickMs = now() - t0;
      this.geometryVersion++;
      this.dirty = true;
      busy = busy || this.sim.running;
      if (this.autoFit && this.dragging < 0) this.followLayout();
    }
    if (this.viewTween) {
      const v = this.viewTween;
      if (v.start < 0) v.start = time;
      const u = Math.min(1, (time - v.start) / VIEW_TWEEN_MS);
      const e = easeInOut(u);
      this.k = v.from.k + (v.to.k - v.from.k) * e;
      this.tx = v.from.tx + (v.to.tx - v.from.tx) * e;
      this.ty = v.from.ty + (v.to.ty - v.from.ty) * e;
      this.dirty = true;
      if (u >= 1) this.viewTween = null;
      else busy = true;
    }
    return busy;
  }

  /** Whether to redraw; clears the flag. */
  consumeDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  /** Whether `step` has more to do. */
  get animating(): boolean {
    return this.tween !== null || this.viewTween !== null || (this.options.layout === "force" && this.sim.running);
  }

  // -------------------------------------------------------------------------------------------
  // Viewport

  setSize(width: number, height: number) {
    if (width === this.width && height === this.height) return;
    const first = this.width === 0 || this.height === 0;
    if (!first && !this.autoFit) {
      // Keep the center where it was.
      this.tx += (width - this.width) / 2;
      this.ty += (height - this.height) / 2;
    }
    this.width = width;
    this.height = height;
    if (this.autoFit || first) this.fit(false);
    this.dirty = true;
  }

  graphToScreen(x: number, y: number): Pt {
    return { x: x * this.k + this.tx, y: y * this.k + this.ty };
  }

  screenToGraph(x: number, y: number): Pt {
    return { x: (x - this.tx) / this.k, y: (y - this.ty) / this.k };
  }

  /** Zooms by `factor` keeping the screen point (sx, sy) still. */
  zoomAt(factor: number, sx: number, sy: number) {
    const { maxZoom } = this.options;
    const k = clamp(this.k * factor, this.minZoomNow(), maxZoom);
    if (k === this.k) return;
    const p = this.screenToGraph(sx, sy);
    this.k = k;
    this.tx = sx - p.x * k;
    this.ty = sy - p.y * k;
    this.userMovedView();
  }

  /** Zooms by `factor` around the center, animated. */
  zoomBy(factor: number) {
    const { maxZoom } = this.options;
    const target = this.viewTween ? this.viewTween.to : { k: this.k, tx: this.tx, ty: this.ty };
    const k = clamp(target.k * factor, this.minZoomNow(), maxZoom);
    const cx = this.width / 2;
    const cy = this.height / 2;
    const px = (cx - target.tx) / target.k;
    const py = (cy - target.ty) / target.k;
    this.userMovedView();
    this.animateView({ k, tx: cx - px * k, ty: cy - py * k });
  }

  /** minZoom, or less when the graph only fits further out. */
  private minZoomNow(): number {
    const fit = this.fitViewport(this.nodes.map((n) => ({ x: n.x, y: n.y })));
    return fit ? Math.min(this.options.minZoom, fit.k * 0.8) : this.options.minZoom;
  }

  setZoom(k: number) {
    this.zoomBy(k / (this.viewTween ? this.viewTween.to.k : this.k));
  }

  panBy(dx: number, dy: number) {
    this.tx += dx;
    this.ty += dy;
    this.userMovedView();
  }

  /** Centers the graph point (x, y), animated. */
  centerOn(x: number, y: number) {
    this.animateView({ k: this.k, tx: this.width / 2 - x * this.k, ty: this.height / 2 - y * this.k });
  }

  /** Fits the whole graph in view; the viewport then follows the layout again until the user moves it. */
  fit(animated = true) {
    this.autoFit = true;
    this.fitTo(this.nodes.map((n) => ({ x: n.x, y: n.y })), animated);
  }

  /** Fits these nodes in view (the rest of the graph may fall outside); the view stops following the layout. */
  fitNodes(ids: Iterable<string>, animated = true) {
    const picked: EngineNode[] = [];
    for (const id of ids) {
      const n = this.byId.get(id);
      if (n) picked.push(n);
    }
    if (picked.length === 0) return;
    this.autoFit = false;
    this.fitTo(
      picked.map((n) => ({ x: n.x, y: n.y })),
      animated,
      picked.map((n) => n.r),
    );
  }

  private fitTo(points: Positions, animated: boolean, radii?: number[]) {
    const v = this.fitViewport(points, radii);
    if (!v) return;
    if (animated && !this.options.reduceMotion) this.animateView(v);
    else {
      this.viewTween = null;
      this.k = v.k;
      this.tx = v.tx;
      this.ty = v.ty;
      this.dirty = true;
    }
  }

  private fitViewport(points: Positions, radii?: number[]): Viewport | null {
    if (this.width <= 0 || this.height <= 0 || points.length === 0) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    points.forEach((p, i) => {
      const r = (radii ? radii[i] : this.nodes[i]?.r) ?? 0;
      if (Number.isNaN(p.x)) return;
      x0 = Math.min(x0, p.x - r);
      y0 = Math.min(y0, p.y - r);
      x1 = Math.max(x1, p.x + r);
      y1 = Math.max(y1, p.y + r);
    });
    if (!Number.isFinite(x0)) return null;
    const pad = this.options.fitPadding;
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);
    // Below minZoom when that is what showing everything takes: minZoom limits the user, not fitting.
    const k = clamp(
      Math.min((this.width - pad * 2) / w, (this.height - pad * 2) / h),
      Math.min(this.options.minZoom, 1e-4),
      Math.min(this.options.maxZoom, 1.5),
    );
    return { k, tx: this.width / 2 - ((x0 + x1) / 2) * k, ty: this.height / 2 - ((y0 + y1) / 2) * k };
  }

  /** While the layout runs, glide toward the fitted viewport. */
  private followLayout() {
    if (this.viewTween) return;
    const v = this.fitViewport(this.nodes.map((n) => ({ x: n.x, y: n.y })));
    if (!v) return;
    const s = this.options.reduceMotion ? 1 : 0.18;
    // Zoom out promptly, zoom in only slowly, so the view does not pump.
    const ks = v.k < this.k ? s : s * 0.4;
    this.k += (v.k - this.k) * ks;
    const cx = (this.width / 2 - this.tx) / this.k;
    const cy = (this.height / 2 - this.ty) / this.k;
    const tcx = (this.width / 2 - v.tx) / v.k;
    const tcy = (this.height / 2 - v.ty) / v.k;
    const ncx = cx + (tcx - cx) * s;
    const ncy = cy + (tcy - cy) * s;
    this.tx = this.width / 2 - ncx * this.k;
    this.ty = this.height / 2 - ncy * this.k;
  }

  private animateView(to: Viewport) {
    if (this.options.reduceMotion) {
      this.viewTween = null;
      this.k = to.k;
      this.tx = to.tx;
      this.ty = to.ty;
    } else {
      this.viewTween = { from: { k: this.k, tx: this.tx, ty: this.ty }, to, start: -1 };
    }
    this.dirty = true;
  }

  /**
   * The user is panning or zooming: when layout ticks are expensive (big graphs on QuickJS), hold them for
   * `ms`, so frames only redraw and the view follows the fingers.
   */
  holdLayout(ms = 150) {
    this.layoutHold = now() + ms;
  }

  private userMovedView() {
    this.autoFit = false;
    this.viewTween = null;
    this.dirty = true;
  }

  // -------------------------------------------------------------------------------------------
  // Edge shapes and hit testing

  /** Edge i's shape at the current positions, computed when first asked for and kept until they move. */
  edgeShape(i: number): EdgeShape {
    if (this.shapeStamp[i] === this.geometryVersion) return this.shapes[i];
    const e = this.edges[i];
    const s = this.nodes[e.source];
    const t = this.nodes[e.target];
    const shape = edgeShape(s, s.r, t, t.r, e.bend, e.self, e.loopIndex);
    this.shapes[i] = shape;
    this.shapeStamp[i] = this.geometryVersion;
    return shape;
  }

  /** Every edge's shape. */
  edgeShapes(): EdgeShape[] {
    return this.edges.map((_, i) => this.edgeShape(i));
  }

  /**
   * Whether edge i may reach into the graph-space rectangle: a cheap test on its ends (grown by its curve or
   * loop), so off-screen edges and edges far from a pointer are skipped without computing their shapes.
   */
  edgeMayTouch(i: number, x0: number, y0: number, x1: number, y1: number): boolean {
    const e = this.edges[i];
    const s = this.nodes[e.source];
    const t = this.nodes[e.target];
    const pad = Math.max(s.r, t.r) + (e.self ? s.r * 3.2 + 18 : Math.abs(e.bend) * 2);
    return !(
      Math.max(s.x, t.x) + pad < x0 ||
      Math.min(s.x, t.x) - pad > x1 ||
      Math.max(s.y, t.y) + pad < y0 ||
      Math.min(s.y, t.y) - pad > y1
    );
  }

  /**
   * What is under the screen point (sx, sy). `slop` widens targets, in screen points (more for touch).
   * Nodes win over edges; the topmost node (drawn last) wins.
   */
  hitTest(sx: number, sy: number, slop = 2): HitTarget {
    const hit = this.hitIndex(sx, sy, slop);
    if (!hit) return { kind: "background" };
    return hit.kind === "node"
      ? { kind: "node", node: this.nodes[hit.index].node }
      : { kind: "edge", edge: this.edges[hit.index].edge };
  }

  hitIndex(sx: number, sy: number, slop = 2): { kind: "node" | "edge"; index: number } | null {
    const p = this.screenToGraph(sx, sy);
    const s = slop / this.k;
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      const r = n.r + s;
      const dx = p.x - n.x;
      const dy = p.y - n.y;
      if (dx * dx + dy * dy <= r * r) return { kind: "node", index: i };
    }
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.edges.length; i++) {
      const tolerance = Math.max(3, strokeWidth(this.edges[i].edge.width) / 2) / this.k + s;
      if (!this.edgeMayTouch(i, p.x - tolerance, p.y - tolerance, p.x + tolerance, p.y + tolerance)) continue;
      const d = edgeDistance(p, this.edgeShape(i));
      if (d <= tolerance && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best >= 0 ? { kind: "edge", index: best } : null;
  }

  // -------------------------------------------------------------------------------------------
  // Hover and selection

  /** Hover what is under (sx, sy); null clears. Returns whether it changed. */
  hoverAt(sx: number | null, sy = 0): boolean {
    const hit = sx === null ? null : this.hitIndex(sx, sy, 2);
    const same =
      (hit === null && this.hovered === null) ||
      (hit !== null && this.hovered !== null && hit.kind === this.hovered.kind && hit.index === this.hovered.index);
    if (same) return false;
    this.hovered = hit as typeof this.hovered;
    this.dirty = true;
    this.onEvent?.({ type: "hover", target: this.hoverTarget() });
    return true;
  }

  hoverTarget(): HitTarget | null {
    const h = this.hovered;
    if (!h) return null;
    return h.kind === "node"
      ? { kind: "node", node: this.nodes[h.index].node }
      : { kind: "edge", edge: this.edges[h.index].edge };
  }

  /** Selects one node or edge by id, replacing the selection (null clears). */
  setSelected(sel: { kind: "node" | "edge"; id: string } | null) {
    if (sel && sel.kind === "node") return this.commitNodes(this.byId.has(sel.id) ? [sel.id] : []);
    if (sel && !this.edgeById.has(sel.id)) sel = null;
    const a = this.selected;
    const same = a === sel || (a !== null && sel !== null && a.kind === sel.kind && a.id === sel.id);
    if (same && this.selectedNodes.size === 0) return;
    this.selected = sel;
    this.selectedNodes = new Set();
    this.changedSelection();
  }

  /**
   * Changes which nodes are selected: `replace` selects just `ids`, `add` and `remove` change the
   * selection by them, and `toggle` flips each. Ids not in the graph are skipped. A node added becomes
   * the primary one; a selected edge is let go.
   */
  selectNodes(ids: Iterable<string>, mode: "replace" | "add" | "remove" | "toggle" = "replace") {
    const next = new Set(mode === "replace" ? [] : this.selectedNodes);
    for (const id of ids) {
      if (!this.byId.has(id)) continue;
      const had = next.delete(id);
      if (mode === "remove" || (mode === "toggle" && had)) continue;
      next.add(id); // last: the primary one
    }
    this.commitNodes([...next]);
  }

  /** Whether the node is selected (the primary one or another). */
  isSelected(id: string): boolean {
    return this.selectedNodes.has(id);
  }

  /** Makes `ids` the selected nodes, the last one primary, and reports it when anything changed. */
  private commitNodes(ids: string[]) {
    const cur = [...this.selectedNodes];
    const same = this.selected?.kind !== "edge" && cur.length === ids.length && cur.every((id, i) => id === ids[i]);
    if (same) return;
    this.selectedNodes = new Set(ids);
    this.selected = ids.length > 0 ? { kind: "node", id: ids[ids.length - 1] } : null;
    this.changedSelection();
  }

  private changedSelection() {
    this.dirty = true;
    this.onEvent?.({ type: "selection", selection: this.selection() });
  }

  selection(): Selection {
    const s = this.selected;
    if (!s) return null;
    if (s.kind === "node") {
      const n = this.byId.get(s.id);
      if (!n) return null;
      const nodes: GraphNode[] = [];
      for (const id of this.selectedNodes) {
        const m = this.byId.get(id);
        if (m) nodes.push(m.node);
      }
      return { kind: "node", node: n.node, nodes };
    }
    const e = this.edgeById.get(s.id);
    return e ? { kind: "edge", edge: e.edge } : null;
  }

  /** Selects what is under (sx, sy), or clears the selection over the background. */
  selectAt(sx: number, sy: number, slop = 2): HitTarget {
    const hit = this.hitIndex(sx, sy, slop);
    if (!hit) this.setSelected(null);
    else if (hit.kind === "node") this.setSelected({ kind: "node", id: this.nodes[hit.index].id });
    else this.setSelected({ kind: "edge", id: this.edges[hit.index].id });
    return this.hitTest(sx, sy, slop);
  }

  /** The ids of the nodes whose centers are inside a screen rectangle (its corners in any order). */
  nodesInRect(x0: number, y0: number, x1: number, y1: number): string[] {
    const a = this.screenToGraph(Math.min(x0, x1), Math.min(y0, y1));
    const b = this.screenToGraph(Math.max(x0, x1), Math.max(y0, y1));
    const out: string[] = [];
    for (const n of this.nodes) if (n.x >= a.x && n.x <= b.x && n.y >= a.y && n.y <= b.y) out.push(n.id);
    return out;
  }

  /** Starts a selection box at (sx, sy); with `add` it adds to what is selected, else it starts over. */
  marqueeStart(sx: number, sy: number, add: boolean) {
    this.marquee = { x0: sx, y0: sy, x1: sx, y1: sy };
    this.marqueeBase = add ? [...this.selectedNodes] : [];
    if (!add) this.setSelected(null);
    this.dirty = true;
  }

  /** Stretches the selection box to (sx, sy). The nodes inside it are selected as it moves. */
  marqueeMove(sx: number, sy: number) {
    const m = this.marquee;
    if (!m) return;
    m.x1 = sx;
    m.y1 = sy;
    const base = this.marqueeBase ?? [];
    const seen = new Set(base);
    this.commitNodes([...base, ...this.nodesInRect(m.x0, m.y0, m.x1, m.y1).filter((id) => !seen.has(id))]);
    this.dirty = true;
  }

  marqueeEnd() {
    this.marquee = null;
    this.marqueeBase = null;
    this.dirty = true;
  }

  /**
   * What to emphasize: the hovered node (else the selected one) with its neighbors and edges, or an
   * edge with its two ends. Null when nothing is in focus.
   */
  focus(): { nodes: Set<number>; edges: Set<number> } | null {
    const f =
      this.hovered ??
      (this.selected
        ? this.selected.kind === "node"
          ? { kind: "node" as const, index: this.byId.get(this.selected.id)?.index ?? -1 }
          : { kind: "edge" as const, index: this.edges.indexOf(this.edgeById.get(this.selected.id)!) }
        : null);
    if (!this.hovered && this.selectedNodes.size > 1) {
      // Several nodes selected: all of them, their neighbors and their edges.
      const sel = new Set<number>();
      for (const id of this.selectedNodes) {
        const n = this.byId.get(id);
        if (n) sel.add(n.index);
      }
      const nodes = new Set(sel);
      for (const i of sel) for (const j of this.nodes[i].neighbors) nodes.add(j);
      const edges = new Set<number>();
      this.edges.forEach((e, i) => {
        if (sel.has(e.source) || sel.has(e.target)) edges.add(i);
      });
      return { nodes, edges };
    }
    if (!f || f.index < 0) return null;
    if (f.kind === "node") {
      const nodes = new Set(this.nodes[f.index].neighbors);
      nodes.add(f.index);
      const edges = new Set<number>();
      this.edges.forEach((e, i) => {
        if (e.source === f.index || e.target === f.index) edges.add(i);
      });
      return { nodes, edges };
    }
    const e = this.edges[f.index];
    return { nodes: new Set([e.source, e.target]), edges: new Set([f.index]) };
  }

  /** The node nearest the selected one in a direction, for arrow-key navigation. */
  nearestInDirection(dx: number, dy: number): GraphNode | null {
    if (this.nodes.length === 0) return null;
    const sel = this.selected?.kind === "node" ? this.byId.get(this.selected.id) : undefined;
    if (!sel) {
      // Start from the node nearest the center of the view.
      const c = this.screenToGraph(this.width / 2, this.height / 2);
      let best = this.nodes[0];
      let bestD = Infinity;
      for (const n of this.nodes) {
        const d = (n.x - c.x) ** 2 + (n.y - c.y) ** 2;
        if (d < bestD) { bestD = d; best = n; }
      }
      return best.node;
    }
    let best: EngineNode | null = null;
    let bestScore = Infinity;
    for (const n of this.nodes) {
      if (n === sel) continue;
      const vx = n.x - sel.x;
      const vy = n.y - sel.y;
      const d = Math.hypot(vx, vy);
      if (d === 0) continue;
      const cos = (vx * dx + vy * dy) / d;
      if (cos < 0.5) continue; // within 60° of the direction
      const score = d * (1 + 2 * (1 - cos));
      if (score < bestScore) { bestScore = score; best = n; }
    }
    return best ? best.node : null;
  }

  // -------------------------------------------------------------------------------------------
  // Dragging and pinning

  /** Starts dragging node `index`. */
  /** Starts dragging a node. When it is one of several selected nodes, they all move with it. */
  dragStart(index: number) {
    const n = this.nodes[index];
    if (!n) return;
    this.dragging = index;
    this.dragWasPinned = n.fx !== null;
    n.fx = n.x;
    n.fy = n.y;
    this.dragGroup = [];
    if (this.selectedNodes.size > 1 && this.selectedNodes.has(n.id)) {
      for (const id of this.selectedNodes) {
        const m = this.byId.get(id);
        if (!m || m === n) continue;
        this.dragGroup.push({ index: m.index, dx: m.x - n.x, dy: m.y - n.y, wasPinned: m.fx !== null });
        m.fx = m.x;
        m.fy = m.y;
      }
    }
    if (this.options.layout === "force") {
      this.sim.alphaTarget = 0.3;
      this.sim.reheat(0.3);
    }
    this.dirty = true;
  }

  /** Moves the dragged node to the screen point (sx, sy). */
  dragMove(sx: number, sy: number) {
    const n = this.nodes[this.dragging];
    if (!n) return;
    const p = this.screenToGraph(sx, sy);
    n.fx = n.x = p.x;
    n.fy = n.y = p.y;
    for (const g of this.dragGroup) {
      const m = this.nodes[g.index];
      if (!m) continue;
      m.fx = m.x = p.x + g.dx;
      m.fy = m.y = p.y + g.dy;
    }
    this.geometryVersion++;
    this.dirty = true;
  }

  dragEnd() {
    const n = this.nodes[this.dragging];
    this.dragging = -1;
    this.sim.alphaTarget = 0;
    const group = this.dragGroup;
    this.dragGroup = [];
    if (!n) return;
    if (!this.options.stickyDrag) {
      if (!this.dragWasPinned) n.fx = n.fy = null;
      for (const g of group) {
        const m = this.nodes[g.index];
        if (m && !g.wasPinned) m.fx = m.fy = null;
      }
    }
    this.dirty = true;
  }

  isPinned(id: string): boolean {
    const n = this.byId.get(id);
    return !!n && n.fx !== null;
  }

  setPinned(id: string, pinned: boolean) {
    const n = this.byId.get(id);
    if (!n) return;
    if (pinned) {
      n.fx = n.x;
      n.fy = n.y;
    } else {
      n.fx = n.fy = null;
      if (this.options.layout === "force") this.sim.reheat(0.3);
    }
    this.dirty = true;
  }

  unpinAll() {
    for (const n of this.nodes) n.fx = n.fy = null;
    if (this.options.layout === "force") this.sim.reheat(0.3);
    this.dirty = true;
  }

  // -------------------------------------------------------------------------------------------
  // Inspection

  node(id: string): GraphNode | undefined {
    return this.byId.get(id)?.node;
  }

  engineNode(id: string): EngineNode | undefined {
    return this.byId.get(id);
  }

  position(id: string): Pt | undefined {
    const n = this.byId.get(id);
    return n ? { x: n.x, y: n.y } : undefined;
  }

  degree(id: string): number {
    return this.byId.get(id)?.degree ?? 0;
  }

  neighborsOf(id: string): GraphNode[] {
    const n = this.byId.get(id);
    return n ? [...n.neighbors].map((i) => this.nodes[i].node) : [];
  }

  edgesOf(id: string): ResolvedEdge[] {
    const n = this.byId.get(id);
    if (!n) return [];
    return this.edges.filter((e) => e.source === n.index || e.target === n.index).map((e) => e.edge);
  }

  /** The key a node is colored by. */
  colorKey(n: EngineNode): string {
    return this.options.colorBy === "group" ? (n.group ?? "") : n.category;
  }

  /** A node's fill: its own color, else its category's (or group's) palette slot. */
  colorOf(n: EngineNode, palette: readonly string[], other = OTHER): string {
    if (n.node.color) return n.node.color;
    return this.keyColor(this.colorKey(n), palette, other);
  }

  /** The color of a category (or group): its palette slot; nodes without one, and those past the palette's end, share `other`. */
  private keyColor(key: string, palette: readonly string[], other: string): string {
    if (key === "") return other;
    this.slots.setCapacity(palette.length);
    const slot = this.slots.slot(key);
    return slot >= 0 ? palette[slot] : other;
  }

  /** The categories (or groups) shown, in palette order, with their colors and node counts. */
  legend(palette: readonly string[], other = OTHER): { key: string; color: string; count: number }[] {
    const counts = new Map<string, { color: string; count: number; slot: number }>();
    this.slots.setCapacity(palette.length);
    for (const n of this.nodes) {
      const key = this.colorKey(n);
      let entry = counts.get(key);
      if (!entry) {
        const slot = key === "" ? -1 : this.slots.slot(key);
        entry = { color: slot >= 0 ? palette[slot] : other, count: 0, slot: slot >= 0 ? slot : Infinity };
        counts.set(key, entry);
      }
      entry.count++;
    }
    return [...counts.entries()]
      .sort((a, b) => a[1].slot - b[1].slot || naturalCompare(a[0], b[0]))
      .map(([key, v]) => ({ key, color: v.color, count: v.count }));
  }
}

/** Merges `more` into `data`: nodes and edges by id (later ones win), others kept. */
export function mergeGraphData<N, E>(data: GraphData<N, E>, more: GraphData<N, E>): GraphData<N, E> {
  const nodes = new Map<string, GraphNode<N>>();
  for (const n of data.nodes) nodes.set(n.id, n);
  for (const n of more.nodes) nodes.set(n.id, { ...nodes.get(n.id), ...n });
  const edgeKey = (e: GraphEdge<E>) => e.id ?? `${e.from}->${e.to}:${e.caption ?? ""}`;
  const edges = new Map<string, GraphEdge<E>>();
  for (const e of data.edges) edges.set(edgeKey(e), e);
  for (const e of more.edges) edges.set(edgeKey(e), e);
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
