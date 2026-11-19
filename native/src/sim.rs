//! The force layout, as `src/simulation.ts` and `src/quadtree.ts` have it: link springs, Barnes–Hut
//! many-body repulsion, gravity toward the origin, a pull of each group toward its centroid and circle
//! collision on a spatial hash. Velocities decay every tick and `alpha` cools the system until it stops.
//!
//! It follows the TypeScript step for step, so both lay out the same graph the same way; the one
//! difference is that it keeps the configured `theta` at every size (the TypeScript coarsens it past 300
//! nodes to stay fast on QuickJS). Every buffer is kept between ticks, so a tick allocates nothing once
//! the graph's size is reached.

/// The settings, as `ForceConfig` names them in TypeScript.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Config {
    pub link_distance: f64,
    pub charge: f64,
    pub theta: f64,
    pub charge_distance_max: f64,
    pub collide_padding: f64,
    pub gravity: f64,
    pub group_strength: f64,
    pub velocity_decay: f64,
    pub alpha_decay: f64,
    pub alpha_min: f64,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            link_distance: 90.,
            charge: -320.,
            theta: 0.9,
            charge_distance_max: f64::INFINITY,
            collide_padding: 10.,
            gravity: 0.04,
            group_strength: 0.12,
            velocity_decay: 0.4,
            alpha_decay: 1. - 0.001f64.powf(1. / 300.),
            alpha_min: 0.001,
        }
    }
}

/// The nodes, as columns. `fx` / `fy` are NaN for a node the forces move.
#[derive(Clone, Debug, Default)]
pub struct Nodes {
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    pub vx: Vec<f64>,
    pub vy: Vec<f64>,
    pub fx: Vec<f64>,
    pub fy: Vec<f64>,
    pub r: Vec<f64>,
}

impl Nodes {
    pub fn len(&self) -> usize {
        self.x.len()
    }

    pub fn is_empty(&self) -> bool {
        self.x.is_empty()
    }

    pub fn resize(&mut self, n: usize) {
        for v in [&mut self.x, &mut self.y, &mut self.vx, &mut self.vy, &mut self.r] {
            v.resize(n, 0.);
        }
        self.fx.resize(n, f64::NAN);
        self.fy.resize(n, f64::NAN);
    }
}

/// The TypeScript `lcg`: the same numbers from the same seed.
#[derive(Clone, Debug)]
pub struct Lcg(u32);

impl Lcg {
    pub fn new(seed: u32) -> Self {
        Lcg(if seed == 0 { 1 } else { seed })
    }

    pub fn next(&mut self) -> f64 {
        self.0 = 1664525u32.wrapping_mul(self.0).wrapping_add(1013904223);
        self.0 as f64 / 4294967296.
    }

    fn jiggle(&mut self) -> f64 {
        (self.next() - 0.5) * 1e-6
    }
}

pub struct Simulation {
    pub config: Config,
    pub alpha: f64,
    pub alpha_target: f64,
    links: Vec<(u32, u32)>,
    link_strength: Vec<f64>,
    link_bias: Vec<f64>,
    /// Each node's group, as an index into the group sums, or -1.
    groups: Vec<i32>,
    group_count: usize,
    group_sums: Vec<(f64, f64, u32)>,
    random: Lcg,
    many_body: ManyBody,
    collider: Collider,
}

impl Default for Simulation {
    fn default() -> Self {
        Self::new(Config::default())
    }
}

impl Simulation {
    pub fn new(config: Config) -> Self {
        Simulation {
            config,
            alpha: 1.,
            alpha_target: 0.,
            links: Vec::new(),
            link_strength: Vec::new(),
            link_bias: Vec::new(),
            groups: Vec::new(),
            group_count: 0,
            group_sums: Vec::new(),
            random: Lcg::new(7),
            many_body: ManyBody::default(),
            collider: Collider::default(),
        }
    }

