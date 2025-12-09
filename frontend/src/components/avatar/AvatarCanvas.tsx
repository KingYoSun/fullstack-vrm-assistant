import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Box3,
  LoopOnce,
  PerspectiveCamera,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from 'three'
import { GLTFLoader, type GLTF, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useAppStore } from '../../store/appStore'
import type { MotionDiagResult } from '../../types/app'

type VrmModelProps = {
  url: string
  mouthOpen: number
  onLoaded?: (name: string) => void
  onVrmLoaded?: (vrm: VRM) => void
}

type CameraFitterProps = {
  vrm: VRM | null
  recenterKey: number
  controlsRef: MutableRefObject<OrbitControlsImpl | null>
}

export type AvatarCanvasProps = { url: string; mouthOpen: number; onLoaded?: (name: string) => void; recenterKey: number }

type CanvasErrorBoundaryProps = { resetKey?: string; onError?: (error: Error) => void; children: ReactNode }
type CanvasErrorBoundaryState = { error: Error | null }

const avatarBox = new Box3()
const avatarSize = new Vector3()
const headPosition = new Vector3()
const shoulderPosition = new Vector3()
const focusPosition = new Vector3()
const frontDirection = new Vector3()
const directionBuffer = new Vector3()
const cameraPositionBuffer = new Vector3()
const tmpQuat = new Quaternion()

const buildMotionClip = (vrm: VRM, motion: MotionDiagResult): AnimationClip | null => {
  const humanoid = vrm.humanoid
  if (!humanoid) return null

  const tracks: (QuaternionKeyframeTrack | VectorKeyframeTrack)[] = []

  const toTimes = (frames: { t: number }[]) => Float32Array.from(frames.map((f) => f.t ?? 0))

  Object.entries(motion.tracks ?? {}).forEach(([bone, frames]) => {
    if (!Array.isArray(frames) || frames.length === 0) return
    const node = humanoid.getBoneNode(bone as never)
    if (!node) return
    const times = toTimes(frames)
    const values = new Float32Array(frames.length * 4)
    frames.forEach((frame, idx) => {
      tmpQuat.set(frame.x ?? 0, frame.y ?? 0, frame.z ?? 0, frame.w ?? 1).normalize()
      const offset = idx * 4
      values[offset] = tmpQuat.x
      values[offset + 1] = tmpQuat.y
      values[offset + 2] = tmpQuat.z
      values[offset + 3] = tmpQuat.w
    })
    tracks.push(new QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values))
  })

  if (motion.rootPosition?.length) {
    const hips = humanoid.getBoneNode('hips')
    if (hips) {
      const times = toTimes(motion.rootPosition)
      const values = new Float32Array(motion.rootPosition.length * 3)
      motion.rootPosition.forEach((frame, idx) => {
        const offset = idx * 3
        values[offset] = frame.x ?? 0
        values[offset + 1] = frame.y ?? 0
        values[offset + 2] = frame.z ?? 0
      })
      tracks.push(new VectorKeyframeTrack(`${hips.name}.position`, times, values))
    }
  }

  if (!tracks.length) return null
  return new AnimationClip(`motion-${motion.jobId || Date.now()}`, motion.durationSec ?? -1, tracks)
}

const adjustCameraToHeadshot = (vrm: VRM, camera: PerspectiveCamera, controls?: OrbitControlsImpl | null) => {
  vrm.scene.updateWorldMatrix(true, true)
  avatarBox.setFromObject(vrm.scene)
  const size = avatarBox.getSize(avatarSize)

  const headBone = vrm.humanoid?.getBoneNode('head')
  const shoulderBone =
    vrm.humanoid?.getBoneNode('neck') ??
    vrm.humanoid?.getBoneNode('upperChest') ??
    vrm.humanoid?.getBoneNode('chest')

  const head = headBone?.getWorldPosition(headPosition) ?? avatarBox.getCenter(headPosition)
  const shoulder = shoulderBone?.getWorldPosition(shoulderPosition) ?? null

  const focus = focusPosition.copy(head)
  if (shoulder) {
    focus.lerp(shoulder, 0.35)
  } else {
    focus.y -= size.y * 0.18
  }
  focus.y += size.y * 0.05

  const desiredViewHeight = Math.max(0.32, Math.min(size.y * 0.3, 0.6))
  const fovRad = (camera.fov * Math.PI) / 180
  const distance = Math.min(1.8, Math.max(0.6, desiredViewHeight / (2 * Math.tan(fovRad / 2))))

  vrm.scene.getWorldDirection(frontDirection)
  if (!Number.isFinite(frontDirection.x + frontDirection.y + frontDirection.z) || frontDirection.length() < 1e-6) {
    frontDirection.set(0, 0, -1)
  }
  frontDirection.normalize()

  const viewDirection = directionBuffer.copy(frontDirection).multiplyScalar(-1)
  if (viewDirection.length() < 1e-3) {
    viewDirection.set(0, 0, 1)
  }

  const newPosition = cameraPositionBuffer.copy(focus).add(viewDirection.multiplyScalar(distance))
  camera.position.copy(newPosition)
  camera.lookAt(focus)
  camera.updateProjectionMatrix()

  if (controls) {
    controls.target.copy(focus)
    controls.update()
  }
}

