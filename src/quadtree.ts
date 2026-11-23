/**
 * Barnes–Hut many-body force and circle collision on flat typed arrays.
 *
 * The first version built a tree of small objects every tick, which QuickJS (NSH's engine on devices) runs
 * several times slower than a JIT does. Here every buffer is allocated once and reused, the tree is
 * indexed by integers, and a tick allocates nothing.
 *
 * QuickJS interprets: what a loop costs is about how many operations it runs, and a call or a property of
 * `this` costs several. So the hot loops read typed arrays held in locals, and the tree walk follows links
 * instead of keeping a stack (see `ManyBody.link`). Their locals are `var`s: QuickJS checks a `let` or
 * `const` binding for use before its declaration on every access, which costs these loops about a fifth
 * of their time (a JIT drops the checks; `var` has none).
 *
 * The walk visits the quads in the order of a walk with a stack that pushes the children first slot first,
 * as native/src/sim.rs walks them, so every force adds up the same terms in the same order.
 */
import type { SimNode } from "./simulation";

const MAX_DEPTH = 24;
const sqrt = Math.sqrt;
const floor = Math.floor;
const imul = Math.imul;

/** `head` of a quad that has children. */
const INNER = -2;

export class ManyBody {
  private cap = 0;
  private count = 0;
  // Per quad
  private x0 = new Float64Array(0);
  private y0 = new Float64Array(0);
  /** Half the side, and the middle (x0 + half, y0 + half), where the children divide. */
  private half = new Float64Array(0);
  private mx = new Float64Array(0);
  private my = new Float64Array(0);
  /** The side squared, for the far-field test. */
  private size2 = new Float64Array(0);
  private value = new Float64Array(0);
  private cx = new Float64Array(0);
  private cy = new Float64Array(0);
  /** Children: kids[q * 4 + k], -1 for none. */
  private kids = new Int32Array(0);
  /** A leaf's first point (-1 while empty), or INNER for a quad with children. */
  private head = new Int32Array(0);
  private depth = new Int32Array(0);
  /** What the walk finds at a quad: -1 an inner quad, p ≥ 0 a leaf holding point p alone, -2 - p a leaf of several from p. */
  private item = new Int32Array(0);
  /** The walk's next quad when it opens this one (its first child), and when it is done with it (-1: the end). */
  private down = new Int32Array(0);
  private skip = new Int32Array(0);
  // Per point
  private px = new Float64Array(0);
  private py = new Float64Array(0);
  /** The next point in the same leaf (coincident points), -1 at the end. */
  private next = new Int32Array(0);

  private ensure(n: number) {
    if (this.px.length < n) {
      const m = Math.max(16, n * 2);
      this.px = new Float64Array(m);
      this.py = new Float64Array(m);
      this.next = new Int32Array(m);
    }
    const cap = n * 6 + 64;
    if (this.cap < cap) {
      this.cap = cap * 2;
      const c = this.cap;
      this.x0 = new Float64Array(c);
      this.y0 = new Float64Array(c);
      this.half = new Float64Array(c);
      this.mx = new Float64Array(c);
      this.my = new Float64Array(c);
      this.size2 = new Float64Array(c);
      this.value = new Float64Array(c);
      this.cx = new Float64Array(c);
      this.cy = new Float64Array(c);
      this.kids = new Int32Array(c * 4);
      this.head = new Int32Array(c);
      this.depth = new Int32Array(c);
      this.item = new Int32Array(c);
      this.down = new Int32Array(c);
      this.skip = new Int32Array(c);
    }
  }

  private newQuad(x0: number, y0: number, size: number, depth: number): number {
    const q = this.count++;
    const h = size / 2;
    this.x0[q] = x0;
    this.y0[q] = y0;
    this.half[q] = h;
    this.mx[q] = x0 + h;
    this.my[q] = y0 + h;
    this.size2[q] = size * size;
    this.depth[q] = depth;
    this.head[q] = -1;
    const k = q * 4;
    this.kids[k] = this.kids[k + 1] = this.kids[k + 2] = this.kids[k + 3] = -1;
    return q;
  }

  /** The child of quad q in `slot` (q * 4 + bottom * 2 + right), made. */
  private newChild(q: number, slot: number): number {
    const h = this.half[q];
    const c = this.newQuad(this.x0[q] + (slot & 1) * h, this.y0[q] + ((slot >> 1) & 1) * h, h, this.depth[q] + 1);
    this.kids[slot] = c;
    return c;
  }

  /** Adds the many-body force to every node's velocity. */
  apply(nodes: SimNode[], strength: number, theta: number, maxDistance: number, alpha: number, jiggle: () => number) {
    const n = nodes.length;
    if (n === 0 || strength === 0) return;
    this.ensure(n);
    this.build(nodes);
    this.accumulate(strength);
    this.link();
    this.walk(nodes, strength, theta, maxDistance, alpha, jiggle);
  }

