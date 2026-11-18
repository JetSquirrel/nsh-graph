# Datasets

Graphs for trying the view against (`nsh run example/Gallery.tsx`) and for the tests (`datasets.test.ts`,
`regressions.test.ts`). They live in the example app only; the `nsh-graph` package does not ship them.

| File | What | Source |
|---|---|---|
| `karate.json` | Zachary's karate club: 34 members, 78 ties, the two factions as categories | W. W. Zachary, "An Information Flow Model for Conflict and Fission in Small Groups", *J. Anthropological Research* 33 (1977); via networkx's `karate_club_graph` (BSD-3-Clause) |
| `miserables.json` | Character co-occurrence in *Les Misérables*: 77 characters, 254 weighted edges, 11 groups | D. E. Knuth, *The Stanford GraphBase* (1993); via the d3 gallery |
| `flare-tree.json` | The Flare ActionScript library's packages and classes: a 252-node tree | Flare (BSD-3-Clause); via vega-datasets |
| `flare-deps.json` | Imports between Flare classes: 220 nodes, 764 directed edges | Flare (BSD-3-Clause); via vega-datasets |

`index.ts` also generates synthetic cases: a scale-free graph (1500 nodes), a 300-leaf star, K30, a 200-node
chain, disconnected islands, parallel edges and loops, captions in many scripts, malformed data, and the empty
and single-node graphs.
