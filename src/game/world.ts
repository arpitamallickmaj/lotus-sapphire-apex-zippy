import * as THREE from "three";
import { CELL, HALF, PLOT, ROAD, WORLD, type Aabb, type Footprint } from "./types";
import { makeGroundTexture, makeSignTexture, makeWaterNormal } from "./textures";
import { makeTree } from "./models";

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type WorldData = {
  group: THREE.Group;
  colliders: Aabb[];
  // Horizontal surfaces the player can stand ON (stair treads, rooftops) —
  // separate from `colliders`, which are obstacles walked AROUND. A stair
  // tread and a wall both start as an AABB, but they need opposite
  // treatment: one blocks horizontal movement, the other supports vertical
  // resting height.
  walkSurfaces: Aabb[];
  footprints: Footprint[];
  waypoints: { x: number; z: number }[];
  spawns: { x: number; z: number }[];
  carSpawns: { x: number; z: number; yaw: number }[];
  crates: { x: number; z: number; kind: "ammo" | "bomb" }[];
  shops: { x: number; z: number }[];
  sky: THREE.Mesh;
  sun: THREE.DirectionalLight;
  dispose: () => void;
};

// Given the player's XZ position and current Y, finds the highest walkable
// surface at or below their feet (with a small tolerance so climbing up
// onto the next stair tread doesn't require an exact frame-perfect jump)
// and returns the height they should rest on — 0 (street level) if nothing
// under them qualifies. This is what makes stairs and rooftops actually
// standable, instead of the player always resting on a single flat y=0
// plane regardless of what's underneath them.
export function groundHeightAt(x: number, z: number, currentY: number, surfaces: Aabb[]): number {
  let best = 0;
  for (const s of surfaces) {
    if (x < s.minx || x > s.maxx || z < s.minz || z > s.maxz) continue;
    // Only "land" on a surface that's near-or-below current foot height
    // (plus a forgiving step-up tolerance) — otherwise the player would
    // snap up onto a rooftop the instant they walked underneath it.
    if (s.maxy > currentY + 0.55) continue;
    if (s.maxy > best) best = s.maxy;
  }
  return best;
}

export function resolveCircle(x: number, z: number, r: number, boxes: Aabb[]): { x: number; z: number } {
  for (const b of boxes) {
    const cx = Math.max(b.minx, Math.min(x, b.maxx));
    const cz = Math.max(b.minz, Math.min(z, b.maxz));
    const dx = x - cx;
    const dz = z - cz;
    const d2 = dx * dx + dz * dz;
    const minD2 = 1e-6;
    if (d2 >= r * r) continue;
    if (d2 < minD2) {
      // The center point is at (or extremely near) the clamped point, which
      // means it's fully inside this box's footprint rather than just
      // overlapping its edge — dx/dz give no useful push direction here.
      // Push out along whichever axis has the least distance to an edge,
      // toward the nearer face, so the player (and critically, the on-foot
      // camera, which sits at the player's exact x/z) never ends up stuck
      // inside solid geometry looking at its unlit inside faces — which
      // reads as a blank world since backface-culled interior walls render
      // as nothing.
      const distToMinX = x - b.minx;
      const distToMaxX = b.maxx - x;
      const distToMinZ = z - b.minz;
      const distToMaxZ = b.maxz - z;
      const min = Math.min(distToMinX, distToMaxX, distToMinZ, distToMaxZ);
      if (min === distToMinX) x = b.minx - r;
      else if (min === distToMaxX) x = b.maxx + r;
      else if (min === distToMinZ) z = b.minz - r;
      else z = b.maxz + r;
      continue;
    }
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    x += dx * k;
    z += dz * k;
  }
  const lim = HALF - 4;
  // Belt-and-suspenders: if x/z ever became non-finite despite the guard
  // above (or from some other source entirely), never hand back a broken
  // position — clamping Infinity/NaN through Math.min/Math.max does not
  // reliably produce a finite result, so check explicitly.
  if (!Number.isFinite(x)) x = 0;
  if (!Number.isFinite(z)) z = 0;
  x = Math.max(-lim, Math.min(lim, x));
  z = Math.max(-lim, Math.min(lim, z));
  return { x, z };
}

