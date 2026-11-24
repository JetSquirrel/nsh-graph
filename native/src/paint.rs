//! Edge and node outlines as SVG path data, so the TSX canvas draws a whole batch with one
//! `new Path2D(d)` instead of a canvas call per segment, arc and arrow (gpui-graph batches its edges into
//! one path per state the same way). The shapes are `src/geometry.ts`'s `edgeShape`, step for step.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pt {
    pub x: f64,
    pub y: f64,
}

const fn pt(x: f64, y: f64) -> Pt {
    Pt { x, y }
}

/// An edge as the engine resolved it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Edge {
    pub source: u32,
    pub target: u32,
    /// Sideways offset of the curve (parallel edges), 0 for straight.
    pub bend: f64,
    pub self_loop: bool,
    pub loop_index: u32,
}

/// The drawn shape of an edge, as `EdgeShape` in TypeScript.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Shape {
    Line { a: Pt, b: Pt, end_angle: f64 },
    Quad { a: Pt, c: Pt, b: Pt, end_angle: f64 },
    Cubic { a: Pt, c1: Pt, c2: Pt, b: Pt, end_angle: f64 },
}

fn towards(from: Pt, to: Pt, d: f64) -> Pt {
    let (dx, dy) = (to.x - from.x, to.y - from.y);
    let l = dx.hypot(dy);
    let l = if l == 0. { 1e-6 } else { l };
    pt(from.x + dx / l * d, from.y + dy / l * d)
}

/// `edgeShape` of `src/geometry.ts`.
pub fn edge_shape(s: Pt, rs: f64, t: Pt, rt: f64, bend: f64, self_loop: bool, loop_index: u32) -> Shape {
    if self_loop {
        let base = -std::f64::consts::FRAC_PI_2 + loop_index as f64 * 0.9;
        let spread = 0.45;
        let (a0, a1) = (base - spread, base + spread);
        let reach = rs * 3.2 + 18.;
        let a = pt(s.x + a0.cos() * rs, s.y + a0.sin() * rs);
        let b = pt(s.x + a1.cos() * rs, s.y + a1.sin() * rs);
        let c1 = pt(s.x + (a0 - 0.25).cos() * reach, s.y + (a0 - 0.25).sin() * reach);
        let c2 = pt(s.x + (a1 + 0.25).cos() * reach, s.y + (a1 + 0.25).sin() * reach);
        return Shape::Cubic { a, c1, c2, b, end_angle: (b.y - c2.y).atan2(b.x - c2.x) };
    }
    let (dx, dy) = (t.x - s.x, t.y - s.y);
    let len = dx.hypot(dy);
    let len = if len == 0. { 1e-6 } else { len };
    let (ux, uy) = (dx / len, dy / len);
    if bend == 0. {
        let a = pt(s.x + ux * rs, s.y + uy * rs);
        let b = pt(t.x - ux * rt, t.y - uy * rt);
        return Shape::Line { a, b, end_angle: dy.atan2(dx) };
    }
    let (nx, ny) = (-uy, ux);
    let c = pt((s.x + t.x) / 2. + nx * bend * 2., (s.y + t.y) / 2. + ny * bend * 2.);
    let a = towards(s, c, rs);
    let b = towards(t, c, rt);
    Shape::Quad { a, c, b, end_angle: (b.y - c.y).atan2(b.x - c.x) }
}

/// A rectangle in graph coordinates.
#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

/// What `trace_edges` needs to know of the view.
#[derive(Clone, Copy, Debug)]
pub struct EdgeStyle {
    /// Graph-space rectangle on screen (with a margin); edges outside it are left out.
    pub view: Rect,
    /// Arrow heads at all (the renderer drops them when too small).
    pub arrows: bool,
    /// Arrow length, in graph units.
    pub arrow_len: f64,
    /// The most decimals a coordinate gets (0 to 2): fewer when zoomed out, where they cannot be seen.
    pub decimals: u32,
    /// Screen points per graph unit, for level of detail; 0 turns it off. With it, straight edges hidden
    /// under their nodes or shorter than a fraction of a point are left out, and when zoomed out (under
    /// `DEDUPE_BELOW`) straight edges that land on the same screen pixels are traced once.
    pub scale: f64,
}

