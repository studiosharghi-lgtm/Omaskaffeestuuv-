import {
  Color,
  DepthTexture,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  UnsignedIntType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { FootageLayer, type FootageState } from './FootageLayer';
import { compositeFragment, dofFragment, fullscreenVertex } from './shaders';
import { degrade, type Quality } from './quality';
import type { StageSize, World, WorldFrame } from './types';

const MATTE = new Color('#1a120c').convertSRGBToLinear();

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  quality: Quality;
  motion: boolean;
  onContextLost: () => void;
  /**
   * Video export: no animation loop and no automatic quality reduction; every frame is drawn
   * explicitly with `renderAt`, on a clock chosen by the caller.
   */
  manual?: boolean;
}

/**
 * Owns the WebGL renderer and draws, per frame: the 3D scene (when visible) into an HDR target,
 * a half-resolution depth-of-field pass, an optional steam layer, and one composite pass that
 * blends footage and 3D and applies the shared film look.
 */
export class Engine {
  readonly renderer: WebGLRenderer;
  readonly footage: FootageLayer;
  quality: Quality;

  private world: World | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly motion: boolean;
  private readonly manual: boolean;
  private readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly compositeScene = new Scene();
  private readonly dofScene = new Scene();
  private readonly composite: ShaderMaterial;
  private readonly dof: ShaderMaterial;
  private sceneRT!: WebGLRenderTarget;
  private dofRT!: WebGLRenderTarget;
  private steamRT!: WebGLRenderTarget;
  private readonly blank: Texture;

  private t = 0;
  private stage: StageSize = { width: 1, height: 1, aspect: 1 };
  private bufferSize = new Vector2(1, 1);
  private dpr = 1;
  private dirty = true;
  private raf = 0;
  private continuous = false;
  private visible = true;
  private lastFrameAt = 0;
  private frameTimes: number[] = [];
  private lastWorldFrame: WorldFrame | null = null;
  private resizeObserver: ResizeObserver;
  private intersection: IntersectionObserver;
  private disposed = false;

  /** Called after each render with the current footage state (for labels). */
  onRendered: (footage: FootageState, world: WorldFrame | null) => void = () => {};

