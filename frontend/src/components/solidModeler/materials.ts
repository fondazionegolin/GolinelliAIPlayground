// Surface presets for the 3D Lab: PBR parameters plus procedural patterns (wood, marble) computed in the shader,
// because the solids have no UV coordinates. Used by the shaded viewport and by the offline render.
import * as THREE from 'three'
import { tl } from '@/i18n/tl'

export type MaterialPattern = 'wood' | 'darkwood' | 'marble'

export interface MaterialPreset {
  id: string
  label: string
  /** CSS for the swatch in the picker. */
  swatch: string
  /** Fixed base colour; without it the object's own colour is used. */
  color?: string
  roughness: number
  metalness: number
  clearcoat?: number
  opacity?: number
  transmission?: number
  pattern?: MaterialPattern
}

export const MATERIALS: MaterialPreset[] = [
  { id: 'plastic', label: tl("Plastica"), swatch: 'radial-gradient(circle at 30% 30%, #fff, #cbd5e1 60%, #94a3b8)', roughness: 0.55, metalness: 0.02 },
  { id: 'matte', label: tl("Opaco"), swatch: 'radial-gradient(circle at 35% 35%, #e5e7eb, #9ca3af)', roughness: 0.95, metalness: 0 },
  { id: 'glossy', label: tl("Lucido"), swatch: 'radial-gradient(circle at 30% 25%, #fff 0 12%, #93c5fd 40%, #2563eb)', roughness: 0.12, metalness: 0.05, clearcoat: 1 },
  { id: 'ceramic', label: tl("Ceramica"), swatch: 'radial-gradient(circle at 30% 25%, #fff 0 15%, #f1f5f9 45%, #cbd5e1)', roughness: 0.2, metalness: 0, clearcoat: 0.8 },
  { id: 'rubber', label: tl("Gomma"), swatch: 'radial-gradient(circle at 35% 35%, #52525b, #18181b)', roughness: 1, metalness: 0 },
  { id: 'wood', label: tl("Legno"), swatch: 'repeating-linear-gradient(100deg, #d9a35f 0 5px, #b9783a 5px 8px, #cf9650 8px 14px)', roughness: 0.6, metalness: 0, pattern: 'wood' },
  { id: 'darkwood', label: tl("Noce"), swatch: 'repeating-linear-gradient(100deg, #7a4a2b 0 5px, #4e2c16 5px 8px, #6b3f22 8px 14px)', roughness: 0.55, metalness: 0, pattern: 'darkwood' },
  { id: 'marble', label: tl("Marmo"), swatch: 'linear-gradient(115deg, #f8fafc 0 35%, #cbd5e1 38%, #f1f5f9 42% 70%, #94a3b8 72%, #f8fafc 75%)', roughness: 0.25, metalness: 0, clearcoat: 0.5, pattern: 'marble' },
  { id: 'steel', label: tl("Acciaio"), swatch: 'linear-gradient(135deg, #f1f5f9, #94a3b8 45%, #e2e8f0 60%, #64748b)', color: '#c9ced6', roughness: 0.28, metalness: 1 },
  { id: 'aluminium', label: tl("Alluminio"), swatch: 'linear-gradient(135deg, #fff, #cbd5e1 50%, #f1f5f9)', color: '#e3e6ea', roughness: 0.4, metalness: 1 },
  { id: 'gold', label: tl("Oro"), swatch: 'linear-gradient(135deg, #fde68a, #d4a017 45%, #fff3b0 60%, #a16207)', color: '#e8b54a', roughness: 0.22, metalness: 1 },
  { id: 'copper', label: tl("Rame"), swatch: 'linear-gradient(135deg, #fdba74, #c2410c 50%, #fed7aa 62%, #9a3412)', color: '#d0795a', roughness: 0.3, metalness: 1 },
  { id: 'glass', label: tl("Vetro"), swatch: 'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(186,230,253,0.5) 50%, rgba(255,255,255,0.8))', roughness: 0.04, metalness: 0, opacity: 0.28, transmission: 0 },
]

export const materialById = (id: string | undefined): MaterialPreset => MATERIALS.find(m => m.id === id) ?? MATERIALS[0]

const NOISE = /* glsl */ `
float mh(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float mn(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mh(i), mh(i + vec3(1,0,0)), f.x), mix(mh(i + vec3(0,1,0)), mh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(mh(i + vec3(0,0,1)), mh(i + vec3(1,0,1)), f.x), mix(mh(i + vec3(0,1,1)), mh(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float mfbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * mn(p); p *= 2.03; a *= 0.5; } return s; }
vec3 woodPattern(vec3 p, vec3 light, vec3 dark){
  p *= 0.11;
  vec2 q = p.yz + vec2(mfbm(p * vec3(0.4, 1.3, 1.3)), mfbm(p * vec3(0.4, 1.3, 1.3) + 9.1)) * 0.9;
  float rings = fract(length(q) * 2.2 + mfbm(p * vec3(0.2, 2.0, 2.0)) * 1.4);
  float t = smoothstep(0.0, 0.55, rings) * (1.0 - smoothstep(0.55, 1.0, rings));
  float fibre = mn(p * vec3(0.4, 42.0, 42.0));
  vec3 c = mix(dark, light, t);
  return c * (0.9 + 0.2 * fibre);
}
vec3 marblePattern(vec3 p, vec3 base){
  p *= 0.045;
  float v = abs(sin(p.x * 5.0 + p.y * 2.0 + mfbm(p * 3.0) * 9.0));
  float vein = 1.0 - smoothstep(0.0, 0.22, v);
  float cloud = mfbm(p * 6.0);
  vec3 c = mix(base, vec3(0.45, 0.48, 0.55), vein * 0.75);
  return c * (0.93 + 0.12 * cloud);
}
`

/** Configure `mat` for `preset` (the object's colour tints plain presets). `patternKey` forces a shader rebuild when it changes. */
export function applyMaterialPreset(mat: THREE.MeshPhysicalMaterial, preset: MaterialPreset, objectColor: string) {
  const pattern = preset.pattern ?? ''
  mat.color.set(preset.color ?? (preset.pattern ? '#ffffff' : objectColor))
  mat.roughness = preset.roughness
  mat.metalness = preset.metalness
  mat.clearcoat = preset.clearcoat ?? 0
  mat.clearcoatRoughness = 0.08
  const glass = preset.opacity != null
  mat.transparent = glass
  mat.opacity = preset.opacity ?? 1
  mat.depthWrite = !glass
  mat.side = glass ? THREE.DoubleSide : THREE.FrontSide
  mat.envMapIntensity = preset.metalness > 0.5 || glass ? 1.4 : 1
  if (mat.userData.pattern !== pattern) {
    mat.userData.pattern = pattern
    mat.userData.tint = objectColor
    mat.customProgramCacheKey = () => `pat:${pattern}`
    mat.onBeforeCompile = shader => {
      if (!pattern) return
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vObjP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position * vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));')
      const colors = pattern === 'darkwood' ? 'vec3(0.33, 0.18, 0.09), vec3(0.17, 0.08, 0.04)' : 'vec3(0.78, 0.55, 0.28), vec3(0.50, 0.30, 0.13)'
      const apply = pattern === 'marble' ? 'diffuseColor.rgb *= marblePattern(vObjP, vec3(0.92, 0.93, 0.95));' : `diffuseColor.rgb *= woodPattern(vObjP, ${colors});`
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vObjP;\n${NOISE}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${apply}`)
    }
    mat.needsUpdate = true
  }
}