export class CanvasErrorBoundary extends Component<CanvasErrorBoundaryProps, CanvasErrorBoundaryState> {
  state: CanvasErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): CanvasErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error)
  }

  componentDidUpdate(prevProps: CanvasErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return (
        <div className="canvas-error">
          <div className="eyebrow">VRM 読み込みエラー</div>
          <p className="mono small">{this.state.error.message}</p>
          <button onClick={this.handleReset}>再試行</button>
        </div>
      )
    }
    return this.props.children
  }
}

function VrmModel({ url, mouthOpen, onLoaded, onVrmLoaded }: VrmModelProps) {
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.register((parser: GLTFParser) => new VRMLoaderPlugin(parser))
  }) as GLTF

  const vrm = useMemo(() => {
    const loaded = gltf.userData.vrm as VRM | undefined
    if (!loaded) return null
    VRMUtils.removeUnnecessaryJoints(loaded.scene)
    VRMUtils.removeUnnecessaryVertices(loaded.scene)
    loaded.scene.traverse((obj) => {
      obj.frustumCulled = false
    })
    return loaded
  }, [gltf])

  useEffect(() => {
    if (!vrm) return
    if (onLoaded) {
      const meta = vrm.meta
      const name = meta.metaVersion === '0' ? meta.title ?? 'VRM avatar' : meta.name ?? 'VRM avatar'
      onLoaded(name)
    }
    onVrmLoaded?.(vrm)
  }, [onLoaded, onVrmLoaded, vrm])

  useFrame((_, delta) => {
    if (!vrm) return
    const intensity = Math.min(1, Math.max(0, mouthOpen))
    vrm.expressionManager?.setValue('aa', intensity)
    vrm.expressionManager?.setValue('ih', intensity * 0.25)
    vrm.expressionManager?.update()
    vrm.update(delta)
  })

  return vrm ? <primitive object={vrm.scene} /> : null
}

function CameraFitter({ vrm, recenterKey, controlsRef }: CameraFitterProps) {
  const { camera } = useThree()

  useEffect(() => {
    if (!vrm) return
    adjustCameraToHeadshot(vrm, camera as PerspectiveCamera, controlsRef.current)
  }, [vrm, recenterKey, camera, controlsRef])

  return null
}

export function AvatarCanvas({ url, mouthOpen, onLoaded, recenterKey }: AvatarCanvasProps) {
  const [vrm, setVrm] = useState<VRM | null>(null)
  const controlsRef = useRef<OrbitControlsImpl | null>(null)

  const handleVrmLoaded = useCallback((loaded: VRM) => {
    setVrm(loaded)
  }, [])

  return (
    <Canvas camera={{ position: [0, 1.4, 2.4], fov: 28 }} shadows style={{ height: '100%', width: '100%' }}>
      <color attach="background" args={['#0b1021']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[2, 3, 2]} intensity={1.1} castShadow />
      <Suspense
        fallback={
          <Html center>
            <span className="loading">Loading VRM...</span>
          </Html>
        }
      >
        <VrmModel url={url} mouthOpen={mouthOpen} onLoaded={onLoaded} onVrmLoaded={handleVrmLoaded} />
        <CameraFitter vrm={vrm} recenterKey={recenterKey} controlsRef={controlsRef} />
        <OrbitControls ref={controlsRef} minDistance={0.9} maxDistance={3.5} />
        <MotionPlayer vrm={vrm} />
      </Suspense>
    </Canvas>
  )
}

type MotionPlayerProps = { vrm: VRM | null }

function MotionPlayer({ vrm }: MotionPlayerProps) {
  const mixerRef = useRef<AnimationMixer | null>(null)
  const lastActionRef = useRef<AnimationAction | null>(null)
  const motionPlayback = useAppStore((s) => s.motionPlayback)
  const motionPlaybackKey = useAppStore((s) => s.motionPlaybackKey)
  const appendLog = useAppStore((s) => s.appendLog)

  useEffect(() => {
    if (!vrm) return undefined
    mixerRef.current = new AnimationMixer(vrm.scene)
    return () => {
      mixerRef.current?.stopAllAction()
      mixerRef.current = null
      lastActionRef.current = null
    }
  }, [vrm])

  useFrame((_, delta) => {
    mixerRef.current?.update(delta)
  })

  useEffect(() => {
    if (!vrm || !motionPlayback || !mixerRef.current) return
    const clip = buildMotionClip(vrm, motionPlayback)
    if (!clip || clip.tracks.length === 0) {
      return
    }
    const mixer = mixerRef.current
    if (lastActionRef.current) {
      lastActionRef.current.stop()
    }
    const action = mixer.clipAction(clip)
    action.reset()
    action.setLoop(LoopOnce, 1)
    action.clampWhenFinished = true
    action.play()
    lastActionRef.current = action
    appendLog(`motion: play job=${motionPlayback.jobId || 'n/a'} (${clip.tracks.length} tracks)`)
  }, [motionPlaybackKey, motionPlayback, vrm, appendLog])

  return null
}
