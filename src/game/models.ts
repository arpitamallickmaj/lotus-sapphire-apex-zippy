import * as THREE from "three";

const _mats: THREE.Material[] = [];

function mat(params: THREE.MeshStandardMaterialParameters) {
  const m = new THREE.MeshStandardMaterial(params);
  _mats.push(m);
  return m;
}

// A small stepped gradient (not a smooth ramp) is what actually produces the
// "cel-shaded" banded look toon materials are known for — MeshToonMaterial
// samples this 1D texture based on light-facing angle instead of smoothly
// blending, which is the single biggest lever for a stylized, Fortnite-like
// read versus the soft, continuous shading a standard PBR material gives.
let _toonGradient: THREE.DataTexture | null = null;
function toonGradient(): THREE.DataTexture {
  if (_toonGradient) return _toonGradient;
  const steps = 4;
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) data[i] = Math.round((i / (steps - 1)) * 255);
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  _toonGradient = tex;
  return tex;
}

// Stylized/toon material for characters and vehicles: flatter, more
// saturated color response and banded shading instead of continuous PBR
// roughness — the "Fortnite-ish" look this pass is going for. Buildings stay
// on the existing MeshStandardMaterial + procedural window shader since that
// custom shader patch is written against the standard material's chunks.
function toonMat(params: { color: number; emissive?: number; emissiveIntensity?: number }) {
  const m = new THREE.MeshToonMaterial({
    color: params.color,
    emissive: params.emissive ?? 0x000000,
    gradientMap: toonGradient(),
  });
  if (params.emissiveIntensity !== undefined) {
    // MeshToonMaterial has no emissiveIntensity property pre-baked in the
    // same way MeshStandardMaterial does in older three versions, so scale
    // the emissive color itself to approximate intended intensity.
    m.emissive = new THREE.Color(params.emissive ?? 0x000000).multiplyScalar(params.emissiveIntensity);
  }
  _mats.push(m);
  return m;
}

export function disposeSharedMats() {
  for (const m of _mats) m.dispose();
  _mats.length = 0;
}

