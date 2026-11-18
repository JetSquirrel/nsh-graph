/**
 * Barnes–Hut many-body force and circle collision on flat typed arrays.
 *
 * The first version built a tree of small objects every tick, which QuickJS (NSH's engine on devices) runs
 * several times slower than a JIT does. Here every buffer is allocated once and reused, the tree is
 * indexed by integers, and traversal uses an explicit stack, so a tick allocates nothing.
 */
import type { SimNode } from "./simulation";

const MAX_DEPTH = 24;

export class ManyBody {
  private cap = 0;
  private count = 0;
  // Per quad
  private x0 = new Float64Array(0);
  private y0 = new Float64Array(0);
  private size = new Float64Array(0);
  private value = new Float64Array(0);
  private cx = new Float64Array(0);
  private cy = new Float64Array(0);
  /** Children: kids[q * 4 + k], -1 for none. A quad with no children is a leaf. */
  private kids = new Int32Array(0);
  /** A leaf's first point, -1 when empty. */
  private head = new Int32Array(0);
  private depth = new Int32Array(0);
  /** 1 while a quad has no children. */
  private leaf = new Uint8Array(0);
  // Per point
  private px = new Float64Array(0);
  private py = new Float64Array(0);
  /** The next point in the same leaf (coincident points), -1 at the end. */
  private next = new Int32Array(0);
  private stack = new Int32Array(0);

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
      this.size = new Float64Array(c);
      this.value = new Float64Array(c);
      this.cx = new Float64Array(c);
      this.cy = new Float64Array(c);
      this.kids = new Int32Array(c * 4);
      this.head = new Int32Array(c);
      this.depth = new Int32Array(c);
      this.leaf = new Uint8Array(c);
      this.stack = new Int32Array(c * 4 + 16);
    }
  }

  private newQuad(x0: number, y0: number, size: number, depth: number): number {
    const q = this.count++;
    this.x0[q] = x0;
    this.y0[q] = y0;
    this.size[q] = size;
    this.depth[q] = depth;
    this.head[q] = -1;
    this.leaf[q] = 1;
    const k = q * 4;
    this.kids[k] = this.kids[k + 1] = this.kids[k + 2] = this.kids[k + 3] = -1;
    return q;
  }

  /** The child of q that (x, y) falls in, made if missing. */
  private child(q: number, x: number, y: number): number {
    const h = this.size[q] / 2;
    const right = x >= this.x0[q] + h ? 1 : 0;
    const bottom = y >= this.y0[q] + h ? 1 : 0;
    const slot = q * 4 + bottom * 2 + right;
    let c = this.kids[slot];
    if (c < 0) {
      c = this.newQuad(this.x0[q] + right * h, this.y0[q] + bottom * h, h, this.depth[q] + 1);
      this.kids[slot] = c;
      this.leaf[q] = 0;
    }
    return c;
  }

  private insert(i: number) {
    const { px, py } = this;
    const x = px[i];
    const y = py[i];
    let q = 0;
    for (;;) {
      if (this.leaf[q] === 0) {
        q = this.child(q, x, y);
        continue;
      }
      const first = this.head[q];
      if (first < 0) {
        this.head[q] = i;
        this.next[i] = -1;
        return;
      }
      // Coincident, too deep, or out of room: share the leaf.
      if ((px[first] === x && py[first] === y) || this.depth[q] >= MAX_DEPTH || this.count + 4 > this.cap) {
        this.next[i] = this.head[q];
        this.head[q] = i;
        return;
      }
      // Split: the leaf's points (all at one place) move down into one child, then try again.
      this.head[q] = -1;
      const c = this.child(q, px[first], py[first]);
      this.head[c] = first;
    }
  }

  /** Adds the many-body force to every node's velocity. */
  apply(nodes: SimNode[], strength: number, theta: number, maxDistance: number, alpha: number, jiggle: () => number) {
    const n = nodes.length;
    if (n === 0 || strength === 0) return;
    this.ensure(n);
    const { px, py } = this;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = nodes[i].x;
      const y = nodes[i].y;
      px[i] = x;
      py[i] = y;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
    this.count = 0;
    this.newQuad(x0, y0, Math.max(x1 - x0, y1 - y0, 1) * 1.0001, 0);
    for (let i = 0; i < n; i++) this.insert(i);

    // Accumulate: children always come after their parent, so walk the quads backwards.
    const { kids, value, cx, cy, head, next, leaf } = this;
    for (let q = this.count - 1; q >= 0; q--) {
      let v = 0, sx = 0, sy = 0;
      if (leaf[q] === 1) {
        let c = 0;
        for (let p = head[q]; p >= 0; p = next[p]) {
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
        let w = 0;
        for (let k = 0; k < 4; k++) {
          const c = kids[q * 4 + k];
          if (c < 0) continue;
          const a = Math.abs(value[c]);
          v += value[c];
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

    const theta2 = theta * theta;
    const max2 = maxDistance === Infinity ? Infinity : maxDistance * maxDistance;
    const { size, stack } = this;
    for (let i = 0; i < n; i++) {
      const nx = px[i];
      const ny = py[i];
      let fx = 0, fy = 0;
      let top = 0;
      stack[top++] = 0;
      while (top > 0) {
        const q = stack[--top];
        const v = value[q];
        if (v === 0) continue;
        let x = cx[q] - nx;
        let y = cy[q] - ny;
        let l = x * x + y * y;
        const w = size[q];
        const isLeaf = leaf[q] === 1;
        if (!isLeaf && w * w < l * theta2) {
          // Far enough: the quad acts as one body.
          if (l < max2) {
            if (l < 1) l = Math.sqrt(l) || 1e-6;
            fx += (x * v) / l;
            fy += (y * v) / l;
          }
          continue;
        }
        if (!isLeaf) {
          const k = q * 4;
          for (let j = 0; j < 4; j++) if (kids[k + j] >= 0) stack[top++] = kids[k + j];
          continue;
        }
        for (let p = head[q]; p >= 0; p = next[p]) {
          if (p === i) continue;
          x = px[p] - nx;
          y = py[p] - ny;
          l = x * x + y * y;
          if (l >= max2) continue;
          if (x === 0) { x = jiggle(); l += x * x; }
          if (y === 0) { y = jiggle(); l += y * y; }
          if (l < 1) l = Math.sqrt(l);
          fx += (x * strength) / l;
          fy += (y * strength) / l;
        }
      }
      const node = nodes[i];
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
    }
    let size = 1;
    while (size < n * 2) size <<= 1;
    if (this.headTable.length !== size) this.headTable = new Int32Array(size);
    const mask = size - 1;
    const table = this.headTable;
    table.fill(-1);
    let maxR = 0;
    for (let i = 0; i < n; i++) if (nodes[i].r > maxR) maxR = nodes[i].r;
    const cell = Math.max(1, maxR * 2 + padding);
    const { next, cellX, cellY, x: X, y: Y } = this;
    const hash = (cx: number, cy: number) => (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & mask;
    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      const x = node.x + node.vx;
      const y = node.y + node.vy;
      X[i] = x;
      Y[i] = y;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      cellX[i] = cx;
      cellY[i] = cy;
      const h = hash(cx, cy);
      next[i] = table[h];
      table[h] = i;
    }
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      const ra = a.r;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const tcx = cellX[i] + dx;
          const tcy = cellY[i] + dy;
          for (let j = table[hash(tcx, tcy)]; j >= 0; j = next[j]) {
            // Only pairs once, and only true neighbors (hash buckets can mix cells).
            if (j <= i || cellX[j] !== tcx || cellY[j] !== tcy) continue;
            const b = nodes[j];
            const r = ra + b.r + padding;
            let x = X[i] - X[j];
            let y = Y[i] - Y[j];
            let l = x * x + y * y;
            if (l >= r * r) continue;
            if (x === 0) { x = jiggle(); l += x * x; }
            if (y === 0) { y = jiggle(); l += y * y; }
            l = Math.sqrt(l);
            l = ((r - l) / l) * strength;
            const r2a = ra * ra;
            const r2b = b.r * b.r;
            const wa = r2b / (r2a + r2b);
            x *= l;
            y *= l;
            a.vx += x * wa;
            a.vy += y * wa;
            b.vx -= x * (1 - wa);
            b.vy -= y * (1 - wa);
          }
        }
      }
    }
  }
}
