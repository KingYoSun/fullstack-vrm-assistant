import * as THREE from 'three'
import type { AnimationClip, KeyframeTrack } from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { VRM } from '@pixiv/three-vrm'
import type { MotionKeyframe, MotionRootPosition } from '../types/app'

const BONES_NAME_LIST: Record<string, string[]> = {
  head: ['root', 'head', 'J_Bip_C_Head', 'Normalized_J_Bip_C_Head'],
  neck: ['neck_1', 'neck', 'J_Bip_C_Neck', 'Normalized_J_Bip_C_Neck'],
  chest: ['torso_4', 'spine1', 'chest', 'J_Bip_C_Chest', 'Normalized_J_Bip_C_Chest'],
  spine: ['torso_3', 'spine3', 'spine', 'J_Bip_C_Spine', 'Normalized_J_Bip_C_Spine'],
  hips: ['torso_2', 'hips', 'J_Bip_C_Hips', 'Normalized_J_Bip_C_Hips'],
  rightShoulder: ['r_shoulder', 'rightshoulder', 'J_Bip_R_Shoulder', 'Normalized_J_Bip_R_Shoulder'],
  rightUpperArm: ['r_up_arm', 'rightarm', 'rightupperarm', 'J_Bip_R_UpperArm', 'Normalized_J_Bip_R_UpperArm'],
  rightLowerArm: ['r_low_arm', 'rightforearm', 'rightlowerarm', 'J_Bip_R_LowerArm', 'Normalized_J_Bip_R_LowerArm'],
  rightHand: ['r_hand', 'righthand', 'J_Bip_R_Hand', 'Normalized_J_Bip_R_Hand'],
  leftShoulder: ['l_shoulder', 'leftshoulder', 'J_Bip_L_Shoulder', 'Normalized_J_Bip_L_Shoulder'],
  leftUpperArm: ['l_up_arm', 'leftarm', 'leftupperarm', 'J_Bip_L_UpperArm', 'Normalized_J_Bip_L_UpperArm'],
  leftLowerArm: ['l_low_arm', 'leftforearm', 'leftlowerarm', 'J_Bip_L_LowerArm', 'Normalized_J_Bip_L_LowerArm'],
  leftHand: ['l_hand', 'lefthand', 'J_Bip_L_Hand', 'Normalized_J_Bip_L_Hand'],
  rightUpperLeg: ['r_up_leg', 'rightupleg', 'rightupperleg', 'J_Bip_R_UpperLeg', 'Normalized_J_Bip_R_UpperLeg'],
  rightLowerLeg: ['r_low_leg', 'rightleg', 'rightlowerleg', 'J_Bip_R_LowerLeg', 'Normalized_J_Bip_R_LowerLeg'],
  rightFoot: ['r_foot', 'rightfoot', 'J_Bip_R_Foot', 'Normalized_J_Bip_R_Foot'],
  leftUpperLeg: ['l_up_leg', 'leftupleg', 'leftupperleg', 'J_Bip_L_UpperLeg', 'Normalized_J_Bip_L_UpperLeg'],
  leftLowerLeg: ['l_low_leg', 'leftleg', 'leftlowerleg', 'J_Bip_L_LowerLeg', 'Normalized_J_Bip_L_LowerLeg'],
  leftFoot: ['l_foot', 'leftfoot', 'J_Bip_L_Foot', 'Normalized_J_Bip_L_Foot'],
}

const allCandidates = Object.entries(BONES_NAME_LIST).flatMap(([key, aliases]) =>
  aliases.concat(key).map((alias) => [alias.toLowerCase(), key] as const),
)

const remapTrackNames = (clip: AnimationClip) => {
  clip.tracks.forEach((track) => {
    const match = track.name.match(/^(.+)\.(position|quaternion|scale)$/)
    if (!match) return
    const base = match[1].toLowerCase()
    const prop = match[2]
    const hit = allCandidates.find(([alias]) => alias === base)
    if (hit) {
      const humanBone = hit[1]
      track.name = `${humanBone}.${prop}`
    }
  })
}

export async function loadVrmaClip(url: string): Promise<AnimationClip> {
  const loader = new GLTFLoader()
  const gltf = (await loader.loadAsync(url)) as GLTF
  const clip = gltf.animations?.[0]
  if (!clip) {
    throw new Error('VRMA has no animations')
  }
  // Track を HumanBone 名に揃える
  remapTrackNames(clip)
  // eslint-disable-next-line no-console
  console.info('vrma loader: clip loaded', {
    url,
    tracks: clip.tracks.map((t: KeyframeTrack) => t.name),
    duration: clip.duration,
  })
  return clip
}