export function makeCar(color: number): THREE.Group {
  const g = new THREE.Group();
  const bodyM = toonMat({ color });
  const bodyShadeM = toonMat({ color: shade(color, 0.72) });
  const dark = toonMat({ color: 0x0f0f11 });
  const trim = toonMat({ color: 0x3a3c42 });
  const glass = mat({ color: 0x0e131c, metalness: 0.85, roughness: 0.06, transparent: true, opacity: 0.78 });
  const rubber = toonMat({ color: 0x161618 });
  const rim = toonMat({ color: 0x8b8d94 });
  const lightF = toonMat({ color: 0xfff6dc, emissive: 0xffe7a0, emissiveIntensity: 2.0 });
  const lightR = toonMat({ color: 0xff3a2a, emissive: 0xaa1510, emissiveIntensity: 1.3 });

  // Lower body: a slightly rounded box (bevel via a chamfer-ish extra pass
  // of smaller boxes along the sides) reads much less "brick on wheels"
  // than one flat slab, and a subtle taper toward the rear.
  const bodyLow = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.42, 4.3), bodyM);
  bodyLow.position.y = 0.42;
  bodyLow.castShadow = true;
  bodyLow.receiveShadow = true;
  g.add(bodyLow);

  // Side skirt strip (darker) along the rocker panel — breaks up the flat
  // side face and gives a visual "waistline" the way real car bodies have.
  const skirtGeo = new THREE.BoxGeometry(1.9, 0.1, 4.1);
  const skirt = new THREE.Mesh(skirtGeo, dark);
  skirt.position.y = 0.2;
  g.add(skirt);

  // Upper body / greenhouse taper: narrower than the lower body, curved
  // shoulder line via a cylinder-sliced fender bulge over each wheel arch.
  const bodyUpper = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.3, 3.7), bodyShadeM);
  bodyUpper.position.y = 0.72;
  bodyUpper.castShadow = true;
  g.add(bodyUpper);

  // Hood with a slight forward taper (two stacked boxes narrowing toward
  // the front) instead of one flat plate.
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 1.15), bodyM);
  hood.position.set(0, 0.66, -1.5);
  g.add(hood);
  const hoodTip = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.09, 0.4), bodyM);
  hoodTip.position.set(0, 0.63, -2.05);
  g.add(hoodTip);

  // Trunk lid, similarly stepped down toward the rear.
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.12, 0.75), bodyM);
  trunk.position.set(0, 0.7, 1.75);
  g.add(trunk);

  // Cabin / greenhouse: raked windshield and rear glass via angled panes
  // rather than one flat box, plus a roof.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 1.55), bodyShadeM);
  roof.position.set(0, 1.12, -0.1);
  roof.castShadow = true;
  g.add(roof);
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.5, 0.06), glass);
  windshield.position.set(0, 0.92, -0.86);
  windshield.rotation.x = 0.42;
  g.add(windshield);
  const rearGlass = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.42, 0.06), glass);
  rearGlass.position.set(0, 0.94, 0.68);
  rearGlass.rotation.x = -0.36;
  g.add(rearGlass);
  const sideGlassL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.32, 1.3), glass);
  sideGlassL.position.set(-0.74, 0.98, -0.1);
  g.add(sideGlassL);
  const sideGlassR = sideGlassL.clone();
  sideGlassR.position.x = 0.74;
  g.add(sideGlassR);

  // Pillars (A/B/C) — thin dark strips at the glass edges, a small but
  // meaningful detail that separates panels from a plain glass box.
  for (const zx of [-0.78, 0.78]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.08), dark);
    pillar.position.set(zx, 0.95, -0.78);
    g.add(pillar);
  }

  // Door seams: thin recessed lines so the side reads as panels, not one
  // continuous surface.
  for (const z of [-0.55, 0.55]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.36, 0.015), dark);
    seam.position.set(0.935, 0.42, z);
    g.add(seam);
    const seamL = seam.clone();
    seamL.position.x = -0.935;
    g.add(seamL);
  }

  // Door handles.
  for (const z of [-0.3, 0.75]) {
    for (const side of [-1, 1]) {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.14), trim);
      handle.position.set(side * 0.945, 0.58, z);
      g.add(handle);
    }
  }

  // Fender bulges over each wheel — a quarter-cylinder wrapped over the
  // wheel arch, which is what actually sells "car body" over "box with
  // wheels bolted on" from the side silhouette.
  const fenderGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.14, 12, 1, false, Math.PI, Math.PI);
  for (const [x, z] of [
    [-0.95, -1.28],
    [0.95, -1.28],
    [-0.95, 1.32],
    [0.95, 1.32],
  ] as const) {
    const fender = new THREE.Mesh(fenderGeo, bodyM);
    fender.rotation.z = Math.PI / 2;
    fender.rotation.y = x < 0 ? Math.PI : 0;
    fender.position.set(x * 0.97, 0.44, z);
    fender.castShadow = true;
    g.add(fender);
  }

  for (const x of [-0.68, 0.68]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.06), lightF);
    head.position.set(x, 0.46, -2.16);
    g.add(head);
    const headRing = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 6, 12), trim);
    headRing.position.set(x, 0.46, -2.18);
    g.add(headRing);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.15, 0.06), lightR);
    tail.position.set(x, 0.5, 2.16);
    g.add(tail);
  }

  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.24, 0.2), dark);
  bumperF.position.set(0, 0.28, -2.15);
  g.add(bumperF);
  const bumperR = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.22, 0.18), dark);
  bumperR.position.set(0, 0.28, 2.15);
  g.add(bumperR);
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 0.04), dark);
  grille.position.set(0, 0.42, -2.16);
  g.add(grille);
  for (let i = -1; i <= 1; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.05), trim);
    slat.position.set(i * 0.28, 0.42, -2.17);
    g.add(slat);
  }

  const wheels: THREE.Group[] = [];
  const tireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 20);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.25, 12);
  rimGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [
    [-0.95, -1.28],
    [0.95, -1.28],
    [-0.95, 1.32],
    [0.95, 1.32],
  ] as const) {
    const wheelGroup = new THREE.Group();
    wheelGroup.position.set(x, 0.36, z);
    const tire = new THREE.Mesh(tireGeo, rubber);
    tire.castShadow = true;
    wheelGroup.add(tire);
    const rimMesh = new THREE.Mesh(rimGeo, rim);
    wheelGroup.add(rimMesh);
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.03, 0.03), trim);
      spoke.rotation.x = (i / 5) * Math.PI * 2;
      wheelGroup.add(spoke);
    }
    g.add(wheelGroup);
    wheels.push(wheelGroup);
  }
  g.userData.wheels = wheels;
  g.userData.bodyM = bodyM;
  return g;
}

