import * as THREE from 'three';
import { textures } from './assets.js';

// Creates a material with custom Tri-Planar Shader injection.
// Tri-planar mapping avoids UV stretching by projecting textures from 3 axes based on world position.
export function createTriPlanarMat(texKey) {
    const config = textures[texKey] || textures.grid;
    const mat = new THREE.MeshStandardMaterial({
        roughness: 1.0,
        metalness: 0.0,
        bumpScale: 1.0
    });

    // Shader Uniforms: Control texture behavior in real-time
    mat.userData.uTexScale = { value: 0.05 };
    mat.userData.uUpAxis = { value: 1 };
    mat.userData.uTexRotation = { value: 0.0 };
    mat.userData.uDiffuseMap = { value: config.map };
    mat.userData.uBumpScale = { value: config.bumpScale ?? 0.05 };
    mat.userData.uRoughnessScale = { value: config.roughnessScale ?? 1.0 };

    mat.onBeforeCompile = (shader) => {
        // Link JavaScript uniform values to GLSL uniforms
        shader.uniforms.uTexScale = mat.userData.uTexScale;
        shader.uniforms.uUpAxis = mat.userData.uUpAxis;
        shader.uniforms.uTexRotation = mat.userData.uTexRotation;
        shader.uniforms.uDiffuseMap = mat.userData.uDiffuseMap;
        shader.uniforms.uBumpScale = mat.userData.uBumpScale;
        shader.uniforms.uRoughnessScale = mat.userData.uRoughnessScale;

        // Force shader to include logic for secondary maps
        shader.fragmentShader = '#define USE_ROUGHNESSMAP\n#define USE_BUMPMAP\n' + shader.fragmentShader;

        // Vertex Shader Injection: Pass world position and normal to fragment shader
        shader.vertexShader = shader.vertexShader.replace(`#include <common>`,
            `#include <common>
             varying vec3 vWorldPos;
             varying vec3 vWorldNormal;
             varying vec2 vBumpMapUv;
             varying vec2 vRoughnessMapUv;`);

        shader.vertexShader = shader.vertexShader.replace(`#include <fog_vertex>`,
            `#include <fog_vertex>
             vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
             vWorldPos = worldPos.xyz;
             vWorldNormal = normalize( mat3( modelMatrix * instanceMatrix ) * normal );
             vBumpMapUv = vec2(0.0);
             vRoughnessMapUv = vec2(0.0);`);

        // Fragment Shader Injection: Tri-Planar Sampling Logic
        shader.fragmentShader = shader.fragmentShader.replace(`#include <common>`,
            `#include <common>
             varying vec3 vWorldPos;
             varying vec3 vWorldNormal;
             uniform sampler2D uDiffuseMap;
             uniform float uTexScale;
             uniform float uTexRotation;
             uniform float uBumpScale;
             uniform float uRoughnessScale;
             uniform int uUpAxis;

// Rotation helper for the UV coordinates
             vec2 rotateUV(vec2 uv, float rotation) {
                float s = sin(rotation);
                float c = cos(rotation);
                return vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
             }

// Core tri-planar sampling function
             vec3 triSample(sampler2D tex, vec3 p, vec3 n, float s, int ax, float rot) {
                vec3 blending = abs(n);
                blending /= (blending.x + blending.y + blending.z + 0.0001);
                vec2 uvX, uvY, uvZ;
                if(ax == 0) { uvX = p.yz; uvY = p.zx; uvZ = p.xy; }
                else if(ax == 1) { uvX = p.zy; uvY = p.xz; uvZ = p.xy; }
                else { uvX = p.xy; uvY = p.yz; uvZ = p.zx; }
                vec3 cx = texture2D(tex, rotateUV(uvX, rot) * s).rgb;
                vec3 cy = texture2D(tex, rotateUV(uvY, rot) * s).rgb;
                vec3 cz = texture2D(tex, rotateUV(uvZ, rot) * s).rgb;
                return cx * blending.x + cy * blending.y + cz * blending.z;
             }

             float getTriHeight(vec3 p, vec3 n) {
                return triSample(uDiffuseMap, p, n, uTexScale, uUpAxis, uTexRotation).r;
             }`);

        shader.fragmentShader = shader.fragmentShader.replace(`void main() {`,
            `void main() {
             vec3 triOut = triSample(uDiffuseMap, vWorldPos, vWorldNormal, uTexScale, uUpAxis, uTexRotation);`);

        shader.fragmentShader = shader.fragmentShader.replace(`#include <map_fragment>`,
            `diffuseColor.rgb *= triOut;`);

// Derive roughness from the green channel of the tri-sampled texture
// manual roughness adjustment for used assets
        shader.fragmentShader = shader.fragmentShader.replace(`#include <roughnessmap_fragment>`,
            `#include <roughnessmap_fragment>
             roughnessFactor = 0.15 + (triOut.g * uRoughnessScale);`);

// Compute procedural bump mapping using derivative functions (dFdx, dFdy)
        shader.fragmentShader = shader.fragmentShader.replace(`#include <normal_fragment_maps>`,
            `#include <normal_fragment_maps>
             #ifdef USE_BUMPMAP
                float h0 = getTriHeight(vWorldPos, vWorldNormal);
                float hx = dFdx(h0) * uBumpScale;
                float hy = dFdy(h0) * uBumpScale;
                normal = perturbNormalArb(-vViewPosition, normal, vec2(hx, hy), faceDirection);
             #endif`);
    };
    return mat;
}
