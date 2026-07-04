// Renderer, kamera, ışık, kontroller, resize, render döngüsü (SPEC §3.2).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CabinetParams } from '../core/types';

export type CameraPreset = 'front' | 'side' | 'perspective' | 'iso';

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;

  private frameHooks: Array<(dt: number) => void> = [];
  private clock = new THREE.Clock();
  private camAnim: {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    t: number;
  } | null = null;
  private grid: THREE.GridHelper;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.background = new THREE.Color(0x14181f);
    this.scene.fog = new THREE.Fog(0x14181f, 18, 42);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
    this.camera.position.set(4.5, 3.2, 6.5);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 1.25, 0);
    this.controls.maxPolarAngle = Math.PI * 0.55;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 30;

    // Işıklar: yarıküre + iki yönlü (gölgesiz — 20k instance mobil performansı, SPEC §3.3)
    const hemi = new THREE.HemisphereLight(0xdde6f0, 0x30363f, 1.0);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(5, 8, 6);
    const fill = new THREE.DirectionalLight(0x9fb4ff, 0.5);
    fill.position.set(-6, 4, -4);
    this.scene.add(hemi, key, fill);

    this.grid = new THREE.GridHelper(24, 48, 0x3a4250, 0x232a35);
    this.grid.position.y = -0.001;
    this.scene.add(this.grid);

    const resize = () => this.resize();
    new ResizeObserver(resize).observe(canvas.parentElement ?? canvas);
    resize();
  }

  resize(): void {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  onFrame(fn: (dt: number) => void): void {
    this.frameHooks.push(fn);
  }

  start(): void {
    this.renderer.setAnimationLoop(() => {
      const dt = Math.min(this.clock.getDelta(), 0.1);
      if (this.camAnim) {
        const a = this.camAnim;
        a.t = Math.min(1, a.t + dt / 0.6);
        const e = 1 - Math.pow(1 - a.t, 3); // easeOutCubic
        this.camera.position.lerpVectors(a.fromPos, a.toPos, e);
        this.controls.target.lerpVectors(a.fromTarget, a.toTarget, e);
        if (a.t >= 1) this.camAnim = null;
      }
      this.controls.update();
      for (const fn of this.frameHooks) fn(dt);
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** Kamera preset'leri (SPEC §5): Ön / Yan (nested istif) / Perspektif / İzometrik. */
  setPreset(preset: CameraPreset, p: CabinetParams): void {
    const { W, H, D } = p;
    const target = new THREE.Vector3(0, H / 2, 0);
    let pos: THREE.Vector3;
    switch (preset) {
      case 'front':
        pos = new THREE.Vector3(0, H / 2, Math.max(W, H) * 1.15 + D / 2);
        break;
      case 'side':
        pos = new THREE.Vector3(Math.max(D, H) * 1.9 + W / 2, H / 2, 0);
        break;
      case 'iso': {
        const r = Math.max(W, H, D) * 1.35;
        pos = new THREE.Vector3(r, r * 0.82, r);
        break;
      }
      default: {
        pos = new THREE.Vector3(W * 0.85, H * 1.15, Math.max(W, D) * 1.5);
      }
    }
    this.camAnim = {
      fromPos: this.camera.position.clone(),
      toPos: pos,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      t: 0,
    };
  }
}
