/**
 * `<GraphTooltip>`: the card `GraphView` shows beside the pointer over a node, an edge, a group or a
 * bundle. Exported so a custom `tooltip` can show the same card with lines of its own.
 */
import { Text, View, token } from "nsh";
import type { TooltipInfo } from "./tooltip";

export interface GraphTooltipProps extends Partial<TooltipInfo> {
  title: string;
}

export function GraphTooltip(props: GraphTooltipProps) {
  return (
    <View
      testID="graph-tooltip"
      style={{
        maxWidth: 280,
        paddingHorizontal: 10,
        paddingVertical: 6,
        gap: 2,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: token("border"),
        backgroundColor: token("popover"),
        boxShadow: "0 2px 10px rgba(0, 0, 0, 0.16)",
      }}
    >
      {props.kicker ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {props.swatch ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: props.swatch }} /> : null}
          <Text class="text-xs text-muted-foreground">{props.kicker}</Text>
        </View>
      ) : null}
      <Text class="text-sm font-semibold" style={{ color: token("popover-foreground") }}>{props.title}</Text>
      {props.detail ? <Text class="text-xs text-muted-foreground">{props.detail}</Text> : null}
    </View>
  );
}
