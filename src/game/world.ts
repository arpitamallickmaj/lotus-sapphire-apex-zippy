import * as THREE from "three";
import { CELL, HALF, PLOT, ROAD, WORLD, type Aabb, type Footprint } from "./types";
import { makeGroundTexture, makeWaterNormal } from "./textures";
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
  footprints: Footprint[];
  waypoints: { x: number; z: number }[];
  spawns: { x: number; z: number }[];
  carSpawns: { x: number; z: number; yaw: number }[];
  crates: { x: number; z: number; kind: "ammo" | "bomb" }[];
  sky: THREE.Mesh;
  sun: THREE.DirectionalLight;
  dispose: () => void;
};

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
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 n = abs(normalize(vWn));
        float h = vWp.y;
        float wx = n.x > n.z ? vWp.z : vWp.x;
        float fx = fract(wx * 0.34);
        float fy = fract(h * 0.31);
        vec2 cellId = floor(vec2(wx * 0.34, h * 0.31));
        float id = hash(cellId);
        float win = step(0.22, fx) * step(fx, 0.78) * step(0.28, fy) * step(fy, 0.82) * step(2.2, h);
        float lit = step(0.55, id);
        // Per-window brightness variation instead of a flat binary
        // lit/unlit — real windows are never uniformly bright, so this
        // alone reads as noticeably less "grid pattern" and more "building
        // full of individually lived-in rooms".
        float winBrightness = 0.55 + hash(cellId + 4.7) * 0.7;
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
        #ifdef USE_EMISSIVEMAP
        #endif
        `,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        vec3 n2 = abs(normalize(vWn));
        float wx2 = n2.x > n2.z ? vWp.z : vWp.x;
        float fx2 = fract(wx2 * 0.34);
        float fy2 = fract(vWp.y * 0.31);
        vec2 cellId2 = floor(vec2(wx2 * 0.34, vWp.y * 0.31));
        float id2 = hash(cellId2);
        float win2 = step(0.22, fx2) * step(fx2, 0.78) * step(0.28, fy2) * step(fy2, 0.82) * step(2.2, vWp.y);
        float lit2 = step(0.62, id2);
        float winBrightness2 = 0.55 + hash(cellId2 + 4.7) * 0.7;
        totalEmissiveRadiance += vec3(1.0, 0.74, 0.4) * win2 * lit2 * winBrightness2 * 1.35;`,
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

export function buildWorld(scene: THREE.Scene): WorldData {
  const rng = mulberry32(0x51d6fa11);
  const group = new THREE.Group();
  const colliders: Aabb[] = [];
  const footprints: Footprint[] = [];
  const waypoints: { x: number; z: number }[] = [];
  const spawns: { x: number; z: number }[] = [];
  const carSpawns: { x: number; z: number; yaw: number }[] = [];
  const crates: { x: number; z: number; kind: "ammo" | "bomb" }[] = [];
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

  for (let ix = -3; ix <= 3; ix++) {
    for (let iz = -3; iz <= 3; iz++) {
      waypoints.push({ x: ix * CELL, z: iz * CELL });
    }
  }

  for (let ix = -3; ix <= 2; ix++) {
    for (let iz = -3; iz <= 2; iz++) {
      const cx = (ix + 0.5) * CELL;
      const cz = (iz + 0.5) * CELL;
      const plaza = Math.abs(cx) < 42 && Math.abs(cz) < 42;
      const park = !plaza && (ix * 13 + iz * 7 + 3) % 5 === 0;
      const waterfront = cz > HALF - CELL * 1.2;

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
          tree.position.set(cx + (rng() - 0.5) * (PLOT - 6), 0, cz + (rng() - 0.5) * (PLOT - 6));
          tree.rotation.y = rng() * Math.PI * 2;
          const s = 0.85 + rng() * 0.5;
          tree.scale.setScalar(s);
          group.add(tree);
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
        // Parapet trim: a thin lip proud of the facade at the roofline —
        // a small detail that breaks the "box just stops" silhouette real
        // buildings avoid.
        const parapet = new THREE.Mesh(new THREE.BoxGeometry(w + 0.25, 0.5, d + 0.25), roofMat);
        parapet.position.set(x, h + 0.25, z);
        group.add(parapet);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.1, d + 0.4), roofMat);
        roof.position.set(x, h + 0.55, z);
        group.add(roof);
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
        }
        if (rng() > 0.55) {
          const ac = new THREE.Mesh(
            new THREE.BoxGeometry(1.6, 1.1, 2.2),
            new THREE.MeshStandardMaterial({ color: 0x4a4e54, roughness: 0.5, metalness: 0.4 }),
          );
          ac.position.set(x + (rng() - 0.5) * w * 0.3, h + 1.1, z + (rng() - 0.5) * d * 0.3);
          group.add(ac);
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
  for (let ix = -3; ix <= 3; ix++) {
    for (let iz = -3; iz <= 3; iz++) {
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

  return { group, colliders, footprints, waypoints, spawns, carSpawns, crates, sky, sun, dispose };
}
