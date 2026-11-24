// One node in the middle of the view, for testing tooltips end to end: the built-in card, a custom one, none.
import { mount, signal, Text, View } from "nsh";
import { GraphTooltip, GraphView } from "nsh-graph";

function Tooltip() {
  const mode = signal<"default" | "custom" | "off">("default");
  const hovered = signal("none");
  const button = (label: string, value: "default" | "custom" | "off") => (
    <View role="button" testID={value} onPress={() => mode.set(value)}>
      <Text>{label}</Text>
    </View>
  );
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        {button("Default", "default")}
        {button("Custom", "custom")}
        {button("Off", "off")}
        <Text testID="hovered">{`hovered: ${hovered()}`}</Text>
      </View>
      <GraphView
        testID="graph"
        layout="grid"
        data={{ nodes: [{ id: "a", caption: "Alice", category: "Person", group: "team", size: 60 }], edges: [] }}
        tooltips={mode() !== "off"}
        tooltip={mode() === "custom" ? (t) => (t.kind === "node" ? <GraphTooltip title={`Custom ${t.node.caption}`} /> : null) : undefined}
        onHover={(t) => hovered.set(t?.kind === "node" ? t.node.id : "none")}
        style={{ flex: 1 }}
      />
    </View>
  );
}

mount(Tooltip);
