import {
  Box3,
  Color,
  FogExp2,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  ShaderMaterial,
  Vector3,
  type Material,
  type WebGLRenderer,
} from 'three';
import type { HandoffView } from '../render/FootageLayer';
import type { Quality } from '../render/quality';
import type { StageSize, World, WorldFrame } from '../render/types';
import { chapter } from '../content/story';
import { buildCake, type CakeBuild } from './cake';
import { buildTableware, type TablewareBuild } from './tableware';
import { buildProps, type PropsBuild } from './props';
import { buildEnvironment, buildLights, type Lights } from './environment';
import { Steam } from './steam';
import { loadScannedModels, sliceCentroid } from './models';
import { CAKE, CUP, PLATE } from './dimensions';
import {
  HANDOFF_CAMERA,
  choreography,
  emptyChoreo,
  sliceState,
  type CameraPose,
  type Choreo,
  type SliceState,
} from './choreography';

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

interface Frustum {
  l: number;
  r: number;
  t: number;
  b: number;
}

const DEG = Math.PI / 180;

/**
 * The final table: the cake with its first slice, plate, fork, cappuccino and steam, lit to
 * match the last footage frame. Built in the background while the visitor watches the film.
 */
export class World3D implements World {
  readonly scene = new Scene();
  readonly steamScene = new Scene();
  readonly camera = new PerspectiveCamera(24, 16 / 9, 0.02, 8);

  private cake!: CakeBuild;
  private tableware!: TablewareBuild;
  private props!: PropsBuild;
  private lights!: Lights;
  private steam!: Steam;
  private readonly choreo: Choreo = emptyChoreo();
  private readonly slice: SliceState = { position: new Vector3(), yaw: 0, roll: 0, lift: 0, onPlate: 0 };
  private restCentroid = new Vector3();
  private centerAngle = 0;
  /** Height of the plate's flat well (measured on a scanned plate). */
  private plateSurface = PLATE.wellHeight;
  private cupSteamBase = new Vector3(CUP.position.x, CUP.saucerTop + CUP.coffeeLevel + 0.002, CUP.position.z);
  private cakeSteamBase = new Vector3(0, CAKE.height + 0.016, 0);
  private orbitYaw = 0;
  private orbitPitch = 0;
  private orbitYawSmoothed = 0;
  private orbitPitchSmoothed = 0;
  private lastNow = 0;
  private readonly materials: Material[] = [];

  private constructor(
    private readonly renderer: WebGLRenderer,
    private quality: Quality,
    private readonly motion: boolean,
  ) {}

  static async create(renderer: WebGLRenderer, quality: Quality, opts: { motion: boolean }): Promise<World3D> {
    const world = new World3D(renderer, quality, opts.motion);
    await world.build();
    return world;
  }

  private async build(): Promise<void> {
    const r = this.renderer;
    r.shadowMap.enabled = true;
    r.shadowMap.type = PCFShadowMap;
    r.localClippingEnabled = true;
    const aniso = r.capabilities.getMaxAnisotropy();

    this.scene.environment = buildEnvironment(r);
    // the room falls off into darkness away from the window
    this.scene.fog = new FogExp2(new Color('#1a120c'), 0.3);
    this.scene.environmentIntensity = 0.7;
    this.lights = buildLights(this.quality.shadowMapSize);
    this.scene.add(this.lights.key, this.lights.key.target, this.lights.fill, this.lights.fill.target, this.lights.rim, this.lights.rim.target, this.lights.bounce);
    await nextFrame();

    this.props = buildProps(aniso);
    this.scene.add(this.props.group);
    this.cake = buildCake();
    this.scene.add(this.cake.root);
    this.tableware = buildTableware(aniso);
    this.scene.add(this.tableware.plate, this.tableware.cup);
    this.materials.push(...this.cake.materials, ...this.tableware.materials, ...this.props.materials);
    this.restCentroid.copy(this.cake.centroid);
    this.centerAngle = this.cake.centerAngle;
    await nextFrame();

    await this.useScans();

    this.steam = new Steam(this.cupSteamBase, this.cakeSteamBase);
    this.steamScene.add(this.steam.root);

    // Compile all programs up front so the first 3D frame does not stutter.
    this.camera.position.copy(HANDOFF_CAMERA.desktop.pos);
    this.camera.lookAt(HANDOFF_CAMERA.desktop.target);
    try {
      await r.compileAsync(this.scene, this.camera);
      await r.compileAsync(this.steamScene, this.camera);
    } catch {
      /* compileAsync is an optimisation only */
    }
  }

