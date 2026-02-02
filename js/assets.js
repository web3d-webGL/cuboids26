import * as THREE from 'three';
import { LightProbeGenerator } from 'three/addons/lights/LightProbeGenerator.js';

export const texLoader = new THREE.TextureLoader();
export const envMaps = [];
export const textures = {
    grid: {
        map: texLoader.load('./tex/grid.webp', (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 8; if(window.setNeedsRender) window.setNeedsRender(); }),
        bumpScale: 0.15,
        roughnessScale: 2.5
    },
    wood: {
        map: texLoader.load('./tex/wood1.webp', (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 8; if(window.setNeedsRender) window.setNeedsRender(); }),
        bumpScale: 0.2,
        roughnessScale: 0.4
    },
    pat1: {
        map: texLoader.load('./tex/grid2.webp', (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 8; if(window.setNeedsRender) window.setNeedsRender(); }),
        bumpScale: 0.02,
        roughnessScale: 0.5
    },
    pat2: {
        map: texLoader.load('./tex/grid3.webp', (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 8; if(window.setNeedsRender) window.setNeedsRender(); }),
        bumpScale: 0.45,
        roughnessScale: 0.77
    },
    pat3: {
        map: texLoader.load('./tex/pat3.webp', (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 8; if(window.setNeedsRender) window.setNeedsRender(); }),
        bumpScale: 0.05,
        roughnessScale: 0.9
    },
    pat4: {
        map: texLoader.load('./tex/pat4.webp', (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 8; if(window.setNeedsRender) window.setNeedsRender(); }),
        bumpScale: 0.03,
        roughnessScale: 0.8
    },
    matcap: texLoader.load('./tex/matcap1.webp', (t) => { t.colorSpace = THREE.SRGBColorSpace; if(window.setNeedsRender) window.setNeedsRender(); })
};

// Recalculates lighting data from an environment map.
export async function updateEnvironment(tex, scene, renderer, lightProbe, envVisible) {
    if(!tex) return;
    scene.environment = tex;
    if(envVisible) scene.background = tex;
    const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(64);
    cubeRenderTarget.fromEquirectangularTexture(renderer, tex);
    const newProbe = await LightProbeGenerator.fromCubeRenderTarget(renderer, cubeRenderTarget);
    lightProbe.copy(newProbe);
    cubeRenderTarget.dispose();
    if(window.setNeedsRender) window.setNeedsRender();
}

export function initEnvMaps(updateCallback) {
    [1,2,3,4].forEach((i, idx) => {
        texLoader.load(`./tex/hemi${i}.webp`, (tex) => {
            tex.mapping = THREE.EquirectangularReflectionMapping;
            envMaps[idx] = tex;
            if (idx === 0) updateCallback(tex);
        });
    });
}
