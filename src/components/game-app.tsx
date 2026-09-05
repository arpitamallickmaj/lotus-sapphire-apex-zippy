import { useCallback, useEffect, useRef, useState } from "react";
import { Car, Copy, Link2, Volume2, VolumeX, Users } from "lucide-react";
import type { GameEngine } from "@/game/engine";
import type { Footprint, GameHud, Mode, Weapon } from "@/game/types";

const EMPTY: GameHud = {
  playing: false,
  health: 200,
  maxHealth: 200,
  ammo: 30,
  reserve: 120,
  bombs: 5,
  kills: 0,
  speed: 0,
  inVehicle: false,
  prompt: "",
  mode: null,
  peers: [],
  room: "",
  inviteUrl: "",
  dead: false,
  objective: "",
  hitmarker: 0,
  aimLocked: false,
  weapon: "rifle",
  scoped: false,
  hurt: 0,
  reloading: false,
  fps: 0,
  connected: false,
  blips: [],
  nameTags: [],
  yaw: 0,
  x: 0,
  z: 0,
  pointerLocked: false,
  isTouch: false,
};

type Props = {
  initialMode?: Mode;
  initialRoom?: string;
};

export function GameApp({ initialMode, initialRoom }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const hudRef = useRef<GameHud>(EMPTY);
  const [hud, setHud] = useState<GameHud>(EMPTY);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("Outrider");
  const [copied, setCopied] = useState(false);
  const [muted, setMuted] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const footprints = useRef<Footprint[]>([]);
  const stickRef = useRef<HTMLDivElement>(null);
  const lookRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let engine: GameEngine | null = null;
    (async () => {
      try {
        const { GameEngine: Eng } = await import("@/game/engine");
        if (cancelled) return;
        engine = new Eng(canvas, (h) => {
          hudRef.current = h;
        });
        engineRef.current = engine;
        footprints.current = engine.footprints;
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not start the renderer");
      }
    })();
    const id = window.setInterval(() => {
      setHud({ ...hudRef.current });
    }, 80);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      engine?.dispose();
      engineRef.current = null;
    };
  }, []);

  const start = useCallback(
    (mode: Mode) => {
      engineRef.current?.play(mode, mode === "friends" ? initialRoom : undefined, name);
      if (mode === "friends") setInviteOpen(true);
    },
    [initialRoom, name],
  );

  const copyInvite = async () => {
    const url = hud.inviteUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" && hud.playing && hud.mode === "friends") setInviteOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hud.playing, hud.mode]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-bg text-fg touch-none select-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-0 size-full"
        onContextMenu={(e) => e.preventDefault()}
      />

      {hud.playing && (
        <div className="pointer-events-none absolute bottom-1 left-1 z-40 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white/70">
          canvas {canvasRef.current?.width ?? "?"}×{canvasRef.current?.height ?? "?"} · win{" "}
          {typeof window !== "undefined" ? window.innerWidth : "?"}×
          {typeof window !== "undefined" ? window.innerHeight : "?"}
        </div>
      )}

      {hud.hurt > 0 && (
        <div
          className="pointer-events-none absolute inset-0 bg-danger/25"
          style={{ opacity: Math.min(0.45, hud.hurt * 1.2) }}
        />
      )}

      <Minimap hud={hud} footprints={footprints.current} />

      {hud.playing &&
        hud.nameTags
          .filter((t) => t.visible)
          .map((t) => (
            <div
              key={t.id}
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full border border-border/60 bg-surface/70 px-2 py-0.5 font-display text-xs tracking-wide text-fg backdrop-blur-sm"
              style={{
                left: `${t.sx * 100}%`,
                top: `${t.sy * 100}%`,
                opacity: Math.max(0.3, 1 - t.dist / 90),
              }}
            >
              {t.name}
            </div>
          ))}

      {!hud.playing && (
        <Menu
          ready={ready}
          error={error}
          name={name}
          setName={setName}
          onAi={() => start("ai")}
          onFriends={() => start("friends")}
          joinRoom={initialMode === "friends" && Boolean(initialRoom)}
          room={initialRoom}
        />
      )}

      {hud.playing && <Hud hud={hud} />}

      {hud.playing && (
        <TouchPad
          stickRef={stickRef}
          lookRef={lookRef}
          inVehicle={hud.inVehicle}
          aimLocked={hud.aimLocked}
          weapon={hud.weapon}
          scoped={hud.scoped}
          onMove={(x, y) => engineRef.current?.setVirtualMove(x, y)}
          onLook={(x, y) => engineRef.current?.setVirtualLook(x, y)}
          onFire={(v) => engineRef.current?.setVirtualFire(v)}
          onBomb={() => engineRef.current?.pressBomb()}
          onEnter={() => engineRef.current?.pressInteract()}
          onJump={() => engineRef.current?.pressJump()}
          onSwitchWeapon={() => engineRef.current?.pressSwitchWeapon()}
          onScope={(v) => engineRef.current?.setScope(v)}
        />
      )}

      {hud.playing && (
        <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
          {hud.mode === "friends" && (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="flex size-11 items-center justify-center rounded-lg border border-border bg-surface text-fg"
              aria-label="Invite"
            >
              <Link2 className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setMuted((m) => {
                const next = !m;
                engineRef.current?.setMuted(next);
                return next;
              });
            }}
            className="flex size-11 items-center justify-center rounded-lg border border-border bg-surface text-fg"
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
        </div>
      )}

      {inviteOpen && hud.mode === "friends" && (
        <InvitePanel
          url={hud.inviteUrl}
          room={hud.room}
          peers={hud.peers}
          connected={hud.connected}
          copied={copied}
          onCopy={copyInvite}
          onClose={() => setInviteOpen(false)}
        />
      )}
    </div>
  );
}

