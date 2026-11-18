/**
 * A force-directed layout in the manner of d3-force: link springs, Barnes–Hut many-body repulsion, circle
 * collision on a spatial hash, gravity toward the origin and an optional pull of each group toward its
 * centroid. Velocities decay every tick and the whole system cools with `alpha`, so it settles and stops.
 *
 * Pure TypeScript with no NSH imports: it runs (and is tested) anywhere.
 */
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

  constructor(config: Partial<ForceConfig> = {}) {
    this.config = { ...DEFAULT_FORCE, ...config };
  }

  /** Replaces the nodes and links. Node objects are used as given, so their positions carry over. */
  setGraph(nodes: SimNode[], links: SimLink[]) {
    this.nodes = nodes;
    this.links = links;
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
