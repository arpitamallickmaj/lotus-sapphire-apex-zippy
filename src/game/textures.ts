import * as THREE from "three";

function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d");
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function makeGroundTexture(size = 2048): THREE.CanvasTexture {
  return canvasTex(size, (ctx, n) => {
    ctx.fillStyle = "#2a2b28";
    ctx.fillRect(0, 0, n, n);

    const WORLD = 560;
    const HALF = WORLD / 2;
    const ROAD_UNITS = 16;
    const to = (v: number) => ((v + HALF) / WORLD) * n;
    // Actual pixel width of a 16-unit-wide road on this canvas — the
    // previous formula divided two WORLD-normalized fractions by each
    // other (ROAD/CELL), which produces a fixed ~0.286 ratio independent
    // of world size rather than a real pixel width, so at this canvas
    // resolution the "road" band came out roughly 10x too wide — wide
    // enough that the crosswalk stripes and lane paint covered most of the
    // street area, reading as an almost-solid white road instead of black
    // asphalt with thin markings.
    const roadPx = (ROAD_UNITS / WORLD) * n;

    // grass plots
    ctx.fillStyle = "#3a4334";
    for (let ix = -4; ix <= 3; ix++) {
      for (let iz = -4; iz <= 3; iz++) {
        const cx = (ix + 0.5) * 56;
        const cz = (iz + 0.5) * 56;
        const park = (ix * 13 + iz * 7 + 3) % 5 === 0;
        const plaza = Math.abs(cx) < 40 && Math.abs(cz) < 40;
        if (!park && !plaza) continue;
        const w = 56 - 16;
        ctx.fillStyle = plaza ? "#3d3c38" : "#3a4334";
        ctx.fillRect(to(cx - w / 2), to(cz - w / 2), (w / WORLD) * n, (w / WORLD) * n);
      }
    }

    // road grid
    ctx.fillStyle = "#1c1d1b";
    for (let i = -4; i <= 4; i++) {
      const p = i * 56;
      ctx.fillRect(0, to(p) - roadPx / 2, n, roadPx);
      ctx.fillRect(to(p) - roadPx / 2, 0, roadPx, n);
    }

    // lane dashes
    ctx.strokeStyle = "#c4b070";
    ctx.lineWidth = Math.max(1, n * 0.0014);
    ctx.setLineDash([n * 0.012, n * 0.016]);
    for (let i = -4; i <= 4; i++) {
      const p = to(i * 56);
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(n, p);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, n);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Crosswalk stripes at every intersection, correctly sized to the
    // actual road width now instead of the old oversized band.
    ctx.fillStyle = "#d8d4c8";
    const crossW = roadPx;
    for (let ix = -4; ix <= 4; ix++) {
      for (let iz = -4; iz <= 4; iz++) {
        const cx = to(ix * 56);
        const cz = to(iz * 56);
        const half = crossW / 2;
        const stripeW = crossW * 0.09;
        const gap = crossW * 0.06;
        for (let s = -3; s <= 3; s++) {
          const off = s * (stripeW + gap);
          if (Math.abs(off) > half - stripeW) continue;
          ctx.fillRect(cx - half, cz + off - stripeW / 2, crossW, stripeW * 0.55);
          ctx.fillRect(cx + off - stripeW / 2, cz - half, stripeW * 0.55, crossW);
        }
      }
    }

    // edge lines
    ctx.strokeStyle = "#9a9a92";
    ctx.lineWidth = Math.max(1, n * 0.001);
    for (let i = -4; i <= 4; i++) {
      const p = to(i * 56);
      const half = roadPx / 2;
      ctx.beginPath();
      ctx.moveTo(0, p - half + 2);
      ctx.lineTo(n, p - half + 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p + half - 2);
      ctx.lineTo(n, p + half - 2);
      ctx.stroke();
    }

    // noise grain
    const img = ctx.getImageData(0, 0, n, n);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = (Math.random() - 0.5) * 18;
      d[i] = Math.max(0, Math.min(255, d[i] + g));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + g));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + g));
    }
    ctx.putImageData(img, 0, 0);
  });
}

export function makeWaterNormal(size = 256): THREE.CanvasTexture {
  return canvasTex(size, (ctx, n) => {
    ctx.fillStyle = "#8080ff";
    ctx.fillRect(0, 0, n, n);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.08})`;
      ctx.beginPath();
      ctx.ellipse(Math.random() * n, Math.random() * n, 20 + Math.random() * 40, 8 + Math.random() * 10, Math.random() * 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

// City banner sign: a colored background, an optional accent stripe, and
// one or two lines of real rendered text — used for the tower nameplates
// and street banners scattered through the city, instead of a plain flat
// color panel with no readable label on it.
export function makeSignTexture(
  lines: string[],
  opts: { bg?: string; fg?: string; accent?: string; width?: number; height?: number } = {},
): THREE.CanvasTexture {
  const w = opts.width ?? 512;
  const h = opts.height ?? 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d");
  ctx.fillStyle = opts.bg ?? "#12213a";
  ctx.fillRect(0, 0, w, h);
  if (opts.accent) {
    ctx.fillStyle = opts.accent;
    ctx.fillRect(0, 0, w, h * 0.07);
    ctx.fillRect(0, h * 0.93, w, h * 0.07);
  }
  ctx.fillStyle = opts.fg ?? "#f2f0e8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lineH = h / (lines.length + 1);
  lines.forEach((line, i) => {
    const fontSize = Math.floor(lineH * (i === 0 ? 0.62 : 0.42));
    ctx.font = `700 ${fontSize}px "Barlow Condensed", Arial, sans-serif`;
    ctx.fillText(line.toUpperCase(), w / 2, lineH * (i + 1));
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function disposeTex(t: THREE.Texture | undefined) {
  t?.dispose();
}
