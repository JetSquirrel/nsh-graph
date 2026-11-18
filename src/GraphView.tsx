/**
 * `<GraphView>`: an interactive network graph drawn on a native canvas.
 *
 * Drag the background to pan, drag a node to move it, scroll / pinch to zoom, tap to select, double-tap
 * (or Enter) to activate a node, right-click for a context menu, and use the arrow keys to walk the graph
 * when it has the keyboard focus.
 */
import {
  Canvas,
  cleanup,
  colorScheme,
  computed,
  effect,
  reduceMotion,
  signal,
  token,
  untracked,
  type ContextMenuEvent,
  type GestureResponderEvent,
  type KeyEvent,
  type MouseEvent,
  type PinchEvent,
  type Point,
  type ViewStyle,
  type WheelEvent,
} from "nsh";
import type { GraphController } from "./controller";
import { GraphEngine } from "./engine";
import { OTHER, PALETTE_DARK, PALETTE_LIGHT, withAlpha } from "./palette";
import { renderGraph, type RenderTheme } from "./render";
import type {
  ColorBy,
  ForceConfig,
  GraphColors,
  GraphData,
  GraphNode,
  HierarchicalConfig,
  HitTarget,
  LabelMode,
  LayoutKind,
  NodeSizing,
  Selection,
} from "./types";

export interface GraphViewProps<N = unknown, E = unknown> {
  /** What to show. Changes are merged by id: nodes keep their positions, pins and selection. */
  data: GraphData<N, E>;
  /** An imperative handle: fit, zoom, select, pin, export (`createGraphController()`). */
  controller?: GraphController;

  /** Default "force". Switching animates the nodes to their new places. */
  layout?: LayoutKind;
  /** Force layout settings (d3-force's). */
  force?: Partial<ForceConfig>;
  /** Hierarchical layout settings. */
  hierarchical?: Partial<HierarchicalConfig>;

  /** Default: by degree, 14 to 30 points. */
  nodeSizing?: NodeSizing;
  /** What node colors stand for. Default "category". */
  colorBy?: ColorBy;
  /** When captions are drawn. Default "auto". */
  labelMode?: LabelMode;
  /** Arrow heads on edges. Default true. */
  arrows?: boolean;
  /** Edge captions along the edges. Default false. */
  edgeLabels?: boolean;
  /** Outlines around each group of nodes. Default false. */
  groupHulls?: boolean;
  /** Dropped nodes stay pinned. Default false. */
  stickyDrag?: boolean;
  /** Default 0.05. */
  minZoom?: number;
  /** Default 6. */
  maxZoom?: number;

  /** Colors over the theme's. */
  colors?: GraphColors;
  /** Caption font family. Default "system-ui". */
  fontFamily?: string;

  /** The selection changed (a tap, the keyboard, or the controller). */
  onSelectionChange?: (selection: Selection<N, E>) => void;
  /** A node was double-tapped, double-clicked, or Enter was pressed on it: expand it, open it. */
  onNodeActivate?: (node: GraphNode<N>) => void;
  /** The pointer moved onto a node or edge, or off it (null). Desktops and the web. */
  onHover?: (target: HitTarget<N, E> | null) => void;
  /** A context menu was asked for over a node, an edge or the background. Open one with `Menu.popup(items, e.pagePosition)`. */
  onContextMenu?: (target: HitTarget<N, E>, e: { position: Point; pagePosition: Point }) => void;

  style?: ViewStyle;
  class?: string;
  testID?: string;
  /** What screen readers call the graph; its size and selection are added. Default "Graph". */
  accessibilityLabel?: string;
}

const KEYS = ["up", "down", "left", "right", "enter", "escape", "plus", "minus", "shift+plus", "0", "p"] as const;
const TAP_SLOP = 5;
const HIT_SLOP_TOUCH = 8;
const DOUBLE_TAP_MS = 350;

type Gesture = {
  mode: "pending-pan" | "pending-drag" | "pan" | "drag" | "pinch";
  /** Converts page coordinates to the canvas's: local = page - origin. */
  origin: Point;
  start: Point;
  last: Point;
  startTime: number;
  node: number;
  moved: boolean;
  pinchDistance: number;
  pinchCenter: Point;
};