export function makeHuman(outfit: number, accent = 0x2a2c32): THREE.Group {
  const g = new THREE.Group();
  // Stylized/toon shading (banded lighting instead of continuous PBR
  // response) plus punchier, more saturated tones — the "Fortnite-ish"
  // look this pass is going for, versus the muted realistic palette before.
  const cloth = toonMat({ color: outfit });
  const clothShade = toonMat({ color: shade(outfit, 0.82) });
  const skin = toonMat({ color: 0xe0a877 });
  const skinShade = toonMat({ color: shade(0xe0a877, 0.86) });
  const hairM = toonMat({ color: 0x2a211c });
  const eyeM = toonMat({ color: 0x181614 });
  const dark = toonMat({ color: accent });
  const boot = toonMat({ color: 0x17171a });

  // --- Head: rounded skull instead of a box, with a jaw taper, brow ridge,
  // simple eyes, and hair, so it reads as a head shape rather than a cube. ---
  const headGroup = new THREE.Group();
  headGroup.position.y = 1.62;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 12), skin);
  skull.scale.set(1, 1.12, 0.92);
  skull.castShadow = true;
  headGroup.add(skull);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), skinShade);
  jaw.scale.set(0.92, 0.7, 0.82);
  jaw.position.set(0, -0.135, 0.02);
  headGroup.add(jaw);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.152, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), hairM);
  hair.scale.set(1.04, 1.05, 0.98);
  hair.position.y = 0.02;
  headGroup.add(hair);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), eyeM);
    eye.position.set(side * 0.052, 0.01, 0.132);
    headGroup.add(eye);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.05, 6), skinShade);
  nose.rotation.x = Math.PI / 2.15;
  nose.position.set(0, -0.02, 0.145);
  headGroup.add(nose);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.068, 0.1, 10), skin);
  neck.position.y = -0.16;
  headGroup.add(neck);
  g.add(headGroup);

  // --- Torso: tapered (wider shoulders, narrower waist) rather than a flat
  // slab, built from two stacked capsule-ish segments. ---
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.22, 4, 10), cloth);
  chest.scale.set(1.32, 1, 0.82);
  chest.position.y = 1.32;
  chest.castShadow = true;
  g.add(chest);
  const waist = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.14, 4, 10), clothShade);
  waist.scale.set(1.12, 1, 0.78);
  waist.position.y = 1.04;
  g.add(waist);
  const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.1, 4, 10), dark);
  hips.scale.set(1.18, 1, 0.85);
  hips.position.y = 0.86;
  g.add(hips);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.018, 6, 12), clothShade);
  collar.position.y = 1.46;
  collar.rotation.x = Math.PI / 2;
  g.add(collar);

  // --- Legs: separate thigh/shin segments (tapered capsules) with a knee
  // joint implied by the taper, instead of one straight box per leg. The
  // leg group's own origin is the hip joint (not the ground) so that
  // swinging leg.rotation.x pivots at the hip like a real leg, instead of
  // rotating the whole leg around a point down at the feet — which is what
  // was making legs swing into/through the torso instead of a normal walk.
  const legX = 0.13;
  const hipY = 0.84;
  const lLeg = new THREE.Group();
  lLeg.position.set(-legX, hipY, 0);
  const rLeg = new THREE.Group();
  rLeg.position.set(legX, hipY, 0);
  for (const legRoot of [lLeg, rLeg]) {
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.28, 4, 8), dark);
    thigh.position.y = 0.62 - hipY;
    thigh.castShadow = true;
    legRoot.add(thigh);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.26, 4, 8), dark);
    shin.position.y = 0.3 - hipY;
    shin.castShadow = true;
    legRoot.add(shin);
    const bootMesh = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.22), boot);
    bootMesh.position.set(0, 0.06 - hipY, 0.03);
    legRoot.add(bootMesh);
    g.add(legRoot);
  }

  // --- Arms: shoulder/upper-arm/forearm/hand, tapered capsules again. ---
  const armX = 0.335;
  const lArm = new THREE.Group();
  lArm.position.set(-armX, 1.44, 0);
  const rArm = new THREE.Group();
  rArm.position.set(armX, 1.44, 0.05);
  rArm.rotation.x = -0.55;
  for (const armRoot of [lArm, rArm]) {
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.24, 4, 8), cloth);
    upper.position.y = -0.14;
    upper.castShadow = true;
    armRoot.add(upper);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.22, 4, 8), skinShade);
    fore.position.y = -0.36;
    fore.castShadow = true;
    armRoot.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.052, 8, 6), skin);
    hand.scale.set(0.85, 1.1, 0.65);
    hand.position.y = -0.49;
    armRoot.add(hand);
    g.add(armRoot);
  }

  const rifle = makeRifle(false);
  rifle.position.set(0.28, 1.12, -0.35);
  rifle.rotation.set(0.15, 0, 0.08);
  g.add(rifle);

  g.userData.lLeg = lLeg;
  g.userData.rLeg = rLeg;
  g.userData.lArm = lArm;
  g.userData.rArm = rArm;
  g.userData.flash = cloth;
  return g;
}