/// A straight edge whose visible part is shorter than this on screen, in points, is not traced.
pub const MIN_EDGE_PX: f64 = 0.35;
/// Below this zoom, straight edges ending in the same screen pixels are traced once.
pub const DEDUPE_BELOW: f64 = 0.5;

/// One state's edges: their strokes, and their arrow heads to fill.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EdgeBatch {
    pub lines: String,
    pub arrows: String,
}

/// The most decimals a coordinate gets: plenty in graph units at any zoom.
pub const MAX_DECIMALS: u32 = 2;

/// `v` with at most `decimals` (0 to 2) decimals, trailing zeros dropped ("12.5", "-3", "0.07"), in
/// `buf`. Written by hand: `fmt` costs several times more, and a frame writes tens of thousands of them.
fn fixed(v: f64, decimals: u32, buf: &mut [u8; 32]) -> &str {
    let decimals = decimals.min(MAX_DECIMALS);
    let scale = 10u64.pow(decimals);
    let scaled = (v * scale as f64).round();
    if !scaled.is_finite() || scaled.abs() >= 1e17 {
        return "0";
    }
    // `round` gives -0 for small negatives, which is not < 0: they print as "0".
    let negative = scaled < 0.;
    let mut n = scaled.abs() as u64;
    let mut end = buf.len();
    // Fraction first (dropping trailing zeros), then the integer part, right to left.
    let mut frac = n % scale;
    n /= scale;
    if frac != 0 {
        let mut digits = decimals;
        while frac % 10 == 0 {
            frac /= 10;
            digits -= 1;
        }
        for _ in 0..digits {
            end -= 1;
            buf[end] = b'0' + (frac % 10) as u8;
            frac /= 10;
        }
        end -= 1;
        buf[end] = b'.';
    }
    loop {
        end -= 1;
        buf[end] = b'0' + (n % 10) as u8;
        n /= 10;
        if n == 0 {
            break;
        }
    }
    if negative {
        end -= 1;
        buf[end] = b'-';
    }
    std::str::from_utf8(&buf[end..]).unwrap_or("0")
}

/// Writes SVG path data: commands and their numbers pushed straight onto the string (no `fmt`).
struct PathData<'a> {
    s: &'a mut String,
    decimals: u32,
}

impl PathData<'_> {
    fn num(&mut self, v: f64) {
        let mut buf = [0u8; 32];
        self.s.push_str(fixed(v, self.decimals, &mut buf));
    }

    /// `c` and then `values`, space-separated ("M1 2", "Q1 2 3 4").
    fn cmd(&mut self, c: char, values: &[f64]) {
        self.s.push(c);
        for (j, &v) in values.iter().enumerate() {
            if j > 0 {
                self.s.push(' ');
            }
            self.num(v);
        }
    }
}

/// Whether the edge between (s, rs) and (t, rt) may reach into `v` (`edgeMayTouch` in the engine).
fn may_touch(v: &Rect, s: Pt, rs: f64, t: Pt, rt: f64, e: &Edge) -> bool {
    let pad = rs.max(rt) + if e.self_loop { rs * 3.2 + 18. } else { e.bend.abs() * 2. };
    !(s.x.max(t.x) + pad < v.x0 || s.x.min(t.x) - pad > v.x1 || s.y.max(t.y) + pad < v.y0 || s.y.min(t.y) - pad > v.y1)
}