const resolveHumanBone = (base: string): string | null => {
  const lower = base.toLowerCase()
  const hit = allCandidates.find(([alias]) => alias === lower)
  return hit ? hit[1] : null
}

export type RetargetResult = { clip: AnimationClip; missing: string[] }

type RetargetOptions = {
  useNormalized?: boolean
}

export const retargetVrmaClip = (clip: AnimationClip, vrm: VRM, options: RetargetOptions = {}): RetargetResult => {
  const humanoid = vrm.humanoid
  if (!humanoid) return { clip, missing: [] }
  const filtered: KeyframeTrack[] = []
  const missing: string[] = []
  clip.tracks.forEach((track) => {
    const match = track.name.match(/^(.+)\.(position|quaternion|scale)$/)
    if (!match) return
    const base = match[1]
    const prop = match[2]
    const normalizedBase = base.replace(/^normalized_/i, '')
    const humanBone = resolveHumanBone(normalizedBase) ?? normalizedBase
    const node = options.useNormalized
      ? humanoid.getNormalizedBoneNode(humanBone as never)
      : humanoid.getRawBoneNode(humanBone as never)
    if (!node) {
      missing.push(`${humanBone}.${prop}`)
      return
    }
    track.name = `${node.name}.${prop}`
    filtered.push(track)
  })
  const retargeted = new THREE.AnimationClip(clip.name || 'vrma', clip.duration, filtered)
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.debug('retarget: missing tracks', missing)
  }
  return { clip: retargeted, missing }
}

const tmpQuat = new THREE.Quaternion()
const tmpAxis = new THREE.Vector3()
const clamp = (v: number) => Math.min(1, Math.max(-1, v))
const ROTATION_BOOST_FACTOR = 4
const ROTATION_BOOST_THRESHOLD_DEG = 8

export const motionJsonToClip = (motion: {
  jobId?: string
  durationSec?: number
  tracks?: Record<string, Array<{ t: number; x: number; y: number; z: number; w: number }>>
  rootPosition?: Array<{ t: number; x: number; y: number; z: number }>
}): AnimationClip => {
  const tracks: KeyframeTrack[] = []
  const toTimes = (frames: { t: number }[]) => Float32Array.from(frames.map((f) => f.t ?? 0))
  const normalizeName = (name: string) => {
    const lower = name.toLowerCase()
    const map: Record<string, string> = {
      leftarm: 'leftUpperArm',
      rightarm: 'rightUpperArm',
      leftforearm: 'leftLowerArm',
      rightforearm: 'rightLowerArm',
      leftupleg: 'leftUpperLeg',
      rightupleg: 'rightUpperLeg',
      leftleg: 'leftLowerLeg',
      rightleg: 'rightLowerLeg',
      spine1: 'chest',
      spine2: 'upperChest',
      spine3: 'upperChest',
      normalized_hips: 'hips',
      normalized_spine: 'spine',
      normalized_spine1: 'chest',
      normalized_spine2: 'upperChest',
      normalized_spine3: 'upperChest',
      normalized_leftarm: 'leftUpperArm',
      normalized_rightarm: 'rightUpperArm',
      normalized_leftforearm: 'leftLowerArm',
      normalized_rightforearm: 'rightLowerArm',
      normalized_leftleg: 'leftLowerLeg',
      normalized_rightleg: 'rightLowerLeg',
      normalized_leftupleg: 'leftUpperLeg',
      normalized_rightupleg: 'rightUpperLeg',
      leftupperarm: 'leftUpperArm',
      rightupperarm: 'rightUpperArm',
      leftlowerarm: 'leftLowerArm',
      rightlowerarm: 'rightLowerArm',
      leftupperleg: 'leftUpperLeg',
      rightupperleg: 'rightUpperLeg',
    }
    return map[lower] ?? name
  }

  Object.entries(motion.tracks || {}).forEach(([bone, frames]) => {
    if (!Array.isArray(frames) || frames.length === 0) return
    const targetBone = normalizeName(bone)
    const times = toTimes(frames)

    // 1st pass: measure magnitude
    let maxDeg = 0
    frames.forEach((frame) => {
      tmpQuat.set(frame.x ?? 0, frame.y ?? 0, frame.z ?? 0, frame.w ?? 1).normalize()
      const angle = 2 * Math.acos(clamp(tmpQuat.w))
      const deg = (angle * 180) / Math.PI
      if (deg > maxDeg) maxDeg = deg
    })
    const scale = maxDeg < ROTATION_BOOST_THRESHOLD_DEG ? ROTATION_BOOST_FACTOR : 1

    const values = new Float32Array(frames.length * 4)
    frames.forEach((frame, idx) => {
      tmpQuat.set(frame.x ?? 0, frame.y ?? 0, frame.z ?? 0, frame.w ?? 1).normalize()
      if (scale !== 1) {
        const angle = 2 * Math.acos(clamp(tmpQuat.w))
        const sinHalf = Math.sqrt(Math.max(0, 1 - tmpQuat.w * tmpQuat.w))
        if (sinHalf < 1e-6) {
          tmpAxis.set(0, 1, 0)
        } else {
          tmpAxis.set(tmpQuat.x / sinHalf, tmpQuat.y / sinHalf, tmpQuat.z / sinHalf)
        }
        tmpQuat.setFromAxisAngle(tmpAxis, angle * scale)
      }
      const offset = idx * 4
      values[offset] = tmpQuat.x
      values[offset + 1] = tmpQuat.y
      values[offset + 2] = tmpQuat.z
      values[offset + 3] = tmpQuat.w
    })
    tracks.push(new THREE.QuaternionKeyframeTrack(`${targetBone}.quaternion`, times, values))
    // eslint-disable-next-line no-console
    console.info('motion: track stats', { track: targetBone, maxDeg: Number(maxDeg.toFixed(2)), scaleApplied: scale })
  })

  if (motion.rootPosition?.length) {
    const times = toTimes(motion.rootPosition)
    const values = new Float32Array(motion.rootPosition.length * 3)
    motion.rootPosition.forEach((frame, idx) => {
      const offset = idx * 3
      values[offset] = frame.x ?? 0
      values[offset + 1] = frame.y ?? 0
      values[offset + 2] = frame.z ?? 0
    })
    tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, values))
  }

  const clip = new THREE.AnimationClip(`motion-${motion.jobId || Date.now()}`, motion.durationSec ?? -1, tracks)
  // eslint-disable-next-line no-console
  console.info('motion: clip built from json', {
    jobId: motion.jobId,
    duration: motion.durationSec,
    trackNames: clip.tracks.map((t) => t.name),
    rootKeys: motion.rootPosition?.length ?? 0,
  })
  return clip
}

