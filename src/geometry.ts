/**
 * Edge shapes, hit testing and community hulls. Pure TypeScript, no NSH imports.
 */

export interface Pt {
  x: number;
  y: number;
}

/**
 * The drawn shape of an edge, in graph coordinates: a straight segment (`c` null) or a quadratic curve
 * through control point `c`, trimmed to the two node circles. A self loop is a cubic curve (`c1`, `c2`).
 */
export interface EdgeShape {
  /** Start, on the source circle. */
  a: Pt;
  /** End, on the target circle (where an arrow's tip goes). */
  b: Pt;
  /** Quadratic control point, or null for a straight edge. */
  c: Pt | null;
  /** Cubic control points of a self loop. */
  c1?: Pt;
  c2?: Pt;
  /** Where a label goes and the tangent angle there (radians, kept upright by the renderer). */
  mid: Pt;
  angle: number;
  /** The direction the edge arrives at `b`, for its arrow head. */
  endAngle: number;
}

/**
 * The shape of an edge between circles (`s`, rs) and (`t`, rt). `bend` is the curve's sideways offset in
 * points: 0 straight, ± for parallel edges; `loopIndex` places the n-th self loop of a node.
 */
export function edgeShape(s: Pt, rs: number, t: Pt, rt: number, bend: number, self: boolean, loopIndex = 0): EdgeShape {
  if (self) {
    const base = -Math.PI / 2 + loopIndex * 0.9;
    const spread = 0.45;
    const a0 = base - spread;
    const a1 = base + spread;
    const reach = rs * 3.2 + 18;
    const a = { x: s.x + Math.cos(a0) * rs, y: s.y + Math.sin(a0) * rs };
    const b = { x: s.x + Math.cos(a1) * rs, y: s.y + Math.sin(a1) * rs };
    const c1 = { x: s.x + Math.cos(a0 - 0.25) * reach, y: s.y + Math.sin(a0 - 0.25) * reach };
    const c2 = { x: s.x + Math.cos(a1 + 0.25) * reach, y: s.y + Math.sin(a1 + 0.25) * reach };
    const mid = cubicAt(a, c1, c2, b, 0.5);
    return { a, b, c: null, c1, c2, mid, angle: base + Math.PI / 2, endAngle: Math.atan2(b.y - c2.y, b.x - c2.x) };
  }
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const len = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / len;
  const uy = dy / len;
  if (bend === 0) {
    const a = { x: s.x + ux * rs, y: s.y + uy * rs };
    const b = { x: t.x - ux * rt, y: t.y - uy * rt };
    const angle = Math.atan2(dy, dx);
    return { a, b, c: null, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle, endAngle: angle };
  }
  // Control point: off the midpoint, along the normal. The curve's apex is then bend points out.
  const nx = -uy;
  const ny = ux;
  const c = { x: (s.x + t.x) / 2 + nx * bend * 2, y: (s.y + t.y) / 2 + ny * bend * 2 };
  const a = towards(s, c, rs);
  const b = towards(t, c, rt);
  const mid = quadAt(a, c, b, 0.5);
  const tan = quadTangent(a, c, b, 0.5);
  return { a, b, c, mid, angle: Math.atan2(tan.y, tan.x), endAngle: Math.atan2(b.y - c.y, b.x - c.x) };
}

function towards(from: Pt, to: Pt, d: number): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const l = Math.hypot(dx, dy) || 1e-6;
  return { x: from.x + (dx / l) * d, y: from.y + (dy / l) * d };
}

export function quadAt(a: Pt, c: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

function quadTangent(a: Pt, c: Pt, b: Pt, t: number): Pt {
  return { x: 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x), y: 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y) };
}

export function cubicAt(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return { x: w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x, y: w0 * a.y + w1 * c1.y + w2 * c2.y + w3 * b.y };
}

/** Squared distance from `p` to segment `ab`. */
export function segmentDistance2(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t * dx - p.x;
  const y = a.y + t * dy - p.y;
  return x * x + y * y;
}

/** Distance from `p` to an edge's shape (curves are sampled). */
export function edgeDistance(p: Pt, e: EdgeShape): number {
  if (!e.c && !e.c1) return Math.sqrt(segmentDistance2(p, e.a, e.b));
  const steps = 16;
  let best = Infinity;
  let prev = e.a;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const q = e.c ? quadAt(e.a, e.c, e.b, t) : cubicAt(e.a, e.c1!, e.c2!, e.b, t);
    best = Math.min(best, segmentDistance2(p, prev, q));
    prev = q;
  }
  return Math.sqrt(best);
}

/** Convex hull (Andrew's monotone chain), with positive orientation in the coordinates given. */
export function convexHull(points: Pt[]): Pt[] {
  const pts = points
    .slice()
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((p, i, arr) => i === 0 || p.x !== arr[i - 1].x || p.y !== arr[i - 1].y);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** The subset of a canvas path API that `roundedHullPath` draws with. */
export interface PathSink {
  moveTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void;
  closePath(): void;
}

/**
 * Traces the outline of a hull grown by `pad`: straight sides pushed out along their normals, joined by
 * arcs around the corners. One point gives a circle, two a capsule.
 */
export function roundedHullPath(sink: PathSink, hull: Pt[], pad: number) {
  if (hull.length === 0) return;
  if (hull.length === 1) {
    sink.moveTo(hull[0].x + pad, hull[0].y);
    sink.arc(hull[0].x, hull[0].y, pad, 0, Math.PI * 2);
    sink.closePath();
    return;
  }
  const n = hull.length;
  const normalAngle = (i: number) => {
    const a = hull[i];
    const b = hull[(i + 1) % n];
    // Outward normal of a positively oriented polygon: (dy, -dx).
    return Math.atan2(-(b.x - a.x), b.y - a.y);
  };
  for (let i = 0; i < n; i++) {
    const v = hull[i];
    let a0 = normalAngle((i - 1 + n) % n);
    let a1 = normalAngle(i);
    while (a1 < a0) a1 += Math.PI * 2;
    if (i === 0) sink.moveTo(v.x + Math.cos(a0) * pad, v.y + Math.sin(a0) * pad);
    sink.arc(v.x, v.y, pad, a0, a1, false);
  }
  sink.closePath();
}

/** The topmost point of a hull grown by `pad`, where its label goes. */
export function hullTop(hull: Pt[], pad: number): Pt {
  let top = hull[0];
  for (const p of hull) if (p.y < top.y) top = p;
  return { x: top.x, y: top.y - pad };
}
