/**
 * AvatarEngine.ts
 * ─────────────────────────────────────────────────────────────
 * Three.js engine for REIGAN's 3D avatar (Riruka model).
 * Follows the same pattern as ReiganOrb.ts — class-based,
 * container-aware, dispose-safe.
 *
 * Handles: GLB loading, anime-tuned lighting, orbit controls,
 * portrait cropping, mood-based post-processing tints,
 * and auto-spin idle animation.
 * ─────────────────────────────────────────────────────────────
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ── Types ──────────────────────────────────────────────────

export type AvatarMood = 'neutral' | 'happy' | 'thinking' | 'alert' | 'speaking' | 'error';

export interface AvatarView {
  target: THREE.Vector3;
  spherical: { theta: number; phi: number; radius: number };
}

export interface MoodPreset {
  rimColor: number;
  rimIntensity: number;
  ambientIntensity: number;
  bgTint: number;
  autoSpinSpeed: number;
}

// ── Mood Presets (REIGAN palette) ──────────────────────────

const MOOD_PRESETS: Record<AvatarMood, MoodPreset> = {
  neutral: {
    rimColor: 0x7c3aed,     // --reigan-primary violet
    rimIntensity: 0.6,
    ambientIntensity: 0.5,
    bgTint: 0x0c1017,       // --bg-surface
    autoSpinSpeed: 0.002,
  },
  happy: {
    rimColor: 0x00d4ff,     // --reigan-secondary cyan
    rimIntensity: 0.9,
    ambientIntensity: 0.7,
    bgTint: 0x0c1520,
    autoSpinSpeed: 0.004,
  },
  thinking: {
    rimColor: 0xa78bfa,     // --text-accent
    rimIntensity: 0.5,
    ambientIntensity: 0.4,
    bgTint: 0x0a0e16,
    autoSpinSpeed: 0.001,
  },
  alert: {
    rimColor: 0xf59e0b,     // --alert amber
    rimIntensity: 1.0,
    ambientIntensity: 0.6,
    bgTint: 0x14120c,
    autoSpinSpeed: 0.006,
  },
  speaking: {
    rimColor: 0x10b981,     // --active green
    rimIntensity: 0.8,
    ambientIntensity: 0.6,
    bgTint: 0x0c1414,
    autoSpinSpeed: 0.003,
  },
  error: {
    rimColor: 0xef4444,     // --critical red
    rimIntensity: 1.0,
    ambientIntensity: 0.5,
    bgTint: 0x140c0c,
    autoSpinSpeed: 0.0,
  },
};

// ── Views ──────────────────────────────────────────────────

const VIEWS: Record<string, AvatarView> = {
  portrait: {
    target: new THREE.Vector3(0, 0.65, 0),
    spherical: { theta: 0.15, phi: Math.PI / 2.2, radius: 0.8 },
  },
  full: {
    target: new THREE.Vector3(0, 0.5, 0),
    spherical: { theta: 0.2, phi: Math.PI / 2.3, radius: 1.5 },
  },
  closeup: {
    target: new THREE.Vector3(0, 0.78, 0),
    spherical: { theta: 0.08, phi: Math.PI / 2.1, radius: 0.5 },
  },
};

// ── Engine ──────────────────────────────────────────────────

export class AvatarEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private animFrameId: number = 0;
  private model: THREE.Group | null = null;
  private clock = new THREE.Clock();

  // Lights (kept as refs for mood transitions)
  private ambientLight: THREE.AmbientLight;
  private keyLight: THREE.DirectionalLight;
  private fillLight: THREE.DirectionalLight;
  private rimLight: THREE.DirectionalLight;

  // State
  private currentMood: AvatarMood = 'neutral';
  private targetPreset: MoodPreset = { ...MOOD_PRESETS.neutral };
  private activePreset: MoodPreset = { ...MOOD_PRESETS.neutral };
  private autoSpin = true;
  private disposed = false;
  private lerpSpeed = 0.04; // mood transition speed

  // Callbacks
  public onLoadProgress?: (progress: number) => void;
  public onLoadComplete?: () => void;
  public onLoadError?: (error: Error) => void;

  constructor(container: HTMLElement) {
    this.container = container;
    const { width, height } = container.getBoundingClientRect();

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(MOOD_PRESETS.neutral.bgTint);

    // Camera
    this.camera = new THREE.PerspectiveCamera(30, width / height, 0.01, 100);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;      // keep framing consistent
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 3;
    this.controls.minPolarAngle = Math.PI / 6;
    this.controls.maxPolarAngle = Math.PI / 1.5;

    // Lighting — anime-style 3-point + ambient
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(this.ambientLight);

    this.keyLight = new THREE.DirectionalLight(0xfff0f5, 1.0);
    this.keyLight.position.set(2, 3, 2);
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(0xd0d0ff, 0.35);
    this.fillLight.position.set(-2, 1, -1);
    this.scene.add(this.fillLight);

    this.rimLight = new THREE.DirectionalLight(0x7c3aed, 0.6);
    this.rimLight.position.set(0, 2, -3);
    this.scene.add(this.rimLight);

    // Set initial view
    this.setView('portrait');

    // Resize
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);

    // ResizeObserver for container-aware sizing
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    // Start render loop
    this.animate();
  }

  private resizeObserver: ResizeObserver;

  // ── Model Loading ────────────────────────────────────────

  async loadModel(url: string): Promise<void> {
    const loader = new GLTFLoader();

    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          if (this.model) {
            this.scene.remove(this.model);
          }

          this.model = gltf.scene;

          // Normalize scale: fit model to unit box
          const box = new THREE.Box3().setFromObject(this.model);
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const scale = 1.0 / maxDim;
          this.model.scale.setScalar(scale);

          // Re-center after scaling
          const box2 = new THREE.Box3().setFromObject(this.model);
          const center = box2.getCenter(new THREE.Vector3());
          this.model.position.sub(center);
          this.model.position.y += box2.getSize(new THREE.Vector3()).y / 2;

          this.scene.add(this.model);
          this.onLoadComplete?.();
          resolve();
        },
        (event) => {
          if (event.total > 0) {
            this.onLoadProgress?.(event.loaded / event.total);
          }
        },
        (error) => {
          const err = error instanceof Error ? error : new Error(String(error));
          this.onLoadError?.(err);
          reject(err);
        },
      );
    });
  }

  // ── Mood System ──────────────────────────────────────────

  setMood(mood: AvatarMood): void {
    if (mood === this.currentMood) return;
    this.currentMood = mood;
    this.targetPreset = { ...MOOD_PRESETS[mood] };
  }

  getMood(): AvatarMood {
    return this.currentMood;
  }

  private lerpPreset(): void {
    const a = this.activePreset;
    const t = this.targetPreset;
    const s = this.lerpSpeed;

    a.rimIntensity += (t.rimIntensity - a.rimIntensity) * s;
    a.ambientIntensity += (t.ambientIntensity - a.ambientIntensity) * s;
    a.autoSpinSpeed += (t.autoSpinSpeed - a.autoSpinSpeed) * s;

    // Lerp colors
    const rimCurrent = new THREE.Color(a.rimColor);
    const rimTarget = new THREE.Color(t.rimColor);
    rimCurrent.lerp(rimTarget, s);
    a.rimColor = rimCurrent.getHex();

    const bgCurrent = new THREE.Color(a.bgTint);
    const bgTarget = new THREE.Color(t.bgTint);
    bgCurrent.lerp(bgTarget, s);
    a.bgTint = bgCurrent.getHex();
  }

  private applyPreset(): void {
    this.rimLight.color.setHex(this.activePreset.rimColor);
    this.rimLight.intensity = this.activePreset.rimIntensity;
    this.ambientLight.intensity = this.activePreset.ambientIntensity;
    (this.scene.background as THREE.Color).setHex(this.activePreset.bgTint);
  }

  // ── View System ──────────────────────────────────────────

  setView(viewName: 'portrait' | 'full' | 'closeup'): void {
    const view = VIEWS[viewName];
    if (!view) return;

    this.controls.target.copy(view.target);

    const { theta, phi, radius } = view.spherical;
    const x = radius * Math.sin(phi) * Math.sin(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.cos(theta);

    this.camera.position.set(
      view.target.x + x,
      view.target.y + y,
      view.target.z + z,
    );

    this.controls.update();
  }

  // ── Controls ─────────────────────────────────────────────

  setAutoSpin(enabled: boolean): void {
    this.autoSpin = enabled;
  }

  setInteractive(enabled: boolean): void {
    this.controls.enabled = enabled;
  }

  // ── Render Loop ──────────────────────────────────────────

  private animate = (): void => {
    if (this.disposed) return;
    this.animFrameId = requestAnimationFrame(this.animate);

    // Mood transitions
    this.lerpPreset();
    this.applyPreset();

    // Auto-spin
    if (this.autoSpin && this.model) {
      this.model.rotation.y += this.activePreset.autoSpinSpeed;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  // ── Resize ───────────────────────────────────────────────

  private handleResize(): void {
    const { width, height } = this.container.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  // ── Cleanup ──────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver.disconnect();
    this.controls.dispose();

    // Dispose geometry + materials
    this.scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material?.dispose();
        }
      }
    });

    this.renderer.dispose();

    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
