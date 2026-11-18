/**
 * `<GraphLegend>`: the categories (or groups) a `GraphView` shows, with their colors and counts, so node
 * color never carries meaning alone.
 */
import { Text, View, type ViewStyle } from "nsh";
import type { GraphController } from "./controller";

export interface GraphLegendProps {
  /** The controller of the `GraphView` to describe. */
  controller: GraphController;
  /** What nodes without a category are called. Default "Other". */
  emptyLabel?: string;
  /** Show node counts. Default true. */
  counts?: boolean;
  /** Lay the entries out in a row (wrapping) or a column. Default "row". */
  direction?: "row" | "column";
  style?: ViewStyle;
  class?: string;
}

export function GraphLegend(props: GraphLegendProps) {
  return (
    <View
      role="list"
      accessibilityLabel="Legend"
      style={{
        flexDirection: (props.direction ?? "row") === "row" ? "row" : "column",
        flexWrap: "wrap",
        gap: 8,
        columnGap: 14,
        ...props.style,
      }}
      class={props.class}
    >
      <Each of={props.controller.legend()} key={(e) => e.key}>
        {(entry) => (
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            accessibilityLabel={`${entry().key || (props.emptyLabel ?? "Other")}: ${entry().count}`}
          >
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: entry().color }} />
            <Text class="text-sm text-foreground">{entry().key || (props.emptyLabel ?? "Other")}</Text>
            {(props.counts ?? true) ? <Text class="text-sm text-muted-foreground">{entry().count}</Text> : null}
          </View>
        )}
      </Each>
    </View>
  );
}