// Pushes two overlapping circles directly apart along the line between
// their centers, splitting the correction evenly unless one side is given
// more "weight" (heavier things move less) — used so people, cars, and
// other characters actually collide with each other instead of passing
// through, the way they already do against buildings via resolveCircle.
export function separateCircles(
  ax: number,
  az: number,
  ar: number,
  aWeight: number,
  bx: number,
  bz: number,
  br: number,
  bWeight: number,
): { ax: number; az: number; bx: number; bz: number } {
  const dx = ax - bx;
  const dz = az - bz;
  const d2 = dx * dx + dz * dz;
  const minDist = ar + br;
  if (d2 >= minDist * minDist) return { ax, az, bx, bz };
  const d = Math.sqrt(d2);
  // Two entities spawned (or pushed) to the exact same point have no
  // meaningful separation direction — nudge them apart along a fixed axis
  // rather than dividing by zero.
  const nx = d > 1e-4 ? dx / d : 1;
  const nz = d > 1e-4 ? dz / d : 0;
  const overlap = minDist - d;
  const totalWeight = aWeight + bWeight;
  const aShare = totalWeight > 0 ? bWeight / totalWeight : 0.5;
  const bShare = totalWeight > 0 ? aWeight / totalWeight : 0.5;
  return {
    ax: ax + nx * overlap * aShare,
    az: az + nz * overlap * aShare,
    bx: bx - nx * overlap * bShare,
    bz: bz - nz * overlap * bShare,
  };
}

export function rayAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  max: number,
  boxes: Aabb[],
): number {
  let hit = max;
  for (const b of boxes) {
    const t1 = (b.minx - ox) / (dx || 1e-8);
    const t2 = (b.maxx - ox) / (dx || 1e-8);
    const t3 = (b.miny - oy) / (dy || 1e-8);
    const t4 = (b.maxy - oy) / (dy || 1e-8);
    const t5 = (b.minz - oz) / (dz || 1e-8);
    const t6 = (b.maxz - oz) / (dz || 1e-8);
    const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4), Math.min(t5, t6));
    const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4), Math.max(t5, t6));
    if (tmax >= Math.max(0, tmin) && tmin < hit && tmin > 0) hit = tmin;
  }
  return hit;
}

function buildingMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: 0x8a8680,
    roughness: 0.78,
    metalness: 0.0,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWp;
        varying vec3 vWn;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vWp = worldPosition.xyz;
        vWn = normalize(mat3(modelMatrix) * normal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vWp;
        varying vec3 vWn;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        // Shared window-grid mask, computed once and reused for color,
        // emissive glow, AND roughness/metalness — previously each of
        // those recomputed the same grid separately (and roughness wasn't
        // touched at all), so glass panes looked exactly as matte as the
        // concrete around them instead of reading as reflective curtain
        // wall like the reference towers.
        float winMask, winLitMask, winBrightMask;
        void computeWindowMask(vec3 wn, vec3 wp) {
          vec3 n = abs(normalize(wn));
          float h = wp.y;
          float wx = n.x > n.z ? wp.z : wp.x;
          float fx = fract(wx * 0.34);
          float fy = fract(h * 0.31);
          vec2 cellId = floor(vec2(wx * 0.34, h * 0.31));
          float id = hash(cellId);
          winMask = step(0.22, fx) * step(fx, 0.78) * step(0.28, fy) * step(fy, 0.82) * step(2.2, h);
          winLitMask = step(0.55, id);
          winBrightMask = 0.55 + hash(cellId + 4.7) * 0.7;
        }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        computeWindowMask(vWn, vWp);
        float win = winMask;
        float lit = winLitMask;
        float winBrightness = winBrightMask;
        float h = vWp.y;
        // Unlit glass still reflects a bit of cool sky tint rather than
        // going pure black.
        vec3 frame = vec3(0.16, 0.155, 0.15);
        vec3 darkw = vec3(0.05, 0.065, 0.09);
        vec3 glow = vec3(1.0, 0.78, 0.45) * winBrightness;
        vec3 windowCol = mix(darkw, glow, lit);
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(frame, windowCol, win), 0.92 * win);
        // Horizontal floor-band trim: a subtly darker strip every few
        // "floors" so the facade reads as stacked stories rather than one
        // continuous slab, independent of the window grid itself.
        float floorBand = step(0.94, fract(h * 0.31 * 0.5));
        diffuseColor.rgb *= mix(1.0, 0.85, floorBand * (1.0 - win));
        `,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `float roughnessFactor = roughness;
        // Glass panes read as glossy/reflective; the concrete frame around
        // them stays matte — this contrast (missing before) is most of
        // what makes a curtain-wall tower look like glass instead of a
        // painted grid on stone.
        roughnessFactor = mix(roughnessFactor, 0.12, winMask);`,
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `float metalnessFactor = metalness;
        metalnessFactor = mix(metalnessFactor, 0.75, winMask);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.74, 0.4) * winMask * winLitMask * winBrightMask * 1.35;`,
      );
  };
  return m;
}

// A handful of distinct facade tones so buildings in the same block don't
// all share one flat gray — real city blocks mix concrete, brick, and
// glass-curtain towers with genuinely different base colors.
const FACADE_TONES = [0xd6432f, 0x2f6fd6, 0xf2c94c, 0x3fae6b, 0xe0e0e0, 0x8a4fe0];

function makeSky(): THREE.Mesh {
  const sunDir = new THREE.Vector3(0.48, 0.32, 0.4).normalize();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color("#152038") },
      midColor: { value: new THREE.Color("#e07a48") },
      botColor: { value: new THREE.Color("#2a241c") },
      sunDir: { value: sunDir },
    },
    vertexShader: `
      varying vec3 vW;
      void main() {
        vW = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vW;
      uniform vec3 topColor, midColor, botColor, sunDir;
      void main() {
        float h = vW.y;
        vec3 col = mix(botColor, midColor, smoothstep(-0.18, 0.1, h));
        col = mix(col, topColor, smoothstep(0.04, 0.58, h));
        float sun = pow(max(dot(normalize(vW), sunDir), 0.0), 72.0);
        float glow = pow(max(dot(normalize(vW), sunDir), 0.0), 5.0);
        col += vec3(1.0, 0.74, 0.42) * sun * 2.4;
        col += vec3(1.0, 0.42, 0.18) * glow * 0.42;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(620, 32, 20), mat);
}