/// Traces the edges into one batch per state: `states[i]` is 0 (dimmed), 1 (normal) or 2 (highlighted),
/// anything else leaves edge i out (the TypeScript draws those, with their own color or width).
/// `x`, `y`, `r` are the nodes' centers and radii.
pub fn trace_edges(edges: &[Edge], states: &[u8], x: &[f64], y: &[f64], r: &[f64], style: &EdgeStyle) -> [EdgeBatch; 3] {
    let mut out: [EdgeBatch; 3] = Default::default();
    let n = x.len();
    let spread = 0.42f64;
    let k = style.scale;
    let lod = k > 0.;
    // Pixels already traced, per state: (state, x0, y0, x1, y1) in whole screen points. Arrows point one
    // way, so with them an edge and its reverse stay apart.
    let dedupe = lod && k < DEDUPE_BELOW;
    let mut seen: std::collections::HashSet<(u8, i32, i32, i32, i32)> = std::collections::HashSet::new();
    for (i, e) in edges.iter().enumerate() {
        let state = states.get(i).copied().unwrap_or(255);
        if state > 2 {
            continue;
        }
        let (si, ti) = (e.source as usize, e.target as usize);
        if si >= n || ti >= n {
            continue;
        }
        let (s, t) = (pt(x[si], y[si]), pt(x[ti], y[ti]));
        if !may_touch(&style.view, s, r[si], t, r[ti], e) {
            continue;
        }
        let shape = edge_shape(s, r[si], t, r[ti], e.bend, e.self_loop, e.loop_index);
        if lod {
            if let Shape::Line { a, b, .. } = shape {
                // The node circles overlap or the line is too short to see: it is under the nodes.
                let (dx, dy) = (b.x - a.x, b.y - a.y);
                let visible = (t.x - s.x).hypot(t.y - s.y) > r[si] + r[ti];
                if !visible || dx.hypot(dy) * k < MIN_EDGE_PX {
                    continue;
                }
                if dedupe {
                    let q = |v: f64| (v * k).round() as i32;
                    let (mut p0, mut p1) = ((q(a.x), q(a.y)), (q(b.x), q(b.y)));
                    if !style.arrows && p1 < p0 {
                        std::mem::swap(&mut p0, &mut p1);
                    }
                    if !seen.insert((state, p0.0, p0.1, p1.0, p1.1)) {
                        continue;
                    }
                }
            }
        }
        let batch = &mut out[state as usize];
        let mut lines = PathData { s: &mut batch.lines, decimals: style.decimals };
        let (b, end_angle) = match shape {
            Shape::Line { a, b, end_angle } => {
                // Stop the line under the arrow head, so its butt does not poke through the tip.
                let (mut bx, mut by) = (b.x, b.y);
                if style.arrows {
                    let back = style.arrow_len * 0.7;
                    bx -= end_angle.cos() * back;
                    by -= end_angle.sin() * back;
                }
                lines.cmd('M', &[a.x, a.y]);
                lines.cmd('L', &[bx, by]);
                (b, end_angle)
            }
            Shape::Quad { a, c, b, end_angle } => {
                lines.cmd('M', &[a.x, a.y]);
                lines.cmd('Q', &[c.x, c.y, b.x, b.y]);
                (b, end_angle)
            }
            Shape::Cubic { a, c1, c2, b, end_angle } => {
                lines.cmd('M', &[a.x, a.y]);
                lines.cmd('C', &[c1.x, c1.y, c2.x, c2.y, b.x, b.y]);
                (b, end_angle)
            }
        };
        if style.arrows {
            let len = style.arrow_len;
            let mut heads = PathData { s: &mut batch.arrows, decimals: style.decimals };
            heads.cmd('M', &[b.x, b.y]);
            heads.cmd('L', &[b.x - (end_angle - spread).cos() * len, b.y - (end_angle - spread).sin() * len]);
            heads.cmd('L', &[b.x - (end_angle + spread).cos() * len, b.y - (end_angle + spread).sin() * len]);
            heads.s.push('Z');
        }
    }
    out
}

