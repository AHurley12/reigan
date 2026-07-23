import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { OrbState, OrbParams, AudioData, ColorShift } from './types'
import { STATE_PRESETS } from './colorPresets'

const PARAM_KEYS: (keyof OrbParams)[] = [
  'nebulaSize',
  'petalCurl',
  'rotationRate',
  'cloudDepth',
  'corePulse',
  'turbulence',
]

const PARAM_LERP_FACTOR = 0.04
const AUDIO_INFLUENCE_DECAY = 0.09 // ~500ms to settle at 60fps
const AUTO_RETURN_STATES: OrbState[] = ['error', 'success']
const AUTO_RETURN_DELAY_MS = 2000

// Original petal hue formula used coefficients 0.085 (layer term) and 0.018
// (turbulence term); this ratio is preserved so the palette shift keeps the
// same relative texture as the source formation.
const PETAL_SECONDARY_HUE_RATIO = 0.018 / 0.085

function lerpHue(current: number, target: number, factor: number): number {
  let delta = target - current
  delta -= Math.round(delta)
  let next = current + delta * factor
  next -= Math.floor(next)
  return next
}

function lerpColors(current: ColorShift, target: ColorShift, factor: number): void {
  current.petalHueBase = lerpHue(current.petalHueBase, target.petalHueBase, factor)
  current.petalHueRange += (target.petalHueRange - current.petalHueRange) * factor
  current.coreHueBase = lerpHue(current.coreHueBase, target.coreHueBase, factor)
  current.coreHueRange += (target.coreHueRange - current.coreHueRange) * factor
  current.haloHueBase = lerpHue(current.haloHueBase, target.haloHueBase, factor)
  current.haloHueRange += (target.haloHueRange - current.haloHueRange) * factor
}

export class ReiganOrb {
  private container: HTMLElement
  private count: number
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
  private dummy: THREE.Object3D
  private target: THREE.Vector3
  private pColor: THREE.Color
  private positions: THREE.Vector3[]
  private clock: THREE.Clock

  private currentParams: OrbParams
  private targetParams: OrbParams
  private currentSpeedMult: number
  private targetSpeedMult: number
  private currentColors: ColorShift
  private targetColors: ColorShift

  private audioData: AudioData = { amplitude: 0, bass: 0, mid: 0, high: 0 }
  private audioInfluence = 0