// Builds a zigzag exterior stairway up one side of a building, from street
// level to its roof — alternating flight direction every run of steps with
// a landing in between, fire-escape style. Every tread and landing is
// pushed into `walkSurfaces` as a real, walkable AABB (not just visual
// geometry), which is what actually lets the player climb it via
// groundHeightAt() finding the highest surface under their feet each step.
function addExteriorStairs(
  group: THREE.Group,
  walkSurfaces: Aabb[],
  colliders: Aabb[],
  stairM: THREE.Material,
  bx: number,
  bz: number,
  bw: number,
  bd: number,
  roofH: number,
  rng: () => number,
) {
  const stairWidth = 1.4;
  const railH = 0.95;
  // Attach to either the +X (east) or -X (west) face at random, offset
  // slightly out from the wall so the ramp doesn't clip into the facade —
  // varying the side keeps every stairway from looking identically placed.
  const side = rng() > 0.5 ? 1 : -1;
  const wallX = bx + side * (bw / 2 + stairWidth / 2 + 0.15);
  const railM = stairM;
  const flightRise = Math.min(roofH, 3.2); // vertical rise per flight before a landing/turn
  const runPerRise = 1.55; // horizontal run needed for each unit of rise (slope steepness)
  let curY = 0;
  let curZ = bz - bd / 2 + 1.0;
  let dir = 1;
  let flight = 0;
  while (curY < roofH - 0.05) {
    const rise = Math.min(flightRise, roofH - curY);
    const run = rise * runPerRise;
    const startY = curY;
    const startZ = curZ;
    const endY = curY + rise;
    const endZ = curZ + dir * run;
    const midY = (startY + endY) / 2;
    const midZ = (startZ + endZ) / 2;
    const slopeLen = Math.hypot(run, rise);
    const angle = Math.atan2(rise, run) * (dir > 0 ? 1 : -1);

    // One continuous solid ramp slab per flight — a real sloped surface,
    // not a row of separate stepped platforms with gaps between them. The
    // visible mesh is a single rotated box running the full length of the
    // flight, so it reads as a real ramp/staircase with no seams to fall
    // through.
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(stairWidth, 0.14, slopeLen + 0.3), stairM);
    ramp.position.set(wallX, midY, midZ);
    ramp.rotation.x = -angle;
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    group.add(ramp);

    // Thin stand-in walk surfaces sampled along the ramp's length, each
    // overlapping generously with its neighbors, so groundHeightAt() always
    // finds solid ground directly under the player's feet at any point
    // along the slope — this is what actually closes the "gap between
    // steps" problem, since there is no gap: consecutive samples cover
    // more than their own span.
    const samples = Math.max(6, Math.ceil(slopeLen / 0.35));
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const sy = startY + (endY - startY) * t;
      const sz = startZ + (endZ - startZ) * t;
      const half = (slopeLen / samples) * 0.9; // overlap neighboring samples
      walkSurfaces.push({
        minx: wallX - stairWidth / 2,
        maxx: wallX + stairWidth / 2,
        miny: sy - 0.12,
        maxy: sy + 0.1,
        minz: sz - half,
        maxz: sz + half,
      });
    }

    // Solid guard rails down BOTH sides of the ramp, running its full
    // length as real colliders (not just a decorative bar with gaps) —
    // this is what stops stepping off either edge and falling.
    for (const railSide of [1, -1] as const) {
      const railX = wallX + railSide * (stairWidth / 2 + 0.03);
      colliders.push({
        minx: railX - 0.07,
        maxx: railX + 0.07,
        miny: Math.min(startY, endY) - 0.15,
        maxy: Math.max(startY, endY) + railH,
        minz: Math.min(startZ, endZ) - 0.2,
        maxz: Math.max(startZ, endZ) + 0.2,
      });
      // Visual rail: a run of angled posts + a top handrail bar along the
      // slope, matching the ramp's own angle.
      const railBar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, slopeLen), railM);
      railBar.position.set(railX, midY + railH, midZ);
      railBar.rotation.x = -angle;
      group.add(railBar);
      const postCount = Math.max(2, Math.round(slopeLen / 0.9));
      for (let i = 0; i <= postCount; i++) {
        const t = i / postCount;
        const py = startY + (endY - startY) * t;
        const pz = startZ + (endZ - startZ) * t;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, railH, 0.05), railM);
        post.position.set(railX, py + railH / 2, pz);
        group.add(post);
      }
    }

    // Landing between flights, wide enough to stand on and turn.
    const landing = new THREE.Mesh(new THREE.BoxGeometry(stairWidth, 0.12, stairWidth), stairM);
    landing.position.set(wallX, endY, endZ + dir * stairWidth * 0.5);
    landing.receiveShadow = true;
    group.add(landing);
    walkSurfaces.push({
      minx: wallX - stairWidth / 2,
      maxx: wallX + stairWidth / 2,
      miny: endY - 0.12,
      maxy: endY + 0.1,
      minz: endZ + dir * stairWidth * 0.5 - stairWidth * 0.75,
      maxz: endZ + dir * stairWidth * 0.5 + stairWidth * 0.75,
    });
    // Guard rail around the landing's outer (open) edge.
    const landingRailX = wallX + (stairWidth / 2 + 0.03);
    colliders.push({
      minx: landingRailX - 0.07,
      maxx: landingRailX + 0.07,
      miny: endY - 0.15,
      maxy: endY + railH,
      minz: endZ + dir * stairWidth * 0.5 - stairWidth * 0.75,
      maxz: endZ + dir * stairWidth * 0.5 + stairWidth * 0.75,
    });

    curY = endY;
    curZ = endZ + dir * stairWidth;
    dir *= -1;
    flight++;
    if (flight > 12) break; // safety guard against pathological heights
  }
}