function Menu({
  ready,
  error,
  name,
  setName,
  onAi,
  onFriends,
  joinRoom,
  room,
}: {
  ready: boolean;
  error: string | null;
  name: string;
  setName: (v: string) => void;
  onAi: () => void;
  onFriends: () => void;
  joinRoom: boolean;
  room?: string;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-5 pt-8 sm:p-10">
      <header className="pointer-events-auto max-w-xl">
        <p className="font-mono text-xs tracking-[0.28em] text-muted uppercase">Open world</p>
        <h1 className="font-display mt-1 text-6xl font-semibold leading-none tracking-tight text-fg sm:text-8xl">
          RIDGEFALL
        </h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-muted sm:text-base">
          Dusk over the industrial waterfront. Take a car, clear the streets, or send a friend the link and
          share the district.
        </p>
      </header>

      <div className="pointer-events-auto w-full max-w-lg space-y-4 rounded-xl border border-border bg-surface/90 p-4 sm:p-5">
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="block">
          <span className="text-xs tracking-wide text-muted uppercase">Callsign</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 20))}
            className="mt-1 h-11 w-full rounded-md border border-border bg-bg px-3 text-fg outline-none focus:border-accent"
            maxLength={20}
            autoComplete="nickname"
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          {joinRoom ? (
            <button
              type="button"
              disabled={!ready}
              onClick={onFriends}
              className="col-span-full h-12 rounded-lg bg-accent text-sm font-medium tracking-wide text-accent-fg disabled:opacity-40"
            >
              Join world {room ? room.toUpperCase() : ""}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={!ready}
                onClick={onAi}
                className="h-12 rounded-lg bg-accent text-sm font-medium tracking-wide text-accent-fg disabled:opacity-40"
              >
                Start skirmish
              </button>
              <button
                type="button"
                disabled={!ready}
                onClick={onFriends}
                className="h-12 rounded-lg border border-border bg-surface-2 text-sm font-medium tracking-wide text-fg disabled:opacity-40"
              >
                Play with friends
              </button>
            </>
          )}
        </div>
        <p className="text-xs leading-relaxed text-subtle">
          WASD move · Mouse/drag look · LMB / Space fire · G / RMB grenade · E enter car · R reload · Q switch weapon · C
          scope · Shift sprint
        </p>
      </div>
    </div>
  );
}

