import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { OrbState, AudioData } from './types'
import { STATE_PRESETS } from './colorPresets'
import { lerpHue } from './colorMath'
import type { VoiceOrbEngine } from './orbRegistry'

const SPEED_LERP_FACTOR = 0.04
const COLOR_LERP_FACTOR = 0.04
const AUDIO_INFLUENCE_DECAY = 0.09
const AUTO_RETURN_STATES: OrbState[] = ['error', 'success']
const AUTO_RETURN_DELAY_MS = 2000
const BASE_AUTO_ROTATE_SPEED = 0.5
const BASE_BLOOM_STRENGTH = 1.5
// Mic capture runs on the audio thread (AudioWorklet), not the main thread —
// this throttle is a courtesy to reduce main-thread load while listening,
// not a hard guard, so it stays close to full rate. See ReiganOrb.
const THROTTLED_FRAME_INTERVAL_MS = 1000 / 30

export interface ParticleTarget {
  x: number
  y: number
  z: number
  /** HSL, each 0–1 */
  h: number
  s: number
  l: number
}

export interface ComputeTargetContext {
  /** Particle index, 0 to count-1. */
  i: number
  count: number
  /** Elapsed seconds, already scaled by the current state's speed multiplier. */
  time: number
  audio: AudioData
  /** 0–1, eased toward 1 while listening/speaking and 0 otherwise. */
  audioInfluence: number
  /**
   * Current REIGAN state's base hue (0–1), smoothly lerped across state
   * changes — the same idle/listening/processing/speaking/error/success
   * palette ReiganOrb uses (from colorPresets.ts), shared across every orb
   * style so switching styles keeps the same color language. Shapes with
   * their own hue pattern (a rainbow sweep, a swirl) should recenter that
   * pattern on this value rather than ignoring it.
   */
  stateHue: number
}

/**
 * Shared scaffolding for the particle-swarm-formation orb styles (cube,
 * sphere, helix, ai_orb, ...): scene/renderer/composer/bloom/controls setup,
 * resize/dispose lifecycle, REIGAN-state-driven speed, audio-reactive bloom,
 * and the main-thread-courtesy render throttle — all identical to how
 * ReiganOrb is built. Subclasses only supply computeTarget(), the per-particle
 * position + color formula for their shape.
 */
export abstract class ParticleSwarmOrb implements VoiceOrbEngine {
  protected container: HTMLElement
  protected count: number
  private state: OrbState = 'idle'
  private stateTimeoutId: ReturnType<typeof setTimeout> | null = null
  private animationFrameId: number | null = null
  private resizeObserver: ResizeObserver
  private prefersReducedMotion: boolean

  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private composer: EffectComposer
  private bloomPass: UnrealBloomPass | null = null
  private controls: OrbitControls

  private geometry: THREE.TetrahedronGeometry
  private material: THREE.MeshBasicMaterial
  private mesh: THREE.InstancedMesh
  private dummy = new THREE.Object3D()
  private target = new THREE.Vector3()
  private pColor = new THREE.Color()
  private positions: THREE.Vector3[] = []
  private clock = new THREE.Clock()

  private currentSpeedMult: number
  private targetSpeedMult: number
  private currentHue: number
  private targetHue: number

  private audioData: AudioData = { amplitude: 0, bass: 0, mid: 0, high: 0 }
  private audioInfluence = 0

  private throttled = false
  private lastThrottledRender = 0

