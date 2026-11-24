//! nsh-graph's native part (`nsh-graph/native`): the force layout and painting in Rust.
//!
//! An app that adds the nsh-graph nshm (`nsh add nsh-graph`) imports it and hands it to nsh-graph once:
//!
//! ```ts
//! import * as native from "nsh-graph/native";
//! import { setNativeBackend } from "nsh-graph";
//! setNativeBackend(native);
//! ```
//!
//! From then on `ForceSimulation` ticks here instead of in TypeScript. On QuickJS (every NSH platform but
//! the web) that is the difference between a 1500-node layout moving at a few frames a second and at the
//! display's rate. Data crosses as little-endian `f64` / `u32` / `i32` buffers in `Uint8Array`s, one copy
//! each way per call.

use nsh_core::prelude::*;

pub mod paint;
pub mod sim;

use paint::{Edge, EdgeStyle, Rect};
use sim::{Config, Nodes, Simulation};

#[native_module("nsh-graph/native")]
fn native(registry: &mut Registry) {
    registry.class::<ForceLayout>();
    registry.class::<GraphPainter>();
}

fn f64s(bytes: &[u8]) -> impl Iterator<Item = f64> + '_ {
    bytes.chunks_exact(8).map(|c| f64::from_le_bytes(c.try_into().unwrap()))
}

fn rect(v: &[f64]) -> Result<Rect, String> {
    match v {
        [x0, y0, x1, y1, ..] => Ok(Rect { x0: *x0, y0: *y0, x1: *x1, y1: *y1 }),
        _ => Err("a view is 4 numbers: x0, y0, x1, y1".into()),
    }
}

/// A decimals count as JS gave it (absent, NaN or out of range: the most there are).
fn decimals(v: Option<&f64>) -> u32 {
    match v {
        Some(&d) if d >= 0. => (d as u32).min(paint::MAX_DECIMALS),
        _ => paint::MAX_DECIMALS,
    }
}

/// Traces a frame's edges and nodes as SVG path data, one string per batch, for the renderer to draw
/// with `new Path2D(d)`: a few canvas calls a frame instead of several per edge and node.
#[class]
pub struct GraphPainter {
    edges: Vec<Edge>,
    x: Vec<f64>,
    y: Vec<f64>,
    r: Vec<f64>,
    /// Each node's color rank (`setRanks`), and what the last `frameNodes` worked out (`frameInfo`).
    ranks: Vec<u32>,
    frame: Vec<u8>,
}

#[class]
impl GraphPainter {
    /// A painter with no edges or nodes yet.
    pub fn new() -> Self {
        GraphPainter { edges: Vec::new(), x: Vec::new(), y: Vec::new(), r: Vec::new(), ranks: Vec::new(), frame: Vec::new() }
    }

    /// The edges, 5 f64 each: source, target, bend, self (1 or 0), loop index.
    pub fn set_edges(&mut self, edges: Vec<u8>) -> Result<(), String> {
        let v: Vec<f64> = f64s(&edges).collect();
        if v.len() % 5 != 0 {
            return Err("an edge is 5 f64".into());
        }
        self.edges = v
            .chunks_exact(5)
            .map(|e| Edge { source: e[0] as u32, target: e[1] as u32, bend: e[2], self_loop: e[3] != 0., loop_index: e[4] as u32 })
            .collect();
        Ok(())
    }

    /// The nodes for this frame, 3 f64 each: x, y, r.
    pub fn set_nodes(&mut self, nodes: Vec<u8>) -> Result<(), String> {
        let v: Vec<f64> = f64s(&nodes).collect();
        if v.len() % 3 != 0 {
            return Err("a node is 3 f64".into());
        }
        let n = v.len() / 3;
        self.x.clear();
        self.y.clear();
        self.r.clear();
        for c in v.chunks_exact(3) {
            self.x.push(c[0]);
            self.y.push(c[1]);
            self.r.push(c[2]);
        }
        debug_assert_eq!(self.x.len(), n);
        Ok(())
    }