function Hud({ hud }: { hud: GameHud }) {
  if (hud.scoped) {
    return (
      <>
        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
          <div
            className="absolute left-1/2 top-1/2 aspect-square h-[92vh] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ boxShadow: "0 0 0 100vmax black" }}
          >
            <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
              <line x1="50" y1="0" x2="50" y2="44" stroke="#dfe3e8" strokeWidth="0.4" />
              <line x1="50" y1="56" x2="50" y2="100" stroke="#dfe3e8" strokeWidth="0.4" />
              <line x1="0" y1="50" x2="44" y2="50" stroke="#dfe3e8" strokeWidth="0.4" />
              <line x1="56" y1="50" x2="100" y2="50" stroke="#dfe3e8" strokeWidth="0.4" />
              {[20, 35, 65, 80].map((x) => (
                <line key={x} x1={x} y1="48.5" x2={x} y2="51.5" stroke="#dfe3e8" strokeWidth="0.35" />
              ))}
              {[20, 35, 65, 80].map((y) => (
                <line key={y} x1="48.5" y1={y} x2="51.5" y2={y} stroke="#dfe3e8" strokeWidth="0.35" />
              ))}
              <circle cx="50" cy="50" r="1.1" fill={hud.hitmarker > 0.2 ? "#c45c4a" : hud.aimLocked ? "#7d9a7a" : "#dfe3e8"} />
            </svg>
          </div>
        </div>
        <HudPanels hud={hud} />
      </>
    );
  }
  return (
    <>
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 transition-transform"
        style={{
          opacity: hud.inVehicle ? 0.35 : 1,
          transform: `translate(-50%, -50%) scale(${hud.aimLocked ? 1.35 : 1})`,
        }}
      >
        <div
          className={`size-1 rounded-full ${hud.hitmarker > 0.2 ? "bg-danger" : hud.aimLocked ? "bg-ok" : "bg-fg"}`}
        />
        <div
          className={`absolute left-1/2 top-1/2 h-4 w-px -translate-x-1/2 -translate-y-1/2 ${hud.aimLocked ? "bg-ok" : "bg-fg/70"}`}
        />
        <div
          className={`absolute left-1/2 top-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 ${hud.aimLocked ? "bg-ok" : "bg-fg/70"}`}
        />
      </div>

      <HudPanels hud={hud} />
    </>
  );
}

