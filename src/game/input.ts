const GAME_CODES = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyE",
  "KeyG",
  "KeyR",
  "KeyF",
  "KeyQ",
  "Space",
  "ShiftLeft",
  "ShiftRight",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyC",
]);

export type Actions = {
  moveX: number;
  moveY: number;
  steer: number;
  throttle: number;
  lookX: number;
  lookY: number;
  fire: boolean;
  firePressed: boolean;
  bombPressed: boolean;
  interactPressed: boolean;
  jumpPressed: boolean;
  sprint: boolean;
  reloadPressed: boolean;
  switchWeaponPressed: boolean;
  scope: boolean;
};

function radialDeadzone(x: number, y: number, dz = 0.16): { x: number; y: number } {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0 };
  const scale = (m - dz) / (1 - dz) / m;
  return { x: x * scale, y: y * scale };
}

export class Input {
  keys = new Set<string>();
  overrideKeys: string[] | null = null;
  overrideSteer: number | null = null;
  lookX = 0;
  lookY = 0;
  virtualMoveX = 0;
  virtualMoveY = 0;
  virtualLookX = 0;
  virtualLookY = 0;
  virtualFire = false;
  virtualBomb = false;
  virtualInteract = false;
  virtualJump = false;
  virtualSwitchWeapon = false;
  virtualScope = false;
  mouseDown = false;
  // Kept for compatibility with anything still reading it, but aiming no
  // longer depends on pointer lock — drag-to-look works with or without it.
  pointerLocked = false;
  private dragId: number | null = null;
  private dragX = 0;
  private dragY = 0;
  private prevFire = false;
  private prevBomb = false;
  private prevInteract = false;
  private prevJump = false;
  private prevReload = false;
  private prevSwitchWeapon = false;
  private bombLatch = false;
  private interactLatch = false;
  private jumpLatch = false;
  private bound = false;
  private canvas: HTMLCanvasElement | null = null;

