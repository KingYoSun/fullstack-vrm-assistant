import * as THREE from 'three'
import type { AnimationClip, KeyframeTrack } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { VRM } from '@pixiv/three-vrm'

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

export async function loadVrmaClip(url: string, _vrm: VRM): Promise<AnimationClip> {
  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(url)
  const clip = gltf.animations?.[0]
  if (!clip) {
    throw new Error('VRMA has no animations')
  }
  // Track を HumanBone 名に揃える
  remapTrackNames(clip)
  return clip
}

const resolveHumanBone = (base: string): string | null => {
  const lower = base.toLowerCase()
  const hit = allCandidates.find(([alias]) => alias === lower)
  return hit ? hit[1] : null
}

export const retargetVrmaClip = (clip: AnimationClip, vrm: VRM): AnimationClip => {
  const humanoid = vrm.humanoid
  if (!humanoid) return clip
  const filtered: KeyframeTrack[] = []
  clip.tracks.forEach((track) => {
    const match = track.name.match(/^(.+)\.(position|quaternion|scale)$/)
    if (!match) return
    const base = match[1]
    const prop = match[2]
    const humanBone = resolveHumanBone(base) ?? base
    const node = humanoid.getNormalizedBoneNode(humanBone as never)
    if (!node) return
    track.name = `${node.name}.${prop}`
    filtered.push(track)
  })
  return new THREE.AnimationClip(clip.name || 'vrma', clip.duration, filtered)
}

export const motionJsonToClip = (motion: {
  jobId?: string
  durationSec?: number
  tracks?: Record<string, Array<{ t: number; x: number; y: number; z: number; w: number }>>
  rootPosition?: Array<{ t: number; x: number; y: number; z: number }>
}): AnimationClip => {
  const tracks: KeyframeTrack[] = []
  const toTimes = (frames: { t: number }[]) => Float32Array.from(frames.map((f) => f.t ?? 0))

  Object.entries(motion.tracks || {}).forEach(([bone, frames]) => {
    if (!Array.isArray(frames) || frames.length === 0) return
    const times = toTimes(frames)
    const values = new Float32Array(frames.length * 4)
    frames.forEach((frame, idx) => {
      const offset = idx * 4
      values[offset] = frame.x ?? 0
      values[offset + 1] = frame.y ?? 0
      values[offset + 2] = frame.z ?? 0
      values[offset + 3] = frame.w ?? 1
    })
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values))
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

  return new THREE.AnimationClip(`motion-${motion.jobId || Date.now()}`, motion.durationSec ?? -1, tracks)
}
