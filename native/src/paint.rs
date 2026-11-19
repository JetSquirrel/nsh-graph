//! Edge and node outlines as SVG path data, so the TSX canvas draws a whole batch with one
//! `new Path2D(d)` instead of a canvas call per segment, arc and arrow (gpui-graph batches its edges into
//! one path per state the same way). The shapes are `src/geometry.ts`'s `edgeShape`, step for step.

use std::fmt::Write;

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
}

/// One state's edges: their strokes, and their arrow heads to fill.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EdgeBatch {
    pub lines: String,
    pub arrows: String,
}

/// Coordinates with two decimals: plenty in graph units, and short strings to parse. Written by hand:
/// `fmt` costs several times more, and a frame writes tens of thousands of them.
struct Num(f64);

impl std::fmt::Display for Num {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut buf = [0u8; 32];
        f.write_str(fixed2(self.0, &mut buf))
    }
}

/// `v` with at most two decimals, trailing zeros dropped ("12.5", "-3", "0.07"), in `buf`.
fn fixed2(v: f64, buf: &mut [u8; 32]) -> &str {
    let scaled = (v * 100.).round();
    if !scaled.is_finite() || scaled.abs() >= 1e17 {
        return "0";
    }
    // `round` gives -0 for small negatives, which is not < 0: they print as "0".
    let negative = scaled < 0.;
    let mut n = scaled.abs() as u64;
    let mut end = buf.len();
    // Fraction first (dropping trailing zeros), then the integer part, right to left.
    let mut frac = n % 100;
    n /= 100;
    if frac != 0 {
        let digits = if frac % 10 == 0 { frac /= 10; 1 } else { 2 };
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
        let batch = &mut out[state as usize];
        let shape = edge_shape(s, r[si], t, r[ti], e.bend, e.self_loop, e.loop_index);
        let (b, end_angle) = match shape {
            Shape::Line { a, b, end_angle } => {
                // Stop the line under the arrow head, so its butt does not poke through the tip.
                let (mut bx, mut by) = (b.x, b.y);
                if style.arrows {
                    let back = style.arrow_len * 0.7;
                    bx -= end_angle.cos() * back;
                    by -= end_angle.sin() * back;
                }
                let _ = write!(batch.lines, "M{} {}L{} {}", Num(a.x), Num(a.y), Num(bx), Num(by));
                (b, end_angle)
            }
            Shape::Quad { a, c, b, end_angle } => {
                let _ = write!(batch.lines, "M{} {}Q{} {} {} {}", Num(a.x), Num(a.y), Num(c.x), Num(c.y), Num(b.x), Num(b.y));
                (b, end_angle)
            }
            Shape::Cubic { a, c1, c2, b, end_angle } => {
                let _ = write!(
                    batch.lines,
                    "M{} {}C{} {} {} {} {} {}",
                    Num(a.x), Num(a.y), Num(c1.x), Num(c1.y), Num(c2.x), Num(c2.y), Num(b.x), Num(b.y)
                );
                (b, end_angle)
            }
        };
        if style.arrows {
            let len = style.arrow_len;
            let _ = write!(
                batch.arrows,
                "M{} {}L{} {}L{} {}Z",
                Num(b.x),
                Num(b.y),
                Num(b.x - (end_angle - spread).cos() * len),
                Num(b.y - (end_angle - spread).sin() * len),
                Num(b.x - (end_angle + spread).cos() * len),
                Num(b.y - (end_angle + spread).sin() * len),
            );
        }
    }
    out
}

/// Traces the nodes as circles, one path per batch: `keys[i]` names node i's batch (its color and
/// dimming, as the TypeScript numbered them), `u32::MAX` leaves it out. Off-screen nodes are left out.
pub fn trace_nodes(keys: &[u32], batches: usize, x: &[f64], y: &[f64], r: &[f64], view: &Rect) -> Vec<String> {
    let mut out = vec![String::new(); batches];
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
        // Two half-circle arcs: SVG has no full-circle command.
        let _ = write!(
            out[k],
            "M{} {}A{r} {r} 0 1 0 {} {}A{r} {r} 0 1 0 {} {}Z",
            Num(cx + rr),
            Num(cy),
            Num(cx - rr),
            Num(cy),
            Num(cx + rr),
            Num(cy),
            r = Num(rr),
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

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
            &EdgeStyle { view: VIEW, arrows: true, arrow_len: 10. },
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
            &EdgeStyle { view: VIEW, arrows: false, arrow_len: 0. },
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
        let out = trace_edges(&edges, &[1, 1], &x, &y, &r, &EdgeStyle { view, arrows: false, arrow_len: 0. });
        assert_eq!(out[1].lines.matches('M').count(), 1);
        let nodes = trace_nodes(&[0, 1, 0, u32::MAX], 2, &x, &y, &r, &view);
        assert_eq!(nodes[0], "M15 10A5 5 0 1 0 5 10A5 5 0 1 0 15 10Z");
        assert_eq!(nodes[1].matches('M').count(), 1);
    }

    #[test]
    fn numbers_have_two_decimals_at_most() {
        let s = |v: f64| Num(v).to_string();
        assert_eq!(s(12.5), "12.5");
        assert_eq!(s(-3.), "-3");
        assert_eq!(s(0.07), "0.07");
        assert_eq!(s(-0.07), "-0.07");
        assert_eq!(s(1234.567), "1234.57");
        assert_eq!(s(-0.001), "0");
        assert_eq!(s(0.), "0");
        assert_eq!(s(100.1), "100.1");
        assert_eq!(s(f64::NAN), "0");
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
