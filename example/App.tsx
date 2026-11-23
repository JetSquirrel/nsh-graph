import { mount, signal, Text, View, windowSize, type JSX } from "nsh";
import {
  GraphLegend,
  GraphView,
  createGraphController,
  mergeGraphData,
  type ColorBy,
  type LabelMode,
  type LayoutKind,
} from "nsh-graph";
import { filmGraph, loadNeighbors, type Props } from "./data";

function Button(props: { label: string; onPress: () => void; active?: boolean; testID?: string }) {
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityState={{ selected: !!props.active }}
      onPress={props.onPress}
      class={`rounded-md px-3 py-1.5 ${props.active ? "bg-primary" : "bg-secondary hover:bg-accent active:bg-accent"}`}
    >
      <Text class={`text-sm ${props.active ? "text-primary-foreground" : "text-secondary-foreground"}`}>{props.label}</Text>
    </View>
  );
}

function Segmented<T extends string>(props: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <View class="flex-row gap-1">
      <Each of={[...props.options]}>
        {(o) => <Button label={o()} active={props.value === o()} onPress={() => props.onChange(o())} testID={`opt-${o()}`} />}
      </Each>
    </View>
  );
}

function Row(props: { children: JSX.Element }) {
  return <View class="flex-row flex-wrap items-center gap-2">{props.children}</View>;
}

function App() {
  const graph = createGraphController();
  const data = signal(filmGraph());
  const layout = signal<LayoutKind>("force");
  const colorBy = signal<ColorBy>("category");
  const labelMode = signal<LabelMode>("auto");
  const edgeLabels = signal(false);
  const hulls = signal(false);
  const sticky = signal(false);
  const status = signal("Double-click a node to load its neighbors.");

  const expand = (id: string) => {
    const more = loadNeighbors(id);
    const fresh = more.nodes.filter((n) => !data().nodes.some((m) => m.id === n.id));
    if (fresh.length === 0) {
      status.set("Nothing more to load there.");
      return;
    }
    data.update((d) => mergeGraphData(d, more));
    status.set(`Loaded ${fresh.map((n) => n.caption).join(", ")}.`);
  };

  const wide = () => windowSize().width >= 860;

  const details = () => {
    const sel = graph.selection();
    if (!sel) return null;
    if (sel.kind === "edge") {
      return {
        title: sel.edge.caption ?? "Edge",
        lines: [`${graph.node(sel.edge.from)?.caption} → ${graph.node(sel.edge.to)?.caption}`],
      };
    }
    const n = sel.node;
    const d = n.data as Props | undefined;
    return {
      title: n.caption ?? n.id,
      lines: [
        `${n.category ?? "Node"}${n.group ? ` · ${n.group}` : ""}`,
        d?.born ? `Born ${d.born}` : d?.year ? `Released ${d.year}` : "",
        `${graph.degree(n.id)} connections${graph.isPinned(n.id) ? " · pinned" : ""}`,
        `Neighbors: ${graph.neighbors(n.id).map((m) => m.caption).join(", ")}`,
      ].filter(Boolean),
    };
  };

  return (
    <View class="flex-1 bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <View class="gap-2 border-b border-border px-4 py-3">
        <Row>
          <Text class="text-base font-semibold text-foreground mr-2">nsh-graph</Text>
          <Segmented value={layout()} options={["force", "hierarchical", "circular", "grid"] as const} onChange={layout.set} />
        </Row>
        <Row>
          <Segmented value={colorBy()} options={["category", "group"] as const} onChange={colorBy.set} />
          <Segmented value={labelMode()} options={["auto", "always", "never"] as const} onChange={labelMode.set} />
          <Button label="Edge labels" active={edgeLabels()} onPress={() => edgeLabels.update((v) => !v)} testID="edge-labels" />
          <Button label="Hulls" active={hulls()} onPress={() => hulls.update((v) => !v)} />
          <Button label="Sticky drag" active={sticky()} onPress={() => sticky.update((v) => !v)} />
        </Row>
        <Row>
          <Button label="Fit" onPress={() => graph.fit()} testID="fit" />
          <Button label="Zoom in" onPress={() => graph.zoomIn()} />
          <Button label="Zoom out" onPress={() => graph.zoomOut()} />
          <Button label="Relayout" onPress={() => graph.relayout()} />
          <Button label="Unpin all" onPress={() => graph.unpinAll()} />
          <Button label="Reset data" onPress={() => data.set(filmGraph())} />
          <Text class="text-sm text-muted-foreground" testID="zoom">
            {`${Math.round(graph.zoom() * 100)}%${graph.settling() ? " · settling" : ""}`}
          </Text>
        </Row>
      </View>

      <View style={{ flex: 1, flexDirection: wide() ? "row" : "column" }}>
        <View style={{ flex: 1, minHeight: 280 }}>
          <GraphView
            data={data()}
            controller={graph}
            layout={layout()}
            colorBy={colorBy()}
            labelMode={labelMode()}
            edgeLabels={edgeLabels()}
            groupHulls={hulls()}
            stickyDrag={sticky()}
            accessibilityLabel="Film graph"
            testID="graph"
            onNodeActivate={(node) => expand(node.id)}
            onContextMenu={(target) => {
              if (target.kind === "node") {
                const pinned = graph.isPinned(target.node.id);
                graph.setPinned(target.node.id, !pinned);
                status.set(`${pinned ? "Unpinned" : "Pinned"} ${target.node.caption}.`);
              }
            }}
            style={{ flex: 1 }}
          />
          {/* Always in reach on the canvas: one wheel turn or drag can leave the graph off screen. */}
          <View style={{ position: "absolute", top: 12, right: 12 }}>
            <Button label="Reset view" onPress={() => graph.fit()} testID="reset-view" />
          </View>
        </View>
        <View
          class="gap-3 border-border p-4"
          style={wide() ? { width: 300, borderLeftWidth: 1 } : { borderTopWidth: 1, maxHeight: 260 }}
        >
          <GraphLegend controller={graph} />
          <If when={details()} else={<Text class="text-sm text-muted-foreground">Select a node or an edge.</Text>}>
            {(d) => (
              <View class="gap-1" testID="details">
                <Text class="text-base font-semibold text-foreground">{d().title}</Text>
                <Each of={d().lines}>{(line) => <Text class="text-sm text-muted-foreground">{line()}</Text>}</Each>
              </View>
            )}
          </If>
          <Text class="text-xs text-muted-foreground" testID="status">{status()}</Text>
          <Text class="text-xs text-muted-foreground">
            Drag to pan · scroll or pinch to zoom · drag nodes · right-click pins · arrows + Enter with focus
          </Text>
        </View>
      </View>
    </View>
  );
}

mount(App);
