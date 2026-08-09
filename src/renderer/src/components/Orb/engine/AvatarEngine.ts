import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// See ReiganOrb — mic capture is off the main thread now, so this only
// needs to be a light courtesy throttle, not a hard guard.
const THROTTLED_FRAME_INTERVAL_MS = 1000 / 30

// Minimal GLB viewer: load, frame, light, orbit + auto-spin. No mood/rigging
// system yet — that lands once animations are wired up.
export class AvatarEngine {
  private container: HTMLElement
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private model: THREE.Group | null = null
  private animationFrameId: number | null = null
  private resizeObserver: ResizeObserver
  private disposed = false
  private autoSpin = true
  // Shares the main thread with mic capture while listening — see ReiganOrb
  // for why this gets capped instead of rendering full tilt.
  private throttled = false
  private lastThrottledRender = 0

  onLoadProgress?: (progress: number) => void
  onLoadComplete?: () => void
  onLoadError?: (error: Error) => void

  constructor(container: HTMLElement) {
    this.container = container
    const { width, height } = container.getBoundingClientRect()

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setSize(width, height)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.2
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()

    this.camera = new THREE.PerspectiveCamera(30, width / height || 1, 0.01, 100)
    this.camera.position.set(0, 0.75, 0.9)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = false
    this.controls.minDistance = 0.4
    this.controls.maxDistance = 3
    this.controls.target.set(0, 0.6, 0)
    this.controls.update()

    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    this.scene.add(ambient)
    const key = new THREE.DirectionalLight(0xfff0f5, 1.0)
    key.position.set(2, 3, 2)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0xd0d0ff, 0.4)
    fill.position.set(-2, 1, -1)
    this.scene.add(fill)
    const rim = new THREE.DirectionalLight(0x7c3aed, 0.5)
    rim.position.set(0, 2, -3)
    this.scene.add(rim)

    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(container)

    this.animate()
  }

  async loadModel(url: string): Promise<void> {
    const loader = new GLTFLoader()

    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          if (this.disposed) return

          if (this.model) {
            this.scene.remove(this.model)
          }
          this.model = gltf.scene

          // Normalize scale to fit a ~1-unit box, then rest it on the floor
          // and center it horizontally so the default view frames it well.
          const box = new THREE.Box3().setFromObject(this.model)
          const size = box.getSize(new THREE.Vector3())
          const maxDim = Math.max(size.x, size.y, size.z) || 1
          this.model.scale.setScalar(1 / maxDim)

          const box2 = new THREE.Box3().setFromObject(this.model)
          const center = box2.getCenter(new THREE.Vector3())
          this.model.position.x -= center.x
          this.model.position.z -= center.z
          this.model.position.y -= box2.min.y

          this.scene.add(this.model)
          this.onLoadComplete?.()
          resolve()
        },
        (event) => {
          if (event.total > 0) this.onLoadProgress?.(event.loaded / event.total)
        },
        (error) => {
          const err = error instanceof Error ? error : new Error(String(error))
          this.onLoadError?.(err)
          reject(err)
        },
      )
    })
  }

  setAutoSpin(enabled: boolean): void {
    this.autoSpin = enabled
  }

  setThrottled(throttled: boolean): void {
    this.throttled = throttled
  }

  private animate = (): void => {
    if (this.disposed) return
    this.animationFrameId = requestAnimationFrame(this.animate)

    if (this.throttled) {
      const now = performance.now()
      if (now - this.lastThrottledRender < THROTTLED_FRAME_INTERVAL_MS) return
      this.lastThrottledRender = now
    }

    if (this.autoSpin && this.model) {
      this.model.rotation.y += 0.003
    }

    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  private handleResize = (): void => {
    const { width, height } = this.container.getBoundingClientRect()
    if (width === 0 || height === 0) return
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  dispose(): void {
    this.disposed = true
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId)
    this.resizeObserver.disconnect()
    this.controls.dispose()

    this.scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose()
        const material = child.material
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material?.dispose()
      }
    })

    this.renderer.dispose()
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement)
    }
  }
}