/// Traces the nodes as circles, one path per batch: `keys[i]` names node i's batch (its color and
/// dimming, as the TypeScript numbered them), `u32::MAX` leaves it out. Off-screen nodes are left out.
/// Coordinates get `decimals` decimals at most.
pub fn trace_nodes(keys: &[u32], batches: usize, x: &[f64], y: &[f64], r: &[f64], view: &Rect, decimals: u32) -> Vec<String> {
    let mut out = vec![String::new(); batches];
    let (mut bx0, mut bx1, mut by, mut br) = ([0u8; 32], [0u8; 32], [0u8; 32], [0u8; 32]);
    for i in 0..x.len().min(keys.len()) {
        let k = keys[i] as usize;
        if k >= batches {
            continue;
        }
        let (cx, cy) = (x[i], y[i]);
        if cx < view.x0 || cx > view.x1 || cy < view.y0 || cy > view.y1 {
            continue;
        }
        let rr = r[i].max(0.);
        // Each number once, though the circle names most of them twice.
        let (x0, x1) = (fixed(cx + rr, decimals, &mut bx0), fixed(cx - rr, decimals, &mut bx1));
        let (yy, rs) = (fixed(cy, decimals, &mut by), fixed(rr, decimals, &mut br));
        // Two half-circle arcs: SVG has no full-circle command.
        let s = &mut out[k];
        for (c, x) in [('M', x0), ('A', x1), ('A', x0)] {
            s.push(c);
            if c == 'A' {
                s.push_str(rs);
                s.push(' ');
                s.push_str(rs);
                s.push_str(" 0 1 0 ");
            }
            s.push_str(x);
            s.push(' ');
            s.push_str(yy);
        }
        s.push('Z');
    }
    out
}

/// How `frame_nodes` draws a frame's nodes.
#[derive(Clone, Copy, Debug)]
pub struct FrameStyle {
    /// Graph-space rectangle on screen (with a margin); nodes outside it are left out.
    pub view: Rect,
    pub decimals: u32,
    /// Screen points per graph unit.
    pub scale: f64,
    /// A batch with a node at least this big on screen (radius, in points) gets its separating ring.
    pub ring_px: f64,
    /// Nodes smaller than this on screen (radius, in points) are traced as squares, once per screen pixel
    /// and batch: at that size a circle and a square look the same, and many nodes share a pixel.
    pub lod_px: f64,
}

/// A frame's nodes: one path per batch, and what the renderer needs to know of them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct NodeFrame {
    pub paths: Vec<String>,
    /// 1 for each node in view.
    pub in_view: Vec<u8>,
    /// 1 for each batch that gets a separating ring.
    pub ringed: Vec<u8>,
}

/// The renderer's node pass, done here: which nodes are in view, which batch each goes in (its color's
/// rank among `colors`, dimmed unless in `focus` when there is a focus: batch b < colors holds dimmed
/// nodes, the rest the others), which batches get a ring, and their paths.
pub fn frame_nodes(ranks: &[u32], focus: Option<&[bool]>, colors: usize, x: &[f64], y: &[f64], r: &[f64], style: &FrameStyle) -> NodeFrame {
    let n = x.len().min(y.len()).min(r.len());
    let batches = colors * 2;
    let mut frame = NodeFrame { paths: vec![String::new(); batches], in_view: vec![0; n], ringed: vec![0; batches] };
    let (v, k, d) = (&style.view, style.scale, style.decimals);
    let mut seen: std::collections::HashSet<(usize, i64, i64)> = std::collections::HashSet::new();
    let (mut b0, mut b1, mut b2, mut b3) = ([0u8; 32], [0u8; 32], [0u8; 32], [0u8; 32]);
    for i in 0..n {
        let (cx, cy) = (x[i], y[i]);
        if !(cx >= v.x0 && cx <= v.x1 && cy >= v.y0 && cy <= v.y1) {
            continue;
        }
        frame.in_view[i] = 1;
        let rank = ranks.get(i).copied().unwrap_or(u32::MAX) as usize;
        if rank >= colors {
            continue;
        }
        let dimmed = focus.is_some_and(|f| !f.get(i).copied().unwrap_or(false));
        let b = if dimmed { 0 } else { colors } + rank;
        let rr = r[i].max(0.);
        let sr = rr * k;
        if sr >= style.ring_px {
            frame.ringed[b] = 1;
        }
        let s = &mut frame.paths[b];
        if k > 0. && sr < style.lod_px {
            if !seen.insert((b, (cx * k).round() as i64, (cy * k).round() as i64)) {
                continue;
            }
            // A square of the node's size, at least a point across.
            let h = rr.max(0.5 / k);
            let (x0, y0, side, back) = (fixed(cx - h, d, &mut b0), fixed(cy - h, d, &mut b1), fixed(2. * h, d, &mut b2), fixed(-2. * h, d, &mut b3));
            for part in ["M", x0, " ", y0, "h", side, "v", side, "h", back, "Z"] {
                s.push_str(part);
            }
            continue;
        }
        let (x0, x1) = (fixed(cx + rr, d, &mut b0), fixed(cx - rr, d, &mut b1));
        let (yy, rs) = (fixed(cy, d, &mut b2), fixed(rr, d, &mut b3));
        for (c, x) in [('M', x0), ('A', x1), ('A', x0)] {
            s.push(c);
            if c == 'A' {
                s.push_str(rs);
                s.push(' ');
                s.push_str(rs);
                s.push_str(" 0 1 0 ");
            }
            s.push_str(x);
            s.push(' ');
            s.push_str(yy);
        }
        s.push('Z');
    }
    frame
}

