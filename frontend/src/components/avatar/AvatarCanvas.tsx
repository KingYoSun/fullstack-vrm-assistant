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
  LoopRepeat,
  PerspectiveCamera,
  Vector3,
} from 'three'
import { GLTFLoader, type GLTF, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useAppStore } from '../../store/appStore'
import { loadVrmaClip, motionJsonToClip, retargetVrmaClip } from '../../utils/vrmaLoader'

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

const adjustCameraToHeadshot = (vrm: VRM, camera: PerspectiveCamera, controls?: OrbitControlsImpl | null) => {
  vrm.scene.updateWorldMatrix(true, true)
  avatarBox.setFromObject(vrm.scene)
  const size = avatarBox.getSize(avatarSize)

  const headBone = vrm.humanoid?.getRawBoneNode('head' as never)
  const shoulderBone =
    vrm.humanoid?.getRawBoneNode('neck' as never) ??
    vrm.humanoid?.getRawBoneNode('upperChest' as never) ??
    vrm.humanoid?.getRawBoneNode('chest' as never)

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
    // normalized ボーンにアニメを乗せ、毎フレーム raw にコピーさせる
    if (loaded.humanoid) {
      // eslint-disable-next-line react-hooks/immutability
      loaded.humanoid.autoUpdateHumanBones = true
    }
    VRMUtils.combineSkeletons(loaded.scene)
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
  }, -1)

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
    if (loaded.humanoid) {
      const humanBones = loaded.humanoid.humanBones as Record<string, { node: { name: string } }>
      const raws = Object.entries(humanBones).map(([humanBoneName, bone]) => ({
        humanBoneName,
        nodeName: bone.node.name,
      }))
      // eslint-disable-next-line no-console
      console.info('VRM humanoid bones (raw)', raws)
      const normalized = Object.keys(humanBones).map((humanBoneName) => ({
        humanBoneName,
        nodeName: loaded.humanoid?.getNormalizedBoneNode(humanBoneName as never)?.name,
      }))
      // eslint-disable-next-line no-console
      console.info('VRM humanoid bones (normalized)', normalized)
    }
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

const DEFAULT_IDLE_VRMA_URL = '/idle_loop.vrma'
const MOTION_FADE_SEC = 0.2

