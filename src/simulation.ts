/**
 * A force-directed layout in the manner of d3-force: link springs, Barnes–Hut many-body repulsion, circle
 * collision on a spatial hash, gravity toward the origin and an optional pull of each group toward its
 * centroid. Velocities decay every tick and the whole system cools with `alpha`, so it settles and stops.
 *
 * Pure TypeScript with no NSH imports: it runs (and is tested) anywhere.
 */
import { nativeBackend, type NativeBackend, type NativeForceLayout } from "./native";
import { Collider, ManyBody } from "./quadtree";
import type { ForceConfig } from "./types";

export interface SimNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** A fixed position (pinned or dragged); null lets the forces move the node. */
  fx: number | null;
  fy: number | null;
  /** Radius in points, for collision and link length. */
  r: number;
  /** Group id for clustering, or null. */
  group: string | null;
}

export interface SimLink {
  source: number;
  target: number;
}

const sqrt = Math.sqrt;

export const DEFAULT_FORCE: ForceConfig = {
  linkDistance: 90,
  charge: -320,
  theta: 0.9,
  chargeDistanceMax: Infinity,
  collidePadding: 10,
  gravity: 0.04,
  groupStrength: 0.12,
  velocityDecay: 0.4,
  alphaDecay: 1 - Math.pow(0.001, 1 / 300),
  alphaMin: 0.001,
};

