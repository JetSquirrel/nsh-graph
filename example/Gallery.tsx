// Every dataset in ./datasets, to try the view against real and awkward data: `nsh run example/Gallery.tsx`.
import { mount, signal, Text, View } from "nsh";
import { GraphLegend, GraphView, createGraphController, type ColorBy, type LayoutKind } from "nsh-graph";
import { datasets } from "./datasets";

function Chip(props: { label: string; active: boolean; onPress: () => void; testID: string }) {
  return (
    <View
      role="button"
      testID={props.testID}
      onPress={props.onPress}
      class={`rounded-md px-2.5 py-1 ${props.active ? "bg-primary" : "bg-secondary hover:bg-accent"}`}
    >
      <Text class={`text-xs ${props.active ? "text-primary-foreground" : "text-secondary-foreground"}`}>{props.label}</Text>
    </View>
  );
}

function Gallery() {
  const graph = createGraphController();
  const current = signal(datasets[0]);
  const data = signal(datasets[0].data());
  const layout = signal<LayoutKind>("force");
  const colorBy = signal<ColorBy>("category");
  const hulls = signal(false);
  const edgeLabels = signal(false);
  const arrows = signal(true);

  const pick = (id: string) => {
    const ds = datasets.find((d) => d.id === id)!;
    current.set(ds);
    data.set(ds.data());
    colorBy.set(ds.id === "miserables" ? "group" : "category");
    // The karate club and Les Misérables are undirected.
    arrows.set(ds.id !== "karate" && ds.id !== "miserables");
  };

  return (
    <View class="flex-1 bg-background">
      <View class="gap-2 border-b border-border p-3">
        <View class="flex-row flex-wrap gap-1">
          <Each of={datasets}>
            {(ds) => <Chip label={ds().name} active={current().id === ds().id} onPress={() => pick(ds().id)} testID={`ds-${ds().id}`} />}
          </Each>
        </View>
        <View class="flex-row flex-wrap items-center gap-1">
          <Each of={["force", "hierarchical", "circular", "grid"] as LayoutKind[]}>
            {(l) => <Chip label={l()} active={layout() === l()} onPress={() => layout.set(l())} testID={`layout-${l()}`} />}
          </Each>
          <Chip label="by group" active={colorBy() === "group"} onPress={() => colorBy.set(colorBy() === "group" ? "category" : "group")} testID="by-group" />
          <Chip label="hulls" active={hulls()} onPress={() => hulls.update((v) => !v)} testID="hulls" />
          <Chip label="edge labels" active={edgeLabels()} onPress={() => edgeLabels.update((v) => !v)} testID="edge-labels" />
          <Chip label="arrows" active={arrows()} onPress={() => arrows.update((v) => !v)} testID="arrows" />
          <Chip label="fit" active={false} onPress={() => graph.fit()} testID="fit" />
          <Text class="text-xs text-muted-foreground" testID="stats">
            {`${data().nodes.length} nodes · ${data().edges.length} edges · ${Math.round(graph.zoom() * 100)}%${graph.settling() ? " · settling" : ""}`}
          </Text>
        </View>
        <GraphLegend controller={graph} />
      </View>
      <GraphView
        testID="graph"
        data={data()}
        controller={graph}
        layout={layout()}
        colorBy={colorBy()}
        groupHulls={hulls()}
        edgeLabels={edgeLabels()}
        arrows={arrows()}
        style={{ flex: 1 }}
      />
    </View>
  );
}

mount(Gallery);