  constructor(container: HTMLElement, particleCount: number) {
    this.container = container
    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.count = this.prefersReducedMotion ? Math.max(1, Math.floor(particleCount / 2)) : particleCount

    const rect = container.getBoundingClientRect()
    const width = Math.max(1, rect.width)
    const height = Math.max(1, rect.height)

    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2(0x000000, 0.008)

    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000)
    this.camera.position.set(0, 0, 80)

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(width, height)
    this.renderer.setClearColor(0x000000, 0)
    container.appendChild(this.renderer.domElement)

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    if (!this.prefersReducedMotion) {
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width * 0.5, height * 0.5), BASE_BLOOM_STRENGTH, 0.4, 0.15)
      this.composer.addPass(this.bloomPass)
    }

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.enableZoom = false
    this.controls.enablePan = false
    this.controls.rotateSpeed = 0.4
    this.controls.autoRotate = !this.prefersReducedMotion
    this.controls.autoRotateSpeed = BASE_AUTO_ROTATE_SPEED

    this.geometry = new THREE.TetrahedronGeometry(0.25)
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff })
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.count)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.scene.add(this.mesh)

    const seedColor = new THREE.Color()
    for (let i = 0; i < this.count; i++) {
      this.positions.push(new THREE.Vector3((Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100))
      this.mesh.setColorAt(i, seedColor.setHex(0x00ff88))
    }

    this.currentSpeedMult = STATE_PRESETS.idle.speedMult
    this.targetSpeedMult = STATE_PRESETS.idle.speedMult
    this.currentHue = STATE_PRESETS.idle.colors.petalHueBase
    this.targetHue = STATE_PRESETS.idle.colors.petalHueBase

    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(container)

    this.animate = this.animate.bind(this)
    this.animate()
  }

  /** Per-particle position + color for this shape. See ComputeTargetContext. */
  protected abstract computeTarget(ctx: ComputeTargetContext): ParticleTarget

  setState(state: OrbState): void {
    this.state = state
    this.targetSpeedMult = STATE_PRESETS[state].speedMult
    this.targetHue = STATE_PRESETS[state].colors.petalHueBase

    if (this.stateTimeoutId) {
      clearTimeout(this.stateTimeoutId)
      this.stateTimeoutId = null
    }
    if (AUTO_RETURN_STATES.includes(state)) {
      this.stateTimeoutId = setTimeout(() => this.setState('idle'), AUTO_RETURN_DELAY_MS)
    }
  }

  setAudioData(data: AudioData): void {
    this.audioData = data
  }

  setThrottled(throttled: boolean): void {
    this.throttled = throttled
  }

  dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    if (this.stateTimeoutId) {
      clearTimeout(this.stateTimeoutId)
      this.stateTimeoutId = null
    }
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.geometry.dispose()
    this.material.dispose()
    this.scene.remove(this.mesh)
    this.renderer.dispose()
    this.composer.dispose()
    this.renderer.domElement.remove()
  }

  private handleResize(): void {
    const rect = this.container.getBoundingClientRect()
    const width = Math.max(1, rect.width)
    const height = Math.max(1, rect.height)

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
    this.composer.setSize(width, height)
    this.bloomPass?.setSize(width, height)
  }

  private animate(): void {
    this.animationFrameId = requestAnimationFrame(this.animate)

    if (this.throttled) {
      const now = performance.now()
      if (now - this.lastThrottledRender < THROTTLED_FRAME_INTERVAL_MS) return
      this.lastThrottledRender = now
    }

    const time = this.clock.getElapsedTime()
    this.currentSpeedMult += (this.targetSpeedMult - this.currentSpeedMult) * SPEED_LERP_FACTOR
    this.currentHue = lerpHue(this.currentHue, this.targetHue, COLOR_LERP_FACTOR)

    const audioTarget = this.state === 'listening' || this.state === 'speaking' ? 1 : 0
    this.audioInfluence += (audioTarget - this.audioInfluence) * AUDIO_INFLUENCE_DECAY

    const speedMult = this.prefersReducedMotion ? 0.1 : this.currentSpeedMult
    const scaledTime = time * speedMult

    // Shape-agnostic voice reactivity: rotation speed and glow pulse with
    // state/volume the same way for every style, so switching styles in
    // Settings keeps the same "staging" even though geometry differs.
    this.controls.autoRotateSpeed = BASE_AUTO_ROTATE_SPEED * speedMult
    if (this.bloomPass) {
      this.bloomPass.strength = BASE_BLOOM_STRENGTH + this.audioData.amplitude * 1.2 * this.audioInfluence
    }

    const count = this.count
    for (let i = 0; i < count; i++) {
      const t = this.computeTarget({
        i,
        count,
        time: scaledTime,
        audio: this.audioData,
        audioInfluence: this.audioInfluence,
        stateHue: this.currentHue,
      })
      this.target.set(t.x, t.y, t.z)
      this.pColor.setHSL(((t.h % 1) + 1) % 1, Math.min(1, Math.max(0, t.s)), Math.min(0.98, Math.max(0.02, t.l)))

      this.positions[i].lerp(this.target, 0.1)
      this.dummy.position.copy(this.positions[i])
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
      this.mesh.setColorAt(i, this.pColor)
    }

    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true

    this.controls.update()

    if (this.prefersReducedMotion) {
      this.renderer.render(this.scene, this.camera)
    } else {
      this.composer.render()
    }
  }
}
