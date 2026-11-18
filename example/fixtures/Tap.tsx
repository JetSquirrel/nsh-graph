// A one-node graph centered in the view, for testing input end to end.
import { mount, signal, Text, View } from "nsh";
import { GraphView, createGraphController } from "nsh-graph";

function Tap() {
  const graph = createGraphController();
  const log = signal("none");
  const activated = signal(0);
  return (
    <View style={{ flex: 1 }}>
      <Text testID="log">{`selected: ${log()}`}</Text>
      <Text testID="activated">{`activated: ${activated()}`}</Text>
      <Text testID="pinned">{`pinned: ${graph.selection()?.kind === "node" ? graph.isPinned("a") : "-"}`}</Text>
      <GraphView
        testID="graph"
        controller={graph}
        layout="grid"
        stickyDrag
        data={{ nodes: [{ id: "a", caption: "A", size: 60 }], edges: [] }}
        onSelectionChange={(s) => log.set(s?.kind === "node" ? s.node.id : "none")}
        onNodeActivate={() => activated.update((n) => n + 1)}
        style={{ flex: 1 }}
      />
    </View>
  );
}

mount(Tap);