    /// The nodes' positions for this frame: x, y for each node `setNodes` last gave (their radii stay). Takes the
    /// buffer `ForceLayout.run` returned as it is (what follows the positions is ignored), so a frame
    /// after a tick costs no copying in JS.
    pub fn set_positions(&mut self, positions: Vec<u8>) -> Result<(), String> {
        let n = self.r.len();
        if positions.len() < n * 16 {
            return Err(format!("positions for {n} nodes need {} bytes, not {}", n * 16, positions.len()));
        }
        let mut v = f64s(&positions);
        for i in 0..n {
            self.x[i] = v.next().unwrap();
            self.y[i] = v.next().unwrap();
        }
        Ok(())
    }

    /// The edges' paths, one u8 state per edge (0 dimmed, 1 normal, 2 highlighted, else left out), with
    /// `style` = x0, y0, x1, y1 (the graph-space view), arrows (1 or 0), arrow length, and optionally the
    /// most decimals a coordinate gets (0 to 2, default 2) and the zoom (screen points per graph unit) for level of detail
    /// (absent or 0: off). Returns six strings: the lines and arrow heads
    /// of states 0, 1 and 2.
    pub fn trace_edges(&self, states: Vec<u8>, style: Vec<f64>) -> Result<Vec<String>, String> {
        let view = rect(&style)?;
        let style = EdgeStyle {
            view,
            arrows: style.get(4).is_some_and(|&a| a != 0.),
            arrow_len: style.get(5).copied().unwrap_or(0.),
            decimals: decimals(style.get(6)),
            scale: style.get(7).copied().filter(|k| k.is_finite() && *k > 0.).unwrap_or(0.),
        };
        let batches = paint::trace_edges(&self.edges, &states, &self.x, &self.y, &self.r, &style);
        Ok(batches.into_iter().flat_map(|b| [b.lines, b.arrows]).collect())
    }

    /// The nodes' circles in `batches` paths: one u32 batch per node (u32::MAX leaves it out), and the
    /// graph-space view (x0, y0, x1, y1) outside which nodes are left out, then optionally the most
    /// decimals a coordinate gets (0 to 2, default 2).
    pub fn trace_nodes(&self, keys: Vec<u8>, batches: f64, view: Vec<f64>) -> Result<Vec<String>, String> {
        let keys: Vec<u32> = keys.chunks_exact(4).map(|c| u32::from_le_bytes(c.try_into().unwrap())).collect();
        let decimals = decimals(view.get(4));
        Ok(paint::trace_nodes(&keys, batches.clamp(0., 1e6) as usize, &self.x, &self.y, &self.r, &rect(&view)?, decimals))
    }

    /// Each node's color: its rank among the distinct fills, one u32 per node. Given when the colors
    /// change, for `frameNodes`.
    pub fn set_ranks(&mut self, ranks: Vec<u8>) -> Result<(), String> {
        if ranks.len() % 4 != 0 {
            return Err("ranks must hold u32".into());
        }
        self.ranks = ranks.chunks_exact(4).map(|c| u32::from_le_bytes(c.try_into().unwrap())).collect();
        Ok(())
    }

