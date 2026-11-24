/**
 * What the built-in tooltip says about the hovered node, edge, group or bundle. Plain TypeScript, apart
 * from NSH: `GraphTooltip` draws it.
 */
import type { GraphEngine } from "./engine";
import { OTHER } from "./palette";
import type { HitTarget } from "./types";

/** What a tooltip is about: anything a pointer can be over but the background. */
export type TooltipTarget<N = unknown, E = unknown> = Exclude<HitTarget<N, E>, { kind: "background" }>;

/** The built-in tooltip's lines. */
export interface TooltipInfo {
  /** The small line on top: a node's category and group, or what the target is. */
  kicker: string;
  /** A node's or group's caption, an edge's type. */
  title: string;
  /** How many relationships or members, or which nodes an edge joins. */
  detail: string;
  /** The node's or group's fill, shown beside the kicker; null for edges. */
  swatch: string | null;
}

/** "1 member", "3 members". */
function counted(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** What the built-in tooltip shows for `target`, as `engine` draws it with `palette`. */
export function tooltipInfo(engine: GraphEngine, target: TooltipTarget, palette: readonly string[], other = OTHER): TooltipInfo {
  const fill = (drawn: number) => (drawn >= 0 ? (engine.nodeColors(palette, other).fills[drawn] ?? null) : null);
  // A node of the data by its caption; an end of a bundle as drawn (a collapsed group by its label).
  const caption = (id: string) => engine.node(id)?.caption ?? id;
  const drawnCaption = (id: string) => {
    const n = engine.nodes[engine.drawnIndex(id)];
    return n ? (n.node.caption ?? n.id) : id;
  };
  switch (target.kind) {
    case "node": {
      const n = target.node;
      const group = n.group !== undefined ? engine.groupLabel(n.group) : "";
      return {
        kicker: [n.category ?? "", group].filter(Boolean).join(" · ") || "Node",
        title: n.caption ?? n.id,
        detail: counted(engine.degree(n.id), "relationship"),
        swatch: fill(engine.drawnIndex(n.id)),
      };
    }
    case "group":
      return {
        kicker: "Group",
        title: target.group.label,
        detail: counted(target.group.nodes.length, "member"),
        swatch: fill(engine.drawnIndex(engine.superId(target.group.id))),
      };
    case "edge": {
      const e = target.edge;
      return { kicker: "Relationship", title: e.caption ?? "Edge", detail: `${caption(e.from)} → ${caption(e.to)}`, swatch: null };
    }
    case "bundle": {
      const first = target.edges[0];
      const types = [...new Set(target.edges.map((e) => e.caption).filter((c): c is string => !!c))];
      return {
        kicker: types.length > 0 && types.length <= 3 ? types.join(", ") : "Relationships",
        title: counted(target.edges.length, "relationship"),
        detail: first ? `${drawnCaption(first.from)} → ${drawnCaption(first.to)}` : "",
        swatch: null,
      };
    }
  }
}