export function buildWorld(scene: THREE.Scene): WorldData {
  const rng = mulberry32(0x51d6fa11);
  const group = new THREE.Group();
  const colliders: Aabb[] = [];
  const walkSurfaces: Aabb[] = [];
  const footprints: Footprint[] = [];
  const waypoints: { x: number; z: number }[] = [];
  const spawns: { x: number; z: number }[] = [];
  const carSpawns: { x: number; z: number; yaw: number }[] = [];
  const crates: { x: number; z: number; kind: "ammo" | "bomb" }[] = [];
  const shops: { x: number; z: number }[] = [];
  const disposables: { dispose: () => void }[] = [];

  const groundTex = makeGroundTexture();
  groundTex.wrapS = groundTex.wrapT = THREE.ClampToEdgeWrapping;
  disposables.push(groundTex);
  const groundMat = new THREE.MeshStandardMaterial({
    map: groundTex,
    roughness: 0.92,
    metalness: 0.04,
    color: 0xffffff,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD + 40, WORLD + 40), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const waterN = makeWaterNormal();
  waterN.wrapS = waterN.wrapT = THREE.RepeatWrapping;
  waterN.repeat.set(8, 8);
  disposables.push(waterN);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1a3344,
    metalness: 0.86,
    roughness: 0.18,
    envMapIntensity: 1.2,
    normalMap: waterN,
    normalScale: new THREE.Vector2(0.4, 0.4),
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(900, 220), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.4, HALF + 90);
  group.add(water);

  const dock = new THREE.Mesh(
    new THREE.BoxGeometry(WORLD + 8, 1.2, 18),
    new THREE.MeshStandardMaterial({ color: 0x3a3936, roughness: 0.9 }),
  );
  dock.position.set(0, 0.2, HALF - 4);
  dock.receiveShadow = true;
  group.add(dock);

  // A small shared palette of facade materials (not one-per-building) so we
  // get real color variety across the skyline without compiling a unique
  // shader program per building.
  const bMats = FACADE_TONES.map((tone) => {
    const bm = buildingMaterial();
    bm.color.setHex(tone);
    disposables.push(bm);
    return bm;
  });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.7, metalness: 0.2 });
  disposables.push(roofMat);

  // Street-level detail materials: raised curb, storefront awnings, and
  // ground-floor signage — none of this existed before; the ground texture
  // only drew flat road markings, with no actual curb geometry, awnings,
  // or shop signs anywhere in the city.
  const curbM = new THREE.MeshStandardMaterial({ color: 0xc8c4b6, roughness: 0.85 });
  disposables.push(curbM);
  const curbStripeM = new THREE.MeshStandardMaterial({ color: 0xb5352a, roughness: 0.75 });
  disposables.push(curbStripeM);
  const stairM = new THREE.MeshStandardMaterial({ color: 0x4a4d54, roughness: 0.6, metalness: 0.5 });
  disposables.push(stairM);
  const awningColors = [0xd6432f, 0x2f6fd6, 0xf2c94c, 0x3fae6b, 0xe0e0e0];
  const awningMats = awningColors.map((c) => {
    const am = new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, side: THREE.DoubleSide });
    disposables.push(am);
    return am;
  });
  const storeSignTex = [
    makeSignTexture(["Shop"], { bg: "#b5352a", fg: "#f2efe4", width: 256, height: 128 }),
    makeSignTexture(["Groceries"], { bg: "#2f6fd6", fg: "#f2efe4", width: 256, height: 128 }),
    makeSignTexture(["24/7", "Market"], { bg: "#2f8f4e", fg: "#f2efe4", width: 256, height: 128 }),
    makeSignTexture(["Cafe"], { bg: "#c47a1f", fg: "#f2efe4", width: 256, height: 128 }),
  ];
  const storeSignMats = storeSignTex.map((t) => {
    disposables.push(t);
    const sm = new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 });
    disposables.push(sm);
    return sm;
  });

  // Tracks the tallest generated building so a "SAPPHIRE CITY"-style
  // nameplate banner (matching the reference skyline shots) can be applied
  // to it once generation finishes, instead of every tower looking
  // anonymous.
  let tallest = { h: 0, x: 0, z: 0, w: 0, d: 0 };

  const lampM = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.5, metalness: 0.4 });
  const bulbM = new THREE.MeshStandardMaterial({
    color: 0xffe6b0,
    emissive: 0xffc978,
    emissiveIntensity: 2.2,
    roughness: 0.4,
  });
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 5.2, 6);
  const bulbGeo = new THREE.SphereGeometry(0.18, 8, 8);
  const lampGroup = new THREE.Group();

  for (let ix = -4; ix <= 4; ix++) {
    for (let iz = -4; iz <= 4; iz++) {
      waypoints.push({ x: ix * CELL, z: iz * CELL });
    }
  }

  for (let ix = -4; ix <= 3; ix++) {
    for (let iz = -4; iz <= 3; iz++) {
      const cx = (ix + 0.5) * CELL;
      const cz = (iz + 0.5) * CELL;
      const plaza = Math.abs(cx) < 42 && Math.abs(cz) < 42;
      const park = !plaza && (ix * 13 + iz * 7 + 3) % 5 === 0;
      const waterfront = cz > HALF - CELL * 1.2;

      // Raised sidewalk curb around every block's street-facing edge, with
      // a red-and-white painted stripe on the road-facing lip — matching
      // the curb detail visible in the reference street shots. Previously
      // the sidewalk was just flat ground texture with no actual raised
      // geometry or curb paint anywhere.
      const curbOuter = PLOT / 2 + 0.9;
      const curbInner = PLOT / 2;
      const curbH = 0.16;
      const curbRing = new THREE.Group();
      const curbSegN = new THREE.Mesh(new THREE.BoxGeometry(curbOuter * 2, curbH, curbOuter - curbInner), curbM);
      curbSegN.position.set(cx, curbH / 2, cz - (curbOuter + curbInner) / 2);
      curbRing.add(curbSegN);
      const curbSegS = curbSegN.clone();
      curbSegS.position.z = cz + (curbOuter + curbInner) / 2;
      curbRing.add(curbSegS);
      const curbSegE = new THREE.Mesh(new THREE.BoxGeometry(curbOuter - curbInner, curbH, curbInner * 2), curbM);
      curbSegE.position.set(cx + (curbOuter + curbInner) / 2, curbH / 2, cz);
      curbRing.add(curbSegE);
      const curbSegW = curbSegE.clone();
      curbSegW.position.x = cx - (curbOuter + curbInner) / 2;
      curbRing.add(curbSegW);
      for (const seg of [curbSegN, curbSegS, curbSegE, curbSegW]) seg.receiveShadow = true;
      const stripeH = 0.02;
      const stripeN = new THREE.Mesh(new THREE.BoxGeometry(curbOuter * 2, stripeH, 0.12), curbStripeM);
      stripeN.position.set(cx, curbH + 0.001, cz - curbInner - 0.06);
      curbRing.add(stripeN);
      const stripeS = stripeN.clone();
      stripeS.position.z = cz + curbInner + 0.06;
      curbRing.add(stripeS);
      group.add(curbRing);

      if (plaza) {
        spawns.push({ x: cx, z: cz });
        const fountain = new THREE.Mesh(
          new THREE.CylinderGeometry(3.2, 3.6, 0.5, 20),
          new THREE.MeshStandardMaterial({ color: 0x6a6560, roughness: 0.4, metalness: 0.3 }),
        );
        fountain.position.set(0, 0.25, 0);
        fountain.castShadow = true;
        group.add(fountain);
        const water2 = new THREE.Mesh(
          new THREE.CylinderGeometry(2.6, 2.6, 0.12, 16),
          new THREE.MeshStandardMaterial({ color: 0x3a6a7a, metalness: 0.8, roughness: 0.15 }),
        );
        water2.position.set(0, 0.5, 0);
        group.add(water2);
        continue;
      }

      if (park) {
        const grass = new THREE.Mesh(
          new THREE.BoxGeometry(PLOT - 2, 0.08, PLOT - 2),
          new THREE.MeshStandardMaterial({ color: 0x3d4a34, roughness: 1 }),
        );
        grass.position.set(cx, 0.04, cz);
        grass.receiveShadow = true;
        group.add(grass);
        const trees = 4 + Math.floor(rng() * 4);
        for (let t = 0; t < trees; t++) {
          const tree = makeTree();
          const tx = cx + (rng() - 0.5) * (PLOT - 6);
          const tz = cz + (rng() - 0.5) * (PLOT - 6);
          tree.position.set(tx, 0, tz);
          tree.rotation.y = rng() * Math.PI * 2;
          const s = 0.85 + rng() * 0.5;
          tree.scale.setScalar(s);
          group.add(tree);
          // Trees had no collider at all before — a small trunk-sized
          // footprint (not the full canopy) so you can't walk or drive
          // straight through the trunk, scaled to match this tree's size.
          const trunkR = 0.35 * s;
          colliders.push({
            minx: tx - trunkR,
            maxx: tx + trunkR,
            miny: 0,
            maxy: 3 * s,
            minz: tz - trunkR,
            maxz: tz + trunkR,
          });
        }
        continue;
      }

      const buildings = waterfront ? 1 : 1 + Math.floor(rng() * 2);
      for (let b = 0; b < buildings; b++) {
        const w = 8 + rng() * (buildings === 1 ? 16 : 10);
        const d = 8 + rng() * (buildings === 1 ? 16 : 10);
        const h = waterfront ? 10 + rng() * 16 : 10 + rng() * 36;
        const ox = buildings === 1 ? 0 : (b === 0 ? -1 : 1) * (PLOT * 0.22);
        const oz = (rng() - 0.5) * 4;
        const x = cx + ox;
        const z = cz + oz;
        const facadeMat = bMats[Math.floor(rng() * bMats.length)];
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), facadeMat);
        mesh.position.set(x, h / 2, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        if (h > tallest.h) {
          tallest = { h, x, z, w, d };
        }
        // Parapet trim: a thin lip proud of the facade at the roofline —
        // a small detail that breaks the "box just stops" silhouette real
        // buildings avoid.
        const parapet = new THREE.Mesh(new THREE.BoxGeometry(w + 0.25, 0.5, d + 0.25), roofMat);
        parapet.position.set(x, h + 0.25, z);
        group.add(parapet);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.1, d + 0.4), roofMat);
        roof.position.set(x, h + 0.55, z);
        group.add(roof);
        // The roof itself is now a real walkable surface, not just a
        // visual cap — this is what climbing the stairs is actually
        // climbing TO.
        walkSurfaces.push({
          minx: x - w / 2 - 0.2,
          maxx: x + w / 2 + 0.2,
          miny: h + 0.5,
          maxy: h + 0.6,
          minz: z - d / 2 - 0.2,
          maxz: z + d / 2 + 0.2,
        });
        // Taller buildings get a stepped-back tower crown — an instantly
        // recognizable skyscraper silhouette cue rather than every building
        // being a plain extruded box.
        if (h > 26 && rng() > 0.4) {
          const cw = w * (0.5 + rng() * 0.2);
          const cd = d * (0.5 + rng() * 0.2);
          const ch = 3 + rng() * 6;
          const crown = new THREE.Mesh(new THREE.BoxGeometry(cw, ch, cd), facadeMat);
          crown.position.set(x, h + ch / 2 + 0.55, z);
          crown.castShadow = true;
          group.add(crown);
          const crownRoof = new THREE.Mesh(new THREE.BoxGeometry(cw + 0.3, 0.3, cd + 0.3), roofMat);
          crownRoof.position.set(x, h + ch + 0.7, z);
          group.add(crownRoof);
        } else if (h <= 30 && rng() > 0.35) {
          // Fire-escape-style exterior stairway up one side of the
          // building, zigzagging between landings — a real, climbable
          // path to the roof (each tread is a genuine walkable surface,
          // not decorative). Only on shorter/mid buildings, both because
          // a stair to a 40+ unit tower would be an enormous amount of
          // geometry and an impractically long climb, and because it
          // visually reads better on smaller buildings.
          addExteriorStairs(group, walkSurfaces, colliders, stairM, x, z, w, d, h + 0.55, rng);
        }
        if (rng() > 0.55) {
          const ac = new THREE.Mesh(
            new THREE.BoxGeometry(1.6, 1.1, 2.2),
            new THREE.MeshStandardMaterial({ color: 0x4a4e54, roughness: 0.5, metalness: 0.4 }),
          );
          ac.position.set(x + (rng() - 0.5) * w * 0.3, h + 1.1, z + (rng() - 0.5) * d * 0.3);
          group.add(ac);
        }
        // Ground-floor storefront: an awning and a shop sign on shorter
        // buildings (the ones plausibly street-level retail rather than
        // office towers) — matching the awnings and shop signage visible
        // along the street in the reference images, which the city didn't
        // have anywhere before.
        if (h < 22 && rng() > 0.35) {
          const awningMat = awningMats[Math.floor(rng() * awningMats.length)];
          const awningW = Math.min(w * 0.7, 6);
          const awning = new THREE.Mesh(new THREE.BoxGeometry(awningW, 0.12, 1.1), awningMat);
          awning.position.set(x, 3.1, z + d / 2 + 0.55);
          awning.rotation.x = -0.12;
          group.add(awning);
          const signIdx = Math.floor(rng() * storeSignMats.length);
          const signMat = storeSignMats[signIdx];
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(awningW * 0.85, 0.9), signMat);
          sign.position.set(x, 3.85, z + d / 2 + 0.03);
          group.add(sign);
          // Index 0 in storeSignTex/storeSignMats is "Shop" — that
          // storefront becomes a real, walkable-up-to purchase point,
          // recorded here for the engine to check proximity against.
          if (signIdx === 0) {
            shops.push({ x, z: z + d / 2 + 1.5 });
          }
        }
        colliders.push({
          minx: x - w / 2,
          maxx: x + w / 2,
          miny: 0,
          maxy: h,
          minz: z - d / 2,
          maxz: z + d / 2,
        });
        footprints.push({ x, z, w, d });
      }
    }
  }

  // Street lamps
  for (let ix = -4; ix <= 4; ix++) {
    for (let iz = -4; iz <= 4; iz++) {
      if ((ix + iz) % 2 !== 0) continue;
      const pole = new THREE.Mesh(poleGeo, lampM);
      const bx = ix * CELL + ROAD * 0.38;
      const bz = iz * CELL + ROAD * 0.38;
      pole.position.set(bx, 2.6, bz);
      lampGroup.add(pole);
      const bulb = new THREE.Mesh(bulbGeo, bulbM);
      bulb.position.set(bx, 5.15, bz);
      lampGroup.add(bulb);
    }
  }
  group.add(lampGroup);

  // Nameplate banner on the tallest tower, and a few street-corner banner
  // posts near the plaza — matching the branded-signage look from the
  // reference city shots, instead of every tower being a plain unlabeled
  // box.
  if (tallest.h > 0) {
    const signTex = makeSignTexture(["Sapphire", "City"], {
      bg: "#0f2a52",
      fg: "#f2efe4",
      accent: "#d4af37",
      width: 512,
      height: 320,
    });
    disposables.push(signTex);
    const signW = Math.min(tallest.w * 0.85, 14);
    const signH = signW * (320 / 512);
    const signMat = new THREE.MeshStandardMaterial({
      map: signTex,
      roughness: 0.6,
      metalness: 0.1,
      emissiveMap: signTex,
      emissive: 0xffffff,
      emissiveIntensity: 0.35,
    });
    disposables.push(signMat);
    for (const faceYaw of [0, Math.PI]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(signW, signH), signMat);
      const off = tallest.d / 2 + 0.05;
      sign.position.set(
        tallest.x + Math.sin(faceYaw) * off,
        tallest.h * 0.82,
        tallest.z + Math.cos(faceYaw) * off,
      );
      sign.rotation.y = faceYaw;
      group.add(sign);
    }
  }

  const bannerTex = makeSignTexture(["Sapphire City"], {
    bg: "#12213a",
    fg: "#f2efe4",
    accent: "#d4af37",
    width: 384,
    height: 640,
  });
  disposables.push(bannerTex);
  const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.75, side: THREE.DoubleSide });
  disposables.push(bannerMat);
  const bannerPoleGeo = new THREE.CylinderGeometry(0.05, 0.06, 4.6, 6);
  const bannerPoleM = new THREE.MeshStandardMaterial({ color: 0x2c2d32, roughness: 0.8 });
  disposables.push(bannerPoleM);
  for (const [bx, bz] of [
    [50, 50],
    [-50, 50],
    [50, -50],
    [-50, -50],
  ] as const) {
    const pole = new THREE.Mesh(bannerPoleGeo, bannerPoleM);
    pole.position.set(bx, 2.3, bz);
    group.add(pole);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.6), bannerMat);
    banner.position.set(bx, 3.4, bz);
    banner.rotation.y = Math.atan2(-bx, -bz);
    group.add(banner);
  }

  // World rim walls so you feel the district edge
  const wallM = new THREE.MeshStandardMaterial({ color: 0x2c2d32, roughness: 0.8 });
  const wallH = 6;
  const north = new THREE.Mesh(new THREE.BoxGeometry(WORLD + 8, wallH, 2.4), wallM);
  north.position.set(0, wallH / 2, -HALF - 1);
  group.add(north);
  colliders.push({ minx: -HALF - 4, maxx: HALF + 4, miny: 0, maxy: wallH, minz: -HALF - 2.2, maxz: -HALF + 0.2 });
  const west = new THREE.Mesh(new THREE.BoxGeometry(2.4, wallH, WORLD), wallM);
  west.position.set(-HALF - 1, wallH / 2, 0);
  group.add(west);
  colliders.push({ minx: -HALF - 2.2, maxx: -HALF + 0.2, miny: 0, maxy: wallH, minz: -HALF, maxz: HALF });
  const east = new THREE.Mesh(new THREE.BoxGeometry(2.4, wallH, WORLD), wallM);
  east.position.set(HALF + 1, wallH / 2, 0);
  group.add(east);
  colliders.push({ minx: HALF - 0.2, maxx: HALF + 2.2, miny: 0, maxy: wallH, minz: -HALF, maxz: HALF });

  // Car spawns along plaza ring and a few streets
  const carPts: { x: number; z: number; yaw: number }[] = [
    { x: 3.6, z: 11.2, yaw: 0.12 },
    { x: -11, z: 6, yaw: Math.PI * 0.6 },
    { x: 14, z: -8, yaw: -0.4 },
    { x: -6, z: -14, yaw: Math.PI },
    { x: 56, z: 4, yaw: Math.PI / 2 },
    { x: -56, z: -8, yaw: -Math.PI / 2 },
    { x: 4, z: 56, yaw: 0 },
    { x: -10, z: -56, yaw: Math.PI },
    { x: 112, z: 0, yaw: Math.PI / 2 },
    { x: 0, z: 112, yaw: 0.1 },
    // Extra spawns reaching toward the enlarged city's outer blocks, so
    // traffic and parked cars populate the whole map instead of only the
    // original, smaller core.
    { x: 168, z: 30, yaw: Math.PI / 2 },
    { x: -168, z: -30, yaw: -Math.PI / 2 },
    { x: 30, z: 168, yaw: 0.2 },
    { x: -30, z: -168, yaw: Math.PI + 0.2 },
    { x: 168, z: -168, yaw: Math.PI * 0.75 },
    { x: -168, z: 168, yaw: -Math.PI * 0.25 },
    { x: 224, z: 0, yaw: Math.PI / 2 },
    { x: -224, z: 0, yaw: -Math.PI / 2 },
  ];
  carSpawns.push(...carPts);

  crates.push(
    { x: 4.5, z: -3.5, kind: "ammo" },
    { x: -18, z: 22, kind: "ammo" },
    { x: 70, z: -20, kind: "ammo" },
    { x: -64, z: 48, kind: "bomb" },
    { x: 22, z: 80, kind: "bomb" },
    { x: -30, z: -70, kind: "ammo" },
  );

  for (const wp of waypoints) {
    if (Math.hypot(wp.x, wp.z) > 30) spawns.push({ x: wp.x + 4, z: wp.z + 3 });
  }

  const sky = makeSky();
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xb8c8e0, 0x4a4034, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc898, 3.2);
  sun.position.set(90, 70, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 320;
  sun.shadow.camera.left = -160;
  sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 160;
  sun.shadow.camera.bottom = -160;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x6a7aaa, 0.28);
  fill.position.set(-40, 30, -20);
  scene.add(fill);

  const ambLamps: THREE.PointLight[] = [];
  const lampPositions = [
    [18, 5.2, 18],
    [-18, 5.2, 18],
    [18, 5.2, -18],
    [-18, 5.2, -18],
  ];
  for (const p of lampPositions) {
    const l = new THREE.PointLight(0xffc070, 8, 28, 2);
    l.position.set(p[0], p[1], p[2]);
    scene.add(l);
    ambLamps.push(l);
  }

  scene.add(group);
  scene.fog = new THREE.FogExp2(0x8a6a58, 0.00135);
  scene.background = new THREE.Color(0x0b1220);

  const dispose = () => {
    scene.remove(group, sky, hemi, sun, fill);
    for (const l of ambLamps) scene.remove(l);
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mm = o.material;
        if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
        else if (mm && !bMats.includes(mm as THREE.MeshStandardMaterial) && mm !== roofMat && mm !== groundMat && mm !== waterMat)
          mm.dispose();
      }
    });
    groundMat.dispose();
    waterMat.dispose();
    roofMat.dispose();
    sky.geometry.dispose();
    (sky.material as THREE.Material).dispose();
    for (const d of disposables) d.dispose();
  };

  return { group, colliders, walkSurfaces, footprints, waypoints, spawns, carSpawns, crates, shops, sky, sun, dispose };
}