  /** Swap in photogrammetry scans where they exist (ASSETS.md). */
  private async useScans(): Promise<void> {
    const scans = await loadScannedModels();
    if (scans.cakeBody && scans.cakeSlice) {
      this.cake.body.children.forEach((c) => (c.visible = false));
      this.cake.slice.children.forEach((c) => (c.visible = false));
      this.cake.body.add(scans.cakeBody);
      const centroid = sliceCentroid(scans.cakeSlice);
      this.cake.slicePivot.position.copy(centroid);
      this.cake.slice.position.copy(centroid).negate();
      this.cake.slice.add(scans.cakeSlice);
      this.restCentroid.copy(centroid);
      this.centerAngle = Math.atan2(centroid.z, centroid.x);
    }
    if (scans.plate) {
      this.tableware.plate.children[0].visible = false;
      this.tableware.plate.add(scans.plate);
      // where does the slice land? measure the well of the real plate
      this.tableware.plate.updateMatrixWorld(true);
      const ray = new Raycaster(new Vector3(PLATE.position.x, 1, PLATE.position.z), new Vector3(0, -1, 0));
      const hit = ray.intersectObject(scans.plate, true)[0];
      if (hit) {
        this.plateSurface = hit.point.y;
        this.tableware.fork.position.y = this.plateSurface + 0.0009;
      }
    }
    if (scans.cup) {
      this.tableware.cup.children.forEach((c) => (c.visible = false));
      this.tableware.cup.add(scans.cup);
      const box = new Box3().setFromObject(scans.cup);
      this.cupSteamBase.set(CUP.position.x, box.max.y - 0.008, CUP.position.z);
    }
    if (scans.cakeBody) {
      const box = new Box3().setFromObject(scans.cakeBody);
      this.cakeSteamBase.set(0, box.max.y - 0.004, 0);
    }
  }

  setQuality(q: Quality): void {
    this.quality = q;
    if (this.lights && this.lights.key.shadow.mapSize.x !== q.shadowMapSize) {
      this.lights.key.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.lights.key.shadow.map?.dispose();
      this.lights.key.shadow.map = null;
    }
  }

  setOrbitInput(yaw: number, pitch: number): void {
    this.orbitYaw = yaw;
    this.orbitPitch = pitch;
  }

  frame(t: number, now: number, stage: StageSize, handoff: HandoffView): WorldFrame {
    const dt = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0;
    this.lastNow = now;

    // the slice
    sliceState(t, this.restCentroid, this.centerAngle, this.plateSurface, this.slice);
    const pivot = this.cake.slicePivot;
    pivot.position.copy(this.restCentroid).add(this.slice.position);
    pivot.rotation.set(this.slice.roll, this.slice.yaw, 0, 'YXZ');
    this.cake.updateClipping();

    // its contact shadow follows on whatever surface is below
    const bottom = pivot.position.y - this.restCentroid.y;
    const dx = pivot.position.x - PLATE.position.x;
    const dz = pivot.position.z - PLATE.position.z;
    const overPlate = Math.hypot(dx, dz) < PLATE.radius * 0.8;
    const surface = overPlate ? this.plateSurface : 0;
    const lift = Math.max(0, bottom - surface);
    const sh = this.props.sliceShadow;
    sh.position.set(pivot.position.x, surface + 0.0005, pivot.position.z);
    sh.scale.setScalar(1 + lift * 8);
    (sh.material as Material & { opacity: number }).opacity = 0.5 * Math.max(0, 1 - lift * 18) * (this.slice.position.lengthSq() > 1e-6 ? 1 : 0);

    // focus follows the slice's cut face
    const slicePoint = pivot.position.clone();
    const c = choreography(t, slicePoint, this.choreo);

    // the camera
    this.applyCamera(t, c, stage, handoff, now, dt);

    // backdrop and lighting mood: bright like the footage at the handoff, moodier at the table
    const bd = this.props.backdrop.material as ShaderMaterial;
    bd.uniforms.uBrightness.value = c.backdrop;
    bd.uniforms.uWindow.value = 0.6 + 0.4 * c.backdrop;
    (this.scene.fog as FogExp2).density = 0.18 + (1 - c.backdrop) * 0.75;

    // steam: over the still placeholder photo it starts with the chapter, over real footage at the dissolve
    const overlayOnStill = handoff.kind !== 'sequence';
    const cakeSteam = overlayOnStill ? c.steamCake : c.steamCake * c.sceneMix;
    const cupSteam = c.steamCup * c.sceneMix;
    const steamTime = this.motion ? now / 1000 : 14.2;
    this.steam.update(this.camera, steamTime, cupSteam, cakeSteam, 0.75 + 0.35 * c.backdrop);
    const steamOn = cakeSteam > 0.001 || cupSteam > 0.001;

    // depth of field
    const camPos = this.camera.position;
    const viewDir = new Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const focus = Math.max(0.08, viewDir.dot(new Vector3().subVectors(c.focusPoint, camPos)));
    const cupDist = viewDir.dot(new Vector3(CUP.position.x, 0.08, CUP.position.z).sub(camPos));
    const steamBlur = Math.abs(1 / focus - 1 / Math.max(0.1, cupDist)) * c.aperture;

    return {
      sceneMix: c.sceneMix,
      steam: steamOn ? 1 : 0,
      steamSoftness: Math.min(3.2, 1.1 + Math.log2(1 + steamBlur * 220)),
      focus,
      aperture: c.aperture,
      exposure: c.exposure,
      continuous: this.motion && steamOn,
    };
  }