#[cfg(test)]
mod tests {
    use super::*;

    const FAR: Rect = Rect { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };

    fn frame_style(scale: f64) -> FrameStyle {
        FrameStyle { view: FAR, decimals: 2, scale, ring_px: 5., lod_px: 2. }
    }

    #[test]
    fn frame_nodes_batches_by_rank_and_focus_and_rings_big_batches() {
        let (x, y, r) = (vec![0., 100., 200.], vec![0., 0., 0.], vec![10., 10., 3.]);
        let f = frame_nodes(&[0, 1, 1], None, 2, &x, &y, &r, &frame_style(1.));
        assert_eq!(f.in_view, vec![1, 1, 1]);
        // Undimmed batches are colors + rank.
        assert!(f.paths[0].is_empty() && f.paths[1].is_empty());
        assert_eq!(f.paths[2].matches('M').count(), 1);
        assert_eq!(f.paths[3].matches('M').count(), 2);
        assert_eq!(f.ringed, vec![0, 0, 1, 1]);
        // With a focus, the others are dimmed.
        let focus = [true, false, false];
        let f = frame_nodes(&[0, 1, 1], Some(&focus), 2, &x, &y, &r, &frame_style(1.));
        assert_eq!(f.paths[2].matches('M').count(), 1);
        assert_eq!(f.paths[1].matches('M').count(), 2);
        // Off view: left out, and said so.
        let view = Rect { x0: 50., y0: -10., x1: 150., y1: 10. };
        let f = frame_nodes(&[0, 1, 1], None, 2, &x, &y, &r, &FrameStyle { view, ..frame_style(1.) });
        assert_eq!(f.in_view, vec![0, 1, 0]);
        // A rank out of range (no such color) is left out but still in view.
        let f = frame_nodes(&[0, 9, 1], None, 2, &x, &y, &r, &frame_style(1.));
        assert_eq!(f.in_view, vec![1, 1, 1]);
        assert_eq!(f.paths.iter().map(|p| p.matches('M').count()).sum::<usize>(), 2);
    }

    #[test]
    fn tiny_nodes_are_squares_once_per_pixel() {
        // Zoomed out to 0.1: radius 10 is a point on screen. Nodes 0 and 1 share a pixel, node 2 does not.
        let (x, y, r) = (vec![0., 2., 40.], vec![0., 1., 0.], vec![10., 10., 10.]);
        let f = frame_nodes(&[0, 0, 0], None, 1, &x, &y, &r, &frame_style(0.1));
        let p = &f.paths[1];
        assert_eq!(p.matches('M').count(), 2, "{p}");
        assert!(!p.contains('A'), "squares, not arcs: {p}");
        assert_eq!(&p[..p.find('Z').unwrap() + 1], "M-10 -10h20v20h-20Z");
        // Big enough on screen: circles, one each.
        let f = frame_nodes(&[0, 0, 0], None, 1, &x, &y, &r, &frame_style(1.));
        assert_eq!(f.paths[1].matches('M').count(), 3);
        assert!(f.paths[1].contains('A'));
        // Dimmed and undimmed nodes in one pixel are both kept: they are in different batches.
        let focus = [true, false, false];
        let f = frame_nodes(&[0, 0, 0], Some(&focus), 1, &x, &y, &r, &frame_style(0.1));
        assert_eq!(f.paths[0].matches('M').count() + f.paths[1].matches('M').count(), 3);
    }