  constructor(container: HTMLElement, particleCount = 8000) {
    this.container = container
    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.count = this.prefersReducedMotion ? Math.max(1, Math.floor(particleCount / 2)) : particleCount

    const rect = this.container.getBoundingClientRect()
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
    this.container.appendChild(this.renderer.domElement)

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    if (!this.prefersReducedMotion) {
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width * 0.5, height * 0.5), 1.5, 0.3, 0.1)
      this.composer.addPass(this.bloomPass)
    }

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.enableZoom = false
    this.controls.enablePan = false
    this.controls.rotateSpeed = 0.4
    this.controls.autoRotate = !this.prefersReducedMotion
    this.controls.autoRotateSpeed = 0.5

    this.dummy = new THREE.Object3D()
    this.target = new THREE.Vector3()
    this.pColor = new THREE.Color()

    this.geometry = new THREE.TetrahedronGeometry(0.25)
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff })
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.count)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.scene.add(this.mesh)

    this.positions = []
    const seedColor = new THREE.Color()
    for (let i = 0; i < this.count; i++) {
      this.positions.push(new THREE.Vector3((Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100))
      this.mesh.setColorAt(i, seedColor.setHex(0x00ff88))
    }

    const idlePreset = STATE_PRESETS.idle
    this.currentParams = { ...idlePreset.params }
    this.targetParams = { ...idlePreset.params }
    this.currentSpeedMult = idlePreset.speedMult
    this.targetSpeedMult = idlePreset.speedMult
    this.currentColors = { ...idlePreset.colors }
    this.targetColors = { ...idlePreset.colors }

    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(this.container)

    this.clock = new THREE.Clock()
    this.animate = this.animate.bind(this)
    this.animate()
  }

  setState(state: OrbState): void {
    this.state = state
    const preset = STATE_PRESETS[state]
    this.targetParams = { ...preset.params }
    this.targetSpeedMult = preset.speedMult
    this.targetColors = { ...preset.colors }

    if (this.stateTimeoutId) {
      clearTimeout(this.stateTimeoutId)
      this.stateTimeoutId = null
    }
    if (AUTO_RETURN_STATES.includes(state)) {
      this.stateTimeoutId = setTimeout(() => this.setState('idle'), AUTO_RETURN_DELAY_MS)
    }
  }

  getState(): OrbState {
    return this.state
  }

  setAudioData(data: AudioData): void {
    this.audioData = data
  }

  setParams(params: Partial<OrbParams>): void {
    this.targetParams = { ...this.targetParams, ...params }
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
    const time = this.clock.getElapsedTime()

    for (const key of PARAM_KEYS) {
      this.currentParams[key] += (this.targetParams[key] - this.currentParams[key]) * PARAM_LERP_FACTOR
    }
    this.currentSpeedMult += (this.targetSpeedMult - this.currentSpeedMult) * PARAM_LERP_FACTOR
    lerpColors(this.currentColors, this.targetColors, PARAM_LERP_FACTOR)

    const audioTarget = this.state === 'listening' || this.state === 'speaking' ? 1 : 0
    this.audioInfluence += (audioTarget - this.audioInfluence) * AUDIO_INFLUENCE_DECAY

    const speedMult = this.prefersReducedMotion ? 0.1 : this.currentSpeedMult
    const scaledTime = time * speedMult

    let { nebulaSize, petalCurl, rotationRate, cloudDepth, corePulse, turbulence } = this.currentParams

    if (this.audioData.amplitude > 0.01) {
      const influence = this.audioInfluence
      nebulaSize += this.audioData.amplitude * 8 * influence
      corePulse += this.audioData.bass * 1.2 * influence
      turbulence += this.audioData.high * 0.6 * influence
      rotationRate += this.audioData.mid * 0.3 * influence
    }

    this.updateParticles(scaledTime, { nebulaSize, petalCurl, rotationRate, cloudDepth, corePulse, turbulence })

    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true

    this.controls.update()

    if (this.prefersReducedMotion) {
      this.renderer.render(this.scene, this.camera)
    } else {
      this.composer.render()
    }
  }

  private updateParticles(time: number, params: OrbParams): void {
    const { nebulaSize, petalCurl, rotationRate, cloudDepth, corePulse, turbulence } = params
    const colors = this.currentColors
    const count = this.count
    const safeCount = Math.max(1, count)
    const tau = Math.PI * 2.0
    const goldenAngle = 2.399963229728653
    const phaseTime = time * rotationRate

    for (let i = 0; i < count; i++) {
      const targetPos = this.target
      const color = this.pColor

      const unitIndex = i / safeCount

      const hashA = Math.sin((i + 1.0) * 12.9898) * 43758.5453
      const hashB = Math.sin((i + 1.0) * 78.233) * 24634.6345
      const hashC = Math.sin((i + 1.0) * 39.425) * 15731.7431

      const randA = hashA - Math.floor(hashA)
      const randB = hashB - Math.floor(hashB)
      const randC = hashC - Math.floor(hashC)

      const signedA = randA * 2.0 - 1.0
      const signedB = randB * 2.0 - 1.0
      const signedC = randC * 2.0 - 1.0

      let px = 0.0
      let py = 0.0
      let pz = 0.0

      let hue = colors.petalHueBase
      let saturation = 0.9
      let lightness = 0.5

      // 70% of particles: layered rose-shaped ionized-gas petals.
      if (unitIndex < 0.70) {
        const local = unitIndex / 0.70

        const layerPosition = local * 7.0
        const layer = Math.min(6.0, Math.floor(layerPosition))
        const layerFraction = layerPosition - layer

        const petalCount = 7.0 + layer

        const petalPosition = layerFraction * petalCount
        const petal = Math.floor(petalPosition)
        const along = petalPosition - petal

        const petalArc = Math.sin(Math.PI * along)
        const layerScale = layer / 6.0

        const breathing = 1.0 + 0.035 * Math.sin(time * corePulse + layer * 0.9)

        const baseAngle = (petal / petalCount) * tau + layer * goldenAngle * 0.34

        const curlAngle =
          baseAngle +
          phaseTime * (0.34 - layerScale * 0.18) +
          petalCurl * (along - 0.18) * (0.75 + layerScale * 0.85) +
          signedC * 0.045 * turbulence

        const radialStart = nebulaSize * (0.08 + layerScale * 0.43)
        const radialGrowth = nebulaSize * (0.20 + layerScale * 0.22) * along
        const radialRipple = nebulaSize * 0.018 * turbulence * Math.sin(along * 13.0 + layer * 2.1 + time * 0.42)

        const radius = (radialStart + radialGrowth + radialRipple) * breathing

        const petalWidth = nebulaSize * (0.025 + layerScale * 0.055) * petalArc * (0.35 + 0.65 * randB)
        const sideOffset = signedA * petalWidth

        const ca = Math.cos(curlAngle)
        const sa = Math.sin(curlAngle)

        const tangentAngle = curlAngle + Math.PI * 0.5
        const ct = Math.cos(tangentAngle)
        const st = Math.sin(tangentAngle)

        px = ca * radius + ct * sideOffset
        pz = sa * radius + st * sideOffset

        py =
          signedB * cloudDepth * petalArc * (0.35 + layerScale * 0.95) +
          Math.sin(curlAngle * 3.0 - time * 0.28 + layer) * cloudDepth * 0.12 * turbulence

        const dustLane = 0.5 + 0.5 * Math.sin(petal * 2.7 + along * 18.0 + layer * 1.3)
        const edgeGlow = Math.pow(petalArc, 0.45)

        hue = colors.petalHueBase - layerScale * colors.petalHueRange + signedC * colors.petalHueRange * PETAL_SECONDARY_HUE_RATIO
        saturation = 0.72 + edgeGlow * 0.26
        lightness = 0.14 + edgeGlow * 0.48 + (1.0 - layerScale) * 0.10 - dustLane * 0.10
      }
      // 14% of particles: dense central cluster and hot glowing nebular core.
      else if (unitIndex < 0.84) {
        const local = (unitIndex - 0.70) / 0.14

        const coreRadius = nebulaSize * 0.16 * Math.pow(local, 0.36)
        const coreTheta = i * goldenAngle + phaseTime * 0.8
        const coreY = 1.0 - 2.0 * randB
        const coreRing = Math.sqrt(Math.max(0.0, 1.0 - coreY * coreY))
        const pulse = 1.0 + 0.13 * Math.sin(time * corePulse * 2.0 + i * 0.013)

        px = Math.cos(coreTheta) * coreRing * coreRadius * pulse
        py = coreY * coreRadius * pulse
        pz = Math.sin(coreTheta) * coreRing * coreRadius * pulse

        hue = colors.coreHueBase + randC * colors.coreHueRange
        saturation = 0.52 + randA * 0.28
        lightness = 0.56 + (1.0 - local) * 0.38
      }
      // 12% of particles: diffuse violet outer nebular halo.
      else if (unitIndex < 0.96) {
        const local = (unitIndex - 0.84) / 0.12

        const haloAngle = i * goldenAngle + phaseTime * 0.12
        const haloRadius = nebulaSize * (0.72 + local * 0.66 + signedA * 0.08)
        const haloWarp =
          1.0 +
          0.10 * Math.sin(haloAngle * 5.0 + time * 0.25) +
          0.05 * turbulence * Math.sin(haloAngle * 11.0 - time * 0.17)

        px = Math.cos(haloAngle) * haloRadius * haloWarp
        pz = Math.sin(haloAngle) * haloRadius * haloWarp

        py =
          signedB * cloudDepth * (1.2 + local * 1.8) +
          Math.sin(haloAngle * 2.0 + time * 0.2) * cloudDepth * 0.35

        hue = colors.haloHueBase + randC * colors.haloHueRange
        saturation = 0.58 + randA * 0.30
        lightness = 0.12 + (1.0 - local) * 0.22 + randB * 0.12
      }
      // 4% of particles: sparse background stars surrounding the nebula.
      else {
        const local = (unitIndex - 0.96) / 0.04

        const starAngle = i * goldenAngle
        const starY = signedB
        const starRing = Math.sqrt(Math.max(0.0, 1.0 - starY * starY))
        const starRadius = nebulaSize * (1.25 + local * 1.10 + randA * 0.55)
        const twinkle = 0.5 + 0.5 * Math.sin(time * (1.2 + randC * 2.2) + i * 0.17)

        px = Math.cos(starAngle) * starRing * starRadius
        py = starY * starRadius * 0.72
        pz = Math.sin(starAngle) * starRing * starRadius

        hue = 0.55 + randC * 0.12
        saturation = 0.18 + randA * 0.35
        lightness = 0.32 + twinkle * 0.50
      }

      lightness = Math.max(0.02, Math.min(0.98, lightness))
      saturation = Math.max(0.0, Math.min(1.0, saturation))
      hue = hue - Math.floor(hue)

      targetPos.set(px, py, pz)
      color.setHSL(hue, saturation, lightness)

      this.positions[i].lerp(this.target, 0.1)
      this.dummy.position.copy(this.positions[i])
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
      this.mesh.setColorAt(i, this.pColor)
    }
  }
}