    /// The renderer's node pass: which nodes are in view, their batches (by color, dimmed unless in
    /// `focus`, a list of u32 node indices; empty for no focus), which batches get a ring, and one path per
    /// batch, with level of detail. `colors` is how many distinct fills there are; `style` = x0, y0, x1, y1
    /// (the graph-space view), decimals, zoom, the ring's least radius on screen and the level-of-detail
    /// radius (both in points). Returns `2 × colors` paths (dimmed batches first); `frameInfo` then says
    /// which nodes were in view and which batches get a ring.
    pub fn frame_nodes(&mut self, focus: Vec<u8>, colors: f64, style: Vec<f64>) -> Result<Vec<String>, String> {
        let view = rect(&style)?;
        let at = |i: usize, default: f64| style.get(i).copied().filter(|v| v.is_finite()).unwrap_or(default);
        let style = paint::FrameStyle { view, decimals: decimals(style.get(4)), scale: at(5, 0.).max(0.), ring_px: at(6, 5.), lod_px: at(7, 0.) };
        let n = self.x.len();
        let mask: Option<Vec<bool>> = if focus.len() >= 4 {
            let mut m = vec![false; n];
            for c in focus.chunks_exact(4) {
                let i = u32::from_le_bytes(c.try_into().unwrap()) as usize;
                if i < n {
                    m[i] = true;
                }
            }
            Some(m)
        } else {
            None
        };
        let frame = paint::frame_nodes(&self.ranks, mask.as_deref(), colors.clamp(0., 1e6) as usize, &self.x, &self.y, &self.r, &style);
        self.frame.clear();
        self.frame.extend_from_slice(&frame.in_view);
        self.frame.extend_from_slice(&frame.ringed);
        Ok(frame.paths)
    }

    /// What the last `frameNodes` worked out: one u8 per node (1: in view), then one per batch (1: ringed).
    pub fn frame_info(&self) -> Vec<u8> {
        self.frame.clone()
    }
}

/// Values per node in the state `tick` takes: x, y, vx, vy, fx, fy (NaN: free), r.
const IN: usize = 7;
/// Values per node in the state `tick` returns: x, y, vx, vy, fx, fy (a bad position put back moves its pin).
const OUT: usize = 6;

/// A force layout (link, Barnes–Hut many-body, gravity, group and collision forces) that nsh-graph's
/// `ForceSimulation` runs its ticks on. Give it the links and groups with `setGraph`, the settings with
/// `setConfig`, then call `tick` with the nodes' state.
#[class]
pub struct ForceLayout {
    sim: Simulation,
    nodes: Nodes,
    out: Vec<u8>,
}

#[class]
impl ForceLayout {
    /// An empty layout with nsh-graph's default settings.
    pub fn new() -> Self {
        ForceLayout { sim: Simulation::default(), nodes: Nodes::default(), out: Vec::new() }
    }

    /// The settings, in `ForceConfig`'s order: linkDistance, charge, theta, chargeDistanceMax,
    /// collidePadding, gravity, groupStrength, velocityDecay, alphaDecay, alphaMin.
    pub fn set_config(&mut self, values: Vec<f64>) -> Result<(), String> {
        let [link_distance, charge, theta, charge_distance_max, collide_padding, gravity, group_strength, velocity_decay, alpha_decay, alpha_min] =
            values[..]
        else {
            return Err(format!("setConfig takes 10 values, not {}", values.len()));
        };
        self.sim.config = Config {
            link_distance,
            charge,
            theta,
            charge_distance_max,
            collide_padding,
            gravity,
            group_strength,
            velocity_decay,
            alpha_decay,
            alpha_min,
        };
        Ok(())
    }

    /// The graph's shape for `count` nodes: `links` as u32 pairs (source, target), `groups` one i32 per
    /// node (-1 for none).
    pub fn set_graph(&mut self, count: f64, links: Vec<u8>, groups: Vec<u8>) -> Result<(), String> {
        let n = count.max(0.) as usize;
        if links.len() % 8 != 0 {
            return Err("links must hold u32 pairs".into());
        }
        let pairs: Vec<(u32, u32)> = links
            .chunks_exact(8)
            .map(|c| (u32::from_le_bytes(c[0..4].try_into().unwrap()), u32::from_le_bytes(c[4..8].try_into().unwrap())))
            .collect();
        let groups: Vec<i32> = groups.chunks_exact(4).map(|c| i32::from_le_bytes(c.try_into().unwrap())).collect();
        self.sim.set_graph(n, &pairs, &groups);
        self.nodes.resize(n);
        Ok(())
    }

