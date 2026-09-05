export const STEP = 1 / 60;
export const WORLD = 392;
export const HALF = WORLD / 2;
export const CELL = 56;
export const ROAD = 16;
export const PLOT = CELL - ROAD;

export const WALK_SPEED = 6.4;
export const SPRINT_SPEED = 9.6;
export const PLAYER_RADIUS = 0.42;
export const PLAYER_EYE = 1.64;
export const JUMP_VEL = 7.2;
export const GRAVITY = 22;
export const MAX_HP = 200;

export const CAR_MAX = 34;
export const CAR_ACCEL = 24;
export const CAR_BRAKE = 40;
export const CAR_TURN = 2.55;
export const CAR_DRAG = 0.55;
export const CAR_RADIUS = 1.35;

export const RIFLE_DMG = 19;
export const RIFLE_INTERVAL = 60 / 640;
export const MAG_SIZE = 30;
export const RELOAD_TIME = 1.65;
export const GRENADE_FUSE = 1.85;
export const BLAST_RADIUS = 11;
export const BLAST_DMG = 82;

export const SNIPER_DMG = 120;
export const SNIPER_INTERVAL = 1.35;
export const SNIPER_MAG_SIZE = 5;
export const SNIPER_RELOAD_TIME = 2.6;
export const SNIPER_SCOPE_FOV = 22;

export type Weapon = "rifle" | "sniper";

export type Mode = "ai" | "friends";

export type Aabb = {
  minx: number;
  miny: number;
  minz: number;
  maxx: number;
  maxy: number;
  maxz: number;
};

export type Footprint = { x: number; z: number; w: number; d: number };

export type PeerHud = {
  id: string;
  name: string;
  state: string;
  rtt: number | null;
};

export type Blip = { x: number; z: number; kind: "bot" | "friend" | "car" };

export type NameTag = { id: string; name: string; sx: number; sy: number; visible: boolean; dist: number };

export type GameHud = {
  playing: boolean;
  health: number;
  maxHealth: number;
  ammo: number;
  reserve: number;
  bombs: number;
  kills: number;
  speed: number;
  inVehicle: boolean;
  prompt: string;
  mode: Mode | null;
  peers: PeerHud[];
  room: string;
  inviteUrl: string;
  dead: boolean;
  objective: string;
  hitmarker: number;
  aimLocked: boolean;
  hurt: number;
  reloading: boolean;
  fps: number;
  connected: boolean;
  blips: Blip[];
  nameTags: NameTag[];
  yaw: number;
  x: number;
  z: number;
  pointerLocked: boolean;
  isTouch: boolean;
  weapon: Weapon;
  scoped: boolean;
};

export type ControlsProbe = {
  getYaw: () => number;
  getSpeed: () => number;
  setSteer?: (v: number) => void;
  setKeys?: (codes: string[]) => void;
};

declare global {
  interface Window {
    __controlsTest?: ControlsProbe;
  }
}