    /// Sets the links (node index pairs) and each node's group (-1 for none) for `n` nodes. Links to
    /// nodes past `n` are left out.
    pub fn set_graph(&mut self, n: usize, links: &[(u32, u32)], groups: &[i32]) {
        self.links = links.iter().copied().filter(|&(s, t)| (s as usize) < n && (t as usize) < n).collect();
        let mut count = vec![0u32; n];
        for &(s, t) in &self.links {
            count[s as usize] += 1;
            count[t as usize] += 1;
        }
        self.link_strength = self
            .links
            .iter()
            .map(|&(s, t)| 1. / (count[s as usize].min(count[t as usize]).max(1)) as f64)
            .collect();
        self.link_bias = self
            .links
            .iter()
            .map(|&(s, t)| {
                let (cs, ct) = (count[s as usize] as f64, count[t as usize] as f64);
                cs / (cs + ct).max(1.)
            })
            .collect();
        self.groups = (0..n).map(|i| groups.get(i).copied().unwrap_or(-1)).collect();
        self.group_count = self.groups.iter().map(|&g| g + 1).max().unwrap_or(0).max(0) as usize;
        self.group_sums = vec![(0., 0., 0); self.group_count];
    }

    pub fn running(&self) -> bool {
        self.alpha >= self.config.alpha_min || self.alpha_target > 0.
    }

    /// Advances `iterations` ticks.
    pub fn tick(&mut self, nodes: &mut Nodes, iterations: u32) {
        for _ in 0..iterations {
            self.alpha += (self.alpha_target - self.alpha) * self.config.alpha_decay;
            if nodes.is_empty() {
                continue;
            }
            self.apply_links(nodes);
            let c = self.config;
            self.many_body
                .apply(nodes, c.charge, c.theta, c.charge_distance_max, self.alpha, &mut self.random);
            self.apply_gravity(nodes);
            if c.group_strength > 0. {
                self.apply_groups(nodes);
            }
            self.collider.apply(nodes, c.collide_padding, 0.7, &mut self.random);
            let keep = 1. - c.velocity_decay;
            for i in 0..nodes.len() {
                if !nodes.fx[i].is_nan() {
                    nodes.x[i] = nodes.fx[i];
                    nodes.vx[i] = 0.;
                } else {
                    nodes.vx[i] *= keep;
                    nodes.x[i] += nodes.vx[i];
                }
                if !nodes.fy[i].is_nan() {
                    nodes.y[i] = nodes.fy[i];
                    nodes.vy[i] = 0.;
                } else {
                    nodes.vy[i] *= keep;
                    nodes.y[i] += nodes.vy[i];
                }
                // One bad number would spread to every node through the forces: put the node back instead.
                if !nodes.x[i].is_finite() || !nodes.y[i].is_finite() {
                    nodes.x[i] = (self.random.next() - 0.5) * 100.;
                    nodes.y[i] = (self.random.next() - 0.5) * 100.;
                    nodes.vx[i] = 0.;
                    nodes.vy[i] = 0.;
                    if !nodes.fx[i].is_nan() {
                        nodes.fx[i] = nodes.x[i];
                        nodes.fy[i] = nodes.y[i];
                    }
                }
            }
        }
    }

    fn apply_links(&mut self, n: &mut Nodes) {
        let alpha = self.alpha;
        let base = self.config.link_distance;
        for (i, &(s, t)) in self.links.iter().enumerate() {
            let (s, t) = (s as usize, t as usize);
            if s == t {
                continue;
            }
            let mut x = n.x[t] + n.vx[t] - n.x[s] - n.vx[s];
            if x == 0. || x.is_nan() {
                x = self.random.jiggle();
            }
            let mut y = n.y[t] + n.vy[t] - n.y[s] - n.vy[s];
            if y == 0. || y.is_nan() {
                y = self.random.jiggle();
            }
            let mut l = (x * x + y * y).sqrt();
            let distance = base + (n.r[s] + n.r[t]) * 0.5;
            l = (l - distance) / l * alpha * self.link_strength[i];
            x *= l;
            y *= l;
            let b = self.link_bias[i];
            n.vx[t] -= x * b;
            n.vy[t] -= y * b;
            n.vx[s] += x * (1. - b);
            n.vy[s] += y * (1. - b);
        }
    }