    /// Runs `iterations` ticks from `alpha` toward `alphaTarget`. `state` holds 7 f64 per node (x, y,
    /// vx, vy, fx, fy, r; NaN for a free fx / fy). Returns 6 f64 per node (x, y, vx, vy, fx, fy) and then
    /// the alpha reached.
    pub fn tick(&mut self, state: Vec<u8>, iterations: f64, alpha: f64, alpha_target: f64) -> Result<Vec<u8>, String> {
        let values = state.len() / 8;
        if state.len() % 8 != 0 || values % IN != 0 {
            return Err(format!("state must hold {IN} f64 per node"));
        }
        let n = values / IN;
        if n != self.nodes.len() {
            // setGraph was given another count: follow the state, without links past its end.
            self.nodes.resize(n);
        }
        let f = |i: usize| f64::from_le_bytes(state[i * 8..i * 8 + 8].try_into().unwrap());
        for i in 0..n {
            let b = i * IN;
            self.nodes.x[i] = f(b);
            self.nodes.y[i] = f(b + 1);
            self.nodes.vx[i] = f(b + 2);
            self.nodes.vy[i] = f(b + 3);
            self.nodes.fx[i] = f(b + 4);
            self.nodes.fy[i] = f(b + 5);
            self.nodes.r[i] = f(b + 6);
        }
        self.sim.alpha = alpha;
        self.sim.alpha_target = alpha_target;
        self.sim.tick(&mut self.nodes, iterations.clamp(0., 10_000.) as u32);

        self.out.clear();
        self.out.reserve((n * OUT + 1) * 8);
        let nodes = &self.nodes;
        for i in 0..n {
            for v in [nodes.x[i], nodes.y[i], nodes.vx[i], nodes.vy[i], nodes.fx[i], nodes.fy[i]] {
                self.out.extend_from_slice(&v.to_le_bytes());
            }
        }
        self.out.extend_from_slice(&self.sim.alpha.to_le_bytes());
        Ok(self.out.clone())
    }

    // ---- The layout keeps the nodes' state between ticks: JS sends what it changed, and gets positions
    // back. On QuickJS, copying every node's seven values in and six out took a third of a tick.

    /// Takes the whole state, 7 f64 per node (x, y, vx, vy, fx, fy, r; NaN for a free fx / fy), and keeps
    /// it for `run`. The node count follows the state.
    pub fn load(&mut self, state: Vec<u8>) -> Result<(), String> {
        let v: Vec<f64> = f64s(&state).collect();
        if state.len() % 8 != 0 || v.len() % IN != 0 {
            return Err(format!("state must hold {IN} f64 per node"));
        }
        let n = v.len() / IN;
        self.nodes.resize(n);
        for (i, c) in v.chunks_exact(IN).enumerate() {
            self.nodes.x[i] = c[0];
            self.nodes.y[i] = c[1];
            self.nodes.vx[i] = c[2];
            self.nodes.vy[i] = c[3];
            self.nodes.fx[i] = c[4];
            self.nodes.fy[i] = c[5];
            self.nodes.r[i] = c[6];
        }
        Ok(())
    }

    /// Changes every node at once, 5 f64 each (x, y, fx, fy, r), for the node count `load` gave. Their
    /// velocities stay, or start over at 0 when `reset_velocity` is not 0.
    pub fn update(&mut self, state: Vec<u8>, reset_velocity: f64) -> Result<(), String> {
        const PER: usize = 5;
        let n = self.nodes.len();
        if state.len() != n * PER * 8 {
            return Err(format!("update takes {PER} f64 for each of {n} nodes"));
        }
        let reset = reset_velocity != 0.;
        for (i, c) in f64s(&state).collect::<Vec<_>>().chunks_exact(PER).enumerate() {
            self.set_node(i, c[0], c[1], c[2], c[3], c[4], reset);
        }
        Ok(())
    }

