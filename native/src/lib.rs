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
}

#[class]
impl GraphPainter {
    /// A painter with no edges or nodes yet.
    pub fn new() -> Self {
        GraphPainter { edges: Vec::new(), x: Vec::new(), y: Vec::new(), r: Vec::new() }
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

    /// The edges' paths, one u8 state per edge (0 dimmed, 1 normal, 2 highlighted, else left out), with
    /// `style` = x0, y0, x1, y1 (the graph-space view), arrows (1 or 0), arrow length, and optionally the
    /// most decimals a coordinate gets (0 to 2, default 2). Returns six strings: the lines and arrow heads
    /// of states 0, 1 and 2.
    pub fn trace_edges(&self, states: Vec<u8>, style: Vec<f64>) -> Result<Vec<String>, String> {
        let view = rect(&style)?;
        let style = EdgeStyle {
            view,
            arrows: style.get(4).is_some_and(|&a| a != 0.),
            arrow_len: style.get(5).copied().unwrap_or(0.),
            decimals: decimals(style.get(6)),
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
}
