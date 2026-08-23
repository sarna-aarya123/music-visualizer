import * as THREE from 'three';
import { shaderMaterial } from '@react-three/drei';

/**
 * The shared cel-shading kit, promoted out of the Floating Islands world
 * once that world's look was signed off. Every environment uses these so
 * the whole project reads as one animated game rather than nine separately
 * lit scenes.
 *
 * The rules that produce the animated look (learned the hard way — smooth
 * shading, weak band contrast and a strong rim all read as muddy 3D):
 *  - light quantised into HARD bands with a wide value gap
 *  - shadows hue-shifted, never just darkened
 *  - saturated, high-key base colours
 *  - a restrained rim light, only in a narrow band at the edge
 *  - a dark inverted-hull outline around everything
 */
export const ToonSurfaceMaterial = shaderMaterial(
  {
    uColor: new THREE.Color('#6fbf7a'),
    uShadowTint: new THREE.Color('#4a3aa0'),
    uRimColor: new THREE.Color('#ffd9ea'),
    uRimStrength: 0.5,
    uRimPower: 2.6,
    uEmissive: 0,
    uLightDir: new THREE.Vector3(40, 30, -70).normalize(),
    uCameraPos: new THREE.Vector3(),
    uFogColor: new THREE.Color('#c489b5'),
    uFogNear: 90,
    uFogFar: 340,
  },
  /* glsl */ `
    varying vec3 vNormalW;
    varying vec3 vWorldPos;
    void main() {
      vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  /* glsl */ `
    uniform vec3 uColor, uShadowTint, uRimColor, uCameraPos, uFogColor, uLightDir;
    uniform float uRimStrength, uRimPower, uEmissive, uFogNear, uFogFar;
    varying vec3 vNormalW;
    varying vec3 vWorldPos;
    void main() {
      vec3 n = normalize(vNormalW);
      float ndl = dot(n, normalize(uLightDir));

      vec3 litCol = uColor * 1.18;
      vec3 shadeCol = mix(uColor, uShadowTint, 0.62) * 0.55;
      vec3 col = mix(shadeCol, litCol, step(0.08, ndl));

      float halfTone = smoothstep(0.08, 0.30, ndl) * (1.0 - step(0.30, ndl));
      col = mix(col, mix(shadeCol, litCol, 0.55), halfTone * 0.8);

      vec3 viewDir = normalize(uCameraPos - vWorldPos);
      float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), uRimPower);
      col += uRimColor * smoothstep(0.55, 1.0, fres) * uRimStrength;

      col += uColor * uEmissive;

      float d = length(uCameraPos - vWorldPos);
      col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, d));
      gl_FragColor = vec4(col, 1.0);
    }
  `
);

/** Inverted-hull ink line. Divided by instance scale so a huge landmark
 *  and a small prop get the same apparent line weight. */
export const ToonOutlineMaterial = shaderMaterial(
  { uOutlineWidth: 0.14, uColor: new THREE.Color('#2a1338') },
  /* glsl */ `
    uniform float uOutlineWidth;
    void main() {
      vec3 instScale = vec3(
        length(instanceMatrix[0].xyz),
        length(instanceMatrix[1].xyz),
        length(instanceMatrix[2].xyz)
      );
      vec3 push = normal * (uOutlineWidth / max(instScale, vec3(0.001)));
      vec4 wp = modelMatrix * instanceMatrix * vec4(position + push, 1.0);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  /* glsl */ `
    uniform vec3 uColor;
    void main() { gl_FragColor = vec4(uColor, 1.0); }
  `
);

export interface ToonSpec {
  color: string;
  shadow: string;
  rim: string;
  rimStrength?: number;
  emissive?: number;
}

/** Builds a cel material from a spec and remembers its baseline rim so
 *  per-frame event boosts scale from it rather than compounding. */
export function makeToon(spec: ToonSpec, fog: { color: string; near: number; far: number }) {
  const m = new ToonSurfaceMaterial();
  (m.uniforms.uColor.value as THREE.Color).set(spec.color);
  (m.uniforms.uShadowTint.value as THREE.Color).set(spec.shadow);
  (m.uniforms.uRimColor.value as THREE.Color).set(spec.rim);
  (m.uniforms.uFogColor.value as THREE.Color).set(fog.color);
  m.uniforms.uFogNear.value = fog.near;
  m.uniforms.uFogFar.value = fog.far;
  const rim = spec.rimStrength ?? 0.5;
  m.uniforms.uRimStrength.value = rim;
  m.uniforms.uEmissive.value = spec.emissive ?? 0;
  m.userData.baseRim = rim;
  m.userData.baseEmissive = spec.emissive ?? 0;
  return m;
}

export function makeOutline(width = 0.14, color = '#241030') {
  const m = new ToonOutlineMaterial();
  m.side = THREE.BackSide;
  m.uniforms.uOutlineWidth.value = width;
  (m.uniforms.uColor.value as THREE.Color).set(color);
  return m;
}