function HudPanels({ hud }: { hud: GameHud }) {
  return (
    <>
      <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-xs space-y-3 sm:left-6 sm:top-6">
        <div>
          <div className="mb-1 flex items-center justify-between gap-4 text-xs tracking-wide text-muted uppercase">
            <span>Vital</span>
            <span className="font-mono text-fg">{Math.round(hud.health)}</span>
          </div>
          <div className="h-1.5 w-44 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full ${hud.health < hud.maxHealth * 0.32 ? "bg-danger" : "bg-accent"}`}
              style={{ width: `${(hud.health / hud.maxHealth) * 100}%` }}
            />
          </div>
        </div>
        <p className="text-xs text-muted">{hud.objective}</p>
        {hud.prompt && (
          <p className="inline-flex items-center gap-2 rounded-md border border-border bg-surface/80 px-3 py-1.5 text-sm text-fg">
            <Car className="size-3.5 text-muted" />
            {hud.prompt}
          </p>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-6 right-4 z-10 text-right sm:bottom-8 sm:right-6">
        <div className="font-display text-5xl font-semibold leading-none tabular-nums text-fg">
          {hud.reloading ? "—" : hud.ammo}
          <span className="ml-1 text-xl text-muted">/{hud.reserve}</span>
        </div>
        <p className="mt-1 font-mono text-xs tracking-wide text-muted uppercase">
          {hud.reloading ? "Reloading" : hud.weapon === "sniper" ? "Sniper" : "Rifle"} · {hud.bombs} charges
        </p>
        {hud.inVehicle && (
          <p className="mt-2 font-mono text-lg tabular-nums text-fg">
            {Math.round(hud.speed * 3.6)}
            <span className="ml-1 text-xs text-muted">KM/H</span>
          </p>
        )}
        <p className="mt-2 font-mono text-xs text-subtle">{hud.kills} down</p>
      </div>

      {hud.dead && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-bg/50">
          <p className="font-display text-4xl tracking-tight text-fg">Down · returning</p>
        </div>
      )}
    </>
  );
}

function Minimap({ hud, footprints }: { hud: GameHud; footprints: Footprint[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#121318";
    ctx.fillRect(0, 0, w, h);
    const scale = 0.42;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-hud.yaw);
    ctx.translate(-hud.x * scale, -hud.z * scale);
    ctx.fillStyle = "#2a2b32";
    for (const f of footprints) {
      ctx.fillRect((f.x - f.w / 2) * scale, (f.z - f.d / 2) * scale, f.w * scale, f.d * scale);
    }
    for (const b of hud.blips) {
      ctx.fillStyle = b.kind === "bot" ? "#c45c4a" : b.kind === "friend" ? "#7d9a7a" : "#8b8d94";
      ctx.fillRect(b.x * scale - 2, b.z * scale - 2, 4, 4);
    }
    ctx.restore();
    ctx.fillStyle = "#f1f0ec";
    ctx.beginPath();
    ctx.moveTo(w / 2, h / 2 - 7);
    ctx.lineTo(w / 2 - 4, h / 2 + 5);
    ctx.lineTo(w / 2 + 4, h / 2 + 5);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#2a2b32";
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }, [hud, footprints]);

  if (!hud.playing) return null;
  return (
    <canvas
      ref={ref}
      width={148}
      height={148}
      className="pointer-events-none absolute right-4 top-16 z-10 rounded-md opacity-90 sm:right-6 sm:top-20"
    />
  );
}

