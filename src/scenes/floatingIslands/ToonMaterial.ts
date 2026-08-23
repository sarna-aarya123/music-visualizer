import * as THREE from 'three';
import { shaderMaterial } from '@react-three/drei';

/**
 * The cel-shading used across this world — the single thing that makes it
 * read as an ANIMATED GAME (Pokémon / Zelda / anime) rather than a
 * realistically-lit 3D scene.
 *
 * The rules that matter, all of which the previous smooth-shaded version
 * broke:
 *  - Light is quantised into a few HARD bands. Continuous falloff is what
 *    makes CG look "3D render"; a hard terminator is what makes it look
 *    drawn.
 *  - Shadows are COLOURED, not darkened. Real cel shading tints the shadow
 *    band toward a cool/complementary hue and keeps it bright. Simply
 *    multiplying toward black is what produced the muddy look.
 *  - Colours stay saturated and high-key. No washing the whole frame out
 *    with fog or ambient.
 *  - A bright rim along silhouette edges separates every object from what
 *    is behind it.
 *
 * Instanced-only (reads `instanceMatrix`, which three.js injects for
 * InstancedMesh) since every consumer here is an InstancedMesh.
 */
export const ToonSurfaceMaterial = shaderMaterial(
  {
    uColor: new THREE.Color('#6fbf7a'),
    uShadowTint: new THREE.Color('#4a3aa0'),
    uRimColor: new THREE.Color('#ffd9ea'),
    uRimStrength: 0.55,
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

      // Two hard bands with a WIDE value gap. The previous version used
      // 1.12 / 0.94 / 0.82 — only ~25% between brightest and darkest,
      // which reads as flat. Cel shading needs the lit and shadow sides to
      // be obviously different: bright and slightly blown on the lit side,
      // clearly darker AND strongly hue-shifted on the shadow side.
      vec3 litCol = uColor * 1.18;
      vec3 shadeCol = mix(uColor, uShadowTint, 0.62) * 0.55;
      float term = step(0.08, ndl);
      vec3 col = mix(shadeCol, litCol, term);

      // A narrow half-tone band right at the terminator keeps the hard
      // edge from looking like a cut-out.
      float halfTone = smoothstep(0.08, 0.30, ndl) * (1.0 - step(0.30, ndl));
      col = mix(col, mix(shadeCol, litCol, 0.55), halfTone * 0.8);

      // Rim light, deliberately restrained — at full strength it blew every
      // silhouette out to white and was a major cause of the washed look.
      vec3 viewDir = normalize(uCameraPos - vWorldPos);
      float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), uRimPower);
      col += uRimColor * smoothstep(0.55, 1.0, fres) * uRimStrength;

      col += uColor * uEmissive;

      // Fog kept deliberately distant so near geometry stays crisp and
      // saturated; only the far depth layers dissolve into the sky.
      float d = length(uCameraPos - vWorldPos);
      col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, d));

      gl_FragColor = vec4(col, 1.0);
    }
  `
);

/**
 * Inverted-hull outline: a second copy of the mesh pushed outward along
 * its normals and drawn back-faces-only, so only a rim of it escapes from
 * behind the real mesh. This ink line around every object is the single
 * most recognisable trait of animated/toon games — without it, even
 * correctly cel-shaded geometry still reads as generic 3D.
 *
 * The push is divided by each instance's own scale so a large island and a
 * small mushroom get the same apparent line weight in world units, rather
 * than the outline scaling up with the object.
 */
export const ToonOutlineMaterial = shaderMaterial(
  { uOutlineWidth: 0.12, uColor: new THREE.Color('#2a1338') },
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
