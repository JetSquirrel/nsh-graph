# nsh-graph compared with other graph libraries

*November 2026. nsh-graph 0.1.0, NSH 0.6.0.*

## Features

| | **nsh-graph** | [gpui-graph](https://github.com/JetSquirrel/gpui-graph) | [Neo4j NVL](https://neo4j.com/docs/nvl/current/) | [Cytoscape.js](https://js.cytoscape.org) | [sigma.js](https://www.sigmajs.org) + graphology | [AntV G6](https://g6.antv.antgroup.com) 5 | [vis-network](https://visjs.github.io/vis-network/) | [ECharts](https://echarts.apache.org) graph | [d3-force](https://d3js.org/d3-force) |
|---|---|---|---|---|---|---|---|---|---|
| Runs on | NSH: iOS, Android, macOS, Windows, Linux, GPUI, web | GPUI desktop (macOS, Linux) | Browser | Browser, Node (headless) | Browser | Browser, Node (SSR) | Browser | Browser | Anywhere (layout only) |
| Language | TSX | Rust | TypeScript, React wrapper | JS | TS | TS | JS | TS | JS |
| Runs inside NSH | yes | no (Rust GPUI, not NSH) | no (needs a DOM) | **no**: fails to load (assigns to frozen built-in prototypes) | no (WebGL, DOM); graphology alone runs with an `events` shim | no (DOM) | no (DOM) | no (DOM) | **yes** (layout only, you draw) |
| Rendering | Native canvas (Core Graphics, Android Canvas, Direct2D…), replayed natively | GPU (GPUI) | Canvas (default), WebGL, SVG | Canvas; WebGL preview since 3.31 | WebGL | Canvas, SVG, WebGL | Canvas | Canvas, SVG | none |
| Force layout | Barnes–Hut, collision, gravity, group clustering | Barnes–Hut, collision, gravity, group clustering | forceDirected, d3Force | cose, fcose / cola (ext.) | ForceAtlas2 (web worker) | force, d3-force, ForceAtlas2, Fruchterman (some WASM / GPU) | Barnes–Hut, ForceAtlas2-based, repulsion | force | yes (the reference) |
| Other layouts | hierarchical, circular, grid | none | hierarchical, grid, free | breadthfirst, circle, grid, concentric; dagre, ELK (ext.) | circular, random, noverlap | dagre, circular, concentric, radial, grid, MDS, mindmap, dendrogram… | hierarchical | circular | none |
| Groups | hulls, clustering force | hulls, **collapse to super nodes** | none built in | **compound nodes** | none built in | **combos** (collapsible) | clustering | categories | none |
| Selection | multi, box, keyboard | single, keyboard | single, box, lasso | multi, box | via events | multi, box, lasso | multi | single | none |
| Node look | circles, color, size, caption | circles, caption | circles, icons, captions | shapes, images, CSS-like style | circles, images (programs) | shapes, images, HTML / React nodes, 3D (ext.) | shapes, images | symbols | none |
| Graph algorithms | none (neighbors, degree) | none | none | **many** (paths, centrality, clustering) | graphology std-lib | some | none | none | none |
| Accessibility | keyboard walk, screen-reader label, reduced motion, validated palette | keyboard, focus rings, reduced motion | keyboard handlers | none built in | none built in | some keyboard | keyboard (opt-in) | ARIA description | n/a |
| Practical size, interactive | hundreds of nodes (QuickJS); larger with static layouts | thousands (native) | ~1k canvas, 100k+ WebGL | thousands | 100k (WebGL) | thousands, more with WebGL | thousands | thousands | depends on the host |
| License | Apache-2.0 | Apache-2.0 | Neo4j license (for use with Neo4j) | MIT | MIT | MIT | Apache-2.0 / MIT | Apache-2.0 | ISC |
| Dependencies | none | gpui-base, GPUI | several | none | graphology | @antv/g… | none | zrender | d3-quadtree, d3-dispatch, d3-timer |

## Layout engines measured in NSH's runtime

Only layout engines that don't need a DOM can run in NSH. `bench/compare.test.ts` runs nsh-graph's force layout,
d3-force and ForceAtlas2 (graphology) inside NSH's QuickJS on the same datasets. It records the compute time to a
finished layout, then scores each result the same way after scaling it to a mean edge length of 1:

- **edge CV**: the spread of edge lengths (std / mean). Lower is more even.
- **crowded**: the share of node pairs closer than 0.3 × the mean edge length. Lower means fewer pile-ups.
- **x/edge**: edge crossings per edge. Lower is cleaner.

"d3-force (same forces)" uses exactly nsh-graph's forces and parameters, so its row checks the implementation
itself. "d3-force (defaults)" is how most d3 examples set it up. ForceAtlas2 uses graphology's inferred settings,
with Barnes–Hut on for the 1500-node graph.

Compute time on a Windows Server VM under load (absolute times ran about 2× slower than in quiet runs; every
engine ran under the same conditions). Each engine had at most 120 s per dataset.

| Dataset | Engine | Time | Steps | Edge CV ↓ | Crowded ↓ | x/edge ↓ |
|---|---|---|---|---|---|---|
| Karate (34 / 78) | **nsh-graph** | **0.9 s** | 280 | **0.26** | **0.00%** | 0.95 |
| | d3-force, same forces | 2.0 s | 300 | 0.27 | 0.00% | 1.06 |
| | d3-force, defaults | 1.2 s | 300 | 0.33 | 0.71% | 0.88 |
| | ForceAtlas2 | **0.6 s** | 300 | 0.47 | 0.53% | **0.79** |
| Les Misérables (77 / 254) | **nsh-graph** | 2.4 s | 294 | 0.53 | **0.38%** | 3.71 |
| | d3-force, same forces | 5.9 s | 300 | **0.46** | 0.51% | 3.61 |
| | d3-force, defaults | 3.7 s | 300 | 0.54 | 0.68% | 3.87 |
| | ForceAtlas2 | **2.2 s** | 300 | 0.63 | 1.23% | **3.14** |
| Flare imports (220 / 764) | **nsh-graph** | **8.7 s** | 297 | **0.51** | **0.62%** | 10.68 |
| | d3-force, same forces | 22.6 s | 300 | 0.51 | 0.63% | 10.43 |
| | d3-force, defaults | 14.7 s | 300 | 0.62 | 0.73% | 9.69 |
| | ForceAtlas2 | 14.5 s | 300 | 0.63 | 0.79% | **8.95** |
| Scale-free (1500 / 2997) | **nsh-graph** | **46.9 s, done** | 299 | **0.49** | 1.10% | – |
| | d3-force, same forces | stopped at 120 s | 170 / 300 | 0.49 | 1.09% | – |
| | d3-force, defaults | stopped at 120 s | 249 / 300 | 0.50 | **1.07%** | – |
| | ForceAtlas2 (Barnes–Hut) | stopped at 120 s | 212 / 300 | 0.52 | 1.27% | – |

What it shows:

- **Same forces, same result, 2–4.5× faster than d3-force on QuickJS.** With identical forces, nsh-graph and
  d3-force land on layouts of the same quality (edge CV and crowding match to two decimals), so the simulation is
  correct. nsh-graph is 2.2–2.6× faster per tick on graphs up to 220 nodes: typed-array quadtree, no per-tick
  allocation. On the 1500-node graph it is 4.5× faster, partly because it coarsens Barnes–Hut past 300 nodes
  (θ ≈ 1.4 instead of 0.9).
- **More even edges and fewer pile-ups than ForceAtlas2.** FA2's edge CV is 0.47–0.63 against nsh-graph's
  0.26–0.53. The collision force keeps crowding lowest on the three small graphs.
- **ForceAtlas2 crosses fewer edges.** Its stronger clustering gives 15–25% fewer crossings, and on the two
  smallest graphs it is as fast or faster. A crossing-reducing pass, or an FA2-style "LinLog" mode, would
  be a reasonable addition.
- **No JS engine lays out 1500 nodes interactively in QuickJS.** nsh-graph is the only one that finishes inside
  the budget, but 47 s of compute is far from interactive. For graphs that size, use static layouts, precomputed
  positions, or a native (Rust) simulation.

## Where nsh-graph stands

**Strengths.**
- The only one of these that runs natively on iOS, Android, desktop and the web from one codebase.
- No DOM and no dependencies.
- Fastest force layout on NSH's runtime.
- Follows the app's theme tokens.
- Keyboard and screen-reader support, plus a color-blind-safe palette.
- Apache-2.0. NVL's license limits it to Neo4j.

**Gaps against the browser libraries.**
- No GPU renderer, so it doesn't reach WebGL scale (sigma, NVL, G6).
- No collapsible groups (gpui-graph, G6 combos, Cytoscape compound nodes).
- No lasso selection (Shift-click and box selection are in).
- No node shapes, icons or images.
- No graph algorithms (Cytoscape, graphology).
- Fewer layouts: no radial, concentric or ELK / dagre-grade layered layout.
