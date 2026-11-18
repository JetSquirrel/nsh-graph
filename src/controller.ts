/**
 * An imperative handle on a mounted `GraphView`, as NVL's instance methods are: fit, zoom, select,
 * pin, relayout, inspect and export. Its reactive members (`selection`, `zoom`, `legend`, `settling`)
 * are signals, so JSX that reads them follows the graph.
 */
import { signal, OffscreenCanvas, type Accessor } from "nsh";
import type { GraphEngine } from "./engine";
import { renderGraph, type RenderTheme } from "./render";
import type { GraphNode, ResolvedEdge, Selection } from "./types";

export interface LegendEntry {
  /** The category (or group) name; "" for nodes without one. */
  key: string;
  color: string;
  count: number;
}

export interface ToImageOptions {
  /** Pixel density of the image. Default 2. */
  scale?: number;
  /** Space around the graph, in points. Default 40. */
  padding?: number;
  /** Fill behind the graph; the view's background (or transparent) when unset. */
  background?: string;
  /** Image type. Default "image/png". */
  type?: string;
}

export class GraphController {
  private engine: GraphEngine | null = null;
  private wake: () => void = () => {};
  private theme: () => RenderTheme | null = () => null;

  private readonly selectionSignal = signal<Selection>(null);
  private readonly zoomSignal = signal(1);
  private readonly legendSignal = signal<LegendEntry[]>([], {
    equals: (a, b) =>
      a.length === b.length && a.every((x, i) => x.key === b[i].key && x.color === b[i].color && x.count === b[i].count),
  });
  private readonly settlingSignal = signal(false);

  /** What is selected. */
  readonly selection: Accessor<Selection> = () => this.selectionSignal();
  /** The zoom factor (1: one graph point per screen point). */
  readonly zoom: Accessor<number> = () => this.zoomSignal();
  /** The categories (or groups) shown, in palette order, with their colors: what a legend lists. */
  readonly legend: Accessor<LegendEntry[]> = () => this.legendSignal();
  /** Whether the layout is still moving. */
  readonly settling: Accessor<boolean> = () => this.settlingSignal();

  /** @internal Called by `GraphView` when it mounts. */
  _attach(engine: GraphEngine, wake: () => void, theme: () => RenderTheme | null) {
    this.engine = engine;
    this.wake = wake;
    this.theme = theme;
  }

  /** @internal Called by `GraphView` when it unmounts. */
  _detach(engine: GraphEngine) {
    if (this.engine !== engine) return;
    this.engine = null;
    this.wake = () => {};
    this.theme = () => null;
  }

  /** @internal State `GraphView` reports after each frame. */
  _report(state: { selection?: Selection; zoom?: number; legend?: LegendEntry[]; settling?: boolean }) {
    if (state.selection !== undefined) this.selectionSignal.set(state.selection);
    if (state.zoom !== undefined) this.zoomSignal.set(Math.round(state.zoom * 1000) / 1000);
    if (state.legend !== undefined) this.legendSignal.set(state.legend);
    if (state.settling !== undefined) this.settlingSignal.set(state.settling);
  }

  /** Whether a `GraphView` is using this controller. */
  get attached(): boolean {
    return this.engine !== null;
  }

  private run(fn: (engine: GraphEngine) => void) {
    if (!this.engine) return;
    fn(this.engine);
    this.wake();
  }

  // ---- Viewport

  /** Fits the whole graph in view; the view follows the layout again until the user pans or zooms. */
  fit() {
    this.run((e) => e.fit(true));
  }

  zoomIn(factor = 1.3) {
    this.run((e) => e.zoomBy(factor));
  }

  zoomOut(factor = 1.3) {
    this.run((e) => e.zoomBy(1 / factor));
  }

  setZoom(k: number) {
    this.run((e) => e.setZoom(k));
  }

