/**
 * Categorical colors.
 *
 * Eight hues in a fixed order, stepped separately for light and dark surfaces. The order was validated
 * for color-vision-deficiency separation between neighbors, so it is not cycled: a ninth category shares
 * the neutral `OTHER` color instead of getting a generated hue. A category keeps its slot for the life of
 * the assigner, so filtering the graph never repaints the categories that remain.
 */

export const PALETTE_LIGHT = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#6250d6", // violet
  "#e34948", // red
] as const;

export const PALETTE_DARK = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#0ca30c",
  "#9085e9",
  "#e66767",
] as const;

/** Categories past the end of the palette. */
export const OTHER = "#898781";

/**
 * Hands out palette slots. A key keeps its slot while it is shown, so filtering never repaints the keys
 * that remain; a slot is only reused once its key is gone and a new key needs it. When keys arrive, the
 * biggest get slots first, so what folds into the neutral color are the smallest.
 */
export class SlotAssigner {
  /** key -> slot; -1 for a key past the palette's end. */
  private slots = new Map<string, number>();
  private present: string[] = [];

  constructor(private capacity: number) {}

  /** Declares the keys now shown, biggest first, and gives slots to those without one. */
  prepare(keysBySize: string[]) {
    this.present = keysBySize;
    const shown = new Set(keysBySize);
    const taken = new Set<number>();
    for (const k of keysBySize) {
      const s = this.slots.get(k);
      if (s !== undefined && s >= 0) taken.add(s);
    }
    for (const k of keysBySize) {
      const s = this.slots.get(k);
      if (s !== undefined && s >= 0) continue;
      let free = -1;
      for (let i = 0; i < this.capacity; i++) {
        if (!taken.has(i)) {
          free = i;
          break;
        }
      }
      if (free >= 0) {
        // Whoever held it is gone: forget them.
        for (const [other, slot] of this.slots) if (slot === free && !shown.has(other)) this.slots.delete(other);
        taken.add(free);
      }
      this.slots.set(k, free);
    }
  }

  /** The slot of `key`, or -1 when the palette is used up. A key never prepared gets the next free slot. */
  slot(key: string): number {
    const s = this.slots.get(key);
    if (s !== undefined) return s;
    this.prepare([...this.present, key]);
    return this.slots.get(key)!;
  }

  setCapacity(capacity: number) {
    if (capacity !== this.capacity) {
      this.capacity = capacity;
      this.slots.clear();
      this.prepare(this.present);
    }
  }

  /** Forgets every slot (call `prepare` next). */
  reset() {
    this.slots.clear();
    this.present = [];
  }
}

/** Compares strings with their numbers by value: "Group 8" before "Group 10". */
export function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const pa = a.match(re) ?? [];
  const pb = b.match(re) ?? [];
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === y) continue;
    const nx = /^\d/.test(x);
    const ny = /^\d/.test(y);
    if (nx && ny) return Number(x) - Number(y) || x.length - y.length;
    return x < y ? -1 : 1;
  }
  return pa.length - pb.length;
}

/** Parses `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa`; null for anything else. */
export function parseHex(color: string): [number, number, number, number] | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(color.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a hex color; 0.5 when it cannot be parsed. */
export function luminance(color: string): number {
  const rgb = parseHex(color);
  if (!rgb) return 0.5;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/**
 * The ink for text inside a `fill`: white, unless near-black reads much better (yellows, pale fills).
 * White is preferred because a caption on a saturated mark reads as part of the mark; the threshold keeps
 * white on every palette hue but yellow, as the palette's design asks.
 */
export function inkOn(fill: string): string {
  const l = luminance(fill);
  // Contrast against white vs. against #0b0b0b (luminance ~0.0033).
  const onWhite = 1.05 / (l + 0.05);
  const onBlack = (l + 0.05) / 0.0533;
  return onWhite >= onBlack * 0.35 ? "#ffffff" : "#0b0b0b";
}

/** `color` at `alpha` (0..1), for hex colors; other colors are returned unchanged. */
export function withAlpha(color: string, alpha: number): string {
  const rgb = parseHex(color);
  if (!rgb) return color;
  const a = Math.max(0, Math.min(1, rgb[3] * alpha));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a.toFixed(3)})`;
}
