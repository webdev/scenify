import sharp from "sharp";

export interface ColorSwatch {
  hex: string;
  rgb: [number, number, number];
  /** Fraction of sampled pixels in this bucket, 0..1. */
  population: number;
  /** Coarse human label like "medium blue" / "dark gray" — for the prompt. */
  label: string;
}

export interface PaletteComparison {
  maxDeltaE: number;
  avgDeltaE: number;
  matched: Array<{
    source: ColorSwatch;
    closestOutput: ColorSwatch;
    deltaE: number;
  }>;
}

/** Drift severity buckets. CIE76 deltas. */
export function classifyDelta(deltaE: number): "ok" | "drift" | "severe" {
  if (deltaE < 12) return "ok"; // imperceptible-to-minor
  if (deltaE < 25) return "drift"; // visible drift
  return "severe"; // wrong color
}

/**
 * Extract the top-N dominant colors from the central region of an image.
 * Returns swatches sorted by population desc, with HEX, RGB, and a coarse label.
 *
 * Strategy: crop to center 70% (biases toward subject, away from frame edges),
 * downsample to 64×64, bucket pixels into a 4-bit-per-channel histogram (4096
 * total buckets), sort by population, return top N with mid-bucket reconstructed
 * RGB. ~30–80ms on a typical product photo. No external deps beyond sharp.
 */
export async function extractDominantColors(
  buffer: Buffer,
  n: number = 4,
): Promise<ColorSwatch[]> {
  const meta = await sharp(buffer).metadata();
  const W = meta.width ?? 1024;
  const H = meta.height ?? 1024;
  const cropW = Math.round(W * 0.7);
  const cropH = Math.round(H * 0.7);
  const left = Math.round((W - cropW) / 2);
  const top = Math.round((H - cropH) / 2);

  const { data, info } = await sharp(buffer)
    .extract({ left, top, width: cropW, height: cropH })
    .resize(64, 64, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const buckets = new Map<number, { count: number; rSum: number; gSum: number; bSum: number }>();
  const total = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cur = buckets.get(key);
    if (cur) {
      cur.count += 1;
      cur.rSum += r;
      cur.gSum += g;
      cur.bSum += b;
    } else {
      buckets.set(key, { count: 1, rSum: r, gSum: g, bSum: b });
    }
  }

  const sorted = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, n);

  return sorted.map((b) => {
    const r = Math.round(b.rSum / b.count);
    const g = Math.round(b.gSum / b.count);
    const bl = Math.round(b.bSum / b.count);
    return {
      hex: rgbToHex(r, g, bl),
      rgb: [r, g, bl] as [number, number, number],
      population: b.count / total,
      label: nameColor(r, g, bl),
    };
  });
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Crude HSL-based color naming, good enough for prompt copy. */
function nameColor(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const s = max === 0 ? 0 : (max - min) / max;

  if (s < 0.12) {
    if (v < 0.18) return "near-black";
    if (v < 0.4) return "dark gray";
    if (v < 0.65) return "medium gray";
    if (v < 0.88) return "light gray";
    return "near-white";
  }

  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) * 60;
  else if (max === g) h = (2 + (b - r) / (max - min)) * 60;
  else h = (4 + (r - g) / (max - min)) * 60;
  if (h < 0) h += 360;

  const intensity = v < 0.4 ? "dark" : v < 0.7 ? "medium" : "light";

  let hue: string;
  if (h < 15 || h >= 345) hue = "red";
  else if (h < 40) hue = "orange";
  else if (h < 65) hue = "yellow";
  else if (h < 95) hue = "yellow-green";
  else if (h < 150) hue = "green";
  else if (h < 200) hue = "teal";
  else if (h < 260) hue = "blue";
  else if (h < 290) hue = "purple";
  else hue = "magenta";

  return `${intensity} ${hue}`;
}

/* ----- Lab + Delta-E (CIE76) for palette comparison ----- */

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = [r, g, b].map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  const X = lin[0] * 0.4124564 + lin[1] * 0.3575761 + lin[2] * 0.1804375;
  const Y = lin[0] * 0.2126729 + lin[1] * 0.7151522 + lin[2] * 0.072175;
  const Z = lin[0] * 0.0193339 + lin[1] * 0.119192 + lin[2] * 0.9503041;
  const xn = 0.95047,
    yn = 1.0,
    zn = 1.08883;
  const f = (t: number) =>
    t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(X / xn);
  const fy = f(Y / yn);
  const fz = f(Z / zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE(
  rgb1: [number, number, number],
  rgb2: [number, number, number],
): number {
  const [l1, a1, b1] = rgbToLab(...rgb1);
  const [l2, a2, b2] = rgbToLab(...rgb2);
  return Math.sqrt(
    Math.pow(l1 - l2, 2) + Math.pow(a1 - a2, 2) + Math.pow(b1 - b2, 2),
  );
}

/** For each source swatch, find the closest output swatch. Returns max + avg. */
export function comparePalettes(
  source: ColorSwatch[],
  output: ColorSwatch[],
): PaletteComparison {
  if (source.length === 0 || output.length === 0) {
    return { maxDeltaE: 0, avgDeltaE: 0, matched: [] };
  }
  const matched = source.map((s) => {
    let best = output[0];
    let bestDelta = Infinity;
    for (const o of output) {
      const d = deltaE(s.rgb, o.rgb);
      if (d < bestDelta) {
        bestDelta = d;
        best = o;
      }
    }
    return { source: s, closestOutput: best, deltaE: bestDelta };
  });
  const deltas = matched.map((m) => m.deltaE);
  return {
    maxDeltaE: Math.max(...deltas),
    avgDeltaE: deltas.reduce((sum, d) => sum + d, 0) / deltas.length,
    matched,
  };
}

/** Format a palette as a single-line directive for injection into a prompt. */
export function describeForPrompt(swatches: ColorSwatch[]): string {
  return swatches
    .map((s) => {
      const pct = Math.round(s.population * 100);
      return `${s.hex} (${s.label}, ~${pct}% of frame)`;
    })
    .join(", ");
}
