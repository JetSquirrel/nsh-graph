// One group of three nodes, for testing collapsing and expanding it end to end.
import { mount, signal, Text, View } from "nsh";
import { GraphView, createGraphController } from "nsh-graph";

function Group() {
  const graph = createGraphController();
  const log = signal("none");
  const toggles = signal<string[]>([]);
  return (
    <View style={{ flex: 1 }}>
      <Text testID="log">{`selected: ${log()}`}</Text>
      <Text testID="groups">{`groups: ${graph.groups().map((g) => `${g.id}=${g.collapsed ? "collapsed" : "expanded"}`).join(",")}`}</Text>
      <Text testID="toggles">{`toggles: ${toggles().join(",")}`}</Text>
      <View role="button" testID="collapse" onPress={() => graph.collapseGroup("g")}>
        <Text>Collapse</Text>
      </View>
      <GraphView
        testID="graph"
        controller={graph}
        layout="grid"
        nodeSizing={{ kind: "fixed", radius: 40 }}
        data={{
          nodes: [{ id: "a", group: "g" }, { id: "b", group: "g" }, { id: "c", group: "g" }],
          edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
        }}
        onSelectionChange={(s) => log.set(s?.kind === "group" ? `group ${s.group.id}` : s?.kind === "node" ? s.node.id : "none")}
        onGroupToggle={(g, collapsed) => toggles.update((t) => [...t, `${g.id}:${collapsed}`])}
        style={{ flex: 1 }}
      />
    </View>
  );
}

mount(Group);