export function GraphView<N = unknown, E = unknown>(props: GraphViewProps<N, E>) {
  const engine = new GraphEngine();
  let raf: number | undefined;
  let gesture: Gesture | null = null;
  let lastTap: { time: number; x: number; y: number; node: string | null } | null = null;
  let lastZoom = NaN;
  let lastSettling = false;

  // Bumped to redraw the canvas.
  const frame = signal(0);
  // Bumped when the data or options change (what the legend and the accessibility label read).
  const dataVersion = signal(0);
  const selection = signal<Selection>(null);

  const theme = computed<RenderTheme>(() => {
    const c = props.colors ?? {};
    const dark = colorScheme() === "dark";
    const fg = token("foreground");
    const muted = token("muted-foreground");
    return {
      background: c.background ?? null,
      text: c.text ?? fg,
      surface: c.surface ?? c.background ?? token("background"),
      edge: c.edge ?? withAlpha(muted, dark ? 0.55 : 0.5),
      edgeHighlight: c.edgeHighlight ?? withAlpha(fg, 0.85),
      edgeText: c.edgeText ?? muted,
      selection: c.selection ?? token("primary"),
      palette: c.palette ?? (dark ? PALETTE_DARK : PALETTE_LIGHT),
      other: c.other ?? OTHER,
      fontFamily: props.fontFamily ?? "system-ui",
    };
  });

  const wake = () => {
    if (raf === undefined) raf = requestAnimationFrame(loop);
  };

  const report = () => {
    const c = props.controller;
    if (!c) return;
    const settling = engine.animating;
    if (engine.k === lastZoom && settling === lastSettling) return;
    c._report({ zoom: engine.k, settling });
    lastZoom = engine.k;
    lastSettling = settling;
  };

  const loop = (time: number) => {
    raf = undefined;
    const more = engine.step(time);
    if (engine.consumeDirty()) frame.update((n) => n + 1);
    report();
    if (more || engine.dirty) wake();
  };

  /** Something changed: draw it on the next frame. */
  const invalidate = () => {
    engine.dirty = true;
    wake();
  };

  engine.onEvent = (e) => {
    if (e.type === "selection") {
      selection.set(e.selection);
      props.controller?._report({ selection: e.selection });
      props.onSelectionChange?.(e.selection as Selection<N, E>);
    } else {
      props.onHover?.(e.target as HitTarget<N, E> | null);
    }
  };

  // ---- Props into the engine

  effect(() => {
    engine.setOptions({
      layout: props.layout ?? "force",
      force: props.force ?? {},
      hierarchical: props.hierarchical ?? {},
      nodeSizing: props.nodeSizing ?? { kind: "degree", min: 14, max: 30 },
      colorBy: props.colorBy ?? "category",
      labelMode: props.labelMode ?? "auto",
      arrows: props.arrows ?? true,
      edgeLabels: props.edgeLabels ?? false,
      groupHulls: props.groupHulls ?? false,
      stickyDrag: props.stickyDrag ?? false,
      minZoom: props.minZoom ?? 0.05,
      maxZoom: props.maxZoom ?? 6,
      reduceMotion: reduceMotion(),
    });
    untracked(() => {
      dataVersion.update((n) => n + 1);
      invalidate();
    });
  });

  effect(() => {
    const data = props.data;
    untracked(() => {
      engine.setData(data as GraphData);
      dataVersion.update((n) => n + 1);
      invalidate();
    });
  });

  effect(() => {
    const c = props.controller;
    if (!c) return;
    c._attach(engine, invalidate, () => untracked(theme));
    untracked(() => c._report({ selection: selection(), zoom: engine.k, settling: engine.animating }));
    lastZoom = engine.k;
    cleanup(() => c._detach(engine));
  });

  // The legend follows the data, the palette and colorBy.
  effect(() => {
    const t = theme();
    dataVersion();
    const c = props.controller;
    if (!c) return;
    c._report({ legend: engine.legend(t.palette, t.other) });
  });

  cleanup(() => {
    if (raf !== undefined) cancelAnimationFrame(raf);
    raf = undefined;
    engine.onEvent = null;
  });

  // ---- Pointer and touch

  const hitSlop = HIT_SLOP_TOUCH;

  const local = (g: Gesture, t: { pageX: number; pageY: number }): Point => ({
    x: t.pageX - g.origin.x,
    y: t.pageY - g.origin.y,
  });

  const startPinch = (g: Gesture, e: GestureResponderEvent) => {
    if (g.mode === "drag") engine.dragEnd();
    const [a, b] = e.touches;
    const pa = local(g, a);
    const pb = local(g, b);
    g.mode = "pinch";
    g.moved = true;
    g.pinchDistance = Math.max(1, Math.hypot(pb.x - pa.x, pb.y - pa.y));
    g.pinchCenter = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
  };

  const onGrant = (e: GestureResponderEvent) => {
    const origin = { x: e.pageX - e.locationX, y: e.pageY - e.locationY };
    const p = { x: e.locationX, y: e.locationY };
    const hit = engine.hitIndex(p.x, p.y, hitSlop);
    gesture = {
      mode: hit?.kind === "node" ? "pending-drag" : "pending-pan",
      origin,
      start: p,
      last: p,
      startTime: Date.now(),
      node: hit?.kind === "node" ? hit.index : -1,
      moved: false,
      pinchDistance: 0,
      pinchCenter: p,
    };
    if (e.touches.length >= 2) startPinch(gesture, e);
    return true; // keep scroll views around from taking the drag
  };

  const onMove = (e: GestureResponderEvent) => {
    const g = gesture;
    if (!g) return;
    if (e.touches.length >= 2) {
      if (g.mode !== "pinch") startPinch(g, e);
      const pa = local(g, e.touches[0]);
      const pb = local(g, e.touches[1]);
      const distance = Math.max(1, Math.hypot(pb.x - pa.x, pb.y - pa.y));
      const center = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      engine.holdLayout();
      engine.panBy(center.x - g.pinchCenter.x, center.y - g.pinchCenter.y);
      engine.zoomAt(distance / g.pinchDistance, center.x, center.y);
      g.pinchDistance = distance;
      g.pinchCenter = center;
      invalidate();
      return;
    }
    const p = local(g, e);
    if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) > TAP_SLOP) {
      g.moved = true;
      if (g.mode === "pending-drag") {
        g.mode = "drag";
        engine.dragStart(g.node);
        engine.hoverAt(null);
      } else if (g.mode === "pending-pan") {
        g.mode = "pan";
      }
    }
    if (g.mode === "drag") {
      engine.dragMove(p.x, p.y);
      invalidate();
    } else if (g.mode === "pan") {
      engine.holdLayout();
      engine.panBy(p.x - g.last.x, p.y - g.last.y);
      invalidate();
    } else if (g.mode === "pinch") {
      // One finger left of a pinch: carry on panning from here.
      g.mode = "pan";
    }
    g.last = p;
  };

  const onRelease = (e: GestureResponderEvent) => {
    const g = gesture;
    gesture = null;
    if (!g) return;
    if (g.mode === "drag") {
      engine.dragEnd();
      invalidate();
      return;
    }
    if (g.moved || Date.now() - g.startTime > 600) return;
    tap(local(g, e));
  };

  const onTerminate = () => {
    if (gesture?.mode === "drag") engine.dragEnd();
    gesture = null;
    invalidate();
  };

  const tap = (p: Point) => {
    const target = engine.selectAt(p.x, p.y, hitSlop);
    const id = target.kind === "node" ? target.node.id : null;
    const time = Date.now();
    const double =
      lastTap !== null &&
      time - lastTap.time < DOUBLE_TAP_MS &&
      Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 16 &&
      lastTap.node === id;
    lastTap = double ? null : { time, x: p.x, y: p.y, node: id };
    if (double && target.kind === "node") props.onNodeActivate?.(target.node as GraphNode<N>);
    invalidate();
  };

  const onWheel = (e: WheelEvent) => {
    const m = e.modifiers;
    engine.holdLayout();
    if (e.deltaMode === "lines") {
      const lines = Math.max(-3, Math.min(3, e.delta.y));
      engine.zoomAt(Math.exp(-lines * 0.08), e.position.x, e.position.y);
    } else if (m.control || m.platform) {
      // A touchpad pinch on Windows and most browsers, or Ctrl + scroll.
      engine.zoomAt(Math.exp(-e.delta.y * 0.01), e.position.x, e.position.y);
    } else {
      engine.panBy(-e.delta.x, -e.delta.y);
    }
    invalidate();
  };

  const onPinch = (e: PinchEvent) => {
    engine.holdLayout();
    engine.zoomAt(1 + e.delta, e.position.x, e.position.y);
    invalidate();
  };

  const onMouseMove = (e: MouseEvent) => {
    if (gesture || e.pressedButton !== null) return;
    if (engine.hoverAt(e.position.x, e.position.y)) invalidate();
  };

  const onMouseLeave = () => {
    if (engine.hoverAt(null)) invalidate();
  };

  const onContextMenu = (e: ContextMenuEvent) => {
    const target = engine.hitTest(e.position.x, e.position.y, 2);
    if (target.kind === "node") engine.setSelected({ kind: "node", id: target.node.id });
    else if (target.kind === "edge") engine.setSelected({ kind: "edge", id: target.edge.id });
    invalidate();
    props.onContextMenu?.(target as HitTarget<N, E>, { position: e.position, pagePosition: e.pagePosition });
  };

  // ---- Keyboard

  const selectNode = (node: GraphNode | null) => {
    if (!node) return;
    engine.setSelected({ kind: "node", id: node.id });
    const p = engine.position(node.id)!;
    const s = engine.graphToScreen(p.x, p.y);
    const margin = 48;
    if (s.x < margin || s.y < margin || s.x > engine.width - margin || s.y > engine.height - margin) {
      engine.autoFit = false;
      engine.centerOn(p.x, p.y);
    }
    invalidate();
  };

  const onKeyDown = (e: KeyEvent) => {
    switch (e.key) {
      case "ArrowLeft": return selectNode(engine.nearestInDirection(-1, 0));
      case "ArrowRight": return selectNode(engine.nearestInDirection(1, 0));
      case "ArrowUp": return selectNode(engine.nearestInDirection(0, -1));
      case "ArrowDown": return selectNode(engine.nearestInDirection(0, 1));
      case "Enter": {
        const sel = engine.selection();
        if (sel?.kind === "node") props.onNodeActivate?.(sel.node as GraphNode<N>);
        return;
      }
      case "Escape":
        engine.setSelected(null);
        return invalidate();
      case "=":
      case "+":
        engine.zoomBy(1.3);
        return invalidate();
      case "-":
        engine.zoomBy(1 / 1.3);
        return invalidate();
      case "0":
        engine.fit(true);
        return invalidate();
      case "p":
      case "P": {
        const sel = engine.selection();
        if (sel?.kind === "node") engine.setPinned(sel.node.id, !engine.isPinned(sel.node.id));
        return invalidate();
      }
    }
  };

  // ---- Accessibility

  const label = () => {
    const base = props.accessibilityLabel ?? "Graph";
    dataVersion();
    const sel = selection();
    const what =
      sel?.kind === "node"
        ? `, selected ${sel.node.caption ?? sel.node.id}`
        : sel?.kind === "edge"
          ? `, selected ${sel.edge.caption ?? "edge"}`
          : "";
    return `${base}: ${engine.nodes.length} nodes, ${engine.edges.length} edges${what}`;
  };

  return (
    <Canvas
      style={{ flex: 1, ...props.style }}
      class={props.class}
      testID={props.testID}
      role="image"
      accessibilityLabel={label()}
      accessibilityHint="Arrow keys move between nodes, Enter opens one, plus and minus zoom, 0 fits"
      focusable
      captureKeys={KEYS}
      onKeyDown={onKeyDown}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onRelease}
      onResponderTerminate={onTerminate}
      onWheel={onWheel}
      onPinch={onPinch}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onContextMenu={onContextMenu}
      draw={(cx, size) => {
        frame();
        const t = theme();
        engine.setSize(size.width, size.height);
        renderGraph(cx, engine, t, size.width, size.height);
        // The first draw may have fitted the view: let the loop pick up from here.
        untracked(wake);
      }}
    />
  );
}
