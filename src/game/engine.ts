import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { P2PRoom, type PeerInfo } from "@/lib/multiplayer";
import { GameAudio } from "./audio";
import { Input, type Actions } from "./input";
import { makeCar, makeCrate, makeHuman, makeRifle, makeSniper, disposeSharedMats } from "./models";
import {
  BLAST_DMG,
  BLAST_RADIUS,
  CAR_ACCEL,
  CAR_BRAKE,
  CAR_DRAG,
  CAR_MAX,
  CAR_RADIUS,
  CAR_TURN,
  GRAVITY,
  GRENADE_FUSE,
  JUMP_VEL,
  MAG_SIZE,
  MAX_HP,
  PLAYER_EYE,
  PLAYER_RADIUS,
  RELOAD_TIME,
  RIFLE_DMG,
  RIFLE_INTERVAL,
  SNIPER_DMG,
  SNIPER_INTERVAL,
  SNIPER_MAG_SIZE,
  SNIPER_RELOAD_TIME,
  SNIPER_SCOPE_FOV,
  SPRINT_SPEED,
  STEP,
  WALK_SPEED,
} from "./types";
import type { GameHud, Mode, NameTag, Weapon } from "./types";
import { buildWorld, rayAabb, resolveCircle, type WorldData } from "./world";

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _camPos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _assistTarget = new THREE.Vector3();
const _assistDir = new THREE.Vector3();
const _tagWorld = new THREE.Vector3();
const _tagProj = new THREE.Vector3();

type Vehicle = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  mesh: THREE.Group;
  occupied: boolean;
};

type Bot = {
  id: number;
  x: number;
  z: number;
  y: number;
  yaw: number;
  hp: number;
  wp: number;
  fireCd: number;
  respawn: number;
  mesh: THREE.Group;
  walk: number;
  hostile: boolean;
  alertT: number;
};

type Grenade = {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fuse: number;
  mesh: THREE.Mesh;
};

type Tracer = { mesh: THREE.Line; life: number };
type CrateV = { x: number; z: number; kind: "ammo" | "bomb"; taken: boolean; mesh: THREE.Group };

type Remote = {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  car: number;
  tx: number;
  ty: number;
  tz: number;
  tyaw: number;
  mesh: THREE.Group;
};

type NetState = {
  t: "s";
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  car: number;
};