function MotionPlayer({ vrm }: MotionPlayerProps) {
  const mixerRef = useRef<AnimationMixer | null>(null)
  const lastActionRef = useRef<AnimationAction | null>(null)
  const idleActionRef = useRef<AnimationAction | null>(null)
  const lastVrmaKeyRef = useRef<number>(0)
  const motionPlayback = useAppStore((s) => s.motionPlayback)
  const motionPlaybackKey = useAppStore((s) => s.motionPlaybackKey)
  const vrmaUrl = useAppStore((s) => s.vrmaUrl)
  const vrmaKey = useAppStore((s) => s.vrmaKey)
  const appendLog = useAppStore((s) => s.appendLog)

  useEffect(() => {
    if (!vrm) return undefined
    mixerRef.current = new AnimationMixer(vrm.scene)
    const mixer = mixerRef.current

    const handleFinished = (event: unknown) => {
      const finishedAction = (event as { action?: AnimationAction }).action
      if (!finishedAction) return
      if (finishedAction !== lastActionRef.current) return
      lastActionRef.current = null

      const idle = idleActionRef.current
      if (idle) {
        idle.enabled = true
        idle.fadeIn(MOTION_FADE_SEC)
        idle.play()
      }

      finishedAction.fadeOut(MOTION_FADE_SEC)
      const clip = finishedAction.getClip()
      window.setTimeout(() => {
        finishedAction.stop()
        mixer.uncacheAction(clip, vrm.scene)
      }, Math.round((MOTION_FADE_SEC + 0.05) * 1000))
    }

    mixer.addEventListener('finished', handleFinished)

    let aborted = false
    loadVrmaClip(DEFAULT_IDLE_VRMA_URL)
      .then((clip) => {
        if (aborted) return
        const { clip: retargeted, missing } = retargetVrmaClip(clip, vrm, { useNormalized: true })
        if (!retargeted || retargeted.tracks.length === 0) {
          appendLog(`idle: no applicable tracks (${DEFAULT_IDLE_VRMA_URL})`)
          return
        }
        if (missing.length) {
          // eslint-disable-next-line no-console
          console.warn(`idle retarget: missing ${missing.length}`, { missing: missing.slice(0, 12) })
        }

        const action = mixer.clipAction(retargeted)
        action.reset()
        action.setLoop(LoopRepeat, Infinity)
        action.enabled = true
        action.play()
        if (lastActionRef.current) {
          action.setEffectiveWeight(0)
        }
        idleActionRef.current = action
        appendLog(`idle: play ${DEFAULT_IDLE_VRMA_URL} (${retargeted.tracks.length} tracks)`)
      })
      .catch((err) => {
        if (!aborted) {
          appendLog(`idle load error: ${(err as Error).message}`)
        }
      })

    return () => {
      aborted = true
      mixer.removeEventListener('finished', handleFinished)
      mixerRef.current?.stopAllAction()
      mixerRef.current = null
      lastActionRef.current = null
      idleActionRef.current = null
    }
  }, [vrm, appendLog])

  useFrame((_, delta) => {
    mixerRef.current?.update(delta)
  }, -2)

  const playRetargetedOneShot = useCallback((retargeted: AnimationClip) => {
    if (!vrm || !mixerRef.current) return
    const mixer = mixerRef.current
    const nextAction = mixer.clipAction(retargeted)
    const fromAction = lastActionRef.current ?? idleActionRef.current

    nextAction.reset()
    nextAction.setLoop(LoopOnce, 1)
    nextAction.clampWhenFinished = true
    nextAction.enabled = true
    nextAction.play()

    if (fromAction && fromAction !== nextAction) {
      fromAction.crossFadeTo(nextAction, MOTION_FADE_SEC, false)
    } else {
      nextAction.fadeIn(MOTION_FADE_SEC)
    }

    lastActionRef.current = nextAction
  }, [vrm])

  useEffect(() => {
    if (!motionPlayback) {
      // eslint-disable-next-line no-console
      console.info('motion: skipped (no motionPlayback)')
      return
    }
    if (motionPlayback.metadata && motionPlayback.metadata.generator === 'placeholder') {
      appendLog('motion: placeholder generator detected (Motion Diffusion Model backend が未稼働の可能性)')
      // eslint-disable-next-line no-console
      console.warn('motion generator is placeholder; output may be minimal', motionPlayback)
    }
    if (!vrm) {
      // eslint-disable-next-line no-console
      console.warn('motion: skipped (VRM not ready)', motionPlayback.jobId)
      return
    }
    if (!mixerRef.current) {
      // eslint-disable-next-line no-console
      console.warn('motion: skipped (mixer not ready)', motionPlayback.jobId)
      return
    }
    // eslint-disable-next-line no-console
    console.info('motion: effect triggered', {
      jobId: motionPlayback.jobId,
      trackKeys: Object.keys(motionPlayback.tracks || {}),
      rootKeys: motionPlayback.rootPosition?.length ?? 0,
    })
    appendLog(
      `motion: retarget start job=${motionPlayback.jobId || 'n/a'} srcTracks=${Object.keys(motionPlayback.tracks || {}).length}`,
    )
    const clip = motionJsonToClip({
      jobId: motionPlayback.jobId,
      durationSec: motionPlayback.durationSec,
      tracks: motionPlayback.tracks,
      rootPosition: motionPlayback.rootPosition,
    })
    const originalNames = clip.tracks.map((t) => t.name)
    const { clip: retargeted, missing } = retargetVrmaClip(clip, vrm, { useNormalized: true })
    if (!retargeted || retargeted.tracks.length === 0) {
      appendLog('motion: no applicable tracks for VRM (retargeted 0)')
      // eslint-disable-next-line no-console
      console.warn('motion retarget: no tracks bound', { originalNames, missing, motionPlayback })
      return
    }
    if (missing.length) {
      // eslint-disable-next-line no-console
      console.warn(`motion retarget: missing ${missing.length}`, {
        missing: missing.slice(0, 12),
        totalMissing: missing.length,
        originalNames,
      })
    }
    // eslint-disable-next-line no-console
    console.info('motion retarget mapping', {
      originalNames,
      retargetedNames: retargeted.tracks.map((t) => t.name),
      duration: retargeted.duration,
    })
    const trackNames = retargeted.tracks.map((t) => t.name)
    playRetargetedOneShot(retargeted)
    appendLog(
      `motion: play job=${motionPlayback.jobId || 'n/a'} (${retargeted.tracks.length} tracks) targets=${trackNames
        .slice(0, 6)
        .join(',')}${trackNames.length > 6 ? '…' : ''}`,
    )
    // eslint-disable-next-line no-console
    console.info('motion retargeted tracks', trackNames)
  }, [motionPlaybackKey, motionPlayback, vrm, appendLog, playRetargetedOneShot])

  useEffect(() => {
    let aborted = false
    if (!vrm || !vrmaUrl || !mixerRef.current) return
    if (vrmaKey === lastVrmaKeyRef.current) return
    lastVrmaKeyRef.current = vrmaKey
    loadVrmaClip(vrmaUrl)
      .then((clip) => {
        if (aborted || !clip || !mixerRef.current) return
        const { clip: retargeted, missing } = retargetVrmaClip(clip, vrm, { useNormalized: true })
        if (!retargeted || retargeted.tracks.length === 0) {
          appendLog('vrma: no applicable tracks for VRM (retargeted 0)')
          return
        }
        if (missing.length) {
          // eslint-disable-next-line no-console
          console.warn(`vrma retarget: missing ${missing.length}`, { missing: missing.slice(0, 12) })
        }
        playRetargetedOneShot(retargeted)
        appendLog(`vrma: play ${vrmaUrl} (${retargeted.tracks.length} tracks)`)
        // eslint-disable-next-line no-console
        console.info('vrma retargeted tracks', retargeted.tracks.map((t) => t.name))
      })
      .catch((err) => {
        if (!aborted) {
          appendLog(`vrma load error: ${(err as Error).message}`)
        }
      })
    return () => {
      aborted = true
    }
  }, [vrmaKey, vrmaUrl, vrm, appendLog, playRetargetedOneShot])

  return null
}