function InvitePanel({
  url,
  room,
  peers,
  connected,
  copied,
  onCopy,
  onClose,
}: {
  url: string;
  room: string;
  peers: GameHud["peers"];
  connected: boolean;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex items-end justify-center bg-bg/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs tracking-[0.2em] text-muted uppercase">World link</p>
            <h2 className="font-display mt-1 text-3xl font-semibold tracking-tight">Invite a friend</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-10 rounded-md border border-border text-sm text-muted"
          >
            Close
          </button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Send this link. They drop into the same district. Casual co-op — no accounts.
        </p>
        <div className="mt-4 flex gap-2">
          <div className="h-11 flex-1 truncate rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg">
            {url || room}
          </div>
          <button
            type="button"
            onClick={onCopy}
            className="flex h-11 items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg"
          >
            <Copy className="size-4" />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Users className="size-4" />
          {connected ? `${peers.length} linked` : "Connecting…"}
        </div>
        <ul className="mt-2 space-y-1">
          {peers.map((p) => (
            <li key={p.id} className="flex justify-between font-mono text-xs text-fg">
              <span>{p.name || p.id}</span>
              <span className="text-muted">
                {p.state}
                {p.rtt != null ? ` · ${p.rtt}ms` : ""}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-subtle">Click the world to keep playing. ESC toggles this panel.</p>
      </div>
    </div>
  );
}

function TouchPad({
  stickRef,
  lookRef,
  inVehicle,
  aimLocked,
  weapon,
  scoped,
  onMove,
  onLook,
  onFire,
  onBomb,
  onEnter,
  onJump,
  onSwitchWeapon,
  onScope,
}: {
  stickRef: React.RefObject<HTMLDivElement | null>;
  lookRef: React.RefObject<HTMLDivElement | null>;
  inVehicle: boolean;
  aimLocked: boolean;
  weapon: Weapon;
  scoped: boolean;
  onMove: (x: number, y: number) => void;
  onLook: (x: number, y: number) => void;
  onFire: (v: boolean) => void;
  onBomb: () => void;
  onEnter: () => void;
  onJump: () => void;
  onSwitchWeapon: () => void;
  onScope: (v: boolean) => void;
}) {
  const origin = useRef({ x: 0, y: 0, id: -1 });
  const lookId = useRef(-1);
  const lastLook = useRef({ x: 0, y: 0 });

  return (
    <div className="absolute inset-0 z-20 md:pointer-events-none md:hidden">
      <div
        ref={stickRef}
        className="absolute bottom-6 left-4 size-32 rounded-full border border-border bg-surface/40"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          origin.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        }}
        onPointerMove={(e) => {
          if (e.pointerId !== origin.current.id) return;
          const dx = (e.clientX - origin.current.x) / 48;
          const dy = (e.clientY - origin.current.y) / 48;
          const m = Math.hypot(dx, dy) || 1;
          const s = Math.min(1, m);
          onMove((dx / m) * s, (-dy / m) * s);
        }}
        onPointerUp={() => {
          origin.current.id = -1;
          onMove(0, 0);
        }}
        onPointerCancel={() => {
          origin.current.id = -1;
          onMove(0, 0);
        }}
      />
      <div
        ref={lookRef}
        className="absolute inset-y-0 right-0 left-40 md:left-1/2"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          lookId.current = e.pointerId;
          lastLook.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          if (e.pointerId !== lookId.current) return;
          onLook(e.clientX - lastLook.current.x, e.clientY - lastLook.current.y);
          lastLook.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => {
          lookId.current = -1;
        }}
        onPointerCancel={() => {
          lookId.current = -1;
        }}
      />
      <div className="absolute right-4 bottom-6 flex flex-col gap-2">
        <button
          type="button"
          className={`size-16 rounded-full border text-xs tracking-wide uppercase transition-colors ${
            aimLocked && !inVehicle
              ? "border-ok bg-ok text-accent-fg"
              : "border-border bg-surface/80 text-fg"
          }`}
          onPointerDown={() => onFire(true)}
          onPointerUp={() => onFire(false)}
          onPointerCancel={() => onFire(false)}
        >
          Fire
        </button>
        {!inVehicle && weapon === "sniper" && (
          <button
            type="button"
            className={`size-12 rounded-full border text-xs uppercase transition-colors ${
              scoped ? "border-ok bg-ok text-accent-fg" : "border-border bg-surface/80 text-fg"
            }`}
            onPointerDown={() => onScope(true)}
            onPointerUp={() => onScope(false)}
            onPointerCancel={() => onScope(false)}
          >
            Scope
          </button>
        )}
        <button
          type="button"
          className="size-12 rounded-full border border-border bg-surface/80 text-xs text-fg"
          onClick={onBomb}
        >
          Bomb
        </button>
        <button
          type="button"
          className="size-12 rounded-full border border-border bg-surface/80 text-xs text-fg"
          onClick={onEnter}
        >
          {inVehicle ? "Exit" : "Car"}
        </button>
        <button
          type="button"
          className="size-12 rounded-full border border-border bg-surface/80 text-xs text-fg"
          onClick={onJump}
        >
          Jump
        </button>
        {!inVehicle && (
          <button
            type="button"
            className="size-12 rounded-full border border-border bg-surface/80 text-[10px] uppercase text-fg"
            onClick={onSwitchWeapon}
          >
            {weapon === "sniper" ? "Rifle" : "Sniper"}
          </button>
        )}
      </div>
    </div>
  );
}