  constructor(opts: EngineOptions) {
    this.canvas = opts.canvas;
    this.quality = opts.quality;
    this.motion = opts.motion;
    this.manual = opts.manual ?? false;

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setClearColor(MATTE, 1);
    this.renderer.autoClear = true;

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      cancelAnimationFrame(this.raf);
      opts.onContextLost();
    });

    this.footage = new FootageLayer(this.quality.frameConcurrency);
    this.footage.setRenderCallback(() => this.requestRender());

    const blankData = document.createElement('canvas');
    blankData.width = blankData.height = 2;
    this.blank = new Texture(blankData);
    this.blank.needsUpdate = true;

    this.composite = new ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: compositeFragment,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tFootA: { value: this.blank },
        tFootB: { value: this.blank },
        uRectA: { value: new Vector4(0, 0, 1, 1) },
        uRectB: { value: new Vector4(0, 0, 1, 1) },
        uGradeA: { value: new Vector3(1, 0, 1) },
        uGradeB: { value: new Vector3(1, 0, 1) },
        uMixAB: { value: 0 },
        uHasA: { value: 0 },
        uHasB: { value: 0 },
        tScene: { value: this.blank },
        tDof: { value: this.blank },
        tDepth: { value: this.blank },
        uSceneMix: { value: 0 },
        uUseDof: { value: 0 },
        uExposure: { value: 1 },
        uNear: { value: 0.02 },
        uFar: { value: 8 },
        uFocus: { value: 0.6 },
        uAperture: { value: 0 },
        uMaxBlur: { value: 20 },
        tSteam: { value: this.blank },
        uSteam: { value: 0 },
        uSteamLod: { value: 0 },
        uResolution: { value: new Vector2(1, 1) },
        uTime: { value: 0 },
        uGrain: { value: 0.035 },
        uVignette: { value: 0.55 },
        uMatte: { value: new Vector3(MATTE.r, MATTE.g, MATTE.b) },
        uWarmth: { value: 0.18 },
      },
    });
    this.compositeScene.add(new Mesh(new PlaneGeometry(2, 2), this.composite));

    this.dof = new ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: dofFragment,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tScene: { value: this.blank },
        tDepth: { value: this.blank },
        uTexel: { value: new Vector2(1, 1) },
        uStep: { value: 1.5 },
        uNear: { value: 0.02 },
        uFar: { value: 8 },
        uFocus: { value: 0.6 },
        uAperture: { value: 0 },
        uMaxBlur: { value: 20 },
      },
    });
    this.dofScene.add(new Mesh(new PlaneGeometry(2, 2), this.dof));

    this.createTargets(1, 1);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.resize();

    this.intersection = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      if (this.visible) this.requestRender();
    });
    this.intersection.observe(this.canvas);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get time(): number {
    return this.t;
  }

  get stageSize(): StageSize {
    return this.stage;
  }

  setWorld(world: World): void {
    this.world = world;
    world.setQuality(this.quality);
    this.requestRender();
  }

  hasWorld(): boolean {
    return this.world !== null;
  }

  setTime(t: number): void {
    if (t === this.t) return;
    this.t = t;
    this.requestRender();
  }

  requestRender(): void {
    this.dirty = true;
    this.ensureLoop();
  }

  /** Renders one frame synchronously (used for stills in the static story). */
  renderNow(): void {
    this.render(performance.now());
  }

  /** Video export: renders the current timeline position with the clock at `nowMs`. */
  renderAt(nowMs: number): void {
    this.dirty = false;
    this.render(nowMs);
  }

  /** Strength of the film grain (0 turns it off, e.g. for video files, where grain costs bitrate). */
  setGrain(amount: number): void {
    this.composite.uniforms.uGrain.value = amount;
  }

  private onVisibility = (): void => {
    if (!document.hidden) this.requestRender();
  };

  private ensureLoop(): void {
    if (this.manual) return;
    if (!this.raf && this.visible && !document.hidden && !this.disposed) {
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private tick = (now: number): void => {
    this.raf = 0;
    const minInterval = 1000 / this.quality.maxFps - 2;
    if (!this.dirty && this.continuous && now - this.lastFrameAt < minInterval) {
      this.ensureLoop();
      return;
    }
    if (this.dirty || this.continuous) {
      this.trackFrameTime(now);
      this.dirty = false;
      this.render(now);
    }
    if (this.dirty || this.continuous) this.ensureLoop();
  };

  private trackFrameTime(now: number): void {
    const dt = now - this.lastFrameAt;
    this.lastFrameAt = now;
    if (dt > 0 && dt < 250) {
      this.frameTimes.push(dt);
      if (this.frameTimes.length > 45) this.frameTimes.shift();
      if (this.frameTimes.length === 45) {
        const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
        const budget = 1000 / Math.min(this.quality.maxFps, 40);
        if (avg > budget * 1.35) {
          const lower = degrade(this.quality);
          if (lower) {
            this.quality = lower;
            this.world?.setQuality(lower);
            this.resize();
          }
          this.frameTimes = [];
        }
      }
    }
  }

  private createTargets(w: number, h: number): void {
    this.sceneRT?.dispose();
    this.dofRT?.dispose();
    this.steamRT?.dispose();

    const depthTexture = new DepthTexture(w, h, UnsignedIntType);
    this.sceneRT = new WebGLRenderTarget(w, h, {
      type: HalfFloatType,
      format: RGBAFormat,
      samples: this.quality.msaa,
      depthTexture,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
    });
    const hw = Math.max(1, Math.round(w / 2));
    const hh = Math.max(1, Math.round(h / 2));
    this.dofRT = new WebGLRenderTarget(hw, hh, {
      type: HalfFloatType,
      format: RGBAFormat,
      depthBuffer: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
    });
    this.steamRT = new WebGLRenderTarget(hw, hh, {
      type: UnsignedByteType,
      format: RGBAFormat,
      depthBuffer: false,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: true,
    });

    const u = this.composite.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.tDepth.value = depthTexture;
    u.tDof.value = this.dofRT.texture;
    u.tSteam.value = this.steamRT.texture;
    this.dof.uniforms.tScene.value = this.sceneRT.texture;
    this.dof.uniforms.tDepth.value = depthTexture;
    this.dof.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    let dpr = Math.min(window.devicePixelRatio || 1, this.quality.maxDpr);
    if (width * height * dpr * dpr > this.quality.maxPixels) {
      dpr = Math.sqrt(this.quality.maxPixels / (width * height));
    }
    dpr = Math.max(0.5, dpr);
    this.dpr = dpr;
    this.stage = { width, height, aspect: width / height };
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.renderer.getDrawingBufferSize(this.bufferSize);
    this.createTargets(this.bufferSize.x, this.bufferSize.y);
    this.composite.uniforms.uResolution.value.copy(this.bufferSize);
    this.footage.setStageAspect(this.stage.aspect);
    this.requestRender();
  }

  private render(now: number): void {
    const u = this.composite.uniforms;
    const foot = this.footage.state(this.t);
    this.applyFootage(foot);

    let wf: WorldFrame | null = null;
    if (this.world) {
      wf = this.world.frame(this.t, now, this.stage, this.footage.handoffView(this.t));
    }
    this.lastWorldFrame = wf;

    const sceneOn = !!wf && wf.sceneMix > 0.001;
    const steamOn = !!wf && wf.steam > 0.001;

    if (sceneOn && this.world && wf) {
      const near = this.world.camera.near;
      const far = this.world.camera.far;
      const apertureBuf = wf.aperture * this.bufferSize.y;
      const maxBlur = Math.min(this.quality.dofMaxBlur * this.dpr, this.bufferSize.y * 0.035);
      for (const m of [this.composite, this.dof]) {
        m.uniforms.uNear.value = near;
        m.uniforms.uFar.value = far;
        m.uniforms.uFocus.value = wf.focus;
        m.uniforms.uAperture.value = apertureBuf;
        m.uniforms.uMaxBlur.value = maxBlur;
      }
      this.renderer.setRenderTarget(this.sceneRT);
      this.renderer.render(this.world.scene, this.world.camera);

      const useDof = apertureBuf > 0.01;
      u.uUseDof.value = useDof ? 1 : 0;
      if (useDof) {
        this.dof.uniforms.uStep.value = Math.max(0.8, (maxBlur * maxBlur) / (2 * this.quality.dofSamples));
        this.renderer.setRenderTarget(this.dofRT);
        this.renderer.render(this.dofScene, this.ortho);
      }
    }

    if (steamOn && this.world && wf) {
      this.renderer.setRenderTarget(this.steamRT);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.render(this.world.steamScene, this.world.camera);
      this.renderer.setClearColor(MATTE, 1);
    }

    u.uSceneMix.value = sceneOn && wf ? wf.sceneMix : 0;
    u.uSteam.value = steamOn && wf ? wf.steam : 0;
    u.uSteamLod.value = wf ? wf.steamSoftness : 0;
    u.uExposure.value = wf ? wf.exposure : 1;
    u.uTime.value = now / 1000;

    this.renderer.setRenderTarget(null);
    this.renderer.render(this.compositeScene, this.ortho);

    this.continuous = this.motion && this.visible && !!wf && wf.continuous;
    this.onRendered(foot, wf);
  }

  private applyFootage(f: FootageState): void {
    const u = this.composite.uniforms;
    if (f.a) {
      u.tFootA.value = f.a.texture;
      u.uRectA.value.set(...f.a.rect);
      u.uGradeA.value.set(...f.a.grade);
      u.uHasA.value = 1;
    } else {
      u.uHasA.value = 0;
    }
    if (f.b) {
      u.tFootB.value = f.b.texture;
      u.uRectB.value.set(...f.b.rect);
      u.uGradeB.value.set(...f.b.grade);
      u.uHasB.value = 1;
    } else {
      u.uHasB.value = 0;
    }
    u.uMixAB.value = f.mix;
  }

  get worldFrame(): WorldFrame | null {
    return this.lastWorldFrame;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.intersection.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.world?.dispose();
    this.sceneRT.dispose();
    this.dofRT.dispose();
    this.steamRT.dispose();
    this.renderer.dispose();
  }
}