  attach(canvas: HTMLCanvasElement) {
    if (this.bound) return;
    this.bound = true;
    this.canvas = canvas;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onBlur);
    document.addEventListener("pointerlockchange", this.onLock);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    canvas.addEventListener("contextmenu", this.onMenu);
  }

  detach() {
    if (!this.bound) return;
    this.bound = false;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onBlur);
    document.removeEventListener("pointerlockchange", this.onLock);
    this.canvas?.removeEventListener("mousemove", this.onMouseMove);
    this.canvas?.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas?.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.canvas?.removeEventListener("contextmenu", this.onMenu);
    this.canvas = null;
  }

  sample(): Actions {
    const held = this.overrideKeys ? new Set(this.overrideKeys) : this.keys;
    let moveX = this.virtualMoveX;
    let moveY = this.virtualMoveY;
    if (held.has("KeyA") || held.has("ArrowLeft")) moveX -= 1;
    if (held.has("KeyD") || held.has("ArrowRight")) moveX += 1;
    if (held.has("KeyW") || held.has("ArrowUp")) moveY += 1;
    if (held.has("KeyS") || held.has("ArrowDown")) moveY -= 1;

    const pads = typeof navigator !== "undefined" ? navigator.getGamepads?.() : null;
    if (pads) {
      for (const pad of pads) {
        if (!pad || pad.mapping !== "standard") continue;
        const stick = radialDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
        moveX += stick.x;
        moveY -= stick.y;
        const look = radialDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, 0.12);
        this.lookX += look.x * 0.045;
        this.lookY += look.y * 0.032;
        if (pad.buttons[7]?.pressed) this.mouseDown = true;
        if (pad.buttons[6]?.pressed) this.bombLatch = true;
        if (pad.buttons[0]?.pressed) this.jumpLatch = true;
        if (pad.buttons[3]?.pressed) this.interactLatch = true;
        if (pad.buttons[2]?.pressed) held.add("KeyR");
        if (pad.buttons[4]?.pressed) held.add("ShiftLeft");
      }
    }

    moveX = Math.max(-1, Math.min(1, moveX));
    moveY = Math.max(-1, Math.min(1, moveY));

    let steer = this.overrideSteer ?? 0;
    if (this.overrideSteer === null) {
      if (held.has("KeyA") || held.has("ArrowLeft") || this.virtualMoveX < -0.3) steer += 1;
      if (held.has("KeyD") || held.has("ArrowRight") || this.virtualMoveX > 0.3) steer -= 1;
    }

    const fire = this.mouseDown || this.virtualFire || held.has("Space");
    const bomb = this.bombLatch || this.virtualBomb;
    const interact = this.interactLatch || this.virtualInteract || held.has("KeyE") || held.has("KeyF");
    const jump = this.jumpLatch || this.virtualJump;
    const reload = held.has("KeyR");
    const switchWeapon = held.has("KeyQ") || this.virtualSwitchWeapon;
    const scope = held.has("KeyC") || this.virtualScope;

    const lookX = this.lookX + this.virtualLookX;
    const lookY = this.lookY + this.virtualLookY;
    this.lookX = 0;
    this.lookY = 0;
    this.virtualLookX = 0;
    this.virtualLookY = 0;

    const actions: Actions = {
      moveX,
      moveY,
      steer,
      throttle: moveY,
      lookX,
      lookY,
      fire,
      firePressed: fire && !this.prevFire,
      bombPressed: bomb && !this.prevBomb,
      interactPressed: interact && !this.prevInteract,
      jumpPressed: jump && !this.prevJump,
      sprint: held.has("ShiftLeft") || held.has("ShiftRight"),
      reloadPressed: reload && !this.prevReload,
      switchWeaponPressed: switchWeapon && !this.prevSwitchWeapon,
      scope,
    };

    this.prevFire = fire;
    this.prevBomb = bomb;
    this.prevInteract = interact;
    this.prevJump = jump;
    this.prevReload = reload;
    this.prevSwitchWeapon = switchWeapon;
    this.bombLatch = false;
    this.interactLatch = false;
    this.jumpLatch = false;
    this.virtualBomb = false;
    this.virtualInteract = false;
    this.virtualJump = false;
    this.virtualSwitchWeapon = false;

    return actions;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === "KeyG") this.bombLatch = true;
    this.keys.add(e.code);
    if (GAME_CODES.has(e.code)) e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
    this.mouseDown = false;
  };

  private onLock = () => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
  };

  // When the pointer is locked (still requested opportunistically on
  // mousedown, since it hides the cursor and gives raw deltas), use the
  // browser's native movementX/Y. Otherwise this is a no-op — look input
  // comes from the drag handlers below instead, which work identically
  // with or without lock and on both mouse and touch.
  private onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked) return;
    this.lookX += e.movementX;
    this.lookY += e.movementY;
  };

  // Drag-to-look: press and drag anywhere on the canvas (mouse or touch) to
  // rotate the camera, the same way it works in GTA-style third-person
  // games. This does not depend on pointer lock ever succeeding, so it
  // keeps working even when the browser refuses or drops the lock.
  private onPointerDown = (e: PointerEvent) => {
    if (this.dragId !== null) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    this.dragId = e.pointerId;
    this.dragX = e.clientX;
    this.dragY = e.clientY;
    // setPointerCapture can throw InvalidStateError in some browsers if the
    // pointer is no longer active by the time this runs (e.g. a fast
    // click, or a pointer lock request transitioning capture state at the
    // same moment) — an uncaught throw here would abort the rest of this
    // handler for that event, so this must never be allowed to escape.
    try {
      this.canvas?.setPointerCapture(e.pointerId);
    } catch {
      // Non-fatal: dragging still works via the window-level pointermove/up
      // listeners below even without capture, capture only helps the drag
      // keep tracking once the pointer leaves the canvas bounds.
    }
    if (e.pointerType === "mouse" && !this.pointerLocked) this.onWantLock?.();
  };

  // Set by the engine so a mouse drag can opportunistically request pointer
  // lock (hidden cursor, unclamped movement) without aiming ever depending
  // on it succeeding.
  onWantLock: (() => void) | null = null;

  private onPointerMove = (e: PointerEvent) => {
    if (this.dragId !== e.pointerId) return;
    // Pointer-locked mouse movement is handled by onMouseMove instead, to
    // avoid double-counting the same drag.
    if (this.pointerLocked && e.pointerType === "mouse") {
      this.dragX = e.clientX;
      this.dragY = e.clientY;
      return;
    }
    const dx = e.clientX - this.dragX;
    const dy = e.clientY - this.dragY;
    this.dragX = e.clientX;
    this.dragY = e.clientY;
    const sens = e.pointerType === "touch" ? 2.1 : 1;
    this.lookX += dx * sens;
    this.lookY += dy * sens;
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.dragId !== e.pointerId) return;
    this.dragId = null;
    try {
      if (this.canvas?.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // Same reasoning as onPointerDown above — never let this throw escape.
    }
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = true;
    if (e.button === 2) this.bombLatch = true;
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
  };

  private onMenu = (e: Event) => e.preventDefault();
}
