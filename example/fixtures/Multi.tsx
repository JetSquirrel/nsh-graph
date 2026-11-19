// Four nodes in a 2 × 2 grid, so the middle of the view is background: for testing multi-selection end to end.
import { mount, signal, Text, View } from "nsh";
import { GraphView, createGraphController } from "nsh-graph";

function Multi() {
  const graph = createGraphController();
  const log = signal("none");
  return (
    <View style={{ flex: 1 }}>
      <Text testID="log">{`selected: ${log()}`}</Text>
      <GraphView
        testID="graph"
        controller={graph}
        layout="grid"
        nodeSizing={{ kind: "fixed", radius: 24 }}
        data={{ nodes: ["a", "b", "c", "d"].map((id) => ({ id, caption: id.toUpperCase() })), edges: [] }}
        onSelectionChange={(s) => log.set(s?.kind === "node" ? s.nodes.map((n) => n.id).join(",") : "none")}
        style={{ flex: 1 }}
      />
    </View>
  );
}

mount(Multi);
