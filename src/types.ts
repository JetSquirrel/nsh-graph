/**
 * The data model of a graph view.
 *
 * Shaped after Neo4j NVL's nodes and relationships and gpui-graph's model: a node has an id, a caption
 * and a category (a Neo4j label, say); an edge joins two node ids and may carry a caption (its type).
 * Everything else is optional styling or the host's own payload.
 */

/** A node of the graph. */
export interface GraphNode<T = unknown> {
  /** Unique within the graph. Positions, pins and the selection are kept by id across data changes. */
  id: string;
  /** The text shown on or under the node. Defaults to the id. */
  caption?: string;
  /** The node's category (a Neo4j label such as `"Person"`): its color with `colorBy: "category"`. */
  category?: string;
  /** A community or cluster id (from Louvain, say): its color with `colorBy: "group"`, its hull, its clustering. */
  group?: string;
  /** A fill color that overrides the palette (any CSS color). */
  color?: string;
  /** A radius in points that overrides `nodeSizing`. */
  size?: number;
  /** Keeps the node where it is: the layout does not move it. */
  pinned?: boolean;
  /** A starting position in graph coordinates. Without one, the node starts next to a neighbor. */
  x?: number;
  y?: number;
  /** The host's own payload; never read by the view. */
  data?: T;
}

/** An edge (a relationship) between two nodes. */
export interface GraphEdge<T = unknown> {
  /** Unique within the graph. Defaults to `from->to#n`, n counting parallel edges. */
  id?: string;
  /** The source node's id. */
  from: string;
  /** The target node's id. */
  to: string;
  /** The text drawn along the edge with `edgeLabels` (a relationship type such as `"ACTED_IN"`). */
  caption?: string;
  /** A stroke color that overrides the theme's. */
  color?: string;
  /** A stroke width in points. Default 1.5. */
  width?: number;
  /** The host's own payload; never read by the view. */
  data?: T;
}

/** What a graph view shows. */
export interface GraphData<N = unknown, E = unknown> {
  nodes: GraphNode<N>[];
  edges: GraphEdge<E>[];
}

/** An edge as the view resolved it: its id is always set. */
export interface ResolvedEdge<E = unknown> extends GraphEdge<E> {
  id: string;
}

/**
 * A group (community) of the graph: the nodes that share a `group` id. Collapsed, it is drawn as one
 * super node standing for all its members.
 */
export interface GraphGroup<N = unknown> {
  /** The nodes' `group` value. */
  id: string;
  /** What its hull and super node are captioned: the id unless `setGroupLabel` gave another. */
  label: string;
  /** Whether it is drawn as one super node. */
  collapsed: boolean;
  /** Its members, in data order (hidden ones too, while it is collapsed). */
  nodes: GraphNode<N>[];
}

/**
 * What is selected: one edge, one or more nodes, a collapsed group's super node, or a bundle of edges
 * drawn as one (those between a collapsed group and another node or group). With several nodes, `node`
 * is the primary one (the one selected last) and `nodes` lists them all in the order they were selected,
 * `node` last. Selected nodes stay selected while their group is collapsed.
 */
export type Selection<N = unknown, E = unknown> =
  | { kind: "node"; node: GraphNode<N>; nodes: GraphNode<N>[] }
  | { kind: "edge"; edge: ResolvedEdge<E> }
  | { kind: "group"; group: GraphGroup<N> }
  | { kind: "bundle"; edges: ResolvedEdge<E>[] }
  | null;

/** What a pointer is over: a node, an edge, a collapsed group, a bundle of edges or the background. */
export type HitTarget<N = unknown, E = unknown> =
  | { kind: "node"; node: GraphNode<N> }
  | { kind: "edge"; edge: ResolvedEdge<E> }
  | { kind: "group"; group: GraphGroup<N> }
  | { kind: "bundle"; edges: ResolvedEdge<E>[] }
  | { kind: "background" };

/** The layouts a view can run. */
export type LayoutKind = "force" | "hierarchical" | "circular" | "grid";

/** When node captions are drawn. */
export type LabelMode =
  /** When the node is big enough on screen, and always for the hovered, selected and highlighted nodes. */
  | "auto"
  | "always"
  | "never";

/** What a node's color stands for. */
export type ColorBy = "category" | "group";

/** How node radii are picked (a node's own `size` wins). */
export type NodeSizing =
  | { kind: "fixed"; radius: number }
  /** Grows with the node's degree, from `min` (no edges) to `max` (the busiest node). */
  | { kind: "degree"; min: number; max: number };

/** The force simulation's settings, as d3-force names them. */
export interface ForceConfig {
  /** The length links pull toward, in points. Default 90. */
  linkDistance: number;
  /** Many-body strength: negative repels. Default -320. */
  charge: number;
  /** Barnes–Hut accuracy: higher is faster and coarser. Default 0.9. */
  theta: number;
  /** Repulsion is ignored beyond this distance. Default Infinity. */
  chargeDistanceMax: number;
  /** Extra space kept between node circles. Default 10. */
  collidePadding: number;
  /** Pull toward the center, which keeps disconnected parts together. Default 0.04. */
  gravity: number;
  /** Pull of nodes toward their group's centroid; 0 turns it off. Default 0.12. */
  groupStrength: number;
  /** Friction, 0..1 (d3's `velocityDecay`). Default 0.4. */
  velocityDecay: number;
  /** How fast the layout cools; it stops when alpha falls below `alphaMin`. Default 0.0228 (300 ticks). */
  alphaDecay: number;
  /** Default 0.001. */
  alphaMin: number;
}

/** The hierarchical layout's settings. */
export interface HierarchicalConfig {
  /** Which way edges point. Default "down". */
  direction: "down" | "up" | "right" | "left";
  /** Distance between layers, in points. Default 110. */
  layerGap: number;
  /** Distance between nodes in a layer, in points. Default 70. */
  nodeGap: number;
}

/** Colors the view draws with. Unset ones come from the app's theme tokens and the categorical palette. */
export interface GraphColors {
  /** Filled behind the graph; transparent when unset. */
  background?: string;
  /** Caption text. */
  text?: string;
  /** The halo behind captions, and the ring that separates overlapping nodes. */
  surface?: string;
  /** Edge strokes. */
  edge?: string;
  /** Edges of the hovered or selected node. */
  edgeHighlight?: string;
  /** Edge captions. */
  edgeText?: string;
  /** The selection ring. */
  selection?: string;
  /** The categorical palette, in order; categories past its end share `other`. */
  palette?: readonly string[];
  /** The color of categories past the palette's end. */
  other?: string;
}