    /// Changes some nodes, 6 f64 each: index, x, y, fx, fy, r. Their velocities stay. Indices past the
    /// node count are skipped.
    pub fn patch(&mut self, entries: Vec<u8>) -> Result<(), String> {
        const PER: usize = 6;
        if entries.len() % (PER * 8) != 0 {
            return Err(format!("a patch entry is {PER} f64"));
        }
        for c in f64s(&entries).collect::<Vec<_>>().chunks_exact(PER) {
            let i = c[0];
            if i >= 0. && (i as usize) < self.nodes.len() {
                self.set_node(i as usize, c[1], c[2], c[3], c[4], c[5], false);
            }
        }
        Ok(())
    }

    /// Runs `iterations` ticks from `alpha` toward `alphaTarget` on the state kept. Returns 2 f64 per node
    /// (x, y), then the alpha reached, then how many pins the tick moved (it moves the pin of a node whose
    /// position was not a finite number) and for each 3 f64: index, fx, fy.
    pub fn run(&mut self, iterations: f64, alpha: f64, alpha_target: f64) -> Vec<u8> {
        let n = self.nodes.len();
        // Pins are moved only by the repair of a bad position, so they are compared only when one was.
        let bad = (0..n).any(|i| !self.nodes.x[i].is_finite() || !self.nodes.y[i].is_finite());
        let pins_before = if bad { Some((self.nodes.fx.clone(), self.nodes.fy.clone())) } else { None };
        self.sim.alpha = alpha;
        self.sim.alpha_target = alpha_target;
        self.sim.tick(&mut self.nodes, iterations.clamp(0., 10_000.) as u32);

        let mut moved: Vec<usize> = Vec::new();
        if let Some((fx, fy)) = pins_before {
            for i in 0..n {
                let same = |a: f64, b: f64| a == b || (a.is_nan() && b.is_nan());
                if !same(fx[i], self.nodes.fx[i]) || !same(fy[i], self.nodes.fy[i]) {
                    moved.push(i);
                }
            }
        }
        self.out.clear();
        self.out.reserve((n * 2 + 2 + moved.len() * 3) * 8);
        for i in 0..n {
            self.out.extend_from_slice(&self.nodes.x[i].to_le_bytes());
            self.out.extend_from_slice(&self.nodes.y[i].to_le_bytes());
        }
        self.out.extend_from_slice(&self.sim.alpha.to_le_bytes());
        self.out.extend_from_slice(&(moved.len() as f64).to_le_bytes());
        for i in moved {
            for v in [i as f64, self.nodes.fx[i], self.nodes.fy[i]] {
                self.out.extend_from_slice(&v.to_le_bytes());
            }
        }
        std::mem::take(&mut self.out)
    }

    /// The velocities kept, 2 f64 per node (vx, vy).
    pub fn velocities(&self) -> Vec<u8> {
        let n = self.nodes.len();
        let mut out = Vec::with_capacity(n * 16);
        for i in 0..n {
            out.extend_from_slice(&self.nodes.vx[i].to_le_bytes());
            out.extend_from_slice(&self.nodes.vy[i].to_le_bytes());
        }
        out
    }
}

