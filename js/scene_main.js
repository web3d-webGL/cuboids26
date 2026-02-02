import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import Stats from 'three/addons/libs/stats.module.js';

import { processFile } from './processor.js';
import { textures, envMaps, updateEnvironment, initEnvMaps } from './assets.js';
import { createTriPlanarMat } from './materials.js';

// GLOBAL VARIABLES // State management for rendering, bounding boxes, and material modes
let loadedRoot = null, needsRender = true, showBBox = true, isMatcapMode = false;
let globalRotation = 0, envVisible = true;
const stepEl = document.getElementById('progressStep');

window.setNeedsRender = () => { needsRender = true; };

// SCENE INITIALIZATION
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0a);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 5000);
camera.position.set(-60,60,-60);

const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = 7;
renderer.toneMappingExposure = 0.8;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.addEventListener('change', () => { needsRender = true; });

const dirLight = new THREE.DirectionalLight(0xffffff, 0.3);
dirLight.position.set(50, 50, 50);
scene.add(dirLight);

let lightProbe = new THREE.LightProbe();
scene.add(lightProbe);

const axesHelper = new THREE.AxesHelper(10);
scene.add(axesHelper);

const stats = new Stats();
stats.dom.style.position = 'relative';
document.getElementById('stats-container').appendChild(stats.dom);

let activeEnvIdx = 0;
initEnvMaps((tex) => updateEnvironment(tex, scene, renderer, lightProbe, envVisible));

// Worker Factory: Creates a Web Worker from separate file
function createWorker() {
    return new Worker('./js/worker.js');
}

// BUILDSCENE
// Uses InstancedMesh for performance, drawing thousands of boxes in a single draw call.
function buildScene(cuboidsInt, groups, minX, minY, minZ, maxX, maxY, maxZ) {
    if (loadedRoot) scene.remove(loadedRoot);
    const root = new THREE.Object3D();
    const scale = 50 / (Math.max(maxX-minX, maxY-minY, maxZ-minZ) || 1);
    const cx=(minX+maxX)/2, cy=(minY+maxY)/2, cz=(minZ+maxZ)/2;
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const matrix = new THREE.Matrix4();
    const matLib = ['wood', 'pat1', 'pat2', 'pat3', 'pat4', 'grid'];

    groups.forEach(indices => {
        const texKey = matLib[Math.floor(Math.random()*matLib.length)];
        const pbrMat = createTriPlanarMat(texKey);

        // Initialize MatCap material
        pbrMat.userData.matcapMat = new THREE.MeshMatcapMaterial({
            matcap: textures.matcap,
            color: new THREE.Color().setHSL(Math.random(), 0.4, 0.7)
        });

        const im = new THREE.InstancedMesh(geom, pbrMat, indices.length);
        im.frustumCulled = false;
        for(let i=0; i<indices.length; i++){
            const o = indices[i]*6;
            const w=(cuboidsInt[o+3]-cuboidsInt[o]), h=(cuboidsInt[o+4]-cuboidsInt[o+1]), d=(cuboidsInt[o+5]-cuboidsInt[o+2]);
            matrix.makeScale(Math.max(0.01, w*scale), Math.max(0.01, h*scale), Math.max(0.01, d*scale));
            matrix.setPosition((cuboidsInt[o]+w/2-cx)*scale, (cuboidsInt[o+1]+h/2-cy)*scale, (cuboidsInt[o+2]+d/2-cz)*scale);
            im.setMatrixAt(i, matrix);
        }
        // Visual debug for groups
        if(showBBox){ const box=new THREE.Box3().setFromObject(im); const h=new THREE.Box3Helper(box, 0x00d4ff); h.isBox3Helper=true; root.add(h); }
        root.add(im);
    });
    scene.add(root);
    loadedRoot = root;
    updateTexUniforms();
    stepEl.innerHTML = "Done.";
    needsRender = true;
}

// UI EVENT LISTENERS
document.getElementById('file').onchange = e => { if(e.target.files[0]) processFile(e.target.files[0], stepEl, createWorker, buildScene); };

const updateTexUniforms = () => {
    if(!loadedRoot) return;
    const scale = parseFloat(document.getElementById('texScale').value);
    const axis = parseInt(document.getElementById('upAxis').value);
    document.getElementById('tsVal').innerText = scale;
    loadedRoot.traverse(o => {
        if(o.isInstancedMesh && o.material.userData.uTexScale) {
            o.material.userData.uTexScale.value = scale;
            o.material.userData.uUpAxis.value = axis;
            o.material.userData.uTexRotation.value = globalRotation;
        }
    });
    needsRender = true;
};

document.getElementById('rotateTex').onclick = () => {
    globalRotation = (globalRotation + Math.PI/2) % (Math.PI * 2);
    updateTexUniforms();
};

document.getElementById('toggleEnv').onchange = e => {
    envVisible = e.target.checked;
    scene.background = envVisible ? envMaps[activeEnvIdx] : new THREE.Color(0x0a0a0a);
    needsRender = true;
};

document.getElementById('texScale').oninput = updateTexUniforms;
document.getElementById('upAxis').onchange = updateTexUniforms;
document.getElementById('shuffleEnv').onclick = () => {
    activeEnvIdx = (activeEnvIdx + 1) % envMaps.length;
    updateEnvironment(envMaps[activeEnvIdx], scene, renderer, lightProbe, envVisible);
};

document.getElementById('toggleMatcap').onclick = () => {
    if(!loadedRoot) return;
    isMatcapMode = !isMatcapMode;

    loadedRoot.traverse(o => {
        if(o.isInstancedMesh) {
            if (!o.userData.originalMat) o.userData.originalMat = o.material;
            if (!o.userData.matcapMat) o.userData.matcapMat = new THREE.MeshMatcapMaterial({ matcap: textures.matcap });
            o.material = isMatcapMode ? o.userData.matcapMat : o.userData.originalMat;
            o.material.needsUpdate = true;
        }
    });
    needsRender = true;
};

document.getElementById('randomizeMaterials').onclick = () => {
    if(!loadedRoot || isMatcapMode) return;
    const keys = ['wood','grid','pat1','pat2','pat3','pat4'];
    loadedRoot.traverse(o => {
        if(o.isInstancedMesh && !isMatcapMode){
            const key = keys[Math.floor(Math.random()*keys.length)];
            const config = textures[key];
            o.material.userData.uDiffuseMap.value = config.map;
            o.material.userData.uBumpScale.value = config.bumpScale;
            o.material.userData.uRoughnessScale.value = config.roughnessScale;
            o.material.color.setHSL(Math.random(), 0.3, 0.8);
        }
    });
    needsRender = true;
};

document.getElementById('toggleAxes').onchange = e => { axesHelper.visible = e.target.checked; needsRender = true; };
document.getElementById('toggleBBox').onchange = e => { showBBox = e.target.checked; if(loadedRoot) loadedRoot.traverse(o => { if(o.isBox3Helper) o.visible = showBBox; }); needsRender = true; };
document.getElementById('resetCam').onclick = () => { controls.reset(); camera.position.set(-60,60,-60); needsRender = true; };

window.addEventListener('resize', () => { camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); needsRender = true; });

function animate() {
    requestAnimationFrame(animate);
    if (controls.update() || needsRender) {
        stats.begin();
        renderer.render(scene, camera);
        needsRender = false;
        stats.end();
    }
}
animate();

window.scene = scene;
window.renderer = renderer;