  /** Copies the positions and builds the tree. Children always come after their parent. */
  private build(nodes: SimNode[]) {
    var n = nodes.length, px = this.px, py = this.py, next = this.next;
    var mx = this.mx, my = this.my, kids = this.kids, head = this.head, depth = this.depth, cap = this.cap;
    var i = 0, q = 0, c = 0, slot = 0, first = 0, x = 0, y = 0, node: SimNode;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (i = 0; i < n; i++) {
      node = nodes[i];
      x = node.x;
      y = node.y;
      px[i] = x;
      py[i] = y;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    this.count = 0;
    this.newQuad(x0, y0, Math.max(x1 - x0, y1 - y0, 1) * 1.0001, 0);
    for (i = 0; i < n; i++) {
      x = px[i];
      y = py[i];
      q = 0;
      for (;;) {
        first = head[q];
        if (first === INNER) {
          // Down into the child (x, y) falls in, made if missing.
          slot = q * 4 + (y >= my[q] ? 2 : 0) + (x >= mx[q] ? 1 : 0);
          c = kids[slot];
          q = c < 0 ? this.newChild(q, slot) : c;
          continue;
        }
        if (first < 0) {
          head[q] = i;
          next[i] = -1;
          break;
        }
        // Coincident, too deep, or out of room: share the leaf.
        if ((px[first] === x && py[first] === y) || depth[q] >= MAX_DEPTH || this.count + 4 > cap) {
          next[i] = first;
          head[q] = i;
          break;
        }
        // Split: the leaf's points (all at one place) move down into one child, then try again.
        head[q] = INNER;
        head[this.newChild(q, q * 4 + (py[first] >= my[q] ? 2 : 0) + (px[first] >= mx[q] ? 1 : 0))] = first;
      }
    }
  }

  /** Each quad's charge and center of charge, walking the quads backwards so children come before their parent. */
  private accumulate(strength: number) {
    var px = this.px, py = this.py, next = this.next, kids = this.kids, head = this.head;
    var value = this.value, cx = this.cx, cy = this.cy;
    var q = 0, p = 0, k = 0, end = 0, c = 0, first = 0, v = 0, vc = 0, a = 0, w = 0, sx = 0, sy = 0;
    for (q = this.count - 1; q >= 0; q--) {
      v = 0;
      sx = 0;
      sy = 0;
      first = head[q];
      if (first !== INNER) {
        c = 0;
        for (p = first; p >= 0; p = next[p]) {
          sx += px[p];
          sy += py[p];
          c++;
        }
        if (c > 0) {
          v = strength * c;
          sx /= c;
          sy /= c;
        }
      } else {
        w = 0;
        for (k = q * 4, end = k + 4; k < end; k++) {
          c = kids[k];
          if (c < 0) continue;
          vc = value[c];
          a = vc < 0 ? -vc : vc;
          v += vc;
          sx += a * cx[c];
          sy += a * cy[c];
          w += a;
        }
        if (w > 0) {
          sx /= w;
          sy /= w;
        }
      }
      value[q] = v;
      cx[q] = sx;
      cy[q] = sy;
    }
  }

  /**
   * Links the walk: depth first, the children last slot first. `down` opens a quad, `skip` passes it.
   * Every quad holds a point and strength is not 0, so no quad's value is 0 and none is passed over.
   */
  private link() {
    var count = this.count, next = this.next, kids = this.kids, head = this.head;
    var item = this.item, down = this.down, skip = this.skip;
    var q = 0, k = 0, end = 0, c = 0, first = 0, after = 0;
    skip[0] = -1;
    for (q = 0; q < count; q++) {
      first = head[q];
      if (first !== INNER) {
        item[q] = next[first] < 0 ? first : -2 - first;
        continue;
      }
      item[q] = -1;
      after = skip[q];
      for (k = q * 4, end = k + 4; k < end; k++) {
        c = kids[k];
        if (c < 0) continue;
        skip[c] = after;
        after = c;
      }
      down[q] = after;
    }
  }

  /** Walks the tree once per node, adding up the force on it. */
  private walk(nodes: SimNode[], strength: number, theta: number, maxDistance: number, alpha: number, jiggle: () => number) {
    var n = nodes.length, px = this.px, py = this.py, next = this.next;
    var value = this.value, cx = this.cx, cy = this.cy, item = this.item, down = this.down, skip = this.skip, size2 = this.size2;
    var theta2 = theta * theta;
    var max2 = maxDistance === Infinity ? Infinity : maxDistance * maxDistance;
    var i = 0, q = 0, p = 0, o = 0, v = 0, x = 0, y = 0, l = 0, nx = 0, ny = 0, fx = 0, fy = 0, node: SimNode;
    for (i = 0; i < n; i++) {
      nx = px[i];
      ny = py[i];
      fx = 0;
      fy = 0;
      q = 0;
      do {
        x = cx[q] - nx;
        y = cy[q] - ny;
        l = x * x + y * y;
        p = item[q];
        if (p === -1) {
          if (size2[q] < l * theta2) {
            // Far enough: the quad acts as one body.
            if (l < max2) {
              if (l < 1) l = sqrt(l) || 1e-6;
              v = value[q];
              fx += (x * v) / l;
              fy += (y * v) / l;
            }
            q = skip[q];
          } else {
            q = down[q];
          }
          continue;
        }
        q = skip[q];
        if (p >= 0) {
          // A leaf with one point: its center is the point.
          if (p === i || l >= max2) continue;
          if (x === 0) { x = jiggle(); l += x * x; }
          if (y === 0) { y = jiggle(); l += y * y; }
          if (l < 1) l = sqrt(l);
          fx += (x * strength) / l;
          fy += (y * strength) / l;
          continue;
        }
        for (o = -2 - p; o >= 0; o = next[o]) {
          if (o === i) continue;
          x = px[o] - nx;
          y = py[o] - ny;
          l = x * x + y * y;
          if (l >= max2) continue;
          if (x === 0) { x = jiggle(); l += x * x; }
          if (y === 0) { y = jiggle(); l += y * y; }
          if (l < 1) l = sqrt(l);
          fx += (x * strength) / l;
          fy += (y * strength) / l;
        }
      } while (q >= 0);
      node = nodes[i];
      node.vx += fx * alpha;
      node.vy += fy * alpha;
    }
  }
}

/** Circle collision with a spatial hash on flat arrays. */
export class Collider {
  private headTable = new Int32Array(0);
  private next = new Int32Array(0);
  private cellX = new Int32Array(0);
  private cellY = new Int32Array(0);
  private x = new Float64Array(0);
  private y = new Float64Array(0);
  private r = new Float64Array(0);

