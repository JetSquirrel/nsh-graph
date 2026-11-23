# nsh-graph compared with other graph libraries

*November 2026. nsh-graph 0.1.0, NSH 0.6.1. Benchmarks: d3-force 3.0.0, graphology-layout-forceatlas2 0.10.1, @antv/layout 2.0.0 (AntV G6 5.1), WebCola 3.4.0.*

## Features

| | **nsh-graph** | [gpui-graph](https://github.com/JetSquirrel/gpui-graph) | [Neo4j NVL](https://neo4j.com/docs/nvl/current/) | [Cytoscape.js](https://js.cytoscape.org) | [sigma.js](https://www.sigmajs.org) + graphology | [AntV G6](https://g6.antv.antgroup.com) 5 | [vis-network](https://visjs.github.io/vis-network/) | [ECharts](https://echarts.apache.org) graph | [d3-force](https://d3js.org/d3-force) |
|---|---|---|---|---|---|---|---|---|---|
| Runs on | NSH: iOS, Android, macOS, Windows, Linux, GPUI, web | GPUI desktop (macOS, Linux) | Browser | Browser, Node (headless) | Browser | Browser, Node (SSR) | Browser | Browser | Anywhere (layout only) |
| Language | TSX, optional Rust backend | Rust | TypeScript, React wrapper | JS | TS | TS | JS | TS | JS |
| Runs inside NSH | yes | no (Rust GPUI, not NSH) | no (needs a DOM) | **no**: fails to load (assigns to frozen built-in prototypes) | no (WebGL, DOM); graphology alone runs with an `events` shim | no (DOM); its layouts (@antv/layout) **run**, and are measured below | no (DOM) | no (DOM) | **yes** (layout only, you draw) |
| Rendering | Native canvas (Core Graphics, Android Canvas, Direct2D…), replayed natively | GPU (GPUI) | Canvas (default), WebGL, SVG | Canvas; WebGL preview since 3.31 | WebGL | Canvas, SVG, WebGL | Canvas | Canvas, SVG | none |
| Force layout | Barnes–Hut, collision, gravity, group clustering | Barnes–Hut, collision, gravity, group clustering | forceDirected, d3Force | cose, fcose / cola (ext.) | ForceAtlas2 (web worker) | force, d3-force, ForceAtlas2, Fruchterman (some WASM / GPU) | Barnes–Hut, ForceAtlas2-based, repulsion | force | yes (the reference) |
| Other layouts | hierarchical, circular, grid | none | hierarchical, grid, free | breadthfirst, circle, grid, concentric; dagre, ELK (ext.) | circular, random, noverlap | dagre, circular, concentric, radial, grid, MDS, mindmap, dendrogram… | hierarchical | circular | none |
| Groups | hulls, clustering force | hulls, **collapse to super nodes** | none built in | **compound nodes** | none built in | **combos** (collapsible) | clustering | categories | none |
| Selection | multi, box, keyboard | single, keyboard | single, box, lasso | multi, box | via events | multi, box, lasso | multi | single | none |
| Node look | circles, color, size, caption | circles, caption | circles, icons, captions | shapes, images, CSS-like style | circles, images (programs) | shapes, images, HTML / React nodes, 3D (ext.) | shapes, images | symbols | none |
| Graph algorithms | none (neighbors, degree) | none | none | **many** (paths, centrality, clustering) | graphology std-lib | some | none | none | none |
| Accessibility | keyboard walk, screen-reader label, reduced motion, validated palette | keyboard, focus rings, reduced motion | keyboard handlers | none built in | none built in | some keyboard | keyboard (opt-in) | ARIA description | n/a |
| Practical size, interactive | hundreds of nodes in TypeScript (QuickJS), thousands with the Rust backend; larger with static layouts | thousands (native) | ~1k canvas, 100k+ WebGL | thousands | 100k (WebGL) | thousands, more with WebGL | thousands | thousands | depends on the host |
| License | Apache-2.0 | Apache-2.0 | Neo4j license (for use with Neo4j) | MIT | MIT | MIT | Apache-2.0 / MIT | Apache-2.0 | ISC |
| Dependencies | none (nsh-core for the Rust backend) | gpui-base, GPUI | several | none | graphology | @antv/g… | none | zrender | d3-quadtree, d3-dispatch, d3-timer |

## Layout engines measured in NSH's runtime

Only layout engines that don't need a DOM can run in NSH. `bench/compare.test.ts` runs seven of them inside
NSH's QuickJS on the same datasets:

- **nsh-graph**'s force layout.
- **d3-force**, twice. "Same forces" uses exactly nsh-graph's forces and parameters, so its row checks the
  implementation itself. "Defaults" is how most d3 examples set it up (link, many-body, center).
- **ForceAtlas2** (graphology), Gephi's layout, with graphology's inferred settings and Barnes–Hut on for the
  1500-node graph.
- **AntV force** and **AntV Fruchterman**: the `force` and `fruchterman` layouts of
  [@antv/layout](https://github.com/antvis/layout) 2.0, the layout engine of AntV G6 5. G6 itself needs a DOM, but
  its layouts don't. They run with G6's defaults on a 1000 × 700 canvas, until their own stopping rule
  (`force`: 500 steps, or a step that moves the nodes less than 0.4; `fruchterman`: 1000 steps).
- **WebCola**, the constraint-based layout often paired with d3 (stress majorization over all-pairs shortest
  paths), with its defaults, until it converges.

NSH stops any single call after 2 s, so every engine runs one step at a time across turns of the event loop. The
time counts only computing. AntV's and WebCola's own loops would run to the end in one call, so the bench sets
them up with no iterations and ticks them itself, with the same stopping rules.

Each result is scored the same way after scaling it to a mean edge length of 1:

- **edge CV**: the spread of edge lengths (std / mean). Lower is more even.
- **crowded**: the share of node pairs closer than 0.3 × the mean edge length. Lower means fewer pile-ups.
- **x/edge**: edge crossings per edge. Lower is cleaner.

Compute time on a Windows Server VM, all engines in one session. Each engine had at most 120 s per dataset.

| Dataset | Engine | Time | Steps | Edge CV ↓ | Crowded ↓ | x/edge ↓ |
|---|---|---|---|---|---|---|
| Karate (34 / 78) | **nsh-graph** | 0.39 s | 254 | **0.26** | **0.00%** | 0.95 |
| | d3-force, same forces | 0.91 s | 300 | 0.27 | 0.00% | 1.06 |
| | d3-force, defaults | 0.55 s | 300 | 0.33 | 0.71% | **0.88** |
| | ForceAtlas2 | **0.32 s** | 300 | 0.47 | 0.18% | **0.88** |
| | AntV force | 2.13 s | 500 | 0.27 | 0.00% | 2.12 |
| | AntV Fruchterman | 0.78 s | 1000 | 0.35 | 0.00% | 1.45 |
| | WebCola | 0.69 s | 65 | 0.31 | 0.18% | 1.05 |
| Les Misérables (77 / 254) | **nsh-graph** | **1.08 s** | 284 | 0.53 | 0.38% | 3.71 |
| | d3-force, same forces | 2.86 s | 300 | 0.46 | 0.51% | 3.61 |
| | d3-force, defaults | 1.62 s | 300 | 0.54 | 0.68% | 3.87 |
| | ForceAtlas2 | 1.14 s | 300 | 0.63 | 1.44% | **3.28** |
| | AntV force | 5.87 s | 500 | **0.37** | 0.17% | 7.63 |
| | AntV Fruchterman | 3.56 s | 1000 | 0.45 | 0.07% | 4.52 |
| | WebCola | 26.3 s | 496 | 0.48 | **0.03%** | 3.82 |
| Flare imports (220 / 764) | **nsh-graph** | **3.8 s** | 295 | 0.51 | 0.62% | 10.68 |
| | d3-force, same forces | 10.3 s | 300 | 0.51 | 0.63% | 10.43 |
| | d3-force, defaults | 6.6 s | 300 | 0.62 | 0.73% | 9.69 |
| | ForceAtlas2 | 6.8 s | 300 | 0.65 | 0.83% | **9.28** |
| | AntV force | 20.2 s | 500 | **0.36** | 0.86% | 24.67 |
| | AntV Fruchterman | 23.3 s | 1000 | 0.45 | 0.68% | 14.48 |
| | WebCola | stopped at 120 s | 252 | 0.45 | **0.29%** | 10.52 |
| Scale-free (1500 / 2997) | **nsh-graph** | **23.3 s** | 300 | 0.49 | 1.10% | – |
| | d3-force, same forces | 109.1 s | 300 | 0.49 | 1.09% | – |
| | d3-force, defaults | 75.8 s | 300 | 0.50 | **1.07%** | – |
| | ForceAtlas2 (Barnes–Hut) | 89.1 s | 300 | 0.53 | 1.17% | – |
| | AntV force | stopped at 120 s | 292 / 500 | **0.40** | 2.28% | – |
| | AntV Fruchterman | stopped at 120 s | 106 / 1000 | 0.50 | 6.73% | – |
| | WebCola | can't run | – | – | – | – |

WebCola can't run the 1500-node graph: its setup computes all-pairs shortest paths in one call, which runs past
NSH's 2 s limit, and NSH interrupts it. Crossings aren't counted past 800 edges.

What it shows:

- **Same forces, same result, 2.3–4.7× faster than d3-force on QuickJS.** With identical forces, nsh-graph and
  d3-force land on layouts of the same quality (edge CV and crowding match to two decimals), so the simulation is
  correct. nsh-graph is 2.3–2.7× faster on graphs up to 220 nodes, thanks to a typed-array quadtree with no
  per-tick allocation. On the 1500-node graph it is 4.7× faster, partly because it coarsens Barnes–Hut past
  300 nodes (θ ≈ 1.4 instead of 0.9).
- **AntV G6's layouts are 2–6× slower and cross more edges.** AntV force takes 5.3–5.5× as long as nsh-graph on
  every graph that finishes, and Fruchterman 2–6×. Neither finishes 1500 nodes within the budget. AntV force
  spaces edges most evenly on the three larger graphs (edge CV 0.36–0.40), but its layouts cross 2–2.3× as many
  edges as nsh-graph's. That
  is how G6 behaves by default; a G6 app would tune `linkDistance` and the strengths.
- **WebCola spaces nodes best and is the slowest.** Stress majorization gives the fewest pile-ups (0.03% on Les
  Misérables, 0.29% on Flare). But it took 26 s on 77 nodes, didn't finish 220 nodes in 120 s, and can't run
  1500 in NSH at all.
- **ForceAtlas2 crosses the fewest edges.** Its stronger clustering gives 7–13% fewer crossings than nsh-graph,
  and it is the fastest on the smallest graph. Its edges are the least even (edge CV 0.47–0.65). A
  crossing-reducing pass, or an FA2-style "LinLog" mode, would be a reasonable addition to nsh-graph.
- **No JS engine lays out 1500 nodes interactively in QuickJS.** nsh-graph is the fastest at 23 s, d3-force and
  ForceAtlas2 take 76–109 s, and the AntV layouts don't finish in 120 s. For graphs that size, use nsh-graph's
  Rust backend (`nsh-graph/native`, measured with `nsh test perf`: the same 1500 nodes settle in 0.9 s, 5000 in
  3.6 s), static layouts or precomputed positions.

Engines that can't run in NSH at all: **Cytoscape.js** fails to load, because it assigns to a frozen built-in
prototype. **ngraph.forcelayout** (behind VivaGraph and ngraph) generates its physics code with `new Function`,
which NSH refuses outside development builds.

## Where nsh-graph stands

**Strengths.**
- The only one of these that runs natively on iOS, Android, desktop and the web from one codebase.
- No DOM. Its only dependency is nsh-core, for the optional Rust backend.
- Fastest force layout on NSH's runtime from 77 nodes up (ForceAtlas2 edges it on 34), and with the Rust backend,
  thousands of nodes stay interactive.
- One package (an nshm): `nsh add nsh-graph`.
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