    #[test]
    fn level_of_detail_drops_hidden_tiny_and_repeated_edges() {
        let edge = |s: u32, t: u32| Edge { source: s, target: t, ..Default::default() };
        // 0–1 overlap (hidden under the nodes); 2–3 and 4–5 run along the same pixels at zoom 0.1; 6–7 far apart.
        let x = vec![0., 15., 100., 300., 102., 301., 0., 0.];
        let y = vec![0., 0., 100., 100., 101., 101., 500., 900.];
        let r = vec![10.; 8];
        let edges = [edge(0, 1), edge(2, 3), edge(4, 5), edge(6, 7)];
        let style = |scale| EdgeStyle { view: FAR, arrows: false, arrow_len: 0., decimals: 2, scale };
        let count = |b: &EdgeBatch| b.lines.matches('M').count();
        assert_eq!(count(&trace_edges(&edges, &[1; 4], &x, &y, &r, &style(0.))[1]), 4, "off: everything");
        assert_eq!(count(&trace_edges(&edges, &[1; 4], &x, &y, &r, &style(0.1))[1]), 2, "hidden and repeated dropped");
        assert_eq!(count(&trace_edges(&edges, &[1; 4], &x, &y, &r, &style(1.))[1]), 3, "zoomed in: only the hidden one");
        // Different states are never merged.
        assert_eq!(trace_edges(&edges, &[1, 1, 2, 1], &x, &y, &r, &style(0.1)).iter().map(count).sum::<usize>(), 3);
        // Reversed edges merge without arrows, not with them.
        let rev = [edge(2, 3), edge(3, 2)];
        assert_eq!(count(&trace_edges(&rev, &[1; 2], &x, &y, &r, &style(0.1))[1]), 1);
        let arrows = EdgeStyle { arrows: true, arrow_len: 7., ..style(0.1) };
        assert_eq!(count(&trace_edges(&rev, &[1; 2], &x, &y, &r, &arrows)[1]), 2);
    }

    const VIEW: Rect = Rect { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };

    #[test]
    fn straight_edges_end_on_the_circles_and_stop_under_the_arrow() {
        let edges = [Edge { source: 0, target: 1, ..Edge::default() }];
        let [_, normal, _] = trace_edges(
            &edges,
            &[1],
            &[0., 100.],
            &[0., 0.],
            &[10., 20.],
            &EdgeStyle { view: VIEW, arrows: true, arrow_len: 10., decimals: 2, scale: 0. },
        );
        // From x = 10 (the source's edge) to 80 (the target's) less 7 under the arrow.
        assert_eq!(normal.lines, "M10 0L73 0");
        assert!(normal.arrows.starts_with("M80 0L"), "{}", normal.arrows);
    }

    #[test]
    fn states_split_batches_and_others_are_left_out() {
        let edges = [
            Edge { source: 0, target: 1, ..Edge::default() },
            Edge { source: 1, target: 0, bend: 10., ..Edge::default() },
            Edge { source: 0, target: 0, self_loop: true, ..Edge::default() },
            Edge { source: 0, target: 1, ..Edge::default() },
        ];
        let out = trace_edges(
            &edges,
            &[0, 2, 1, 255],
            &[0., 100.],
            &[0., 0.],
            &[10., 10.],
            &EdgeStyle { view: VIEW, arrows: false, arrow_len: 0., decimals: 2, scale: 0. },
        );
        assert!(out[0].lines.starts_with('M') && !out[0].lines.contains('Q'));
        assert!(out[2].lines.contains('Q'));
        assert!(out[1].lines.contains('C'));
        assert_eq!(out.iter().map(|b| b.lines.matches('M').count()).sum::<usize>(), 3);
        assert!(out.iter().all(|b| b.arrows.is_empty()));
    }