  apply(nodes: SimNode[], padding: number, strength: number, jiggle: () => number) {
    const n = nodes.length;
    if (n < 2) return;
    if (this.next.length < n) {
      const m = n * 2;
      this.next = new Int32Array(m);
      this.cellX = new Int32Array(m);
      this.cellY = new Int32Array(m);
      this.x = new Float64Array(m);
      this.y = new Float64Array(m);
      this.r = new Float64Array(m);
    }
    let size = 1;
    while (size < n * 2) size <<= 1;
    if (this.headTable.length !== size) this.headTable = new Int32Array(size);
    this.headTable.fill(-1);
    this.collide(nodes, padding, strength, jiggle);
  }

  private collide(nodes: SimNode[], padding: number, strength: number, jiggle: () => number) {
    var n = nodes.length, table = this.headTable, mask = table.length - 1;
    var next = this.next, cellX = this.cellX, cellY = this.cellY, X = this.x, Y = this.y, R = this.r;
    var i = 0, j = 0, h = 0, dx = 0, dy = 0, hx = 0, cxi = 0, cyi = 0, tcx = 0, tcy = 0;
    var x = 0, y = 0, l = 0, r = 0, ra = 0, rb = 0, r2a = 0, r2b = 0, wa = 0, xi = 0, yi = 0, maxR = 0;
    var node: SimNode, a: SimNode | null;
    for (i = 0; i < n; i++) {
      r = nodes[i].r;
      R[i] = r;
      if (r > maxR) maxR = r;
    }
    var cell = Math.max(1, maxR * 2 + padding);
    for (i = 0; i < n; i++) {
      node = nodes[i];
      x = node.x + node.vx;
      y = node.y + node.vy;
      X[i] = x;
      Y[i] = y;
      cxi = floor(x / cell);
      cyi = floor(y / cell);
      cellX[i] = cxi;
      cellY[i] = cyi;
      h = (imul(cxi, 73856093) ^ imul(cyi, 19349663)) & mask;
      next[i] = table[h];
      table[h] = i;
    }
    // Each bucket lists its points newest first, so from i's side the ones after i come first: the walk
    // stops at i, and every pair is met once.
    for (i = 0; i < n; i++) {
      xi = X[i];
      yi = Y[i];
      ra = R[i];
      r2a = ra * ra;
      cxi = cellX[i];
      cyi = cellY[i];
      a = null;
      for (dx = -1; dx <= 1; dx++) {
        tcx = cxi + dx;
        hx = imul(tcx, 73856093);
        for (dy = -1; dy <= 1; dy++) {
          tcy = cyi + dy;
          for (j = table[(hx ^ imul(tcy, 19349663)) & mask]; j > i; j = next[j]) {
            // Only true neighbors (hash buckets can mix cells).
            if (cellX[j] !== tcx || cellY[j] !== tcy) continue;
            rb = R[j];
            r = ra + rb + padding;
            x = xi - X[j];
            y = yi - Y[j];
            l = x * x + y * y;
            if (l >= r * r) continue;
            if (x === 0) { x = jiggle(); l += x * x; }
            if (y === 0) { y = jiggle(); l += y * y; }
            l = sqrt(l);
            l = ((r - l) / l) * strength;
            r2b = rb * rb;
            wa = r2b / (r2a + r2b);
            x *= l;
            y *= l;
            if (a === null) a = nodes[i];
            a.vx += x * wa;
            a.vy += y * wa;
            node = nodes[j];
            node.vx -= x * (1 - wa);
            node.vy -= y * (1 - wa);
          }
        }
      }
    }
  }
}
