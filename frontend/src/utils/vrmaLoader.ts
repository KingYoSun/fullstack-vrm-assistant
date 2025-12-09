import * as THREE from 'three'
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
  aliases.map((alias) => [alias.toLowerCase(), key] as const),
)

const remapTrackNames = (clip: THREE.AnimationClip) => {
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

export async function loadVrmaClip(url: string, _vrm: VRM): Promise<THREE.AnimationClip> {
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