/** A small deterministic generator, so layouts are reproducible (and testable). */
export function lcg(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------
// The simulation

export class ForceSimulation {
  nodes: SimNode[] = [];
  links: SimLink[] = [];
  config: ForceConfig;
  alpha = 1;
  /** Kept above zero while a node is dragged, so the layout stays warm around it. */
  alphaTarget = 0;

  private random = lcg(7);
  private manyBody = new ManyBody();
  private collider = new Collider();
  private jiggler = () => this.jiggle();
  /** Per link: its ends' node indices, strength and bias, read by the link force every tick. */
  private linkSource = new Int32Array(0);
  private linkTarget = new Int32Array(0);
  private linkStrength = new Float64Array(0);
  private linkBias = new Float64Array(0);
  /** The Rust layout the ticks run on, when `setNativeBackend` registered one; null runs them here. */
  private native: NativeForceLayout | null = null;
  private state = new Float64Array(0);
  /**
   * Whether the Rust layout keeps the nodes' state between ticks (a backend with `run`): JS then sends
   * only what it changed (`changed`, `changedAll`) and reads back positions, instead of copying every
   * node's state both ways each tick.
   */
  private kept = false;
  /** What JS changed since the last tick: every node (1; 2: their velocities start over too), and some. */
  private pendingAll: 0 | 1 | 2 = 0;
  private pending = new Set<number>();
  /** The last `run`'s result, and whether the nodes have not been given its positions yet (`sync`). */
  private lastRun: Uint8Array | null = null;
  private unsynced = false;
  /**
   * The last tick's result while no node changed in JS since: x, y per node, as the Rust painter's
   * `setPositions` takes them, so a frame does not pack the positions again. Null otherwise.
   */
  positions: Uint8Array | null = null;

  /** `native` overrides the backend `setNativeBackend` registered (null: TypeScript). */
  constructor(config: Partial<ForceConfig> = {}, native: NativeBackend | null = nativeBackend()) {
    this.config = { ...DEFAULT_FORCE, ...config };
    if (native) {
      this.native = new native.ForceLayout();
      this.kept = typeof this.native.run === "function" && typeof this.native.load === "function";
      this.pushConfig();
    }
  }

  /** Whether the ticks run in Rust. */
  get isNative(): boolean {
    return this.native !== null;
  }

  private pushConfig() {
    const c = this.config;
    this.native?.setConfig([
      c.linkDistance, c.charge, c.theta, c.chargeDistanceMax, c.collidePadding,
      c.gravity, c.groupStrength, c.velocityDecay, c.alphaDecay, c.alphaMin,
    ]);
  }

  /** Replaces the nodes and links. Node objects are used as given, so their positions carry over. */
  setGraph(nodes: SimNode[], links: SimLink[]) {
    // The velocities live in Rust between ticks: bring them back to the nodes first, so the ones that stay
    // keep moving as they were (as they do in TypeScript).
    if (this.kept) this.pullVelocities();
    this.nodes = nodes;
    this.links = links;
    if (this.native) this.pushGraph();
    if (this.kept) this.loadState();
    const count = new Array<number>(nodes.length).fill(0);
    for (const l of links) {
      count[l.source]++;
      count[l.target]++;
    }
    const m = links.length;
    this.linkSource = new Int32Array(m);
    this.linkTarget = new Int32Array(m);
    this.linkStrength = new Float64Array(m);
    this.linkBias = new Float64Array(m);
    links.forEach((l, i) => {
      this.linkSource[i] = l.source;
      this.linkTarget[i] = l.target;
      this.linkStrength[i] = 1 / Math.max(1, Math.min(count[l.source], count[l.target]));
      this.linkBias[i] = count[l.source] / Math.max(1, count[l.source] + count[l.target]);
    });
  }

  setConfig(config: Partial<ForceConfig>) {
    this.config = { ...this.config, ...config };
    this.pushConfig();
  }

  /** Hands the links and groups to the Rust layout (groups as indices). */
  private pushGraph() {
    const nodes = this.nodes;
    const links = new Uint32Array(this.links.length * 2);
    this.links.forEach((l, i) => {
      links[i * 2] = l.source;
      links[i * 2 + 1] = l.target;
    });
    const groups = new Int32Array(nodes.length);
    const index = new Map<string, number>();
    nodes.forEach((n, i) => {
      if (n.group === null) return (groups[i] = -1);
      let g = index.get(n.group);
      if (g === undefined) index.set(n.group, (g = index.size));
      groups[i] = g;
    });
    this.native!.setGraph(nodes.length, new Uint8Array(links.buffer), new Uint8Array(groups.buffer));
  }

  /**
   * Node i's position, pin or radius was changed in JS since the last tick (a drag, a pin): with the Rust
   * layout keeping the state, it goes over before the next tick. Nothing to do in TypeScript.
   */
  changed(i: number) {
    if (!this.kept) return;
    this.sync();
    this.pending.add(i);
    this.positions = null;
  }

  /**
   * Every node may have changed in JS since the last tick (a layout jumped or tweened them, their radii
   * changed). With `resetVelocity` their velocities start over at 0, as when the engine zeroes `vx`/`vy`.
   */
  changedAll(resetVelocity = false) {
    if (!this.kept) return;
    this.sync();
    this.pendingAll = resetVelocity ? 2 : Math.max(this.pendingAll, 1) as 1 | 2;
    this.positions = null;
  }

  /** Gives the nodes the positions of ticks run with `sync` false. */
  sync() {
    if (!this.unsynced || !this.lastRun) return;
    this.unsynced = false;
    this.readRun(this.lastRun);
  }

  /** The whole state to the Rust layout, after `setGraph`. */
  private loadState() {
    // `var`s in the copying loops, for QuickJS: see the note in quadtree.ts.
    var nodes = this.nodes, n = nodes.length, i = 0, b = 0, node: SimNode;
    var s = new Float64Array(n * 7);
    for (i = 0; i < n; i++) {
      node = nodes[i];
      b = i * 7;
      s[b] = node.x;
      s[b + 1] = node.y;
      s[b + 2] = node.vx;
      s[b + 3] = node.vy;
      s[b + 4] = node.fx ?? NaN;
      s[b + 5] = node.fy ?? NaN;
      s[b + 6] = node.r;
    }
    this.native!.load!(new Uint8Array(s.buffer));
    this.pendingAll = 0;
    this.pending.clear();
    this.lastRun = null;
    this.unsynced = false;
    this.positions = null;
  }

  /** The velocities Rust kept, onto the nodes it has (before `setGraph` replaces them). */
  private pullVelocities() {
    this.sync();
    var nodes = this.nodes, n = nodes.length, i = 0;
    if (n === 0 || !this.native!.velocities) return;
    const bytes = this.native!.velocities();
    if (bytes.byteLength < n * 16) return;
    var v = f64View(bytes, n * 2);
    for (i = 0; i < n; i++) {
      nodes[i].vx = v[i * 2];
      nodes[i].vy = v[i * 2 + 1];
    }
  }

  /** What JS changed since the last tick, to the Rust layout. */
  private flush() {
    var nodes = this.nodes, n = nodes.length, i = 0, b = 0, node: SimNode;
    if (this.pendingAll !== 0) {
      var s = new Float64Array(n * 5);
      for (i = 0; i < n; i++) {
        node = nodes[i];
        b = i * 5;
        s[b] = node.x;
        s[b + 1] = node.y;
        s[b + 2] = node.fx ?? NaN;
        s[b + 3] = node.fy ?? NaN;
        s[b + 4] = node.r;
      }
      this.native!.update!(new Uint8Array(s.buffer), this.pendingAll === 2 ? 1 : 0);
    } else if (this.pending.size > 0) {
      var p = new Float64Array(this.pending.size * 6);
      b = 0;
      for (const j of this.pending) {
        node = nodes[j];
        if (!node) continue;
        p[b] = j;
        p[b + 1] = node.x;
        p[b + 2] = node.y;
        p[b + 3] = node.fx ?? NaN;
        p[b + 4] = node.fy ?? NaN;
        p[b + 5] = node.r;
        b += 6;
      }
      this.native!.patch!(new Uint8Array(p.buffer, 0, b * 8));
    }
    this.pendingAll = 0;
    this.pending.clear();
  }

  /** `run`'s result onto the nodes: positions, alpha, and the pins the tick moved. */
  private readRun(bytes: Uint8Array) {
    var nodes = this.nodes, n = nodes.length, i = 0, node: SimNode;
    if (bytes.byteLength < (n * 2 + 2) * 8) throw new Error(`ForceLayout.run returned ${bytes.byteLength} bytes for ${n} nodes`);
    var out = f64View(bytes, bytes.byteLength / 8);
    for (i = 0; i < n; i++) {
      node = nodes[i];
      node.x = out[i * 2];
      node.y = out[i * 2 + 1];
    }
    this.alpha = out[n * 2];
    var moved = out[n * 2 + 1], b = n * 2 + 2;
    for (i = 0; i < moved; i++, b += 3) {
      node = nodes[out[b]];
      if (node && node.fx !== null) {
        node.fx = out[b + 1];
        node.fy = out[b + 2];
      }
    }
  }

  /** `iterations` ticks on the state the Rust layout keeps; the nodes get the positions unless `sync` is false. */
  private tickKept(iterations: number, sync: boolean) {
    if (this.unsynced && (this.pendingAll !== 0 || this.pending.size > 0)) this.sync();
    this.flush();
    const bytes = this.native!.run!(iterations, this.alpha, this.alphaTarget);
    this.lastRun = bytes;
    // The alpha is needed now (it says whether to tick again); positions can wait for `sync`.
    const n = this.nodes.length;
    if (bytes.byteLength >= (n * 2 + 1) * 8) this.alpha = f64View(bytes, n * 2 + 1)[n * 2];
    this.unsynced = true;
    if (sync) this.sync();
    this.positions = bytes;
  }

  /** `iterations` ticks in Rust: the nodes' state goes over in one buffer and comes back in another. */
  private tickNative(iterations: number) {
    // `var`s in the copying loops, for QuickJS: see the note in quadtree.ts.
    var nodes = this.nodes, n = nodes.length, i = 0, b = 0, node: SimNode;
    if (this.state.length !== n * 7) this.state = new Float64Array(n * 7);
    var s = this.state;
    for (i = 0; i < n; i++) {
      node = nodes[i];
      b = i * 7;
      s[b] = node.x;
      s[b + 1] = node.y;
      s[b + 2] = node.vx;
      s[b + 3] = node.vy;
      s[b + 4] = node.fx ?? NaN;
      s[b + 5] = node.fy ?? NaN;
      s[b + 6] = node.r;
    }
    const bytes = this.native!.tick(new Uint8Array(s.buffer), iterations, this.alpha, this.alphaTarget);
    if (bytes.byteLength < (n * 6 + 1) * 8) throw new Error(`ForceLayout.tick returned ${bytes.byteLength} bytes for ${n} nodes`);
    // A Float64Array needs its offset aligned to 8: copy when it is not.
    const aligned = bytes.byteOffset % 8 === 0 ? bytes : bytes.slice();
    var out = new Float64Array(aligned.buffer, aligned.byteOffset, n * 6 + 1);
    for (i = 0; i < n; i++) {
      node = nodes[i];
      b = i * 6;
      node.x = out[b];
      node.y = out[b + 1];
      node.vx = out[b + 2];
      node.vy = out[b + 3];
      if (node.fx !== null) {
        node.fx = out[b + 4];
        node.fy = out[b + 5];
      }
    }
    this.alpha = out[n * 6];
  }

  /** Whether another tick would still move things. */
  get running(): boolean {
    return this.alpha >= this.config.alphaMin || this.alphaTarget > 0;
  }

  /** Warms the layout back up (to at least `alpha`). */
  reheat(alpha = 1) {
    this.alpha = Math.max(this.alpha, alpha);
  }

  stop() {
    this.alpha = 0;
    this.alphaTarget = 0;
  }

  /**
   * Advances `iterations` ticks. With the Rust layout and `sync` false, the nodes keep their positions
   * until `sync()` (for loops of ticks that only look at `alpha` in between).
   */
  tick(iterations = 1, sync = true) {
    if (this.kept) return this.tickKept(iterations, sync);
    if (this.native) return this.tickNative(iterations);
    const c = this.config;
    for (let k = 0; k < iterations; k++) {
      this.alpha += (this.alphaTarget - this.alpha) * c.alphaDecay;
      if (this.nodes.length === 0) continue;
      this.applyLinks();
      this.applyCharge();
      this.applyGravity();
      if (c.groupStrength > 0) this.applyGroups();
      this.applyCollide();
      this.integrate();
    }
  }

  // The per-node and per-link loops below use `var`s, for QuickJS: see the note in quadtree.ts.

  /** Moves the nodes by their decayed velocities (pinned ones stay on their pins). */
  private integrate() {
    var nodes = this.nodes, count = nodes.length, keep = 1 - this.config.velocityDecay;
    var i = 0, x = 0, y = 0, v = 0, pin: number | null = null, n: SimNode;
    for (i = 0; i < count; i++) {
      n = nodes[i];
      pin = n.fx;
      if (pin !== null) {
        x = pin;
        n.vx = 0;
      } else {
        v = n.vx * keep;
        n.vx = v;
        x = n.x + v;
      }
      n.x = x;
      pin = n.fy;
      if (pin !== null) {
        y = pin;
        n.vy = 0;
      } else {
        v = n.vy * keep;
        n.vy = v;
        y = n.y + v;
      }
      n.y = y;
      // One bad number would spread to every node through the forces: put the node back instead.
      // (x - x is 0 for every finite x, NaN for NaN and ±Infinity: a test without a call.)
      if (x - x !== 0 || y - y !== 0) {
        n.x = (this.random() - 0.5) * 100;
        n.y = (this.random() - 0.5) * 100;
        n.vx = n.vy = 0;
        if (n.fx !== null) { n.fx = n.x; n.fy = n.y; }
      }
    }
  }

  private jiggle() {
    return (this.random() - 0.5) * 1e-6;
  }

  private applyLinks() {
    var nodes = this.nodes, alpha = this.alpha, base = this.config.linkDistance;
    var source = this.linkSource, target = this.linkTarget, strength = this.linkStrength, bias = this.linkBias;
    var count = source.length, i = 0, x = 0, y = 0, l = 0, b = 0, s: SimNode, t: SimNode;
    for (i = 0; i < count; i++) {
      s = nodes[source[i]];
      t = nodes[target[i]];
      if (s === t) continue;
      x = t.x + t.vx - s.x - s.vx || this.jiggle();
      y = t.y + t.vy - s.y - s.vy || this.jiggle();
      l = sqrt(x * x + y * y);
      l = ((l - (base + (s.r + t.r) * 0.5)) / l) * alpha * strength[i];
      x *= l;
      y *= l;
      b = bias[i];
      t.vx -= x * b;
      t.vy -= y * b;
      s.vx += x * (1 - b);
      s.vy += y * (1 - b);
    }
  }

  /**
   * The Barnes–Hut accuracy used: `theta` up to 300 nodes, coarser beyond (+0.25 per doubling, at most 1.5).
   * Far-field repulsion barely shapes a layout, and on QuickJS the many-body force is most of a tick.
   */
  effectiveTheta(): number {
    const n = this.nodes.length;
    const theta = this.config.theta;
    return n <= 300 ? theta : Math.min(Math.max(theta, 1.5), theta + 0.25 * Math.log2(n / 300));
  }

  private applyCharge() {
    const c = this.config;
    this.manyBody.apply(this.nodes, c.charge, this.effectiveTheta(), c.chargeDistanceMax, this.alpha, this.jiggler);
  }

  private applyGravity() {
    var g = this.config.gravity * this.alpha;
    if (g === 0) return;
    var nodes = this.nodes, count = nodes.length, i = 0, n: SimNode;
    for (i = 0; i < count; i++) {
      n = nodes[i];
      n.vx -= n.x * g;
      n.vy -= n.y * g;
    }
  }

  private applyGroups() {
    const sums = new Map<string, { x: number; y: number; n: number }>();
    for (const n of this.nodes) {
      if (n.group === null) continue;
      let s = sums.get(n.group);
      if (!s) sums.set(n.group, (s = { x: 0, y: 0, n: 0 }));
      s.x += n.x;
      s.y += n.y;
      s.n++;
    }
    const k = this.config.groupStrength * this.alpha;
    for (const n of this.nodes) {
      if (n.group === null) continue;
      const s = sums.get(n.group)!;
      if (s.n < 2) continue;
      n.vx += (s.x / s.n - n.x) * k;
      n.vy += (s.y / s.n - n.y) * k;
    }
  }

  private applyCollide() {
    this.collider.apply(this.nodes, this.config.collidePadding, 0.7, this.jiggler);
  }
}

/** Where the i-th node without a position starts: d3's phyllotaxis spiral around `(cx, cy)`. */
export function phyllotaxis(i: number, cx = 0, cy = 0, spacing = 10): { x: number; y: number } {
  const radius = spacing * Math.sqrt(0.5 + i);
  const angle = i * Math.PI * (3 - Math.sqrt(5));
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

/** The first `count` f64 of a buffer from Rust (copied when its offset is not a multiple of 8, as a Float64Array needs). */
function f64View(bytes: Uint8Array, count: number): Float64Array {
  const aligned = bytes.byteOffset % 8 === 0 ? bytes : bytes.slice();
  return new Float64Array(aligned.buffer, aligned.byteOffset, count);
}