    #[test]
    fn off_screen_edges_and_nodes_are_culled() {
        let view = Rect { x0: 0., y0: 0., x1: 50., y1: 50. };
        let edges = [Edge { source: 0, target: 1, ..Edge::default() }, Edge { source: 2, target: 3, ..Edge::default() }];
        let x = [10., 40., 500., 600.];
        let y = [10., 40., 500., 600.];
        let r = [5.; 4];
        let out = trace_edges(&edges, &[1, 1], &x, &y, &r, &EdgeStyle { view, arrows: false, arrow_len: 0., decimals: 2, scale: 0. });
        assert_eq!(out[1].lines.matches('M').count(), 1);
        let nodes = trace_nodes(&[0, 1, 0, u32::MAX], 2, &x, &y, &r, &view, 2);
        assert_eq!(nodes[0], "M15 10A5 5 0 1 0 5 10A5 5 0 1 0 15 10Z");
        assert_eq!(nodes[1].matches('M').count(), 1);
    }

    #[test]
    fn numbers_have_two_decimals_at_most() {
        let s = |v: f64| fixed(v, 2, &mut [0; 32]).to_string();
        assert_eq!(s(12.5), "12.5");
        assert_eq!(s(-3.), "-3");
        assert_eq!(s(0.07), "0.07");
        assert_eq!(s(-0.07), "-0.07");
        assert_eq!(s(1234.567), "1234.57");
        assert_eq!(s(-0.001), "0");
        assert_eq!(s(0.), "0");
        assert_eq!(s(100.1), "100.1");
        assert_eq!(s(f64::NAN), "0");
        assert_eq!(fixed(1234.567, 5, &mut [0; 32]), "1234.57");
    }

    #[test]
    fn fewer_decimals_round_to_fewer() {
        let s = |v: f64, d: u32| fixed(v, d, &mut [0; 32]).to_string();
        assert_eq!(s(1234.567, 1), "1234.6");
        assert_eq!(s(1234.567, 0), "1235");
        assert_eq!(s(-12.04, 1), "-12");
        assert_eq!(s(-0.4, 0), "0");
        assert_eq!(s(9.96, 1), "10");
        assert_eq!(s(0.5, 1), "0.5");
    }

    #[test]
    fn zoomed_out_paths_are_shorter_and_the_same_shape() {
        let edges = [Edge { source: 0, target: 1, ..Edge::default() }];
        let (x, y, r) = ([0.123, 100.456], [0.789, 50.321], [10.5, 12.25]);
        let at = |decimals| trace_edges(&edges, &[1], &x, &y, &r, &EdgeStyle { view: VIEW, arrows: true, arrow_len: 7., decimals, scale: 0. });
        let (fine, coarse) = (at(2), at(0));
        assert!(coarse[1].lines.len() < fine[1].lines.len());
        assert_eq!(coarse[1].lines.matches(' ').count(), fine[1].lines.matches(' ').count());
        assert!(!coarse[1].lines.contains('.') && !coarse[1].arrows.contains('.'));
        let circles = trace_nodes(&[0, 0], 1, &x, &y, &r, &VIEW, 0);
        assert_eq!(circles[0].matches('Z').count(), 2);
        assert!(!circles[0].contains('.'));
    }

    #[test]
    fn shapes_match_the_typescript() {
        // A curve bends to the left of its direction and starts on the circle, towards the control point.
        match edge_shape(pt(0., 0.), 10., pt(100., 0.), 10., 10., false, 0) {
            Shape::Quad { a, c, .. } => {
                assert_eq!(c, pt(50., 20.));
                assert!((a.x.hypot(a.y) - 10.).abs() < 1e-9);
            }
            s => panic!("{s:?}"),
        }
        match edge_shape(pt(0., 0.), 10., pt(0., 0.), 10., 0., true, 0) {
            Shape::Cubic { a, b, .. } => assert!(a.y < 0. && b.y < 0.),
            s => panic!("{s:?}"),
        }
    }
}