    fn apply_gravity(&self, n: &mut Nodes) {
        let g = self.config.gravity * self.alpha;
        if g == 0. {
            return;
        }
        for i in 0..n.len() {
            n.vx[i] -= n.x[i] * g;
            n.vy[i] -= n.y[i] * g;
        }
    }

    fn apply_groups(&mut self, n: &mut Nodes) {
        if self.group_count == 0 {
            return;
        }
        self.group_sums.iter_mut().for_each(|s| *s = (0., 0., 0));
        for i in 0..n.len() {
            let g = self.groups.get(i).copied().unwrap_or(-1);
            if g < 0 {
                continue;
            }
            let s = &mut self.group_sums[g as usize];
            s.0 += n.x[i];
            s.1 += n.y[i];
            s.2 += 1;
        }
        let k = self.config.group_strength * self.alpha;
        for i in 0..n.len() {
            let g = self.groups.get(i).copied().unwrap_or(-1);
            if g < 0 {
                continue;
            }
            let (sx, sy, c) = self.group_sums[g as usize];
            if c < 2 {
                continue;
            }
            let c = c as f64;
            n.vx[i] += (sx / c - n.x[i]) * k;
            n.vy[i] += (sy / c - n.y[i]) * k;
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Barnes–Hut

const MAX_DEPTH: u32 = 24;
const NONE: i32 = -1;

#[derive(Clone, Copy, Default)]
struct Quad {
    x0: f64,
    y0: f64,
    size: f64,
    value: f64,
    cx: f64,
    cy: f64,
    kids: [i32; 4],
    /// A leaf's first point, -1 when empty.
    head: i32,
    depth: u32,
    leaf: bool,
}

#[derive(Default)]
pub struct ManyBody {
    quads: Vec<Quad>,
    /// The next point in the same leaf (coincident points), -1 at the end.
    next: Vec<i32>,
    stack: Vec<i32>,
}

impl ManyBody {
    fn new_quad(&mut self, x0: f64, y0: f64, size: f64, depth: u32) -> i32 {
        self.quads.push(Quad { x0, y0, size, depth, head: NONE, leaf: true, kids: [NONE; 4], ..Quad::default() });
        (self.quads.len() - 1) as i32
    }

    /// The child of q that (x, y) falls in, made if missing.
    fn child(&mut self, q: i32, x: f64, y: f64) -> i32 {
        let p = self.quads[q as usize];
        let h = p.size / 2.;
        let right = (x >= p.x0 + h) as usize;
        let bottom = (y >= p.y0 + h) as usize;
        let slot = bottom * 2 + right;
        let mut c = p.kids[slot];
        if c < 0 {
            c = self.new_quad(p.x0 + right as f64 * h, p.y0 + bottom as f64 * h, h, p.depth + 1);
            let p = &mut self.quads[q as usize];
            p.kids[slot] = c;
            p.leaf = false;
        }
        c
    }

    fn insert(&mut self, i: usize, px: &[f64], py: &[f64]) {
        let (x, y) = (px[i], py[i]);
        let mut q = 0i32;
        loop {
            if !self.quads[q as usize].leaf {
                q = self.child(q, x, y);
                continue;
            }
            let first = self.quads[q as usize].head;
            if first < 0 {
                self.quads[q as usize].head = i as i32;
                self.next[i] = NONE;
                return;
            }
            let f = first as usize;
            // Coincident or too deep: share the leaf.
            if (px[f] == x && py[f] == y) || self.quads[q as usize].depth >= MAX_DEPTH {
                self.next[i] = first;
                self.quads[q as usize].head = i as i32;
                return;
            }
            // Split: the leaf's points (all at one place) move down into one child, then try again.
            self.quads[q as usize].head = NONE;
            let c = self.child(q, px[f], py[f]);
            self.quads[c as usize].head = first;
        }
    }

    /// Adds the many-body force to every node's velocity.
    pub fn apply(&mut self, n: &mut Nodes, strength: f64, theta: f64, max_distance: f64, alpha: f64, random: &mut Lcg) {
        let count = n.len();
        if count == 0 || strength == 0. {
            return;
        }
        let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for i in 0..count {
            x0 = x0.min(n.x[i]);
            y0 = y0.min(n.y[i]);
            x1 = x1.max(n.x[i]);
            y1 = y1.max(n.y[i]);
        }
        self.quads.clear();
        self.next.clear();
        self.next.resize(count, NONE);
        self.new_quad(x0, y0, (x1 - x0).max(y1 - y0).max(1.) * 1.0001, 0);
        for i in 0..count {
            self.insert(i, &n.x, &n.y);
        }

        // Accumulate: children always come after their parent, so walk the quads backwards.
        for q in (0..self.quads.len()).rev() {
            let (mut v, mut sx, mut sy) = (0., 0., 0.);
            let quad = self.quads[q];
            if quad.leaf {
                let mut c = 0u32;
                let mut p = quad.head;
                while p >= 0 {
                    sx += n.x[p as usize];
                    sy += n.y[p as usize];
                    c += 1;
                    p = self.next[p as usize];
                }
                if c > 0 {
                    v = strength * c as f64;
                    sx /= c as f64;
                    sy /= c as f64;
                }
            } else {
                let mut w = 0.;
                for &k in &quad.kids {
                    if k < 0 {
                        continue;
                    }
                    let kid = &self.quads[k as usize];
                    let a = kid.value.abs();
                    v += kid.value;
                    sx += a * kid.cx;
                    sy += a * kid.cy;
                    w += a;
                }
                if w > 0. {
                    sx /= w;
                    sy /= w;
                }
            }
            let quad = &mut self.quads[q];
            quad.value = v;
            quad.cx = sx;
            quad.cy = sy;
        }

        let theta2 = theta * theta;
        let max2 = if max_distance.is_infinite() { f64::INFINITY } else { max_distance * max_distance };
        for i in 0..count {
            let (nx, ny) = (n.x[i], n.y[i]);
            let (mut fx, mut fy) = (0., 0.);
            self.stack.clear();
            self.stack.push(0);
            while let Some(q) = self.stack.pop() {
                let quad = &self.quads[q as usize];
                let v = quad.value;
                if v == 0. {
                    continue;
                }
                let mut x = quad.cx - nx;
                let mut y = quad.cy - ny;
                let mut l = x * x + y * y;
                let w = quad.size;
                if !quad.leaf && w * w < l * theta2 {
                    // Far enough: the quad acts as one body.
                    if l < max2 {
                        if l < 1. {
                            l = l.sqrt();
                            if l == 0. {
                                l = 1e-6;
                            }
                        }
                        fx += x * v / l;
                        fy += y * v / l;
                    }
                    continue;
                }
                if !quad.leaf {
                    for &k in &quad.kids {
                        if k >= 0 {
                            self.stack.push(k);
                        }
                    }
                    continue;
                }
                let mut p = quad.head;
                while p >= 0 {
                    let pi = p as usize;
                    p = self.next[pi];
                    if pi == i {
                        continue;
                    }
                    x = n.x[pi] - nx;
                    y = n.y[pi] - ny;
                    l = x * x + y * y;
                    if l >= max2 {
                        continue;
                    }
                    if x == 0. {
                        x = random.jiggle();
                        l += x * x;
                    }
                    if y == 0. {
                        y = random.jiggle();
                        l += y * y;
                    }
                    if l < 1. {
                        l = l.sqrt();
                    }
                    fx += x * strength / l;
                    fy += y * strength / l;
                }
            }
            n.vx[i] += fx * alpha;
            n.vy[i] += fy * alpha;
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Collision

#[derive(Default)]
pub struct Collider {
    table: Vec<i32>,
    next: Vec<i32>,
    cell_x: Vec<i32>,
    cell_y: Vec<i32>,
    x: Vec<f64>,
    y: Vec<f64>,
}

fn hash(cx: i32, cy: i32, mask: usize) -> usize {
    ((cx.wrapping_mul(73856093) ^ cy.wrapping_mul(19349663)) as u32 as usize) & mask
}

impl Collider {
    pub fn apply(&mut self, n: &mut Nodes, padding: f64, strength: f64, random: &mut Lcg) {
        let count = n.len();
        if count < 2 {
            return;
        }
        let mut size = 1usize;
        while size < count * 2 {
            size <<= 1;
        }
        let mask = size - 1;
        self.table.clear();
        self.table.resize(size, NONE);
        for v in [&mut self.next, &mut self.cell_x, &mut self.cell_y] {
            v.resize(count, 0);
        }
        self.x.resize(count, 0.);
        self.y.resize(count, 0.);
        let max_r = n.r.iter().fold(0f64, |m, &r| m.max(r));
        let cell = (max_r * 2. + padding).max(1.);
        for i in 0..count {
            let x = n.x[i] + n.vx[i];
            let y = n.y[i] + n.vy[i];
            self.x[i] = x;
            self.y[i] = y;
            let cx = (x / cell).floor() as i32;
            let cy = (y / cell).floor() as i32;
            self.cell_x[i] = cx;
            self.cell_y[i] = cy;
            let h = hash(cx, cy, mask);
            self.next[i] = self.table[h];
            self.table[h] = i as i32;
        }
        for i in 0..count {
            let ra = n.r[i];
            for dx in -1..=1 {
                for dy in -1..=1 {
                    let tcx = self.cell_x[i].wrapping_add(dx);
                    let tcy = self.cell_y[i].wrapping_add(dy);
                    let mut j = self.table[hash(tcx, tcy, mask)];
                    while j >= 0 {
                        let ju = j as usize;
                        j = self.next[ju];
                        // Only pairs once, and only true neighbors (hash buckets can mix cells).
                        if ju <= i || self.cell_x[ju] != tcx || self.cell_y[ju] != tcy {
                            continue;
                        }
                        let rb = n.r[ju];
                        let r = ra + rb + padding;
                        let mut x = self.x[i] - self.x[ju];
                        let mut y = self.y[i] - self.y[ju];
                        let mut l = x * x + y * y;
                        if l >= r * r {
                            continue;
                        }
                        if x == 0. {
                            x = random.jiggle();
                            l += x * x;
                        }
                        if y == 0. {
                            y = random.jiggle();
                            l += y * y;
                        }
                        l = l.sqrt();
                        l = (r - l) / l * strength;
                        let (r2a, r2b) = (ra * ra, rb * rb);
                        let wa = if r2a + r2b > 0. { r2b / (r2a + r2b) } else { 0.5 };
                        x *= l;
                        y *= l;
                        n.vx[i] += x * wa;
                        n.vy[i] += y * wa;
                        n.vx[ju] -= x * (1. - wa);
                        n.vy[ju] -= y * (1. - wa);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chain(n: usize) -> (Nodes, Vec<(u32, u32)>) {
        let mut nodes = Nodes::default();
        nodes.resize(n);
        for i in 0..n {
            // A phyllotaxis spiral, as the engine seeds new nodes.
            let radius = 10. * (0.5 + i as f64).sqrt();
            let angle = i as f64 * std::f64::consts::PI * (3. - 5f64.sqrt());
            nodes.x[i] = radius * angle.cos();
            nodes.y[i] = radius * angle.sin();
            nodes.r[i] = 14.;
        }
        (nodes, (1..n as u32).map(|i| (i - 1, i)).collect())
    }

    #[test]
    fn cools_down_and_stops() {
        let (mut nodes, links) = chain(30);
        let mut sim = Simulation::default();
        sim.set_graph(30, &links, &[]);
        let mut ticks = 0;
        while sim.running() && ticks < 1000 {
            sim.tick(&mut nodes, 1);
            ticks += 1;
        }
        assert!(!sim.running());
        assert!(ticks < 400, "{ticks} ticks");
    }

    #[test]
    fn keeps_nodes_apart_and_linked_nodes_close() {
        let (mut nodes, links) = chain(40);
        let mut sim = Simulation::default();
        sim.set_graph(40, &links, &[]);
        sim.tick(&mut nodes, 400);
        let d = |a: usize, b: usize| ((nodes.x[a] - nodes.x[b]).powi(2) + (nodes.y[a] - nodes.y[b]).powi(2)).sqrt();
        for i in 0..40 {
            for j in i + 1..40 {
                assert!(d(i, j) > 14., "nodes {i} and {j} overlap: {}", d(i, j));
            }
        }
        let linked = (1..40).map(|i| d(i - 1, i)).sum::<f64>() / 39.;
        assert!(linked < 200., "linked nodes {linked} apart");
    }

    #[test]
    fn pinned_nodes_stay() {
        let (mut nodes, links) = chain(10);
        nodes.fx[3] = 500.;
        nodes.fy[3] = -20.;
        let mut sim = Simulation::default();
        sim.set_graph(10, &links, &[]);
        sim.tick(&mut nodes, 50);
        assert_eq!((nodes.x[3], nodes.y[3]), (500., -20.));
    }

    #[test]
    fn survives_coincident_and_bad_positions() {
        let mut nodes = Nodes::default();
        nodes.resize(50);
        nodes.r.iter_mut().for_each(|r| *r = 10.);
        nodes.x[7] = f64::NAN;
        let mut sim = Simulation::default();
        sim.set_graph(50, &[(0, 1), (1, 99)], &[0; 50]);
        sim.tick(&mut nodes, 200);
        assert!(nodes.x.iter().chain(&nodes.y).all(|v| v.is_finite()));
        let spread = nodes.x.iter().fold(0f64, |m, &x| m.max(x.abs()));
        assert!(spread > 10., "everything stayed at one point");
    }

    #[test]
    fn groups_pull_together() {
        let (mut nodes, _) = chain(40);
        let groups: Vec<i32> = (0..40).map(|i| (i % 2) as i32).collect();
        let mut sim = Simulation::new(Config { group_strength: 0.5, ..Config::default() });
        sim.set_graph(40, &[], &groups);
        sim.tick(&mut nodes, 300);
        let centroid = |g: usize| {
            let idx: Vec<usize> = (0..40).filter(|i| i % 2 == g).collect();
            let n = idx.len() as f64;
            (idx.iter().map(|&i| nodes.x[i]).sum::<f64>() / n, idx.iter().map(|&i| nodes.y[i]).sum::<f64>() / n)
        };
        let spread = |g: usize| {
            let (cx, cy) = centroid(g);
            (0..40).filter(|i| i % 2 == g).map(|i| ((nodes.x[i] - cx).powi(2) + (nodes.y[i] - cy).powi(2)).sqrt()).sum::<f64>() / 20.
        };
        let (a, b) = (centroid(0), centroid(1));
        let between = ((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt();
        assert!(between > spread(0) * 0.5, "groups did not separate: {between} vs {}", spread(0));
    }

    #[test]
    fn a_big_graph_ticks_fast() {
        let n = 1500;
        let (mut nodes, mut links) = chain(n);
        let mut s = 12345u32;
        for i in 0..n as u32 {
            s = s.wrapping_mul(1664525).wrapping_add(1013904223);
            links.push((i, s % (i + 1)));
        }
        let mut sim = Simulation::default();
        sim.set_graph(n, &links, &[]);
        sim.tick(&mut nodes, 5); // warm up
        let start = std::time::Instant::now();
        sim.tick(&mut nodes, 50);
        let per = start.elapsed().as_secs_f64() * 1e3 / 50.;
        println!("1500 nodes / {} links: {per:.3} ms per tick", links.len());
        assert!(nodes.x.iter().all(|v| v.is_finite()));
    }
}
