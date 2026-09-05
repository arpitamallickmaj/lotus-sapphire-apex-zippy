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

    const CELL = 56 / 392;
    const ROAD = 16 / 392;
    const to = (v: number) => ((v + 196) / 392) * n;

    // grass plots
    ctx.fillStyle = "#3a4334";
    for (let ix = -3; ix <= 2; ix++) {
      for (let iz = -3; iz <= 2; iz++) {
        const cx = (ix + 0.5) * 56;
        const cz = (iz + 0.5) * 56;
        const park = (ix * 13 + iz * 7 + 3) % 5 === 0;
        const plaza = Math.abs(cx) < 40 && Math.abs(cz) < 40;
        if (!park && !plaza) continue;
        const w = 56 - 16;
        ctx.fillStyle = plaza ? "#3d3c38" : "#3a4334";
        ctx.fillRect(to(cx - w / 2), to(cz - w / 2), (w / 392) * n, (w / 392) * n);
      }
    }

    // road grid
    ctx.fillStyle = "#1c1d1b";
    for (let i = -3; i <= 3; i++) {
      const p = i * 56;
      const rw = (ROAD * n) / CELL;
      ctx.fillRect(0, to(p) - rw / 2, n, rw);
      ctx.fillRect(to(p) - rw / 2, 0, rw, n);
    }

    // lane dashes
    ctx.strokeStyle = "#c4b070";
    ctx.lineWidth = Math.max(1, n * 0.0014);
    ctx.setLineDash([n * 0.012, n * 0.016]);
    for (let i = -3; i <= 3; i++) {
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

    // edge lines
    ctx.strokeStyle = "#9a9a92";
    ctx.lineWidth = Math.max(1, n * 0.001);
    for (let i = -3; i <= 3; i++) {
      const p = to(i * 56);
      const half = (ROAD * n) / 2;
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

    void CELL;
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

export function disposeTex(t: THREE.Texture | undefined) {
  t?.dispose();
}