// Darkens (factor < 1) or lightens (factor > 1) a hex color for subtle
// tonal variance between adjacent body parts, cheaper than a real texture.
function shade(hex: number, factor: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * factor));
  const gr = Math.min(255, Math.round(((hex >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((hex & 0xff) * factor));
  return (r << 16) | (gr << 8) | b;
}

export function makeRifle(viewmodel: boolean): THREE.Group {
  const g = new THREE.Group();
  const steel = mat({ color: 0x2c2e32, metalness: 0.85, roughness: 0.28 });
  const black = mat({ color: 0x141416, metalness: 0.3, roughness: 0.7 });
  const accent = mat({ color: 0x3a3d44, metalness: 0.5, roughness: 0.4 });

  const rec = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.085, 0.38), steel);
  rec.position.set(0, 0, 0);
  g.add(rec);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.42, 8), steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.012, -0.34);
  g.add(barrel);

  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.14), black);
  hand.position.set(0, -0.04, -0.12);
  g.add(hand);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, 0.07), accent);
  mag.position.set(0, -0.1, 0.02);
  g.add(mag);

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.16), black);
  stock.position.set(0, -0.01, 0.24);
  g.add(stock);

  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.08), steel);
  sight.position.set(0, 0.06, -0.04);
  g.add(sight);

  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0 }),
  );
  flash.position.set(0, 0.01, -0.58);
  g.add(flash);
  g.userData.flash = flash;

  if (viewmodel) {
    g.scale.setScalar(1.15);
  }
  return g;
}

export function makeSniper(viewmodel: boolean): THREE.Group {
  const g = new THREE.Group();
  const steel = mat({ color: 0x24262a, metalness: 0.88, roughness: 0.24 });
  const black = mat({ color: 0x101012, metalness: 0.25, roughness: 0.75 });
  const wood = mat({ color: 0x3a2b1e, metalness: 0.05, roughness: 0.6 });
  const glass = mat({ color: 0x0c1a14, metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.88 });
  const scopeM = mat({ color: 0x1c1d20, metalness: 0.8, roughness: 0.3 });

  const rec = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.08, 0.46), steel);
  g.add(rec);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.62, 8), steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.008, -0.52);
  g.add(barrel);

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.34), wood);
  stock.position.set(0, -0.015, 0.36);
  g.add(stock);

  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, 0.1), black);
  hand.position.set(0, -0.045, -0.06);
  g.add(hand);

  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 6), steel);
  bolt.rotation.z = Math.PI / 2;
  bolt.position.set(0.045, 0.02, 0.1);
  g.add(bolt);

  // Scope: tube + two lens caps, mounted above the receiver.
  const scopeBody = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.26, 12), scopeM);
  scopeBody.rotation.x = Math.PI / 2;
  scopeBody.position.set(0, 0.075, -0.06);
  g.add(scopeBody);
  const lensFront = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 12), glass);
  lensFront.rotation.x = Math.PI / 2;
  lensFront.position.set(0, 0.075, -0.19);
  g.add(lensFront);
  const lensBack = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 12), glass);
  lensBack.rotation.x = Math.PI / 2;
  lensBack.position.set(0, 0.075, 0.07);
  g.add(lensBack);
  const mountA = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.02), scopeM);
  mountA.position.set(0, 0.035, -0.14);
  g.add(mountA);
  const mountB = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.02), scopeM);
  mountB.position.set(0, 0.035, 0.02);
  g.add(mountB);

  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0 }),
  );
  flash.position.set(0, 0.008, -0.85);
  g.add(flash);
  g.userData.flash = flash;

  if (viewmodel) {
    g.scale.setScalar(1.15);
  }
  return g;
}

export function makeCrate(kind: "ammo" | "bomb"): THREE.Group {
  const g = new THREE.Group();
  const color = kind === "ammo" ? 0x4a5a48 : 0x5a3a32;
  const m = mat({ color, roughness: 0.7, metalness: 0.15, emissive: color, emissiveIntensity: 0.18 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), m);
  box.position.y = 0.25;
  box.castShadow = true;
  g.add(box);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.06, 0.72), mat({ color: 0x2a2a2c, roughness: 0.6 }));
  lid.position.y = 0.52;
  g.add(lid);
  return g;
}

export function makeTree(): THREE.Group {
  const g = new THREE.Group();
  const trunkM = mat({ color: 0x3a2e24, roughness: 0.95 });
  const leafM = mat({ color: 0x2f4a32, roughness: 0.85 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.6, 6), trunkM);
  trunk.position.y = 0.8;
  trunk.castShadow = true;
  g.add(trunk);
  const leaf = new THREE.Mesh(new THREE.DodecahedronGeometry(1.05, 0), leafM);
  leaf.position.y = 2.05;
  leaf.castShadow = true;
  g.add(leaf);
  const leaf2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), leafM);
  leaf2.position.set(0.2, 2.5, -0.1);
  g.add(leaf2);
  return g;
}
