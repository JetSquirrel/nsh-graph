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
  private linkStrength: number[] = [];
  private linkBias: number[] = [];
  /** The Rust layout the ticks run on, when `setNativeBackend` registered one; null runs them here. */
  private native: NativeForceLayout | null = null;
  private state = new Float64Array(0);

  /** `native` overrides the backend `setNativeBackend` registered (null: TypeScript). */
  constructor(config: Partial<ForceConfig> = {}, native: NativeBackend | null = nativeBackend()) {
    this.config = { ...DEFAULT_FORCE, ...config };
    if (native) {
      this.native = new native.ForceLayout();
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
    this.nodes = nodes;
    this.links = links;
    if (this.native) this.pushGraph();
    const count = new Array<number>(nodes.length).fill(0);
    for (const l of links) {
      count[l.source]++;
      count[l.target]++;
    }
    this.linkStrength = links.map((l) => 1 / Math.max(1, Math.min(count[l.source], count[l.target])));
    this.linkBias = links.map((l) => count[l.source] / Math.max(1, count[l.source] + count[l.target]));
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

  /** `iterations` ticks in Rust: the nodes' state goes over in one buffer and comes back in another. */
  private tickNative(iterations: number) {
    const nodes = this.nodes;
    const n = nodes.length;
    if (this.state.length !== n * 7) this.state = new Float64Array(n * 7);
    const s = this.state;
    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      const b = i * 7;
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
    const out = new Float64Array(aligned.buffer, aligned.byteOffset, n * 6 + 1);
    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      const b = i * 6;
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

  /** Advances `iterations` ticks. */
  tick(iterations = 1) {
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
      const keep = 1 - c.velocityDecay;
      for (const n of this.nodes) {
        if (n.fx !== null) {
          n.x = n.fx;
          n.vx = 0;
        } else {
          n.vx *= keep;
          n.x += n.vx;
        }
        if (n.fy !== null) {
          n.y = n.fy;
          n.vy = 0;
        } else {
          n.vy *= keep;
          n.y += n.vy;
        }
        // One bad number would spread to every node through the forces: put the node back instead.
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) {
          n.x = (this.random() - 0.5) * 100;
          n.y = (this.random() - 0.5) * 100;
          n.vx = n.vy = 0;
          if (n.fx !== null) { n.fx = n.x; n.fy = n.y; }
        }
      }
    }
  }

  private jiggle() {
    return (this.random() - 0.5) * 1e-6;
  }

  private applyLinks() {
    const { nodes, links, alpha } = this;
    const base = this.config.linkDistance;
    for (let i = 0; i < links.length; i++) {
      const s = nodes[links[i].source];
      const t = nodes[links[i].target];
      if (s === t) continue;
      let x = t.x + t.vx - s.x - s.vx || this.jiggle();
      let y = t.y + t.vy - s.y - s.vy || this.jiggle();
      let l = Math.sqrt(x * x + y * y);
      const distance = base + (s.r + t.r) * 0.5;
      l = ((l - distance) / l) * alpha * this.linkStrength[i];
      x *= l;
      y *= l;
      const b = this.linkBias[i];
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
    const g = this.config.gravity * this.alpha;
    if (g === 0) return;
    for (const n of this.nodes) {
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