function wrapPi(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function lerpAngle(a: number, b: number, t: number) {
  return a + wrapPi(b - a) * t;
}

export class GameEngine {
  readonly footprints;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(72, 1, 0.08, 900);
  private world: WorldData;
  private input = new Input();
  private audio = new GameAudio();
  private player = {
    x: 2,
    y: 0,
    z: 12,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0.2,
    pitch: -0.08,
    hp: MAX_HP,
    ammo: MAG_SIZE,
    reserve: 240,
    sniperAmmo: SNIPER_MAG_SIZE,
    sniperReserve: 20,
    weapon: "rifle" as Weapon,
    scoped: false,
    bombs: 10,
    kills: 0,
    inCar: -1,
    fireCd: 0,
    reloadT: 0,
    bombCd: 0,
    onGround: true,
    bob: 0,
    deadT: 0,
    hurtT: 0,
    invuln: 0,
  };
  private vehicles: Vehicle[] = [];
  private bots: Bot[] = [];
  private grenades: Grenade[] = [];
  private tracers: Tracer[] = [];
  private crates: CrateV[] = [];
  private remotes = new Map<string, Remote>();
  private gun: THREE.Group;
  private sniper: THREE.Group;
  private gunLight: THREE.PointLight;
  private blastLight: THREE.PointLight;
  private particles: THREE.Points;
  private pPos: Float32Array;
  private pVel: Float32Array;
  private pLife: Float32Array;
  private envMap: THREE.Texture;
  private pmrem: THREE.PMREMGenerator;
  private playing = false;
  private mode: Mode | null = null;
  private acc = 0;
  private last = 0;
  private hudAcc = 0;
  private netAcc = 0;
  private fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private trauma = 0;
  private hitstop = 0;
  private hitmarker = 0;
  private aimLocked = false;
  private muzzle = 0;
  private footT = 0;
  private menuT = 0;
  private p2p: P2PRoom | null = null;
  private selfId = `p-${Math.random().toString(36).slice(2, 10)}`;
  private selfName = "Outrider";
  private room = "";
  private peers: PeerInfo[] = [];
  private joined = false;
  private isHost = true;
  private onHud: ((h: GameHud) => void) | null = null;
  private disposed = false;
  private canvas: HTMLCanvasElement;
  private resizeObs: ResizeObserver;
  private onWindowResize = () => this.resize();
  private prompt = "";

  constructor(canvas: HTMLCanvasElement, onHud?: (h: GameHud) => void) {
    this.canvas = canvas;
    this.onHud = onHud ?? null;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x0b1220, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.32;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = this.pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
    this.scene.environment = this.envMap;

    this.world = buildWorld(this.scene);
    this.footprints = this.world.footprints;
    this.scene.traverse((o) => {
      if (o instanceof THREE.Light) o.layers.enableAll();
      // TEMP DIAGNOSTIC: disable frustum culling on everything so we can
      // tell whether missing world geometry is a culling/frustum-matrix
      // problem or the objects themselves are invisible for another reason.
      if (o instanceof THREE.Mesh) o.frustumCulled = false;
    });
    this.camera.rotation.order = "YXZ";
    this.camera.layers.enable(0);
    this.camera.layers.enable(1);

    this.gun = makeRifle(true);
    this.gun.position.set(0.28, -0.22, -0.52);
    this.gun.rotation.set(0.04, 0.08, 0.02);
    this.gun.traverse((o) => o.layers.set(1));
    this.camera.add(this.gun);

    this.sniper = makeSniper(true);
    this.sniper.position.set(0.28, -0.22, -0.52);
    this.sniper.rotation.set(0.04, 0.08, 0.02);
    this.sniper.traverse((o) => o.layers.set(1));
    this.sniper.visible = false;
    this.camera.add(this.sniper);
    this.scene.add(this.camera);

    this.gunLight = new THREE.PointLight(0xffcc88, 0, 8, 2);
    this.gunLight.layers.enable(0);
    this.gunLight.layers.enable(1);
    this.camera.add(this.gunLight);

    this.blastLight = new THREE.PointLight(0xffaa55, 0, 28, 2);
    this.scene.add(this.blastLight);

    const pCount = 420;
    this.pPos = new Float32Array(pCount * 3);
    this.pVel = new Float32Array(pCount * 3);
    this.pLife = new Float32Array(pCount);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3));
    this.particles = new THREE.Points(
      pGeo,
      new THREE.PointsMaterial({
        color: 0xffc070,
        size: 0.18,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    this.scene.add(this.particles);

    this.spawnVehicles();
    this.spawnBots(10);
    this.spawnCrates();
    this.makeGrenades();
    this.makeTracers();

    this.input.attach(canvas);
    this.input.onWantLock = () => this.requestLock();
    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas.parentElement || canvas);
    window.addEventListener("resize", this.onWindowResize);
    // The very first resize() call above can occasionally run before
    // layout/hydration has fully settled, capturing a too-small height.
    // ResizeObserver only reports subsequent size *changes*, so a bad first
    // read can otherwise stick permanently — re-measure a couple of frames
    // later to catch and correct that case.
    requestAnimationFrame(() => this.resize());
    setTimeout(() => this.resize(), 250);

    this.wireProbe();
    (window as unknown as { __ridgeDebug?: () => unknown }).__ridgeDebug = () => ({
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      cam: this.camera.position.toArray(),
      camRot: [this.camera.rotation.x, this.camera.rotation.y, this.camera.rotation.z],
      camFov: this.camera.fov,
      kids: this.scene.children.length,
      playing: this.playing,
      inCar: this.player.inCar,
      playerPos: [this.player.x, this.player.y, this.player.z],
      playerYawPitch: [this.player.yaw, this.player.pitch],
      playerPosFinite: [
        Number.isFinite(this.player.x),
        Number.isFinite(this.player.y),
        Number.isFinite(this.player.z),
      ],
      camPosFinite: [
        Number.isFinite(this.camera.position.x),
        Number.isFinite(this.camera.position.y),
        Number.isFinite(this.camera.position.z),
      ],
      worldGroupKids: this.world.group.children.length,
      worldGroupVisible: this.world.group.visible,
      worldGroupInScene: this.scene.children.includes(this.world.group as unknown as THREE.Object3D),
      worldGroupParent: this.world.group.parent === this.scene ? "scene" : this.world.group.parent ? "other" : "none",
      canvasSize: [this.canvas.width, this.canvas.height],
      // Read back the actual pixel WebGL put on screen at the crosshair,
      // instead of inferring color from geometry/triangle counts — this
      // tells us definitively whether the renderer drew something dark
      // there, or whether something else (a DOM overlay, a compositing
      // issue) is covering an otherwise correctly-rendered frame.
      centerPixelRGBA: (() => {
        try {
          const gl = this.renderer.getContext();
          const buf = new Uint8Array(4);
          const px = Math.floor(this.canvas.width / 2);
          const py = Math.floor(this.canvas.height / 2);
          gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          return Array.from(buf);
        } catch (err) {
          return String(err);
        }
      })(),
      sample: this.world.group.children.slice(0, 8).map((o) => {
        const m = o as THREE.Mesh;
        const geo = m.geometry;
        return {
          type: o.type,
          visible: o.visible,
          pos: o.position.toArray(),
          hasGeometry: !!geo,
          vertexCount: geo?.attributes?.position?.count ?? null,
          layer: o.layers.mask,
        };
      }),
    });
    this.last = performance.now();
    this.renderer.setAnimationLoop(this.frame);
    this.emitHud();
  }

  setOnHud(fn: (h: GameHud) => void) {
    this.onHud = fn;
  }

  setVirtualMove(x: number, y: number) {
    this.input.virtualMoveX = x;
    this.input.virtualMoveY = y;
  }

  setVirtualLook(dx: number, dy: number) {
    this.input.virtualLookX += dx;
    this.input.virtualLookY += dy;
  }

  setVirtualFire(v: boolean) {
    this.input.virtualFire = v;
  }

  pressBomb() {
    this.input.virtualBomb = true;
  }

  pressInteract() {
    this.input.virtualInteract = true;
  }

  pressJump() {
    this.input.virtualJump = true;
  }

  pressSwitchWeapon() {
    this.input.virtualSwitchWeapon = true;
  }

  setScope(v: boolean) {
    this.input.virtualScope = v;
  }

  setMuted(v: boolean) {
    this.audio.setMuted(v);
  }

  play(mode: Mode, room?: string, name?: string) {
    this.audio.unlock();
    this.mode = mode;
    this.playing = true;
    this.selfName = (name || "Outrider").slice(0, 24);
    this.player.hp = MAX_HP;
    this.player.deadT = 0;
    this.player.ammo = MAG_SIZE;
    this.player.reserve = 240;
    this.player.sniperAmmo = SNIPER_MAG_SIZE;
    this.player.sniperReserve = 20;
    this.player.weapon = "rifle";
    this.player.scoped = false;
    this.player.bombs = 10;
    this.player.kills = 0;
    this.player.x = 2;
    this.player.z = 12;
    this.player.y = 0;
    this.player.yaw = 0.2;
    this.player.inCar = -1;
    if (mode === "friends") {
      this.room = (room || this.makeRoom()).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
      this.connectP2P();
    } else {
      this.room = "";
      this.closeP2P();
    }
    this.requestLock();
    this.audio.ui();
    this.emitHud();
  }

  private lastLockAttempt = 0;

  requestLock() {
    // Called opportunistically on every mouse pointerdown now that aiming
    // no longer depends on pointer lock succeeding, so this needs to be
    // resilient: browsers throttle/reject rapid repeated lock requests
    // (sometimes throwing synchronously rather than rejecting the
    // returned promise), and an uncaught throw here would abort whatever
    // else was running in that same input handler.
    if (this.input.pointerLocked) return;
    const now = performance.now();
    if (now - this.lastLockAttempt < 400) return;
    this.lastLockAttempt = now;
    try {
      const el = this.canvas as HTMLCanvasElement & {
        requestPointerLock: (opts?: { unadjustedMovement?: boolean }) => Promise<void> | void;
      };
      const p = el.requestPointerLock?.({ unadjustedMovement: true });
      if (p && typeof (p as Promise<void>).catch === "function") {
        (p as Promise<void>).catch(() => {
          try {
            el.requestPointerLock();
          } catch {
            // Ignore — aiming works fine without pointer lock.
          }
        });
      }
    } catch {
      // Ignore — aiming works fine without pointer lock.
    }
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.input.detach();
    this.closeP2P();
    this.resizeObs.disconnect();
    window.removeEventListener("resize", this.onWindowResize);
    this.world.dispose();
    this.renderer.dispose();
    this.envMap.dispose();
    this.pmrem.dispose();
    disposeSharedMats();
    if (window.__controlsTest) delete window.__controlsTest;
  }

  private makeRoom() {
    const a = "abcdefghjkmnpqrstuvwxyz23456789";
    let s = "";
    for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  }

  private connectP2P() {
    this.closeP2P();
    const room = this.room;
    const p2p = new P2PRoom({
      room,
      selfId: this.selfId,
      name: this.selfName,
      onPeersChanged: (peers) => {
        this.peers = peers;
        this.syncRemotes();
        this.recomputeHost();
      },
      onMessage: (from, data, ch) => this.onNet(from, data, ch),
      onConnected: () => {
        this.joined = true;
        this.emitHud();
      },
    });
    this.p2p = p2p;
    void p2p.join();
  }

  private closeP2P() {
    this.p2p?.close();
    this.p2p = null;
    this.joined = false;
    this.peers = [];
    for (const r of this.remotes.values()) {
      this.scene.remove(r.mesh);
      if (r.car >= 0 && r.car < this.vehicles.length) this.vehicles[r.car].occupied = false;
    }
    this.remotes.clear();
  }

  private recomputeHost() {
    const ids = [this.selfId, ...this.peers.map((p) => p.id)];
    ids.sort();
    this.isHost = ids[0] === this.selfId;
    const seen = new Set(this.peers.map((p) => p.id));
    for (const [id, r] of this.remotes) {
      if (!seen.has(id)) {
        this.scene.remove(r.mesh);
        if (r.car >= 0 && r.car < this.vehicles.length) this.vehicles[r.car].occupied = false;
        this.remotes.delete(id);
      }
    }
  }

  private syncRemotes() {
    for (const p of this.peers) {
      if (this.remotes.has(p.id)) {
        const r = this.remotes.get(p.id)!;
        r.name = p.name;
        continue;
      }
      const mesh = makeHuman(0x2f6fd6, 0x1c2733);
      this.scene.add(mesh);
      this.remotes.set(p.id, {
        id: p.id,
        name: p.name,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        pitch: 0,
        hp: MAX_HP,
        car: -1,
        tx: 0,
        ty: 0,
        tz: 0,
        tyaw: 0,
        mesh,
      });
      if (this.isHost) {
        this.p2p?.send({ t: "hello", name: this.selfName }, p.id);
      }
    }
    this.recomputeHost();
  }

  private onNet(from: string, data: unknown, _ch: "state" | "reliable") {
    if (!data || typeof data !== "object") return;
    const msg = data as Record<string, unknown>;
    const t = msg.t;
    if (t === "s") {
      let r = this.remotes.get(from);
      if (!r) return;
      r.tx = Number(msg.x) || 0;
      r.ty = Number(msg.y) || 0;
      r.tz = Number(msg.z) || 0;
      r.tyaw = Number(msg.yaw) || 0;
      r.pitch = Number(msg.pitch) || 0;
      r.hp = Number(msg.hp) || 0;
      const nextCar = Number(msg.car) ?? -1;
      if (nextCar !== r.car) {
        // Release the vehicle this remote was previously reported to be
        // driving (unless the local player has since taken it), and mark
        // whatever they're driving now as occupied, so nearCar() won't let
        // the local player walk into a car someone else is actively using.
        if (r.car >= 0 && r.car < this.vehicles.length && this.player.inCar !== r.car) {
          this.vehicles[r.car].occupied = false;
        }
        r.car = nextCar;
        if (r.car >= 0 && r.car < this.vehicles.length) {
          this.vehicles[r.car].occupied = true;
        }
      }
    } else if (t === "shot") {
      const ox = Number(msg.x),
        oy = Number(msg.y),
        oz = Number(msg.z);
      const dx = Number(msg.dx),
        dy = Number(msg.dy),
        dz = Number(msg.dz);
      this.spawnTracer(ox, oy, oz, dx, dy, dz, 48);
      const incomingDmg = Number(msg.dmg) || RIFLE_DMG;
      this.tryHitLocal(ox, oy, oz, dx, dy, dz, incomingDmg * 0.9);
    } else if (t === "bomb") {
      this.throwGrenade(Number(msg.x), Number(msg.y), Number(msg.z), Number(msg.vx), Number(msg.vy), Number(msg.vz), false);
    } else if (t === "hit") {
      if (msg.id === this.selfId) this.damage(Number(msg.dmg) || 12);
    } else if (t === "botHit" && this.isHost) {
      // Only the host resolves bot damage (it's the one broadcasting
      // authoritative bot hp via "ai"), so a peer's shot needs to arrive
      // here rather than mutate their own local copy, which would just get
      // overwritten by the next sync.
      const bot = this.bots.find((b) => b.id === Number(msg.id));
      if (bot && bot.hp > 0) {
        bot.hostile = true;
        bot.hp -= Number(msg.dmg) || RIFLE_DMG;
        if (bot.hp <= 0) {
          this.hitstop = 0.045;
          this.burst(bot.x, 1, bot.z, 22, 7);
          bot.respawn = 7;
          this.p2p?.send({ t: "botKill" }, from);
        }
      }
    } else if (t === "botKill") {
      this.player.kills += 1;
      this.hitstop = 0.045;
      this.trauma = Math.min(1, this.trauma + 0.28);
    } else if (t === "ai" && Array.isArray(msg.b) && !this.isHost) {
      const rows = msg.b as number[][];
      for (let i = 0; i < rows.length && i < this.bots.length; i++) {
        const row = rows[i];
        const b = this.bots[i];
        b.x = row[0];
        b.z = row[1];
        b.yaw = row[2];
        b.hp = row[3];
        b.y = 0;
      }
    }
  }

  private spawnVehicles() {
    const colors = [0xe0392b, 0xf2efe4, 0x1f6fd1, 0xffb020, 0x2fae5c, 0xe0392b, 0x8a4fe0, 0x1a1c22, 0x2fae5c, 0xffb020];
    this.world.carSpawns.forEach((s, i) => {
      const mesh = makeCar(colors[i % colors.length]);
      mesh.position.set(s.x, 0, s.z);
      mesh.rotation.y = s.yaw;
      this.scene.add(mesh);
      this.vehicles.push({ x: s.x, y: 0, z: s.z, yaw: s.yaw, speed: 0, mesh, occupied: false });
    });
  }

  private spawnBots(n: number) {
    const pts = this.world.spawns.filter((s) => Math.hypot(s.x, s.z) > 22);
    for (let i = 0; i < n; i++) {
      const p = pts[i % pts.length] || { x: 40, z: 40 };
      const mesh = makeHuman(i % 2 === 0 ? 0xd6432f : 0x2f6fd6, 0x232733);
      mesh.position.set(p.x, 0, p.z);
      this.scene.add(mesh);
      this.bots.push({
        id: i,
        x: p.x + (i % 5) * 2,
        z: p.z + (i % 3) * 2,
        y: 0,
        yaw: Math.random() * 6,
        hp: 70,
        wp: i % this.world.waypoints.length,
        fireCd: 0.4 + Math.random(),
        respawn: 0,
        mesh,
        walk: 0,
        hostile: false,
        alertT: 0,
      });
    }
  }

  private spawnCrates() {
    for (const c of this.world.crates) {
      const mesh = makeCrate(c.kind);
      mesh.position.set(c.x, 0, c.z);
      this.scene.add(mesh);
      this.crates.push({ ...c, taken: false, mesh });
    }
  }

  private makeGrenades() {
    const geo = new THREE.SphereGeometry(0.12, 10, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2e28, metalness: 0.6, roughness: 0.4 });
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.grenades.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0, mesh });
    }
  }

  private makeTracers() {
    const mat = new THREE.LineBasicMaterial({ color: 0xffe6a8, transparent: true, opacity: 0.8 });
    for (let i = 0; i < 24; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      const mesh = new THREE.Line(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.tracers.push({ mesh, life: 0 });
    }
  }

  private frame = (now: number) => {
    if (this.disposed) return;
    try {
      this.runFrame(now);
    } catch (err) {
      // An uncaught exception anywhere in the frame (physics step, visual
      // update, or the render call itself) would otherwise abort mid-frame
      // silently — if it happens after renderer.clear() but before
      // renderer.render() finishes, that reads as exactly a blank/black
      // screen for that frame, while everything else (state, debug reads)
      // looks perfectly normal on the next tick. Logging it here turns a
      // silent, hard-to-reproduce failure into a visible one instead of
      // letting the game limp along in a broken-looking state with no
      // trace of why.
      console.error("[game] frame error", err);
    }
  };

  private runFrame(now: number) {
    const raw = Math.min(0.1, (now - this.last) / 1000 || 0.016);
    this.last = now;
    this.fpsAcc += raw;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.4) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }

    this.acc += raw;
    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      this.step(STEP);
      this.acc -= STEP;
      steps++;
    }

    this.renderVisuals(raw);
    this.draw();

    this.hudAcc += raw;
    if (this.hudAcc >= 0.08) {
      this.hudAcc = 0;
      this.emitHud();
    }
  }

  private step(dt: number) {
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return;
    }
    const act = this.input.sample();
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    this.hitmarker = Math.max(0, this.hitmarker - dt * 3.2);
    this.muzzle = Math.max(0, this.muzzle - dt * 18);
    this.player.fireCd = Math.max(0, this.player.fireCd - dt);
    this.player.bombCd = Math.max(0, this.player.bombCd - dt);
    this.player.hurtT = Math.max(0, this.player.hurtT - dt);
    this.player.invuln = Math.max(0, this.player.invuln - dt);
    if (this.player.reloadT > 0) {
      this.player.reloadT -= dt;
      if (this.player.reloadT <= 0) {
        if (this.player.weapon === "sniper") {
          const need = SNIPER_MAG_SIZE - this.player.sniperAmmo;
          const take = Math.min(need, this.player.sniperReserve);
          this.player.sniperAmmo += take;
          this.player.sniperReserve -= take;
        } else {
          const need = MAG_SIZE - this.player.ammo;
          const take = Math.min(need, this.player.reserve);
          this.player.ammo += take;
          this.player.reserve -= take;
        }
      }
    }

    if (!this.playing) {
      this.menuT += dt;
      this.updateVehiclesVisual(dt);
      if (this.isHost) this.updateBots(dt, null);
      return;
    }

    if (this.player.hp <= 0) {
      this.player.deadT += dt;
      if (this.player.deadT > 2.2) this.respawn();
      this.updateGrenades(dt);
      if (this.isHost) this.updateBots(dt, null);
      this.updateRemotes(dt);
      return;
    }

    this.player.yaw -= act.lookX * 0.0022;
    this.player.pitch -= act.lookY * 0.002;
    this.player.pitch = Math.max(-1.45, Math.min(1.45, this.player.pitch));

    if (this.player.inCar >= 0) this.updateDrive(dt, act);
    else this.updateFoot(dt, act);

    this.updateAimLock();

    if (act.interactPressed) this.tryEnterExit();
    if (act.reloadPressed) this.startReload();
    if (act.switchWeaponPressed) this.switchWeapon();
    // Scoping only makes sense on foot with the sniper out; anywhere else
    // it's simply ignored rather than left in a stuck state.
    this.player.scoped =
      act.scope && this.player.inCar < 0 && this.player.weapon === "sniper" && this.player.hp > 0;
    if (act.fire) this.tryFire();
    if (act.bombPressed) this.tryBomb();

    this.updateGrenades(dt);
    if (this.isHost) this.updateBots(dt, this.player);
    this.updateRemotes(dt);
    this.collectCrates();
    this.slowHeal(dt);

    this.netAcc += dt;
    if (this.p2p && this.netAcc >= 0.05) {
      this.netAcc = 0;
      const msg: NetState = {
        t: "s",
        x: +this.player.x.toFixed(2),
        y: +this.player.y.toFixed(2),
        z: +this.player.z.toFixed(2),
        yaw: +this.player.yaw.toFixed(3),
        pitch: +this.player.pitch.toFixed(3),
        hp: this.player.hp,
        car: this.player.inCar,
      };
      this.p2p.broadcast(msg);
      if (this.isHost) {
        this.p2p.broadcast({
          t: "ai",
          b: this.bots.map((b) => [+b.x.toFixed(2), +b.z.toFixed(2), +b.yaw.toFixed(2), b.hp]),
        });
      }
    }
  }

  private updateFoot(dt: number, act: Actions) {
    const p = this.player;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw);
    const rz = -Math.sin(p.yaw);
    const spd = act.sprint ? SPRINT_SPEED : WALK_SPEED;
    const wishX = fx * act.moveY + rx * act.moveX;
    const wishZ = fz * act.moveY + rz * act.moveX;
    const len = Math.hypot(wishX, wishZ);
    const nx = len > 1 ? wishX / len : wishX;
    const nz = len > 1 ? wishZ / len : wishZ;
    p.x += nx * spd * dt;
    p.z += nz * spd * dt;
    const res = resolveCircle(p.x, p.z, PLAYER_RADIUS, this.world.colliders);
    p.x = res.x;
    p.z = res.z;
    if (act.jumpPressed && p.onGround) {
      p.vy = JUMP_VEL;
      p.onGround = false;
    }
    p.vy -= GRAVITY * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) {
      p.y = 0;
      p.vy = 0;
      p.onGround = true;
    }
    if (len > 0.15 && p.onGround) {
      p.bob += dt * spd * 1.7;
      this.footT += dt * spd;
      if (this.footT > 0.42) {
        this.footT = 0;
        this.audio.foot();
      }
    }
    this.prompt = this.nearCar() >= 0 ? "E  Enter vehicle" : "";
    this.audio.setEngine(0, false);
  }

  private updateDrive(dt: number, act: Actions) {
    const car = this.vehicles[this.player.inCar];
    if (!car) {
      this.player.inCar = -1;
      return;
    }
    let steer = act.steer;
    if (steer > 1) steer = 1;
    if (steer < -1) steer = -1;
    const throttle = act.throttle;
    if (throttle > 0.05) car.speed += throttle * CAR_ACCEL * dt;
    else if (throttle < -0.05) car.speed += throttle * CAR_BRAKE * dt;
    else car.speed *= 1 - CAR_DRAG * 1.8 * dt;
    car.speed *= 1 - CAR_DRAG * dt;
    car.speed = Math.max(-CAR_MAX * 0.45, Math.min(CAR_MAX, car.speed));
    const speedFactor = Math.max(0, Math.min(1, Math.abs(car.speed) / 8));
    const reverse = car.speed >= 0 ? 1 : -1;
    car.yaw += steer * CAR_TURN * speedFactor * reverse * dt;
    const fx = -Math.sin(car.yaw);
    const fz = -Math.cos(car.yaw);
    car.x += fx * car.speed * dt;
    car.z += fz * car.speed * dt;
    const res = resolveCircle(car.x, car.z, CAR_RADIUS, this.world.colliders);
    if (Math.hypot(res.x - car.x, res.z - car.z) > 0.002) {
      car.speed *= 0.35;
    }
    car.x = res.x;
    car.z = res.z;
    this.player.x = car.x;
    this.player.z = car.z;
    this.player.y = 0.2;
    this.player.yaw = car.yaw;
    this.prompt = "E  Exit vehicle";
    this.audio.setEngine(Math.abs(car.speed), true);
    const wheels = car.mesh.userData.wheels as THREE.Object3D[] | undefined;
    if (wheels) {
      for (const w of wheels) w.rotation.x += car.speed * dt * 0.9;
    }
  }

  private updateVehiclesVisual(dt: number) {
    for (const car of this.vehicles) {
      if (car.occupied) continue;
      car.mesh.position.set(car.x, 0, car.z);
      car.mesh.rotation.y = car.yaw;
    }
    void dt;
  }

  private nearCar() {
    let best = -1;
    let bestD = 4.6;
    for (let i = 0; i < this.vehicles.length; i++) {
      const c = this.vehicles[i];
      if (c.occupied && this.player.inCar !== i) continue;
      const d = Math.hypot(c.x - this.player.x, c.z - this.player.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private tryEnterExit() {
    if (this.player.inCar >= 0) {
      const car = this.vehicles[this.player.inCar];
      car.occupied = false;
      car.speed = 0;
      // Step out well clear of the car's own collision radius, so the exit
      // camera's near plane never ends up inside the car mesh (which renders
      // as a blank screen with only the camera-attached gun visible, since
      // everything else falls behind the near clip / inside solid geometry).
      const clearance = CAR_RADIUS + PLAYER_RADIUS + 1.2;
      const sideRx = Math.cos(car.yaw);
      const sideRz = -Math.sin(car.yaw);
      const backX = Math.sin(car.yaw);
      const backZ = Math.cos(car.yaw);
      const candidates: Array<[number, number]> = [
        [car.x + sideRx * clearance, car.z + sideRz * clearance],
        [car.x - sideRx * clearance, car.z - sideRz * clearance],
        [car.x + backX * clearance, car.z + backZ * clearance],
      ];
      let ex = candidates[0][0];
      let ez = candidates[0][1];
      let placed = false;
      for (const [cx, cz] of candidates) {
        const res = resolveCircle(cx, cz, PLAYER_RADIUS, this.world.colliders);
        const stayedPut = Math.hypot(res.x - cx, res.z - cz) < 0.6;
        const clearOfCar = Math.hypot(res.x - car.x, res.z - car.z) >= CAR_RADIUS + PLAYER_RADIUS + 0.1;
        if (stayedPut && clearOfCar) {
          ex = res.x;
          ez = res.z;
          placed = true;
          break;
        }
      }
      if (!placed) {
        const res = resolveCircle(ex, ez, PLAYER_RADIUS, this.world.colliders);
        ex = res.x;
        ez = res.z;
      }
      this.player.x = ex;
      this.player.z = ez;
      this.player.y = 0;
      this.player.inCar = -1;
      // Player pitch/yaw are frozen while driving, so sync them to face the
      // same way the car was facing instead of snapping the camera to a
      // stale rotation left over from before you drove.
      this.player.yaw = car.yaw;
      this.player.pitch = 0;
      this.audio.carDoor();
      return;
    }
    const i = this.nearCar();
    if (i < 0) return;
    this.enterCar(i);
  }

  private enterCar(i: number) {
    const car = this.vehicles[i];
    car.occupied = true;
    this.player.inCar = i;
    this.player.x = car.x;
    this.player.z = car.z;
    this.player.yaw = car.yaw;
    this.audio.carDoor();
  }

  enterNearestCar() {
    const i = this.nearCar();
    if (i >= 0 && this.player.inCar < 0) this.enterCar(i);
  }

  private switchWeapon() {
    if (this.player.inCar >= 0 || this.player.hp <= 0) return;
    this.player.weapon = this.player.weapon === "rifle" ? "sniper" : "rifle";
    this.player.reloadT = 0;
    this.player.scoped = false;
    this.audio.reload();
  }

  private startReload() {
    if (this.player.reloadT > 0) return;
    const weapon = this.player.weapon;
    if (weapon === "sniper") {
      if (this.player.sniperAmmo >= SNIPER_MAG_SIZE) return;
      if (this.player.sniperReserve <= 0) return;
      this.player.reloadT = SNIPER_RELOAD_TIME;
    } else {
      if (this.player.ammo >= MAG_SIZE) return;
      if (this.player.reserve <= 0) return;
      this.player.reloadT = RELOAD_TIME;
    }
    this.audio.reload();
  }

  private camDir(out: THREE.Vector3) {
    out.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    return out;
  }

  // Soft aim assist: if a bot or remote player is close to where the player
  // is already aiming (within a narrow cone), nudge the shot/throw direction
  // toward its center. This only pulls the aim a small amount — it forgives
  // near-misses (much easier on touch, where fine aiming is hard) without
  // auto-snapping onto targets the player isn't actually pointing near.
  private aimAssistDir(origin: THREE.Vector3, dir: THREE.Vector3, coneCos: number, maxDist: number, pull: number) {
    let bestT = -1;
    let bestX = 0;
    let bestY = 0;
    let bestZ = 0;
    let bestScore = -1;
    const consider = (x: number, y: number, z: number) => {
      const dx = x - origin.x;
      const dy = y - origin.y;
      const dz = z - origin.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 0.5 || dist > maxDist) return;
      const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / dist;
      if (cos < coneCos) return;
      // Prefer the closest target within the cone, not just the most
      // centered one, so nearby threats take priority.
      const score = cos - dist * 0.0025;
      if (score > bestScore) {
        bestScore = score;
        bestT = dist;
        bestX = x;
        bestY = y;
        bestZ = z;
      }
    };
    for (const b of this.bots) {
      if (b.hp <= 0) continue;
      consider(b.x, 1.1, b.z);
    }
    for (const r of this.remotes.values()) {
      if (r.hp <= 0) continue;
      consider(r.x, 1.1, r.z);
    }
    if (bestT < 0) return dir;
    _assistTarget.set(bestX - origin.x, bestY - origin.y, bestZ - origin.z).normalize();
    _assistDir.copy(dir).lerp(_assistTarget, pull).normalize();
    return _assistDir;
  }

  // Cheap per-frame check (same cone as the fire assist) purely to drive the
  // crosshair's on-target indicator, so aiming feels predictable instead of
  // the assist being an invisible nudge you can't anticipate.
  private updateAimLock() {
    if (this.player.inCar >= 0 || this.player.hp <= 0) {
      this.aimLocked = false;
      return;
    }
    const origin = this.camera.getWorldPosition(_o);
    const dir = this.camDir(_d);
    const coneCos = 0.985;
    const maxDist = 42;
    let found = false;
    const consider = (x: number, y: number, z: number) => {
      const dx = x - origin.x;
      const dy = y - origin.y;
      const dz = z - origin.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 0.5 || dist > maxDist) return;
      const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / dist;
      if (cos >= coneCos) found = true;
    };
    for (const b of this.bots) {
      if (found || b.hp <= 0) continue;
      consider(b.x, 1.1, b.z);
    }
    if (!found) {
      for (const r of this.remotes.values()) {
        if (found || r.hp <= 0) continue;
        consider(r.x, 1.1, r.z);
      }
    }
    this.aimLocked = found;
  }

  private tryFire() {
    const p = this.player;
    if (p.fireCd > 0) return;
    if (p.reloadT > 0) return;
    const weapon = p.weapon;
    const ammo = weapon === "sniper" ? p.sniperAmmo : p.ammo;
    if (ammo <= 0) {
      p.fireCd = 0.18;
      this.audio.empty();
      this.startReload();
      return;
    }
    const dmg = weapon === "sniper" ? SNIPER_DMG : RIFLE_DMG;
    const interval = weapon === "sniper" ? SNIPER_INTERVAL : RIFLE_INTERVAL;
    const spread = weapon === "sniper" ? (p.scoped ? 0.002 : 0.03) : 0.02;
    if (weapon === "sniper") p.sniperAmmo -= 1;
    else p.ammo -= 1;
    p.fireCd = interval;
    this.muzzle = 1;
    this.trauma = Math.min(1, this.trauma + (weapon === "sniper" ? 0.22 : 0.12));
    this.player.pitch += weapon === "sniper" ? 0.02 : 0.012;
    this.audio.shot();
    const origin = this.camera.getWorldPosition(_o);
    let dir = this.camDir(_d);
    // Aim assist matters much less at long range with a scope (you're
    // already precisely lined up), so it only meaningfully kicks in for the
    // rifle's wider, faster-moving crosshair.
    dir = this.aimAssistDir(origin, dir, weapon === "sniper" ? 0.997 : 0.985, weapon === "sniper" ? 90 : 42, weapon === "sniper" ? 0.35 : 0.65);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    dir.normalize();
    this.hitscan(origin, dir, true, dmg);
    this.p2p?.send({
      t: "shot",
      x: +origin.x.toFixed(2),
      y: +origin.y.toFixed(2),
      z: +origin.z.toFixed(2),
      dx: +dir.x.toFixed(3),
      dy: +dir.y.toFixed(3),
      dz: +dir.z.toFixed(3),
      dmg,
    });
  }

  private hitscan(origin: THREE.Vector3, dir: THREE.Vector3, local: boolean, dmg: number = RIFLE_DMG) {
    const wall = rayAabb(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 90, this.world.colliders);
    let best = wall;
    let hitBot: Bot | null = null;
    let hitRemote: Remote | null = null;
    if (this.isHost || true) {
      for (const b of this.bots) {
        if (b.hp <= 0) continue;
        const t = this.rayCapsule(origin, dir, b.x, 0.9, b.z, 0.38, 1.8);
        if (t > 0 && t < best) {
          best = t;
          hitBot = b;
          hitRemote = null;
        }
      }
    }
    for (const r of this.remotes.values()) {
      if (r.hp <= 0) continue;
      const t = this.rayCapsule(origin, dir, r.x, 0.9, r.z, 0.4, 1.8);
      if (t > 0 && t < best) {
        best = t;
        hitRemote = r;
        hitBot = null;
      }
    }
    this.spawnTracer(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, best);
    const hx = origin.x + dir.x * best;
    const hy = origin.y + dir.y * best;
    const hz = origin.z + dir.z * best;
    this.burst(hx, hy, hz, 6, 4);
    if (hitBot && local) {
      hitBot.hostile = true;
      this.hitmarker = 1;
      this.audio.hit();
      if (this.isHost) {
        hitBot.hp -= dmg;
        if (hitBot.hp <= 0) {
          this.player.kills += 1;
          this.hitstop = 0.045;
          this.trauma = Math.min(1, this.trauma + 0.28);
          this.burst(hitBot.x, 1, hitBot.z, 22, 7);
          hitBot.respawn = 7;
        }
      } else {
        // Non-host clients aren't authoritative over bot HP (the host
        // broadcasts it every tick and would otherwise immediately overwrite
        // any local damage), so tell the host what was hit instead. The kill
        // credit/effects arrive back via the next "ai" sync and the bot's hp
        // dropping to 0.
        this.p2p?.send({ t: "botHit", id: hitBot.id, dmg });
        if (hitBot.hp - dmg <= 0) {
          this.hitstop = 0.045;
          this.trauma = Math.min(1, this.trauma + 0.28);
          this.burst(hitBot.x, 1, hitBot.z, 22, 7);
        }
      }
    }
    if (local) {
      // A shot that passes close by an unaware bot still provokes it, and alerts
      // nearby bots (so the player can't snipe a crowd risk-free), but the player
      // always gets the first shot before anyone reacts.
      for (const b of this.bots) {
        if (b.hp <= 0 || b === hitBot) continue;
        const t = this.rayCapsule(origin, dir, b.x, 0.9, b.z, 1.6, 2.6);
        if (t > 0 && t < best) {
          b.hostile = true;
          b.alertT = 6;
        }
      }
    }
    if (hitRemote && local) {
      this.hitmarker = 1;
      this.audio.hit();
      this.p2p?.send({ t: "hit", id: hitRemote.id, dmg });
    }
  }

  private tryHitLocal(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, dmg: number) {
    const t = this.rayCapsule(_o.set(ox, oy, oz), _d.set(dx, dy, dz), this.player.x, this.player.y + 0.9, this.player.z, 0.42, 1.8);
    const wall = rayAabb(ox, oy, oz, dx, dy, dz, 90, this.world.colliders);
    if (t > 0 && t < wall) this.damage(dmg);
  }

  private rayCapsule(o: THREE.Vector3, dir: THREE.Vector3, x: number, y: number, z: number, r: number, h: number) {
    const dx = o.x - x;
    const dz = o.z - z;
    const a = dir.x * dir.x + dir.z * dir.z;
    const b = 2 * (dx * dir.x + dz * dir.z);
    const c = dx * dx + dz * dz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0 || a < 1e-8) return -1;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0) return -1;
    const py = o.y + dir.y * t;
    if (py < y - h * 0.5 || py > y + h * 0.5) return -1;
    return t;
  }

  private tryBomb() {
    if (this.player.bombCd > 0) return;
    if (this.player.bombs <= 0) return;
    this.player.bombs -= 1;
    this.player.bombCd = 0.7;
    const origin = this.camera.getWorldPosition(_o);
    let dir = this.camDir(_d);
    dir = this.aimAssistDir(origin, dir, 0.965, 34, 0.5);
    const vx = dir.x * 18 + (this.player.inCar >= 0 ? -Math.sin(this.player.yaw) * this.vehicles[this.player.inCar].speed * 0.4 : 0);
    const vy = dir.y * 18 + 4;
    const vz = dir.z * 18;
    this.throwGrenade(origin.x + dir.x, origin.y, origin.z + dir.z, vx, vy, vz, true);
    this.p2p?.send({
      t: "bomb",
      x: origin.x,
      y: origin.y,
      z: origin.z,
      vx,
      vy,
      vz,
    });
  }

  private throwGrenade(x: number, y: number, z: number, vx: number, vy: number, vz: number, _local: boolean) {
    const g = this.grenades.find((e) => !e.alive);
    if (!g) return;
    g.alive = true;
    g.x = x;
    g.y = y;
    g.z = z;
    g.vx = vx;
    g.vy = vy;
    g.vz = vz;
    g.fuse = GRENADE_FUSE;
    g.mesh.visible = true;
  }

  private updateGrenades(dt: number) {
    for (const g of this.grenades) {
      if (!g.alive) continue;
      g.vy -= GRAVITY * dt;
      const nx = g.x + g.vx * dt;
      const ny = g.y + g.vy * dt;
      const nz = g.z + g.vz * dt;
      const wall = rayAabb(g.x, g.y, g.z, g.vx, g.vy, g.vz, Math.hypot(g.vx, g.vy, g.vz) * dt + 0.2, this.world.colliders);
      if (wall < 0.25) {
        g.vx *= -0.35;
        g.vz *= -0.35;
        g.vy *= 0.2;
      } else {
        g.x = nx;
        g.z = nz;
        g.y = ny;
      }
      if (g.y < 0.12) {
        g.y = 0.12;
        g.vy *= -0.35;
        g.vx *= 0.7;
        g.vz *= 0.7;
      }
      g.fuse -= dt;
      g.mesh.position.set(g.x, g.y, g.z);
      if (g.fuse <= 0) this.explode(g);
    }
  }

  private explode(g: Grenade) {
    g.alive = false;
    g.mesh.visible = false;
    this.audio.explode();
    this.trauma = Math.min(1, this.trauma + 0.65);
    this.hitstop = 0.06;
    this.blastLight.position.set(g.x, g.y + 0.6, g.z);
    this.blastLight.intensity = 40;
    this.burst(g.x, g.y + 0.4, g.z, 48, 12);
    const dmgAt = (x: number, z: number, y: number) => {
      const d = Math.hypot(x - g.x, z - g.z, y - g.y);
      if (d > BLAST_RADIUS) return 0;
      return BLAST_DMG * (1 - d / BLAST_RADIUS);
    };
    const pd = dmgAt(this.player.x, this.player.z, this.player.y + 1);
    if (pd > 0) this.damage(pd);
    for (const b of this.bots) {
      if (b.hp <= 0) continue;
      const d = dmgAt(b.x, b.z, 1);
      if (d > 0) {
        b.hp -= d;
        if (b.hp <= 0) {
          this.player.kills += 1;
          b.respawn = 7;
        }
      }
    }
    for (const r of this.remotes.values()) {
      const d = dmgAt(r.x, r.z, r.y + 1);
      if (d > 4) this.p2p?.send({ t: "hit", id: r.id, dmg: d });
    }
  }

  private damage(amount: number) {
    if (this.player.invuln > 0 || this.player.hp <= 0) return;
    this.player.hp = Math.max(0, this.player.hp - amount);
    this.player.hurtT = 0.35;
    this.trauma = Math.min(1, this.trauma + 0.35);
    this.audio.hurt();
    if (this.player.hp <= 0) {
      this.player.deadT = 0.01;
      if (this.player.inCar >= 0) {
        this.vehicles[this.player.inCar].occupied = false;
        this.vehicles[this.player.inCar].speed = 0;
        this.player.inCar = -1;
      }
    }
  }

  private respawn() {
    this.player.hp = MAX_HP;
    this.player.deadT = 0;
    // Spread respawns across the map's real spawn points instead of always
    // dropping the player back at the same fixed spot, so you don't
    // immediately re-enter the fight exactly where you died.
    const pts = this.world.spawns;
    const p = pts.length > 0 ? pts[Math.floor(Math.random() * pts.length)] : { x: 2, z: 12 };
    this.player.x = p.x;
    this.player.z = p.z;
    this.player.y = 0;
    this.player.invuln = 2.5;
    this.player.ammo = MAG_SIZE;
    this.player.sniperAmmo = SNIPER_MAG_SIZE;
    this.player.scoped = false;
    this.player.yaw = Math.random() * Math.PI * 2;
  }

  private slowHeal(dt: number) {
    if (this.player.hurtT > 0) return;
    if (this.player.hp <= 0 || this.player.hp >= MAX_HP) return;
    this.player.hp = Math.min(MAX_HP, this.player.hp + 4 * dt);
  }

  private collectCrates() {
    for (const c of this.crates) {
      if (c.taken) continue;
      if (Math.hypot(c.x - this.player.x, c.z - this.player.z) > 1.8) continue;
      c.taken = true;
      c.mesh.visible = false;
      this.audio.pickup();
      if (c.kind === "ammo") this.player.reserve = Math.min(360, this.player.reserve + 90);
      else this.player.bombs = Math.min(16, this.player.bombs + 4);
    }
  }

  private updateBots(dt: number, target: { x: number; z: number; y: number } | null) {
    for (const b of this.bots) {
      if (b.hp <= 0) {
        b.respawn -= dt;
        b.mesh.visible = false;
        if (b.respawn <= 0) {
          const p = this.world.spawns[Math.floor(Math.random() * this.world.spawns.length)];
          b.x = p.x;
          b.z = p.z;
          b.hp = 70;
          b.mesh.visible = true;
          b.hostile = false;
          b.alertT = 0;
        }
        continue;
      }
      b.mesh.visible = true;
      b.fireCd = Math.max(0, b.fireCd - dt);
      b.alertT = Math.max(0, b.alertT - dt);
      let tx = b.x;
      let tz = b.z;
      let aggro = false;
      // Bots only fight back once the player has provoked them (shot at/near
      // them or hit them) — this applies in every mode, including
      // multiplayer, so bots present a real threat there too once someone
      // opens fire on them.
      if (target && b.hostile) {
        const dist = Math.hypot(target.x - b.x, target.z - b.z);
        const los =
          rayAabb(b.x, 1.4, b.z, (target.x - b.x) / (dist || 1), 0, (target.z - b.z) / (dist || 1), dist, this.world.colliders) >=
          dist - 0.4;
        if (dist < 48 && los) {
          aggro = true;
          tx = target.x;
          tz = target.z;
          const want = Math.atan2(-(tx - b.x), -(tz - b.z));
          b.yaw = lerpAngle(b.yaw, want, 1 - Math.exp(-8 * dt));
          if (dist > 12) {
            const fx = -Math.sin(b.yaw);
            const fz = -Math.cos(b.yaw);
            b.x += fx * 4.2 * dt;
            b.z += fz * 4.2 * dt;
            b.walk += dt * 8;
          }
          if (dist < 36 && b.fireCd <= 0) {
            b.fireCd = 0.38 + Math.random() * 0.25;
            const origin = _o.set(b.x, 1.45, b.z);
            const dir = _d.set(target.x - b.x, target.y + 1.4 - 1.45, target.z - b.z).normalize();
            dir.x += (Math.random() - 0.5) * 0.08;
            dir.y += (Math.random() - 0.5) * 0.05;
            dir.z += (Math.random() - 0.5) * 0.08;
            dir.normalize();
            const wall = rayAabb(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 50, this.world.colliders);
            const tHit = this.rayCapsule(origin, dir, this.player.x, this.player.y + 0.9, this.player.z, 0.42, 1.8);
            this.spawnTracer(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, Math.min(wall, tHit > 0 ? tHit : wall));
            if (tHit > 0 && tHit < wall) this.damage(11);
          }
        }
      }
      if (!aggro) {
        const wp = this.world.waypoints[b.wp];
        tx = wp.x;
        tz = wp.z;
        const dist = Math.hypot(tx - b.x, tz - b.z);
        const want = Math.atan2(-(tx - b.x), -(tz - b.z));
        b.yaw = lerpAngle(b.yaw, want, 1 - Math.exp(-5 * dt));
        if (dist < 2.5) b.wp = (b.wp + 1 + (b.id % 3)) % this.world.waypoints.length;
        else {
          const fx = -Math.sin(b.yaw);
          const fz = -Math.cos(b.yaw);
          b.x += fx * 3.3 * dt;
          b.z += fz * 3.3 * dt;
          b.walk += dt * 6;
        }
      }
      const res = resolveCircle(b.x, b.z, 0.4, this.world.colliders);
      b.x = res.x;
      b.z = res.z;
    }
  }

  private updateRemotes(dt: number) {
    const k = 1 - Math.exp(-12 * dt);
    for (const r of this.remotes.values()) {
      r.x += (r.tx - r.x) * k;
      r.y += (r.ty - r.y) * k;
      r.z += (r.tz - r.z) * k;
      r.yaw = lerpAngle(r.yaw, r.tyaw, k);
      const inCar = r.car >= 0 && r.car < this.vehicles.length;
      // A remote driving a car we're also sitting in would fight the local
      // player's own authoritative control of that car's mesh, so only the
      // driver's own client visually drives a given vehicle.
      const drivesSharedMesh = inCar && r.car !== this.player.inCar;
      r.mesh.visible = r.hp > 0 && !inCar;
      if (!inCar) {
        r.mesh.position.set(r.x, r.y, r.z);
        r.mesh.rotation.y = r.yaw;
      } else if (drivesSharedMesh) {
        const car = this.vehicles[r.car];
        car.x = r.x;
        car.z = r.z;
        car.yaw = r.yaw;
        car.mesh.position.set(car.x, car.y, car.z);
        car.mesh.rotation.y = car.yaw;
        car.mesh.visible = true;
      }
    }
  }

  private spawnTracer(x: number, y: number, z: number, dx: number, dy: number, dz: number, dist: number) {
    const tr = this.tracers.find((t) => t.life <= 0) || this.tracers[0];
    tr.life = 0.08;
    tr.mesh.visible = true;
    const arr = tr.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const len = Math.min(dist, 38);
    arr.setXYZ(0, x, y, z);
    arr.setXYZ(1, x + dx * len, y + dy * len, z + dz * len);
    arr.needsUpdate = true;
  }

  private burst(x: number, y: number, z: number, n: number, spd: number) {
    let spawned = 0;
    for (let i = 0; i < this.pLife.length && spawned < n; i++) {
      if (this.pLife[i] > 0) continue;
      this.pLife[i] = 0.35 + Math.random() * 0.4;
      const i3 = i * 3;
      this.pPos[i3] = x;
      this.pPos[i3 + 1] = y;
      this.pPos[i3 + 2] = z;
      this.pVel[i3] = (Math.random() - 0.5) * spd;
      this.pVel[i3 + 1] = Math.random() * spd;
      this.pVel[i3 + 2] = (Math.random() - 0.5) * spd;
      spawned++;
    }
  }

  private renderVisuals(dt: number) {
    this.blastLight.intensity *= Math.max(0, 1 - dt * 8);
    this.gunLight.intensity = 1.4 + this.muzzle * 18;
    const activeWeaponMesh = this.player.weapon === "sniper" ? this.sniper : this.gun;
    const flash = activeWeaponMesh.userData.flash as THREE.Mesh | undefined;
    if (flash) {
      const m = flash.material as THREE.MeshBasicMaterial;
      m.opacity = this.muzzle;
      flash.scale.setScalar(0.6 + this.muzzle * 1.8);
    }

    for (const tr of this.tracers) {
      if (tr.life <= 0) {
        tr.mesh.visible = false;
        continue;
      }
      tr.life -= dt;
      (tr.mesh.material as THREE.LineBasicMaterial).opacity = Math.max(0, tr.life * 10);
    }

    for (let i = 0; i < this.pLife.length; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const i3 = i * 3;
      this.pVel[i3 + 1] -= 8 * dt;
      this.pPos[i3] += this.pVel[i3] * dt;
      this.pPos[i3 + 1] += this.pVel[i3 + 1] * dt;
      this.pPos[i3 + 2] += this.pVel[i3 + 2] * dt;
    }
    (this.particles.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;

    for (const car of this.vehicles) {
      car.mesh.position.set(car.x, 0, car.z);
      car.mesh.rotation.y = car.yaw;
    }
    for (const b of this.bots) {
      if (b.hp <= 0) continue;
      b.mesh.position.set(b.x, 0, b.z);
      b.mesh.rotation.y = b.yaw;
      const l = b.mesh.userData.lLeg as THREE.Object3D;
      const r = b.mesh.userData.rLeg as THREE.Object3D;
      if (l && r) {
        l.rotation.x = Math.sin(b.walk) * 0.55;
        r.rotation.x = Math.sin(b.walk + Math.PI) * 0.55;
      }
    }
    for (const c of this.crates) {
      if (c.taken) continue;
      c.mesh.rotation.y += dt * 0.6;
      c.mesh.position.y = Math.sin(this.menuT * 2 + c.x) * 0.08;
    }

    this.updateCamera(dt);
    const weaponsOn = this.playing && this.player.inCar < 0 && this.player.hp > 0;
    // Gun view-model temporarily disabled: it was rendered via a second
    // camera-layer pass that turned out to be wiping the world out from
    // under it every frame (see draw()). Keeping it hidden entirely for
    // now guarantees the world always renders; the view-model can come
    // back once it's drawn a safer way that doesn't need a second
    // renderer.render() call per frame.
    this.gun.visible = false;
    this.sniper.visible = false;
    const activeGun = this.player.weapon === "sniper" ? this.sniper : this.gun;
    if (weaponsOn) {
      const kick = this.muzzle * 0.04;
      const scopeDip = this.player.scoped ? -0.16 : 0;
      activeGun.position.set(0.28 + (this.player.scoped ? -0.28 : 0), -0.22 - Math.sin(this.player.bob) * 0.02 + scopeDip, -0.52 - kick);
      activeGun.rotation.set(0.04 + this.muzzle * 0.08, 0.08, 0.02);
    }

    const water = this.world.group.children.find(
      (ch) => ch instanceof THREE.Mesh && (ch.material as THREE.MeshStandardMaterial).normalMap,
    ) as THREE.Mesh | undefined;
    if (water) {
      const n = (water.material as THREE.MeshStandardMaterial).normalMap;
      if (n) {
        n.offset.x += dt * 0.03;
        n.offset.y += dt * 0.02;
      }
    }
  }

  private updateCamera(dt: number) {
    const shake = this.trauma * this.trauma;
    const sx = (Math.random() - 0.5) * shake * 0.35;
    const sy = (Math.random() - 0.5) * shake * 0.28;
    if (!this.playing) {
      const r = 24;
      const t = this.menuT * 0.1;
      this.camera.position.set(Math.sin(t) * r, 5.2, Math.cos(t) * r);
      this.camera.lookAt(0, 2.4, 0);
      this.camera.fov = 60;
      this.camera.updateProjectionMatrix();
      return;
    }
    if (this.player.inCar >= 0) {
      const car = this.vehicles[this.player.inCar];
      const fx = -Math.sin(car.yaw);
      const fz = -Math.cos(car.yaw);
      const dist = 8.4;
      const height = 3.6;
      _camPos.set(car.x - fx * dist, height, car.z - fz * dist);
      const k = 1 - Math.exp(-6.5 * dt);
      this.camera.position.lerp(_camPos, k);
      _look.set(car.x + fx * 6, 1.15, car.z + fz * 6);
      this.camera.lookAt(_look);
      const spd = Math.abs(car.speed);
      const wantFov = 68 + Math.min(14, spd * 0.35);
      this.camera.fov += (wantFov - this.camera.fov) * (1 - Math.exp(-4 * dt));
      this.camera.updateProjectionMatrix();
      this.camera.position.x += sx;
      this.camera.position.y += sy;
      return;
    }
    const bob = Math.sin(this.player.bob) * 0.035;
    // Defensive: never let a corrupted position (Infinity/NaN from some
    // upstream physics edge case) permanently break the on-foot camera —
    // once the camera's world position goes non-finite, nothing in the
    // scene can ever come back into view again, even after the underlying
    // cause is gone, because every future frame keeps reading the same
    // broken player.x/y/z.
    if (!Number.isFinite(this.player.x) || !Number.isFinite(this.player.y) || !Number.isFinite(this.player.z)) {
      this.player.x = 2;
      this.player.y = 0;
      this.player.z = 12;
    }
    if (!Number.isFinite(this.player.yaw)) this.player.yaw = 0;
    if (!Number.isFinite(this.player.pitch)) this.player.pitch = 0;
    // Last-resort safety net: if the player's x/z ever end up inside a
    // building's footprint despite the per-frame collision resolve (e.g. a
    // spawn point placed too close to geometry, or a case the resolver
    // doesn't catch), push straight back out here too, right before the
    // camera reads this position — this is exactly what "camera stuck
    // inside a wall, world looks blank" looks like, since the interior
    // faces of solid geometry render as nothing once backface-culled.
    const fixed = resolveCircle(this.player.x, this.player.z, PLAYER_RADIUS, this.world.colliders);
    this.player.x = fixed.x;
    this.player.z = fixed.z;
    _camPos.set(this.player.x, this.player.y + PLAYER_EYE + bob, this.player.z);
    this.camera.position.copy(_camPos);
    this.camera.position.x += sx;
    this.camera.position.y += sy;
    // Same technique as the vehicle camera above: derive the rotation from
    // lookAt() instead of setting Euler angles on camera.rotation directly.
    const cp = Math.cos(this.player.pitch);
    _look.set(
      this.player.x + -Math.sin(this.player.yaw) * cp,
      this.player.y + PLAYER_EYE + bob + Math.sin(this.player.pitch),
      this.player.z + -Math.cos(this.player.yaw) * cp,
    );
    this.camera.lookAt(_look);
    const wantFootFov = this.player.scoped ? SNIPER_SCOPE_FOV : 74;
    // Snap into the scope quickly (feels responsive) but ease back out a bit
    // slower, matching how most shooters handle aim-down-sights transitions.
    const fovRate = this.player.scoped ? 10 : 6;
    this.camera.fov += (wantFootFov - this.camera.fov) * (1 - Math.exp(-fovRate * dt));
    this.camera.updateProjectionMatrix();
  }

  private draw() {
    // Simplified to a single render call, no layer split. The second
    // (layer-1, gun) pass was the actual bug: whenever it ran, it wiped the
    // first pass's fully-rendered world back to a blank background before
    // drawing the gun on top — most likely Three.js repainting
    // scene.background as part of every render() call regardless of our
    // manual clear()/autoClear=false setup. That pass never ran while
    // driving (the gun is hidden in a car), which is exactly why the car
    // view always worked and the on-foot view never did. Dropping the gun
    // overlay entirely for now guarantees the world renders the same way
    // in every state; the gun-on-top-of-world layering can come back later
    // done a different way (e.g. temporarily clearing scene.background
    // instead of relying on a second full render pass).
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.renderer.clear();
    this.camera.layers.enableAll();
    this.renderer.render(this.scene, this.camera);
  }

  private resize() {
    // Read the viewport directly rather than trusting parentElement's
    // measured clientHeight: the canvas's parent is `fixed inset-0`, so it
    // should always equal the viewport, but a ResizeObserver callback (or
    // an SSR/hydration timing gap) can occasionally fire with a stale or
    // not-yet-settled clientHeight — which silently desyncs the renderer's
    // internal drawing-buffer resolution from the canvas's actual on-screen
    // CSS size (setSize's 3rd arg below intentionally leaves the CSS size
    // alone), stretching a much-shorter-than-intended render across the
    // full element and making most of the world appear to vanish.
    const parent = this.canvas.parentElement || this.canvas;
    const w = Math.max(1, window.innerWidth || parent.clientWidth);
    const h = Math.max(1, window.innerHeight || parent.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private inviteUrl() {
    if (typeof window === "undefined" || !this.room) return "";
    const u = new URL(window.location.href);
    u.searchParams.set("mode", "friends");
    u.searchParams.set("room", this.room);
    return u.toString();
  }

  private emitHud() {
    if (!this.onHud) return;
    const spd = this.player.inCar >= 0 ? Math.abs(this.vehicles[this.player.inCar]?.speed ?? 0) : 0;
    const blips = [
      ...this.bots.filter((b) => b.hp > 0).map((b) => ({ x: b.x, z: b.z, kind: "bot" as const })),
      ...[...this.remotes.values()].map((r) => ({ x: r.x, z: r.z, kind: "friend" as const })),
      ...this.vehicles.map((v) => ({ x: v.x, z: v.z, kind: "car" as const })),
    ];
    // Project each remote player's head (or car roof, if driving) into
    // screen space so the UI layer can draw a name tag over them. sx/sy are
    // 0..1 fractions of the viewport; visible is false when the point is
    // behind the camera or too far to bother labeling.
    const nameTags: NameTag[] = [];
    for (const r of this.remotes.values()) {
      if (r.hp <= 0) continue;
      const inCar = r.car >= 0 && r.car < this.vehicles.length;
      if (inCar) {
        const car = this.vehicles[r.car];
        _tagWorld.set(car.x, car.y + 2.35, car.z);
      } else {
        _tagWorld.set(r.x, r.y + 2.35, r.z);
      }
      const camPos = this.camera.getWorldPosition(_camPos);
      const dist = camPos.distanceTo(_tagWorld);
      _tagProj.copy(_tagWorld).project(this.camera);
      const visible = _tagProj.z < 1 && dist < 90;
      nameTags.push({
        id: r.id,
        name: r.name,
        sx: (_tagProj.x + 1) / 2,
        sy: (1 - _tagProj.y) / 2,
        visible,
        dist,
      });
    }
    const hud: GameHud = {
      playing: this.playing,
      health: Math.max(0, this.player.hp),
      maxHealth: MAX_HP,
      ammo: this.player.weapon === "sniper" ? this.player.sniperAmmo : this.player.ammo,
      reserve: this.player.weapon === "sniper" ? this.player.sniperReserve : this.player.reserve,
      bombs: this.player.bombs,
      kills: this.player.kills,
      speed: spd,
      inVehicle: this.player.inCar >= 0,
      prompt: this.playing ? this.prompt : "",
      mode: this.mode,
      peers: this.peers.map((p) => ({ id: p.id, name: p.name, state: p.connectionState, rtt: p.rttMs })),
      room: this.room,
      inviteUrl: this.inviteUrl(),
      dead: this.playing && this.player.hp <= 0,
      objective: this.mode === "friends" ? "Hold the district with your crew" : "Clear hostiles across the district",
      hitmarker: this.hitmarker,
      aimLocked: this.aimLocked,
      weapon: this.player.weapon,
      scoped: this.player.scoped,
      hurt: this.player.hurtT,
      reloading: this.player.reloadT > 0,
      fps: this.fps,
      connected: this.joined,
      blips,
      nameTags,
      yaw: this.player.inCar >= 0 ? this.vehicles[this.player.inCar].yaw : this.player.yaw,
      x: this.player.x,
      z: this.player.z,
      pointerLocked: this.input.pointerLocked,
      isTouch: typeof window !== "undefined" && "ontouchstart" in window,
    };
    this.onHud(hud);
  }

  private wireProbe() {
    window.__controlsTest = {
      getYaw: () => (this.player.inCar >= 0 ? this.vehicles[this.player.inCar].yaw : this.player.yaw),
      getSpeed: () => {
        if (this.player.inCar >= 0) return Math.abs(this.vehicles[this.player.inCar].speed);
        return this.input.overrideKeys?.includes("KeyW") ? WALK_SPEED : 0;
      },
      setSteer: (v: number) => {
        if (!this.playing) this.play("ai");
        this.enterNearestCar();
        this.input.overrideSteer = v;
      },
      setKeys: (codes: string[]) => {
        if (!this.playing) this.play("ai");
        if (codes.length) this.enterNearestCar();
        this.input.overrideKeys = codes.length ? codes : null;
        if (!codes.length) this.input.overrideSteer = null;
      },
    };
  }
}
