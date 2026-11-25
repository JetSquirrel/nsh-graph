# nsh-graph

An interactive network graph view for [Native Shell (NSH)](https://nsh.dev), written in TSX, with an optional Rust
backend for large graphs. It draws on NSH's native `<Canvas>`, so it runs on every NSH platform: iOS, Android, macOS,
Windows, Linux, GPUI, and the web. It ships as an [nshm](#install): `nsh add nsh-graph`.

**[Live demo and showcase →](https://jetsquirrel.github.io/nsh-graph/)** ([gallery](https://jetsquirrel.github.io/nsh-graph/gallery/))

Its design draws on [gpui-graph](https://github.com/JetSquirrel/gpui-graph) (force model, community hulls, keyboard
model) and on [Neo4j NVL](https://neo4j.com/docs/nvl/current/) (data model, controller methods, layouts).

- **Layouts**: force-directed (d3-force style, Barnes–Hut repulsion, collision, gravity, group clustering),
  hierarchical (layered, cycle-safe, four directions), circular and grid. Switching layouts animates the nodes.
- **Interaction**: drag the background (or scroll with two fingers on a touchpad) to pan; drag a node to move it,
  with optional sticky pinning. The mouse wheel, Ctrl+scroll, a trackpad pinch or a two-finger touch pinch zooms.
  Tap to select; Shift-, Ctrl- or ⌘-click adds or removes a node, Shift-drag on the background draws a selection
  box, and dragging one of several selected nodes moves them all. Double-tap or Enter activates; right-click opens a
  context menu.
  Hovering highlights neighbors and shows a tooltip. Arrow keys walk the graph; `+`/`-`/`0` zoom and fit; `p` pins;
  Esc clears.
- **Drawing**: edges batched by state, with arrows; curved parallel edges and self loops; edge captions; community
  hulls; degree-based node sizing; captions inside or under nodes, with collision culling in `auto` mode.
- **Communities**: [collapse a group](#communities) into one super node with its member count; edges to it are
  bundled per direction and captioned `×N`. Double-tap (or Enter) expands it, members back where they were.
- **Colors**: theme tokens (light and dark) plus a categorical palette validated for color-blind viewers. Its
  order is fixed and never cycled; categories past the eighth share a neutral gray. A category keeps its color
  when others are filtered out.
- **Data**: pass `data`. Changes are diffed by id, so nodes keep their positions, pins and selection; new nodes
  start next to a neighbor.
- **Export**: `controller.toImage()` renders the whole graph to a PNG through `OffscreenCanvas`.

## Install

nsh-graph is an [nshm](https://nsh.dev/versions/main/docs/nshm/): one package with the TSX view and its Rust
backend.

```sh
nsh add nsh-graph                    # from crates.io
nsh add github:JetSquirrel/nsh-graph # or from GitHub
```

This adds it to `"dependencies"` in the app's nsh.json and pins it in `nsh.lock`. Import the view from `"nsh-graph"`
and, optionally, the Rust backend from `"nsh-graph/native"` (see [Rust backend](#rust-backend)). The package
includes Rust, so the app builds with the Rust toolchain (and the `wasm32-unknown-unknown` target for the web).

Requires NSH 0.7 or later (its Rust side builds against `nsh-core` 0.7). 0.6 added `onKeyDown`, `onPinch` and `captureKeys`, which the view uses.

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
| `multiSelect` | `true` | Shift/Ctrl/⌘-click, Shift-drag box, Shift + arrows, Ctrl/⌘ + A. `false`: one item at a time. |
| `minZoom` / `maxZoom` | `0.05` / `6` | |
| `colors` | theme | `background`, `text`, `surface`, `edge`, `edgeHighlight`, `edgeText`, `selection`, `palette`, `other`. |
| `fontFamily` | `"system-ui"` | |
| `onSelectionChange(selection)` | | `{ kind: "node", node, nodes }` (`node` is the one selected last, `nodes` all of them), `{ kind: "edge", edge }`, `{ kind: "group", group }` (a super node), `{ kind: "bundle", edges }` or `null`. |
| `onNodeActivate(node)` | | Double-tap, double-click or Enter. |
| `onGroupToggle(group, collapsed)` | | A group was collapsed or expanded. |
| `onHover(target)` | | Desktops and the web. |
| `tooltips` | `true` | A card beside the pointer over a node, edge, group or bundle: its category and group (or what it is), caption, and relationship or member count. Desktops and the web. |
| `tooltip(target)` | | Content in place of the built-in card; return `null` for none, or a `<GraphTooltip kicker title detail swatch>` for the same look with your own lines. |
| `onContextMenu(target, { position, pagePosition })` | | Open a menu with `Menu.popup(items, e.pagePosition)` from `nsh/desktop`. |
| `style`, `class`, `testID`, `accessibilityLabel` | | |

### Controller

```ts
const graph = createGraphController();
graph.selection();  graph.zoom();  graph.legend();  graph.settling();   // reactive
graph.fit();  graph.zoomIn();  graph.zoomOut();  graph.setZoom(1.5);  graph.centerOn(id);
graph.select(id, { center: true });  graph.selectEdge(id);  graph.clearSelection();
graph.selectNodes(ids, "add");  graph.selectAll();  graph.selectedIds();  graph.isSelected(id);  graph.fitSelection();
graph.relayout();  graph.setPinned(id, true);  graph.isPinned(id);  graph.unpinAll();
graph.node(id);  graph.position(id);  graph.degree(id);  graph.neighbors(id);  graph.edgesOf(id);
graph.groups();   // reactive
graph.collapseGroup(id);  graph.expandGroup(id);  graph.toggleGroup(id);  graph.collapseAllGroups();  graph.expandAllGroups();
graph.isCollapsed(id);  graph.group(id);  graph.selectGroup(id);  graph.setGroupLabel(id, "Harbor crew");
const png = await graph.toImage({ scale: 2 });   // Blob
```

### Communities

Nodes that share a `group` (a community from Louvain, say) form a group. `graph.collapseGroup(id)` draws the
group as one super node: bigger than the other nodes, with a double ring, its member count inside and its label
under it. Edges between the group and another node or group are bundled into one per direction, drawn thicker
and captioned `×N`, even without `edgeLabels`. Edges inside the group are hidden. A super node starts at its
members' center. When it expands, by double-tap, Enter or `expandGroup`, the members come back around wherever it
was dragged, placed as they were.

Collapsing changes only what is drawn:

- `node`, `degree`, `neighbors`, `edgesOf` and the legend still describe the whole graph.
- Colors stay the same: with `colorBy="group"` a super node has its group's color, and with `"category"` it has
  the color of its members' most common category.
- Selected members stay selected while their group is collapsed, and their super node shows the ring.
- A selected super node is `{ kind: "group", group }`, with `group.nodes` listing its members. A selected bundle
  is `{ kind: "bundle", edges }`.
- New members that arrive in `data` while the group is collapsed join it hidden. A group that no node has any
  more is no longer collapsed.

`graph.groups()` lists the groups with their members and whether each is collapsed, for a community list.
Hosts that switch on `selection.kind` or `target.kind` should handle `"group"` and `"bundle"`.

### Without the view

`GraphEngine`, `ForceSimulation`, `hierarchicalLayout`, `circularLayout`, `gridLayout` and `renderGraph` are plain
TypeScript with no NSH imports. Use them to lay out graphs headless, or to draw into any Canvas 2D context.

## How it works

```
nsh.json          the nshm: exports "nsh-graph" (src/index.ts)
Cargo.toml        the crate: the Rust module "nsh-graph/native" (native/src/lib.rs)
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
  GraphTooltip.tsx the tooltip card
  tooltip.ts      what the built-in tooltip says (plain TypeScript)
  native.ts       the optional Rust backend's interface and setNativeBackend
native/src/
  lib.rs          the native module: ForceLayout and GraphPainter, data in little-endian buffers
  sim.rs          the force simulation, step for step the same as simulation.ts
  paint.rs        edges and nodes traced as SVG path data, one path per batch
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
  The tree walk follows precomputed links instead of a stack, and the hot loops keep their locals in `var`s,
  which QuickJS reads without the checks it makes on `let` and `const`.
- Barnes–Hut accuracy coarsens past 300 nodes.
- Nodes are drawn one path per color. Arrows, separator rings and captions are dropped when they would be
  too small to see, and at most 300 captions are placed per frame.
- Straight edges are traced without building shape objects; curved ones and loops are computed lazily, and
  only for edges on screen.
- While a tick is expensive, panning and zooming pause the layout, so the view keeps up with the fingers.
- With Reduce Motion on, the layout settles in 10 ms slices and appears once it is done.

Measured on QuickJS (`nsh test example`, `datasets.test.ts`), JS time per frame:

| Graph | Tick | Draw | Settles in |
|---|---|---|---|
| Karate club, 34 nodes / 78 edges | 0.7 ms | 1 ms | 0.2 s |
| Les Misérables, 77 / 254 | 2.1 ms | 2.6 ms | 0.5 s |
| Flare imports, 220 / 764 | 7 ms | 4 ms | 1.9 s |
| Star, 301 / 300 | 10 ms | 5 ms | 2.8 s |
| Scale-free, 1500 / 2997 | 42 ms | 8 ms | 12 s |

In TypeScript, a live force layout stays smooth up to a few hundred nodes. Larger graphs work, but they
settle slowly and frames drop while they do. For those, use the Rust backend below, or `hierarchical`,
`circular` or `grid` (computed once, no ticks), or give nodes starting positions.

### Rust backend

The package's Rust module, `nsh-graph/native` (source in `native/`), follows gpui-graph's Rust layout and
batched painting. It moves the two hot paths out of QuickJS:

- **`ForceLayout`**: the force simulation, the same forces step for step (the layouts match), at the
  configured Barnes–Hut accuracy at every size. It keeps the nodes' state between ticks: JS sends only what
  it changed (a dragged or pinned node, or every node after a layout jumps), and a tick returns only
  positions, which the painter takes as they are.
- **`GraphPainter`**: edges and nodes traced as SVG path data, one path per state and color, that the canvas
  draws with a handful of `Path2D` calls instead of several calls per edge and node. Arrows, captions,
  rings and hulls are unchanged.

It is opt-in: register it once at startup.

```ts
import * as native from "nsh-graph/native";
import { setNativeBackend, type NativeBackend } from "nsh-graph";
setNativeBackend(native as unknown as NativeBackend);
```

Views mounted after that use it. Without it, the TypeScript layout runs.

NSH's docs say nshms from crates.io and Git build optimized. A local checkout added with `nsh add --path` builds
with the app's dev profile, about ten times slower. If you use one, add this to the app's `.cargo/config.toml`
(this repository's covers `perf/`):

```toml
[profile.dev.package.nsh-graph]
opt-level = 3
```

Measured in NSH 0.7's headless runtime (`nsh test perf`, best of three runs), TypeScript → Rust:

| Graph | Tick | Settles in | Draw |
|---|---|---|---|
| Flare imports, 220 / 764 | 6.9 → 0.2 ms | 1.9 → 0.06 s | |
| Star, 301 / 300 | 9.5 → 0.2 ms | 2.7 → 0.09 s | |
| Scale-free, 1500 / 2997 | 42 → 2.1 ms | 11 → 0.52 s | 8.6 → 3.0 ms |
| Scale-free, 5000 / 9997 | 156 → 8.6 ms | (minutes) → 2.4 s | 33 → 11 ms |

Edge-length spread and crowding are the same both ways. Keeping the state in Rust took a 5000-node tick from
11.8 to 8.0 ms, and a tick with the painter's positions from 14.0 to 7.8 ms, measured side by side in one
process; most of what is left is the many-body force. `nsh run perf` shows 1500 to 10000 nodes either way.

## Compared with other libraries

[docs/comparison.md](docs/comparison.md) compares nsh-graph with gpui-graph, Neo4j NVL, Cytoscape.js, sigma.js,
AntV G6, vis-network, ECharts and d3-force, feature by feature. It also has layout benchmarks run inside NSH's
runtime (`nsh test bench`), against d3-force, ForceAtlas2, AntV G6's force and Fruchterman layouts
(@antv/layout) and WebCola. nsh-graph is the fastest on every dataset. With the same forces, it matches
d3-force's layout quality at 3.9–8.2× the speed, and it lays out 3–11× faster than AntV's layouts with fewer
edge crossings (AntV force has 1.7–2.2× as many). ForceAtlas2 crosses fewer edges, and WebCola piles up fewer
nodes but is far slower.

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

nsh run perf                    # 1500 to 10000 nodes, TypeScript or Rust (builds the crate)
nsh test perf                   # TypeScript and Rust side by side: tick, settle, draw, layout quality
nsh test bench                  # nsh-graph against d3-force, ForceAtlas2, AntV and WebCola (docs/comparison.md)
cargo test                      # the Rust crate on its own
```

`example/` and `bench/` resolve `"nsh-graph"` to `src/` with an alias, so they run without Rust. `perf/` adds the
package the way an app does (`"dependencies": { "nsh-graph": { "path": ".." } }`), so it also builds the crate.

To release: bump `version` in `Cargo.toml`, then `cargo publish` and tag the same version
(`git tag v0.2.0 && git push --tags`), which is what `nsh add github:JetSquirrel/nsh-graph` installs. Apps update
with `nsh upgrade nsh-graph`.

## Roadmap

- Lasso selection (box selection is in)
- Edge bundling and level-of-detail rendering for graphs of several thousand nodes

## License

[Apache License 2.0](LICENSE)