  /** Centers a node, keeping the zoom. */
  centerOn(id: string) {
    this.run((e) => {
      const p = e.position(id);
      if (p) {
        e.autoFit = false;
        e.centerOn(p.x, p.y);
      }
    });
  }

  // ---- Selection

  /** Selects a node by id (null clears); `center` also brings it to the middle of the view. */
  select(id: string | null, options: { center?: boolean } = {}) {
    this.run((e) => {
      e.setSelected(id === null ? null : { kind: "node", id });
      if (id !== null && options.center) {
        const p = e.position(id);
        if (p) {
          e.autoFit = false;
          e.centerOn(p.x, p.y);
        }
      }
    });
  }

  /** Selects an edge by id. */
  selectEdge(id: string) {
    this.run((e) => e.setSelected({ kind: "edge", id }));
  }

  clearSelection() {
    this.select(null);
  }

  // ---- Layout and pinning

  /** Runs the layout again and fits the result. */
  relayout() {
    this.run((e) => e.relayout());
  }

  setPinned(id: string, pinned: boolean) {
    this.run((e) => e.setPinned(id, pinned));
  }

  isPinned(id: string): boolean {
    return this.engine?.isPinned(id) ?? false;
  }

  unpinAll() {
    this.run((e) => e.unpinAll());
  }

  // ---- Inspection

  node(id: string): GraphNode | undefined {
    return this.engine?.node(id);
  }

  /** A node's position in graph coordinates. */
  position(id: string): { x: number; y: number } | undefined {
    return this.engine?.position(id);
  }

  degree(id: string): number {
    return this.engine?.degree(id) ?? 0;
  }

  neighbors(id: string): GraphNode[] {
    return this.engine?.neighborsOf(id) ?? [];
  }

  edgesOf(id: string): ResolvedEdge[] {
    return this.engine?.edgesOf(id) ?? [];
  }

  // ---- Export

  /**
   * Renders the whole graph (not only what is on screen) to an image, as it looks now. Resolves to a Blob:
   * `URL.createObjectURL(blob)` shows it in an `<Image>`, `Clipboard.writeImage` or `Share` take it.
   */
  async toImage(options: ToImageOptions = {}): Promise<Blob> {
    const engine = this.engine;
    const theme = this.theme();
    if (!engine || !theme) throw new Error("GraphController.toImage: no GraphView is attached");
    const padding = options.padding ?? 40;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of engine.nodes) {
      x0 = Math.min(x0, n.x - n.r);
      y0 = Math.min(y0, n.y - n.r - 4);
      x1 = Math.max(x1, n.x + n.r);
      y1 = Math.max(y1, n.y + n.r + 20); // room for captions under nodes
    }
    if (!Number.isFinite(x0)) x0 = y0 = x1 = y1 = 0;
    const width = Math.ceil(x1 - x0 + padding * 2);
    const height = Math.ceil(y1 - y0 + padding * 2);
    const canvas = new OffscreenCanvas(width, height);
    const cx = canvas.getContext("2d");
    // Draw at zoom 1 with a viewport over the whole graph, then put the view's own back.
    const saved = { k: engine.k, tx: engine.tx, ty: engine.ty, w: engine.width, h: engine.height, hovered: engine.hovered };
    engine.k = 1;
    engine.tx = padding - x0;
    engine.ty = padding - y0;
    engine.width = width;
    engine.height = height;
    engine.hovered = null;
    try {
      renderGraph(cx, engine, { ...theme, background: options.background ?? theme.background }, width, height);
    } finally {
      engine.k = saved.k;
      engine.tx = saved.tx;
      engine.ty = saved.ty;
      engine.width = saved.w;
      engine.height = saved.h;
      engine.hovered = saved.hovered;
    }
    return canvas.convertToBlob({ type: options.type ?? "image/png", scale: options.scale ?? 2 });
  }
}

/** Makes a controller to pass to `<GraphView controller={…}>`. */
export function createGraphController(): GraphController {
  return new GraphController();
}