  private applyCamera(t: number, c: Choreo, stage: StageSize, handoff: HandoffView, now: number, dt: number): void {
    const cam = this.camera;
    const matched: CameraPose =
      handoff.kind === 'sequence' ? HANDOFF_CAMERA[handoff.variant ?? 'desktop'] : HANDOFF_CAMERA.reference;
    const m = c.free;

    // free pose, adapted to portrait screens by moving back
    const freePos = c.pos.clone();
    const freeTarget = c.target.clone();
    let shiftY = 0;
    if (stage.aspect < 1) {
      const half = (c.fov * DEG) / 2;
      const hRef = Math.atan(Math.tan(half) * (16 / 9));
      const hNow = Math.atan(Math.tan(half) * stage.aspect);
      const k = Math.min(2.2, Math.max(1, Math.tan(hRef * 0.6) / Math.tan(hNow)));
      freePos.sub(freeTarget).multiplyScalar(k).add(freeTarget);
      shiftY = -0.1;
    }

    // look around: drag and pointer, only once the camera is free
    const follow = 1 - Math.exp(-dt * 6);
    this.orbitYawSmoothed += (this.orbitYaw - this.orbitYawSmoothed) * (dt ? follow : 1);
    this.orbitPitchSmoothed += (this.orbitPitch - this.orbitPitchSmoothed) * (dt ? follow : 1);
    const allowOrbit = m * (t > chapter('anschnitt').start ? 1 : 0);
    if (allowOrbit > 0) {
      const off = freePos.clone().sub(freeTarget);
      off.applyAxisAngle(new Vector3(0, 1, 0), this.orbitYawSmoothed * allowOrbit);
      const right = new Vector3().crossVectors(off, new Vector3(0, 1, 0)).normalize();
      off.applyAxisAngle(right, -this.orbitPitchSmoothed * allowOrbit);
      off.y = Math.max(0.03, off.y);
      freePos.copy(freeTarget).add(off);
    }
    if (this.motion && m > 0) {
      const s = now / 1000;
      freePos.x += Math.sin(s * 0.37) * 0.0014 * m;
      freePos.y += Math.sin(s * 0.23 + 1.1) * 0.0009 * m;
    }

    cam.position.copy(matched.pos).lerp(freePos, m);
    const target = matched.target.clone().lerp(freeTarget, m);
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    cam.updateMatrixWorld();

    // projection: from the footage frame (view offset into the source frame) to a normal lens
    const near = cam.near;
    const a = this.matchedFrustum(matched, handoff, near);
    const fovFree = c.fov;
    const top = near * Math.tan((fovFree * DEG) / 2);
    const h = 2 * top;
    const w = stage.aspect * h;
    const b: Frustum = { l: -w / 2, r: w / 2, t: top + shiftY * h, b: -top + shiftY * h };
    const f: Frustum = {
      l: a.l + (b.l - a.l) * m,
      r: a.r + (b.r - a.r) * m,
      t: a.t + (b.t - a.t) * m,
      b: a.b + (b.b - a.b) * m,
    };
    cam.fov = fovFree;
    cam.aspect = stage.aspect;
    cam.projectionMatrix.makePerspective(f.l, f.r, f.t, f.b, near, cam.far);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }

  /** The frustum that shows exactly the part of the footage frame currently on screen. */
  private matchedFrustum(pose: CameraPose, handoff: HandoffView, near: number): Frustum {
    const top0 = near * Math.tan((pose.fov * DEG) / 2);
    const h0 = 2 * top0;
    const w0 = pose.aspect * h0;
    const rect = handoff.rect;
    const l = -w0 / 2 + rect.x * w0;
    const t = top0 - rect.y * h0;
    return { l, r: l + rect.w * w0, t, b: t - rect.h * h0 };
  }

  dispose(): void {
    const geos = new Set<{ dispose(): void }>();
    const mats = new Set<Material>(this.materials);
    for (const root of [this.scene, this.steamScene]) {
      root.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh) {
          geos.add(mesh.geometry);
          (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((mt) => mats.add(mt));
        }
      });
    }
    geos.forEach((g) => g.dispose());
    mats.forEach((mt) => mt.dispose());
    this.scene.environment?.dispose();
    this.lights?.key.shadow.map?.dispose();
  }
}