const estimateFps = (times: ArrayLike<number>): number => {
  if (!times || times.length < 2) return 30
  const deltas: number[] = []
  for (let i = 1; i < times.length; i += 1) {
    const dt = times[i] - times[i - 1]
    if (dt > 1e-4) deltas.push(dt)
  }
  if (!deltas.length) return 30
  deltas.sort((a, b) => a - b)
  const mid = Math.floor(deltas.length / 2)
  const median = deltas.length % 2 ? deltas[mid] : (deltas[mid - 1] + deltas[mid]) / 2
  return Math.round(1 / median)
}

export const clipToMotionJson = (
  clip: AnimationClip,
  options: { jobId?: string; url?: string } = {},
): {
  jobId: string
  durationSec: number
  fps: number
  tracks: Record<string, MotionKeyframe[]>
  rootPosition?: MotionRootPosition[]
  url?: string
} => {
  const tracks: Record<string, MotionKeyframe[]> = {}
  let rootPosition: MotionRootPosition[] | undefined
  let sampleTimes: Float32Array | null = null

  clip.tracks.forEach((track) => {
    const match = track.name.match(/^(.+)\.(position|quaternion)$/)
    if (!match) return
    const base = match[1]
    const prop = match[2]
    const humanBone = resolveHumanBone(base.replace(/^normalized_/i, '')) ?? base
    const times = track.times
    if (!sampleTimes || times.length > sampleTimes.length) sampleTimes = times

    if (prop === 'quaternion') {
      const values = track.values as ArrayLike<number>
      const frames: MotionKeyframe[] = []
      for (let i = 0; i < times.length; i += 1) {
        const offset = i * 4
        frames.push({
          t: times[i],
          x: values[offset],
          y: values[offset + 1],
          z: values[offset + 2],
          w: values[offset + 3],
        })
      }
      tracks[humanBone] = frames
    } else if (prop === 'position' && humanBone.toLowerCase().includes('hip')) {
      const values = track.values as ArrayLike<number>
      const frames: MotionRootPosition[] = []
      for (let i = 0; i < times.length; i += 1) {
        const offset = i * 3
        frames.push({
          t: times[i],
          x: values[offset],
          y: values[offset + 1],
          z: values[offset + 2],
        })
      }
      rootPosition = frames
    }
  })

  const fps = sampleTimes ? estimateFps(sampleTimes) : 30
  let lastSampleTime = 0
  if (sampleTimes) {
    const times = sampleTimes as Float32Array
    lastSampleTime = times[times.length - 1] ?? 0
  }
  const durationSec = clip.duration > 0 ? clip.duration : lastSampleTime
  const jobId = options.jobId ?? `vrma-to-json-${Date.now()}`
  return { jobId, durationSec, fps, tracks, rootPosition, url: options.url }
}
