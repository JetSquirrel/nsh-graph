# nsh-graph

An interactive network graph view for [Native Shell (NSH)](https://nsh.dev), written in TSX. It draws on NSH's
native `<Canvas>`, so it runs on every NSH platform: iOS, Android, macOS, Windows, Linux, GPUI, and the web.

Its design draws on [gpui-graph](https://github.com/JetSquirrel/gpui-graph) (force model, community hulls, keyboard
model) and on [Neo4j NVL](https://neo4j.com/docs/nvl/current/) (data model, controller methods, layouts).

- **Layouts**: force-directed (d3-force style, Barnes–Hut repulsion, collision, gravity, group clustering),
  hierarchical (layered, cycle-safe, four directions), circular and grid. Switching layouts animates the nodes.
- **Interaction**: drag the background (or scroll with two fingers on a touchpad) to pan; drag a node to move it,
  with optional sticky pinning. The mouse wheel, Ctrl+scroll, a trackpad pinch or a two-finger touch pinch zooms.
  Tap to select; double-tap or Enter to activate; right-click for a context menu.
  Hovering highlights neighbors. Arrow keys walk the graph; `+`/`-`/`0` zoom and fit; `p` pins; Esc clears.
- **Drawing**: edges batched by state, with arrows; curved parallel edges and self loops; edge captions; community
  hulls; degree-based node sizing; captions inside or under nodes, with collision culling in `auto` mode.
- **Colors**: theme tokens (light and dark) plus a categorical palette validated for color-blind viewers. Its
  order is fixed and never cycled; categories past the eighth share a neutral gray. A category keeps its color
  when others are filtered out.
- **Data**: pass `data`. Changes are diffed by id, so nodes keep their positions, pins and selection; new nodes
  start next to a neighbor.
- **Export**: `controller.toImage()` renders the whole graph to a PNG through `OffscreenCanvas`.

## Install

```sh
pnpm add nsh-graph     # or npm / bun; NSH compiles the TSX source with your app
```

Requires NSH 0.6 or later. 0.6 added `onKeyDown`, `onPinch` and `captureKeys`, which the view uses.

## Use

```tsx
import { mount, signal, View } from "nsh";
import { GraphView, GraphLegend, createGraphController, mergeGraphData } from "nsh-graph";

function App() {
  const graph = createGraphController();
  const data = signal({
    nodes: [
      { id: "a", caption: "Alice", category: "Person", group: "team" },
      { id: "x", caption: "Acme", category: "Company", group: "team" },
    ],
    edges: [{ from: "a", to: "x", caption: "WORKS_AT" }],
  });

  return (
    <View style={{ flex: 1 }}>
      <GraphView
        data={data()}
        controller={graph}
        layout="force"
        edgeLabels
        onSelectionChange={(sel) => console.log(sel)}
        onNodeActivate={async (node) => {
          const more = await loadNeighbors(node.id); // your query
          data.update((d) => mergeGraphData(d, more));
        }}
        style={{ flex: 1 }}
      />
      <GraphLegend controller={graph} style={{ padding: 12 }} />
    </View>
  );
}

mount(App);
```

The view fills the size its style gives it, so give it `flex: 1` or a fixed height.

### Data

```ts
interface GraphNode<T> {
  id: string;
  caption?: string;   // defaults to the id
  category?: string;  // e.g. a Neo4j label: colors nodes with colorBy="category"
  group?: string;     // a community id (e.g. Louvain): colorBy="group", hulls, clustering
  color?: string;     // overrides the palette
  size?: number;      // radius in points, overrides nodeSizing
  pinned?: boolean;
  x?: number; y?: number;  // starting position
  data?: T;           // your payload
}
interface GraphEdge<T> { id?: string; from: string; to: string; caption?: string; color?: string; width?: number; data?: T }
```

### Props

| Prop | Default | |
|---|---|---|
| `data` | (required) | `{ nodes, edges }`. Changes are merged by id. |
| `controller` | | From `createGraphController()`. |
| `layout` | `"force"` | `"force"`, `"hierarchical"`, `"circular"` or `"grid"`. |
| `force` | | `linkDistance` 90, `charge` -320, `theta` 0.9, `collidePadding` 10, `gravity` 0.04, `groupStrength` 0.12, `velocityDecay` 0.4, `alphaDecay`, `alphaMin`, `chargeDistanceMax`. |
| `hierarchical` | | `direction` (`down`/`up`/`right`/`left`), `layerGap` 110, `nodeGap` 70. |
| `nodeSizing` | degree, 14–30 | `{ kind: "fixed", radius }` or `{ kind: "degree", min, max }`. |
| `colorBy` | `"category"` | or `"group"`. |
| `labelMode` | `"auto"` | `"auto"`, `"always"` or `"never"`. |
| `arrows` / `edgeLabels` / `groupHulls` / `stickyDrag` | `true` / `false` / `false` / `false` | |
| `minZoom` / `maxZoom` | `0.05` / `6` | |
| `colors` | theme | `background`, `text`, `surface`, `edge`, `edgeHighlight`, `edgeText`, `selection`, `palette`, `other`. |
| `fontFamily` | `"system-ui"` | |
| `onSelectionChange(selection)` | | `{ kind: "node", node }`, `{ kind: "edge", edge }` or `null`. |
| `onNodeActivate(node)` | | Double-tap, double-click or Enter. |
| `onHover(target)` | | Desktops and the web. |
| `onContextMenu(target, { position, pagePosition })` | | Open a menu with `Menu.popup(items, e.pagePosition)` from `nsh/desktop`. |
| `style`, `class`, `testID`, `accessibilityLabel` | | |

### Controller

```ts
const graph = createGraphController();
graph.selection();  graph.zoom();  graph.legend();  graph.settling();   // reactive
graph.fit();  graph.zoomIn();  graph.zoomOut();  graph.setZoom(1.5);  graph.centerOn(id);
graph.select(id, { center: true });  graph.selectEdge(id);  graph.clearSelection();
graph.relayout();  graph.setPinned(id, true);  graph.isPinned(id);  graph.unpinAll();
graph.node(id);  graph.position(id);  graph.degree(id);  graph.neighbors(id);  graph.edgesOf(id);
const png = await graph.toImage({ scale: 2 });   // Blob
```

### Without the view

`GraphEngine`, `ForceSimulation`, `hierarchicalLayout`, `circularLayout`, `gridLayout` and `renderGraph` are plain
TypeScript with no NSH imports. Use them to lay out graphs headless, or to draw into any Canvas 2D context.

## How it works

```
src/
  types.ts        data model and options
  simulation.ts   force simulation (link, charge, gravity, groups, alpha cooling)
  quadtree.ts     Barnes–Hut many-body force and collision grid on typed arrays
  layouts.ts      hierarchical / circular / grid layouts
  geometry.ts     edge shapes, hit testing, convex hulls
  engine.ts       state: data diffing, viewport, hover, selection, dragging, tweens
  render.ts       Canvas 2D drawing, label collision culling
  palette.ts      categorical palette, ink contrast
  controller.ts   imperative handle
  GraphView.tsx   the NSH component: canvas, frame loop, touch / mouse / wheel / pinch / keyboard
  GraphLegend.tsx legend component
```

The canvas records drawing operations and NSH replays them natively. While the layout is moving, a
`requestAnimationFrame` loop ticks the simulation and bumps a signal that the canvas `draw` reads. Once the layout
settles the loop stops, and only input or data changes draw again. Pointer input uses the responder system, so a
drag inside a scroll view stays in the graph. Desktop extras (`onWheel`, `onPinch`, `onMouseMove`,
`onContextMenu`, `onKeyDown`) are added on top.

## Performance

NSH runs TSX on QuickJS on every platform except the web. QuickJS is an interpreter, so the force layout costs
far more there than in a browser. The view is built around that limit:

- The Barnes–Hut tree and the collision grid live in reusable typed arrays, so a tick allocates nothing.
- Barnes–Hut accuracy coarsens past 300 nodes.
- Nodes are drawn one path per color. Arrows, separator rings and captions are dropped when they would be
  too small to see, and at most 300 captions are placed per frame.
- Edge shapes are computed lazily, and only for edges on screen.
- While a tick is expensive, panning and zooming pause the layout, so the view keeps up with the fingers.
- With Reduce Motion on, the layout settles in 10 ms slices and appears once it is done.

Measured on QuickJS (`nsh test example`, `datasets.test.ts`), JS time per frame:

| Graph | Tick | Draw | Settles in |
|---|---|---|---|
| Karate club, 34 nodes / 78 edges | 1.2 ms | 1.6 ms | 0.4 s |
| Les Misérables, 77 / 254 | 3.6 ms | 5 ms | 1.1 s |
| Flare imports, 220 / 764 | 14 ms | 16 ms | 3.9 s |
| Star, 301 / 300 | 18 ms | 13 ms | 5.8 s |
| Scale-free, 1500 / 2997 | 80 ms | 30 ms | 22 s |

A live force layout stays smooth up to a few hundred nodes. Larger graphs work, but they settle slowly and
frames drop while they do. For those, use `hierarchical`, `circular` or `grid` (computed once, no ticks), or
give nodes starting positions. A Rust simulation is on the roadmap.

## Compared with other libraries

[docs/comparison.md](docs/comparison.md) compares nsh-graph with gpui-graph, Neo4j NVL, Cytoscape.js, sigma.js,
AntV G6, vis-network, ECharts and d3-force, feature by feature. It also has layout benchmarks run inside NSH's
runtime (`nsh test bench`). With the same forces, nsh-graph matches d3-force's layout quality at 2–4.5× the
speed; ForceAtlas2 crosses fewer edges, nsh-graph spaces edges more evenly.

## Datasets and gallery

`example/datasets` holds four open datasets (Zachary's karate club, *Les Misérables*, and the Flare class tree
and imports) and synthetic edge cases: 1500 nodes, a 300-leaf star, a long chain, parallel edges and loops,
CJK / RTL / emoji captions, and malformed data. `nsh run example/Gallery.tsx` shows each of them in every layout.
`datasets.test.ts` checks every dataset in every layout: positions and viewport stay finite, everything ends
up on screen, and the layout settles. `regressions.test.ts` covers the issues these datasets found.

## Develop

```sh
nsh run example                 # the demo app on this desktop
nsh run example/Gallery.tsx     # every dataset, every layout
nsh run example --target web    # in a browser
nsh check example               # type check (library + example)
nsh test example                # headless tests: engine, layouts, datasets, regressions, UI, input
nsh test example/input.test.tsx --target windows   # input on a real host (or macos, linux, web)
```

## Roadmap

- Collapsing communities into super nodes (as gpui-graph does)
- Box / lasso multi-selection
- Edge bundling and level-of-detail rendering for graphs of several thousand nodes
- A Rust port of the simulation for very large graphs, exported to TSX through `#[native_module]`

## License

[Apache License 2.0](LICENSE)
