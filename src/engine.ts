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
  GraphGroup,
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
  /** For a collapsed group's super node, the group's id; null for the data's own nodes. */
  superOf: string | null;
  /** How many nodes a super node stands for (0 for the data's own nodes). */
  members: number;
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
  /**
   * For an edge to or from a collapsed group's super node, the data's edges it stands for: several are
   * bundled into one per direction (`edge` is then made up: caption `×N`, thicker). Null for other edges.
   */
  bundle: ResolvedEdge[] | null;
}

/** The nodes' fills, as `GraphEngine.nodeColors` gives them. */
export interface NodeColors {
  /** Node i's fill. */
  fills: string[];
  /** The distinct fills, sorted. */
  distinct: string[];
  /** Node i's fill's index in `distinct`. */
  rank: Uint32Array;
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
  | { type: "hover"; target: HitTarget | null }
  | { type: "group"; group: GraphGroup; collapsed: boolean };

/** The ids of super nodes and edge bundles start with these, so they never meet the data's own ids. */
const SUPER_PREFIX = "\u0000group:";
const BUNDLE_PREFIX = "\u0000bundle:";

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
  selected: { kind: "node" | "edge" | "group"; id: string } | null = null;
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

  /** What is drawn, by id: the visible nodes of the data and the super nodes of collapsed groups. */
  private byId = new Map<string, EngineNode>();
  private edgeById = new Map<string, EngineEdge>();
  /** Every node of the data by id, members of collapsed groups too (they keep their positions there). */
  private model = new Map<string, EngineNode>();
  private modelNodes: EngineNode[] = [];
  /** Every edge of the data with both ends present, its id resolved. */
  private modelEdges: ResolvedEdge[] = [];
  private modelDegree = new Map<string, number>();
  /** The collapsed groups, and their super nodes. */
  private collapsed = new Set<string>();
  private supers = new Map<string, EngineNode>();
  /** Where a collapsed group's members were centered when it collapsed: expanding moves them by the super node's travel. */
  private anchors = new Map<string, Pt>();
  private groupLabels = new Map<string, string>();
  /** How many edge bundles are drawn (they are captioned even without `edgeLabels`). */
  bundleCount = 0;
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
  /** The edges with a color or width of their own, which are drawn one by one (the rest are batched). */
  customEdges: number[] = [];

  /** Bumped when the data changes (nodes' own colors); slot changes have the slots' version. */
  private colorStamp = 0;
  private colorCache: { palette: readonly string[]; other: string; stamp: number; slots: number; colors: NodeColors } | null = null;
  /** The positions the painter has, as `geometryVersion` stood when they were sent. */
  private paintedVersion = -1;
  private paintedNodes: EngineNode[] | null = null;
  private paintBuffer = new Float64Array(0);
  /** Bumped when radii change; the painter's radii are as of `paintedRadii`. */
  private radiiVersion = 0;
  private paintedRadii = -1;

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
    const previous = this.model;
    const model = new Map<string, EngineNode>();
    const modelNodes: EngineNode[] = [];
    for (const node of data.nodes) {
      if (model.has(node.id)) continue; // first one wins
      let n = previous.get(node.id);
      if (n) n.node = node;
      else n = newEngineNode(node.id, node);
      n.group = node.group ?? null;
      n.category = node.category ?? "";
      model.set(node.id, n);
      modelNodes.push(n);
    }

    // Edges: drop those with a missing end, and give each an id (parallel ones are numbered).
    const modelEdges: ResolvedEdge[] = [];
    const ids = new Set<string>();
    const pairCount = new Map<string, number>();
    const degree = new Map<string, number>();
    for (const edge of data.edges) {
      if (!model.has(edge.from) || !model.has(edge.to)) continue;
      const pair = edge.from < edge.to ? `${edge.from}\u0000${edge.to}` : `${edge.to}\u0000${edge.from}`;
      const nth = pairCount.get(pair) ?? 0;
      pairCount.set(pair, nth + 1);
      let id = edge.id ?? `${edge.from}->${edge.to}#${nth}`;
      if (ids.has(id)) id = `${id}~${modelEdges.length}`;
      ids.add(id);
      modelEdges.push(edge.id === id ? (edge as ResolvedEdge) : { ...edge, id });
      degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
      if (edge.to !== edge.from) degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    }