impl ForceLayout {
    #[allow(clippy::too_many_arguments)]
    fn set_node(&mut self, i: usize, x: f64, y: f64, fx: f64, fy: f64, r: f64, reset_velocity: bool) {
        let n = &mut self.nodes;
        n.x[i] = x;
        n.y[i] = y;
        n.fx[i] = fx;
        n.fy[i] = fy;
        n.r[i] = r;
        if reset_velocity {
            n.vx[i] = 0.;
            n.vy[i] = 0.;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes(v: &[f64]) -> Vec<u8> {
        v.iter().flat_map(|x| x.to_le_bytes()).collect()
    }
    fn floats(b: &[u8]) -> Vec<f64> {
        f64s(b).collect()
    }

    /// A ring of `n` nodes with a chord, node 2 pinned.
    fn layout(n: usize) -> (ForceLayout, Vec<f64>) {
        let mut l = ForceLayout::new();
        let mut pairs: Vec<u8> = Vec::new();
        for i in 0..n as u32 {
            pairs.extend_from_slice(&i.to_le_bytes());
            pairs.extend_from_slice(&((i + 1) % n as u32).to_le_bytes());
        }
        pairs.extend_from_slice(&0u32.to_le_bytes());
        pairs.extend_from_slice(&(n as u32 / 2).to_le_bytes());
        let groups: Vec<u8> = (0..n as i32).flat_map(|i| (if i % 3 == 0 { 0i32 } else { -1i32 }).to_le_bytes()).collect();
        l.set_graph(n as f64, pairs, groups).unwrap();
        let mut state = Vec::new();
        for i in 0..n {
            let a = i as f64;
            let pinned = i == 2;
            state.extend_from_slice(&[a.cos() * 50. + a, a.sin() * 50., 0., 0., if pinned { 40. } else { f64::NAN }, if pinned { 5. } else { f64::NAN }, 10. + (i % 4) as f64]);
        }
        (l, state)
    }

    #[test]
    fn keeping_the_state_gives_the_same_layout_as_sending_it_every_tick() {
        let n = 40;
        let (mut sent, mut state) = layout(n);
        let (mut kept, s0) = layout(n);
        kept.load(bytes(&s0)).unwrap();
        let mut alpha = 1.;
        for t in 0..30 {
            // Half way, node 5 is dragged (pinned somewhere else) and every radius grows by 1.
            if t == 15 {
                state[5 * IN + 4] = -80.;
                state[5 * IN + 5] = 30.;
                kept.patch(bytes(&[5., state[5 * IN], state[5 * IN + 1], -80., 30., state[5 * IN + 6]])).unwrap();
                let mut all = Vec::new();
                for i in 0..n {
                    state[i * IN + 6] += 1.;
                    let b = i * IN;
                    all.extend_from_slice(&[state[b], state[b + 1], state[b + 4], state[b + 5], state[b + 6]]);
                }
                kept.update(bytes(&all), 0.).unwrap();
            }
            let out = floats(&sent.tick(bytes(&state), 1., alpha, 0.).unwrap());
            let got = floats(&kept.run(1., alpha, 0.));
            for i in 0..n {
                let b = i * IN;
                for k in 0..OUT {
                    state[b + k] = out[i * OUT + k];
                }
                assert_eq!(got[i * 2], out[i * OUT], "x of node {i} at tick {t}");
                assert_eq!(got[i * 2 + 1], out[i * OUT + 1], "y of node {i} at tick {t}");
            }
            assert_eq!(got[n * 2], out[n * OUT], "alpha at tick {t}");
            assert_eq!(got[n * 2 + 1], 0., "no pins moved");
            alpha = out[n * OUT];
        }
        let v = floats(&kept.velocities());
        for i in 0..n {
            assert_eq!(v[i * 2], state[i * IN + 2]);
            assert_eq!(v[i * 2 + 1], state[i * IN + 3]);
        }
    }

    #[test]
    fn a_bad_position_is_repaired_and_its_moved_pin_reported() {
        let (mut l, mut s) = layout(6);
        s[2 * IN] = f64::NAN; // node 2 is pinned, at a NaN position
        l.load(bytes(&s)).unwrap();
        let out = floats(&l.run(1., 1., 0.));
        let n = 6;
        assert!(out[..n * 2].iter().all(|v| v.is_finite()));
        let moved = out[n * 2 + 1] as usize;
        if moved > 0 {
            assert_eq!(out[n * 2 + 2], 2.);
        }
    }

    #[test]
    fn update_can_start_velocities_over() {
        let (mut l, s) = layout(8);
        l.load(bytes(&s)).unwrap();
        l.run(5., 1., 0.);
        assert!(floats(&l.velocities()).iter().any(|v| *v != 0.));
        let all: Vec<f64> = (0..8).flat_map(|i| [s[i * IN], s[i * IN + 1], s[i * IN + 4], s[i * IN + 5], s[i * IN + 6]]).collect();
        l.update(bytes(&all), 1.).unwrap();
        assert!(floats(&l.velocities()).iter().all(|v| *v == 0.));
        assert!(l.update(bytes(&all[..10]), 0.).is_err());
    }
}