    this.model = model;
    this.modelNodes = modelNodes;
    this.modelEdges = modelEdges;
    this.modelDegree = degree;
    // Groups that are gone are no longer collapsed.
    const present = this.groupIds();
    for (const g of [...this.collapsed]) {
      if (present.has(g)) continue;
      this.collapsed.delete(g);
      this.supers.delete(g);
      this.anchors.delete(g);
    }
    this.rebuild(null);
  }

  /**
   * Works out what is drawn from the data and the collapsed groups: the data's nodes, less the members of
   * collapsed groups, plus a super node for each of those; edges to and from a super node merge into one
   * per direction, and edges inside a collapsed group are left out. `alpha`: how hard to rerun the layout
   * when nodes came or went (null: as for a data change).
   */
  private rebuild(alpha: number | null) {
    const previous = this.byId;
    const nodes: EngineNode[] = [];
    const byId = new Map<string, EngineNode>();
    const show = (n: EngineNode) => {
      n.index = nodes.length;
      n.degree = 0;
      n.neighbors = new Set();
      nodes.push(n);
      byId.set(n.id, n);
    };
    const hidden = new Map<string, EngineNode[]>();
    for (const n of this.modelNodes) {
      if (n.group !== null && this.collapsed.has(n.group)) {
        const list = hidden.get(n.group);
        if (list) list.push(n);
        else hidden.set(n.group, [n]);
      } else {
        show(n);
      }
    }
    for (const [g, members] of hidden) {
      let s = this.supers.get(g);
      if (!s) {
        s = newEngineNode(SUPER_PREFIX + g, { id: SUPER_PREFIX + g });
        const c = centroid(members);
        s.x = c.x;
        s.y = c.y;
        this.supers.set(g, s);
        this.anchors.set(g, c);
      }
      s.superOf = g;
      s.members = members.length;
      s.category = majorityCategory(members);
      s.node = { id: s.id, caption: this.groupLabels.get(g) ?? g, category: s.category || undefined, group: g };
      show(s);
    }
    let added = 0;
    for (const n of nodes) if (!previous.has(n.id)) added++;
    let removed = 0;
    for (const id of previous.keys()) if (!byId.has(id)) removed++;

    // The node that draws a data node: itself, or its group's super node.
    const slot = (id: string): EngineNode => {
      const n = this.model.get(id)!;
      return n.group !== null && this.collapsed.has(n.group) ? this.supers.get(n.group)! : n;
    };
    const edges: EngineEdge[] = [];
    const merged = new Map<string, EngineEdge>();
    for (const edge of this.modelEdges) {
      const s = slot(edge.from);
      const t = slot(edge.to);
      const touchesGroup = s.superOf !== null || t.superOf !== null;
      if (touchesGroup && s === t) continue; // inside a collapsed group
      const key = touchesGroup ? `${s.index},${t.index}` : "";
      const into = touchesGroup ? merged.get(key) : undefined;
      if (into) {
        into.bundle!.push(edge);
        continue;
      }
      const e: EngineEdge = {
        id: edge.id,
        edge,
        source: s.index,
        target: t.index,
        bend: 0,
        self: s === t,
        loopIndex: 0,
        bundle: touchesGroup ? [edge] : null,
      };
      edges.push(e);
      if (touchesGroup) merged.set(key, e);
    }
    this.bundleCount = 0;
    for (const e of merged.values()) {
      const count = e.bundle!.length;
      if (count < 2) continue; // one edge: drawn as it is, only its end moved
      const from = nodes[e.source].id;
      const to = nodes[e.target].id;
      e.id = `${BUNDLE_PREFIX}${from}\u0000${to}`;
      e.edge = { id: e.id, from, to, caption: `×${count}`, width: Math.min(6, 1.5 + Math.sqrt(count - 1)) };
      this.bundleCount++;
    }

    // Number parallel edges and loops, and count degrees and neighbors, as drawn.
    const pairCount = new Map<string, number>();
    const pairs: string[] = [];
    const edgeById = new Map<string, EngineEdge>();
    for (const e of edges) {
      const s = nodes[e.source];
      const t = nodes[e.target];
      const pair = s.id < t.id ? `${s.id}\u0000${t.id}` : `${t.id}\u0000${s.id}`;
      const nth = pairCount.get(pair) ?? 0;
      pairCount.set(pair, nth + 1);
      e.loopIndex = nth;
      pairs.push(pair);
      edgeById.set(e.id, e);
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
      e.bend = nodes[e.source].id < nodes[e.target].id ? offset : -offset;
    });

    this.nodes = nodes;
    this.edges = edges;
    this.customEdges = [];
    edges.forEach((e, i) => {
      if (e.edge.color || strokeWidth(e.edge.width) !== 1.5) this.customEdges.push(i);
    });
    this.colorStamp++;
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

    // Keep hover and selection when their target is still there. Selected nodes stay selected while
    // their group is collapsed; an edge bundled away, or a group expanded, is let go.
    this.hovered = null;
    if (this.selected?.kind === "edge") {
      if (!edgeById.has(this.selected.id)) this.setSelected(null);
    } else if (this.selected?.kind === "group") {
      if (!this.supers.has(this.selected.id)) this.setSelected(null);
    } else if (this.selected) {
      const kept = [...this.selectedNodes].filter((id) => this.model.has(id));
      if (kept.length !== this.selectedNodes.size) this.commitNodes(kept);
    }
    if (this.dragging >= 0) this.dragging = -1;
    this.dragGroup = [];

    this.prepareColors();
    const first = !this.loaded;
    this.loaded = this.loaded || nodes.length > 0;
    if (first || added > 0 || removed > 0) {
      this.runLayout(first ? 1 : alpha ?? (added > 0 ? 0.6 : 0.3), first);
    }
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

  // -------------------------------------------------------------------------------------------
  // Groups

  /** The groups present in the data. */
  private groupIds(): Set<string> {
    const ids = new Set<string>();
    for (const n of this.modelNodes) if (n.group !== null) ids.add(n.group);
    return ids;
  }

  /** The groups (communities) in the data, in the order they first appear. */
  groups(): GraphGroup[] {
    const members = new Map<string, GraphNode[]>();
    for (const n of this.modelNodes) {
      if (n.group === null) continue;
      const list = members.get(n.group);
      if (list) list.push(n.node);
      else members.set(n.group, [n.node]);
    }
    return [...members].map(([id, nodes]) => this.groupInfo(id, nodes));
  }

  /** A group by id, or undefined when no node has it. */
  group(id: string): GraphGroup | undefined {
    const nodes: GraphNode[] = [];
    for (const n of this.modelNodes) if (n.group === id) nodes.push(n.node);
    return nodes.length > 0 ? this.groupInfo(id, nodes) : undefined;
  }

  private groupInfo(id: string, nodes: GraphNode[]): GraphGroup {
    return { id, label: this.groupLabels.get(id) ?? id, collapsed: this.collapsed.has(id), nodes };
  }

  isCollapsed(id: string): boolean {
    return this.collapsed.has(id);
  }

  /** The id of a group's super node (drawn only while the group is collapsed). */
  superId(group: string): string {
    return SUPER_PREFIX + group;
  }

  /** How many super nodes are drawn. */
  get supersShown(): number {
    return this.supers.size;
  }

  /** What a group is captioned. */
  groupLabel(id: string): string {
    return this.groupLabels.get(id) ?? id;
  }

  /** The group a super node stands for, by the super node's id; null for other ids. */
  groupOfSuper(id: string): string | null {
    return this.byId.get(id)?.superOf ?? null;
  }

  /**
   * Collapses groups into super nodes (`collapse` true) or expands them again. `ids` null means every
   * group. A super node starts where its members' center was; expanded, the members come back around
   * wherever the super node went, as they were placed before. Reports a `group` event for each change.
   */
  setGroupsCollapsed(ids: Iterable<string> | null, collapse: boolean) {
    const present = this.groupIds();
    const targets = [...new Set(ids ?? present)].filter((g) => present.has(g) && this.collapsed.has(g) !== collapse);
    if (targets.length === 0) return;
    for (const g of targets) {
      const members = this.modelNodes.filter((n) => n.group === g);
      if (collapse) {
        const c = centroid(members);
        const s = newEngineNode(SUPER_PREFIX + g, { id: SUPER_PREFIX + g });
        s.x = c.x;
        s.y = c.y;
        this.supers.set(g, s);
        this.anchors.set(g, c);
        this.collapsed.add(g);
      } else {
        const s = this.supers.get(g);
        const a = this.anchors.get(g);
        if (s && a && Number.isFinite(s.x - a.x) && Number.isFinite(s.y - a.y)) {
          const dx = s.x - a.x;
          const dy = s.y - a.y;
          for (const n of members) {
            n.x += dx;
            n.y += dy;
            n.vx = n.vy = 0;
            if (n.fx !== null) n.fx += dx;
            if (n.fy !== null) n.fy += dy;
          }
        }
        this.supers.delete(g);
        this.anchors.delete(g);
        this.collapsed.delete(g);
      }
    }
    this.rebuild(0.35);
    for (const g of targets) this.onEvent?.({ type: "group", group: this.group(g)!, collapsed: collapse });
  }

  /** Collapses a group if it is expanded, expands it if collapsed. */
  toggleGroup(id: string) {
    this.setGroupsCollapsed([id], !this.collapsed.has(id));
  }

  /** What a group's hull and super node are captioned; null goes back to its id. */
  setGroupLabel(id: string, label: string | null) {
    if (label === null) this.groupLabels.delete(id);
    else this.groupLabels.set(id, label);
    const s = this.supers.get(id);
    if (s) s.node = { ...s.node, caption: label ?? id };
    this.dirty = true;
  }

  /** How many nodes and edges the data has (members of collapsed groups and bundled edges too). */
  get nodeCount(): number {
    return this.modelNodes.length;
  }

  get edgeCount(): number {
    return this.modelEdges.length;
  }

  /** The ids of every node of the data. */
  nodeIds(): string[] {
    return this.modelNodes.map((n) => n.id);
  }

  /**
   * The index (in `nodes`) of what draws a node of the data: the node itself, or the super node of its
   * collapsed group. A super node's own id gives its index too. -1 for unknown ids.
   */
  drawnIndex(id: string): number {
    const n = this.byId.get(id);
    if (n) return n.index;
    const m = this.model.get(id);
    if (m && m.group !== null) return this.supers.get(m.group)?.index ?? -1;
    return -1;
  }

  /** Gives palette slots to the categories (or groups) shown, biggest first. */
  private prepareColors(reset = false) {
    const counts = new Map<string, number>();
    // Over the data, so a group collapsing does not shuffle colors.
    for (const n of this.modelNodes) {
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
    for (const n of this.nodes) if (n.superOf === null) maxDeg = Math.max(maxDeg, n.degree);
    const biggest = sizing.kind === "fixed" ? sizing.radius : sizing.max;
    for (const n of this.nodes) {
      if (n.superOf !== null) {
        // A super node: bigger than any node, growing slowly with its member count.
        n.r = Math.max(1, biggest) * Math.min(2.2, 1.1 + 0.12 * Math.sqrt(n.members));
        continue;
      }
      const own = n.node.size;
      n.r =
        own !== undefined && Number.isFinite(own) && own > 0
          ? own
          : (sizing.kind === "fixed"
          ? sizing.radius
          : sizing.min + (sizing.max - sizing.min) * Math.sqrt(n.degree / maxDeg));
      if (!(n.r > 0)) n.r = 1;
    }
    this.radiiVersion++;
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
      this.sim.changedAll();
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
    // A TypeScript tick costs about 0.03 ms per node on QuickJS: past ~2000 nodes even the first one would
    // overrun the budget and hold the first frame (a 5000-node tick takes 150 ms or more).
    if (!this.sim.isNative && this.nodes.length * 0.03 > WARM_UP_MS) return;
    const start = now();
    // Positions are only looked at once the warm-up is over.
    while (this.sim.alpha > 0.35 && now() - start < WARM_UP_MS) this.sim.tick(1, false);
    this.sim.sync();
    this.geometryVersion++;
  }

  private applyPositions(p: Positions) {
    this.nodes.forEach((n, i) => {
      n.x = p[i].x;
      n.y = p[i].y;
      n.vx = n.vy = 0;
    });
    this.sim.changedAll(true);
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
      this.sim.changedAll();
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
        this.sim.tick(1, false);
        ticks++;
      } while (this.sim.running && now() - start < 10);
      this.sim.sync();
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
    const fit = this.fitViewport(this.nodes);
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
    this.fitTo(this.nodes, animated);
  }

  /** Fits these nodes in view (the rest of the graph may fall outside); the view stops following the layout. */
  fitNodes(ids: Iterable<string>, animated = true) {
    const picked: EngineNode[] = [];
    for (const id of ids) {
      const i = this.drawnIndex(id);
      if (i >= 0 && !picked.includes(this.nodes[i])) picked.push(this.nodes[i]);
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

  /** The viewport that fits `points`: often the nodes themselves, every frame while the layout runs. */
  private fitViewport(points: Positions, radii?: number[]): Viewport | null {
    if (this.width <= 0 || this.height <= 0 || points.length === 0) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const r = (radii ? radii[i] : this.nodes[i]?.r) ?? 0;
      if (Number.isNaN(p.x)) continue;
      x0 = Math.min(x0, p.x - r);
      y0 = Math.min(y0, p.y - r);
      x1 = Math.max(x1, p.x + r);
      y1 = Math.max(y1, p.y + r);
    }
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
    const v = this.fitViewport(this.nodes);
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
    return hit ? this.targetOf(hit.kind, hit.index) : { kind: "background" };
  }

  /** What node or edge i is to the host: a node, a group (a super node), an edge or a bundle of edges. */
  private targetOf(kind: "node" | "edge", index: number): HitTarget {
    if (kind === "node") {
      const n = this.nodes[index];
      const group = n.superOf !== null ? this.group(n.superOf) : undefined;
      return group ? { kind: "group", group } : { kind: "node", node: n.node };
    }
    const e = this.edges[index];
    return e.bundle && e.bundle.length > 1 ? { kind: "bundle", edges: e.bundle } : { kind: "edge", edge: e.edge };
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
    return h ? this.targetOf(h.kind, h.index) : null;
  }

  /**
   * Selects one node, edge (or bundle, by its drawn id) or collapsed group by id, replacing the selection
   * (null clears).
   */
  setSelected(sel: { kind: "node" | "edge" | "group"; id: string } | null) {
    if (sel && sel.kind === "node") return this.commitNodes(this.model.has(sel.id) ? [sel.id] : []);
    if (sel && sel.kind === "edge" && !this.edgeById.has(sel.id)) sel = null;
    if (sel && sel.kind === "group" && !this.supers.has(sel.id)) sel = null;
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
      if (!this.model.has(id)) continue;
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
    const same =
      (this.selected === null || this.selected.kind === "node") && cur.length === ids.length && cur.every((id, i) => id === ids[i]);
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
      const n = this.model.get(s.id);
      if (!n) return null;
      const nodes: GraphNode[] = [];
      for (const id of this.selectedNodes) {
        const m = this.model.get(id);
        if (m) nodes.push(m.node);
      }
      return { kind: "node", node: n.node, nodes };
    }
    if (s.kind === "group") {
      const group = this.group(s.id);
      return group ? { kind: "group", group } : null;
    }
    const e = this.edgeById.get(s.id);
    if (!e) return null;
    return e.bundle && e.bundle.length > 1 ? { kind: "bundle", edges: e.bundle } : { kind: "edge", edge: e.edge };
  }

  /** Selects what is under (sx, sy), or clears the selection over the background. */
  selectAt(sx: number, sy: number, slop = 2): HitTarget {
    const hit = this.hitIndex(sx, sy, slop);
    if (!hit) this.setSelected(null);
    else if (hit.kind === "node") this.selectDrawn(hit.index);
    else this.setSelected({ kind: "edge", id: this.edges[hit.index].id });
    return hit ? this.targetOf(hit.kind, hit.index) : { kind: "background" };
  }

  /** Selects drawn node i: a node of the data, or a collapsed group by its super node. */
  selectDrawn(index: number) {
    const n = this.nodes[index];
    if (!n) return;
    if (n.superOf !== null) this.setSelected({ kind: "group", id: n.superOf });
    else this.setSelected({ kind: "node", id: n.id });
  }

  /** The drawn index of the primary selected node or group, or -1. */
  private selectedIndex(): number {
    const s = this.selected;
    if (!s || s.kind === "edge") return -1;
    return s.kind === "group" ? (this.supers.get(s.id)?.index ?? -1) : this.drawnIndex(s.id);
  }

  /** The ids of the nodes whose centers are inside a screen rectangle (its corners in any order). */
  nodesInRect(x0: number, y0: number, x1: number, y1: number): string[] {
    const a = this.screenToGraph(Math.min(x0, x1), Math.min(y0, y1));
    const b = this.screenToGraph(Math.max(x0, x1), Math.max(y0, y1));
    const out: string[] = [];
    for (const n of this.nodes) {
      if (n.superOf === null && n.x >= a.x && n.x <= b.x && n.y >= a.y && n.y <= b.y) out.push(n.id);
    }
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
        ? this.selected.kind !== "edge"
          ? { kind: "node" as const, index: this.selectedIndex() }
          : { kind: "edge" as const, index: this.edges.indexOf(this.edgeById.get(this.selected.id)!) }
        : null);
    if (!this.hovered && this.selectedNodes.size > 1) {
      // Several nodes selected: all of them (or the super nodes of their groups), their neighbors and edges.
      const sel = new Set<number>();
      for (const id of this.selectedNodes) {
        const i = this.drawnIndex(id);
        if (i >= 0) sel.add(i);
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

  /**
   * The node nearest the selected one in a direction, for arrow-key navigation. A collapsed group's super
   * node counts (`groupOfSuper` tells it by its id).
   */
  nearestInDirection(dx: number, dy: number): GraphNode | null {
    if (this.nodes.length === 0) return null;
    const sel = this.nodes[this.selectedIndex()] as EngineNode | undefined;
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
    this.draggedChanged();
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
    this.draggedChanged();
    this.geometryVersion++;
    this.dirty = true;
  }

  /** Tells the layout the dragged node (and those moving with it) changed. */
  private draggedChanged() {
    if (this.dragging >= 0) this.sim.changed(this.dragging);
    for (const g of this.dragGroup) this.sim.changed(g.index);
  }

  dragEnd() {
    const n = this.nodes[this.dragging];
    const group = this.dragGroup;
    if (n && !this.options.stickyDrag) {
      if (!this.dragWasPinned) n.fx = n.fy = null;
      for (const g of group) {
        const m = this.nodes[g.index];
        if (m && !g.wasPinned) m.fx = m.fy = null;
      }
    }
    if (n) this.draggedChanged();
    this.dragging = -1;
    this.sim.alphaTarget = 0;
    this.dragGroup = [];
    if (!n) return;
    this.dirty = true;
  }

  /** Pins and their state apply to nodes of the data (hidden ones too) and to super nodes by their ids. */
  isPinned(id: string): boolean {
    const n = this.model.get(id) ?? this.byId.get(id);
    return !!n && n.fx !== null;
  }

  setPinned(id: string, pinned: boolean) {
    const n = this.model.get(id) ?? this.byId.get(id);
    if (!n) return;
    if (pinned) {
      n.fx = n.x;
      n.fy = n.y;
    } else {
      n.fx = n.fy = null;
      if (this.options.layout === "force") this.sim.reheat(0.3);
    }
    // A hidden member of a collapsed group is not in the layout; its pin goes over when it is drawn again.
    if (this.nodes[n.index] === n) this.sim.changed(n.index);
    this.dirty = true;
  }

  unpinAll() {
    for (const n of this.modelNodes) n.fx = n.fy = null;
    for (const n of this.nodes) n.fx = n.fy = null;
    this.sim.changedAll();
    if (this.options.layout === "force") this.sim.reheat(0.3);
    this.dirty = true;
  }

  // -------------------------------------------------------------------------------------------
  // Inspection

  /** A node of the data (members of collapsed groups too). */
  node(id: string): GraphNode | undefined {
    return this.model.get(id)?.node;
  }

  /** A drawn node: a visible node of the data, or a super node by its id. */
  engineNode(id: string): EngineNode | undefined {
    return this.byId.get(id);
  }

  /** Where a node is drawn: for a member of a collapsed group, where its super node is. */
  position(id: string): Pt | undefined {
    const n = this.nodes[this.drawnIndex(id)];
    return n ? { x: n.x, y: n.y } : undefined;
  }

  /** A node's degree, neighbors and edges in the data, whatever is collapsed. */
  degree(id: string): number {
    return this.modelDegree.get(id) ?? 0;
  }

  neighborsOf(id: string): GraphNode[] {
    if (!this.model.has(id)) return [];
    const seen = new Set<string>();
    for (const e of this.modelEdges) {
      if (e.from === id && e.to !== id) seen.add(e.to);
      else if (e.to === id && e.from !== id) seen.add(e.from);
    }
    return [...seen].map((m) => this.model.get(m)!.node);
  }

  edgesOf(id: string): ResolvedEdge[] {
    return this.modelEdges.filter((e) => e.from === id || e.to === id);
  }

  /** The key a node is colored by (a super node: its group, or its members' most common category). */
  colorKey(n: EngineNode): string {
    return this.options.colorBy === "group" ? (n.superOf ?? n.group ?? "") : n.category;
  }

  /** A node's fill: its own color, else its category's (or group's) palette slot. */
  colorOf(n: EngineNode, palette: readonly string[], other = OTHER): string {
    if (n.node.color) return n.node.color;
    return this.keyColor(this.colorKey(n), palette, other);
  }

  /**
   * Every node's fill (`colorOf`), and the distinct fills sorted, with each node's rank among them, for
   * batching nodes by color. Kept until the data, `colorBy` or the palette change, so a frame does not
   * look every node's color up again.
   */
  nodeColors(palette: readonly string[], other = OTHER): NodeColors {
    const c = this.colorCache;
    // `setCapacity` first: a palette of another length gives new slots.
    this.slots.setCapacity(palette.length);
    if (c && c.palette === palette && c.other === other && c.stamp === this.colorStamp && c.slots === this.slots.version) return c.colors;
    const fills = this.nodes.map((n) => this.colorOf(n, palette, other));
    const distinct = [...new Set(fills)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const rankOf = new Map(distinct.map((f, i) => [f, i]));
    const rank = new Uint32Array(fills.length);
    for (let i = 0; i < fills.length; i++) rank[i] = rankOf.get(fills[i])!;
    const colors = { fills, distinct, rank };
    // The slots' version after the lookups, which may have given slots to keys first seen.
    this.colorCache = { palette, other, stamp: this.colorStamp, slots: this.slots.version, colors };
    return colors;
  }

  /** Hands the nodes' positions and radii to the painter, unless it has them already. */
  paintPositions(painter: NativeGraphPainter) {
    if (this.paintedVersion === this.geometryVersion && this.paintedNodes === this.nodes) return;
    // Straight after a Rust tick, with nothing moved in JS since: the tick's own buffer is the positions,
    // and the painter has the radii already.
    const fresh = this.sim.positions;
    if (fresh && painter.setPositions && this.paintedNodes === this.nodes && this.paintedRadii === this.radiiVersion) {
      painter.setPositions(fresh);
      this.paintedVersion = this.geometryVersion;
      return;
    }
    const nodes = this.nodes;
    const n = nodes.length;
    if (this.paintBuffer.length !== n * 3) this.paintBuffer = new Float64Array(n * 3);
    const pos = this.paintBuffer;
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      const node = nodes[i];
      pos[j] = node.x;
      pos[j + 1] = node.y;
      pos[j + 2] = node.r;
    }
    painter.setNodes(new Uint8Array(pos.buffer));
    this.paintedVersion = this.geometryVersion;
    this.paintedNodes = nodes;
    this.paintedRadii = this.radiiVersion;
  }

  /** The color of a category (or group): its palette slot; nodes without one, and those past the palette's end, share `other`. */
  private keyColor(key: string, palette: readonly string[], other: string): string {
    if (key === "") return other;
    this.slots.setCapacity(palette.length);
    const slot = this.slots.slot(key);
    return slot >= 0 ? palette[slot] : other;
  }

  /**
   * The categories (or groups) shown, in palette order, with their colors and node counts. Members of
   * collapsed groups count.
   */
  legend(palette: readonly string[], other = OTHER): { key: string; color: string; count: number }[] {
    const counts = new Map<string, { color: string; count: number; slot: number }>();
    this.slots.setCapacity(palette.length);
    for (const n of this.modelNodes) {
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

function newEngineNode(id: string, node: GraphNode): EngineNode {
  return {
    id,
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
    superOf: null,
    members: 0,
  };
}

/** The center of the nodes that have a position (NaN when none has). */
function centroid(nodes: EngineNode[]): Pt {
  let x = 0, y = 0, n = 0;
  for (const m of nodes) {
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
    x += m.x;
    y += m.y;
    n++;
  }
  return n > 0 ? { x: x / n, y: y / n } : { x: NaN, y: NaN };
}

/** The category most of the nodes have (the first such in data order on a tie), or "". */
function majorityCategory(nodes: EngineNode[]): string {
  const counts = new Map<string, number>();
  let best = "";
  let bestCount = 0;
  for (const n of nodes) {
    if (n.category === "") continue;
    const c = (counts.get(n.category) ?? 0) + 1;
    counts.set(n.category, c);
    if (c > bestCount) {
      best = n.category;
      bestCount = c;
    }
  }
  return best;
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
