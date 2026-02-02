# Cuboid 3D Viewer v4.70.5

High-performance WebGL viewer designed to sort face adjacent cuboids, discard loose ones, group and visualize hundreds of thousands of cuboids from CSV data in real-time.

---

## Key Features

- Multi-Threaded Processing
  Uses Web Workers to offload CSV parsing and spatial binning, keeping the UI responsive even with 800k+ objects.

- WASM Adjacency Grouping
  A custom WebAssembly module handles high-speed connectivity checks to group touching cuboids.

- Tri-Planar Shader Mapping
  Custom GLSL injection for seamless textures on cuboids without manual UV unwrapping.

- Adaptive Spatial Grid
  Automatically calculates optimal voxel density based on data distribution to minimize intersection tests.

- Instanced Rendering
  Leverages InstancedMesh to draw thousands of complex objects in a single GPU draw call.

## Technical Pipeline

The application processes data through a high-speed five-stage pipeline:

1. Scan
   Identifies global world boundaries across multiple threads. Chunks the CSV file across CPU threads to find the global min/max bounds.

2. Non-linear Adaptive Grid
   Calculates a dynamic 3D grid resolution to balance memory usage and processing speed.

3. Binning
   Distributes cuboids into spatial voxels using parallel Web Workers. Sorts cuboid IDs into a 3D grid to limit the "Adjacency Search" space.
    Web Workers + Heuristic Logic

4. Grouping (WASM)
   Performs massive-scale adjacency checks using a Union-Find algorithm optimized in C++/WASM.

5. Scene Build
   Generates an instanced 3D scene with PBR materials and environmental lighting.

---
## Controls & Visuals

### Material Modes

- PBR Mode
  Full Physically Based Rendering with tri-planar mapping, roughness adjustment, and procedural bump mapping.

- MatCap Mode
  A high-performance "shading-only" mode that uses spherical environment textures for rapid visual debugging.

### Navigation & UI

- Texture Controls
  Real-time scaling, rotation, and axis-alignment for projected textures.

- Environment
  Shuffle between multiple HDR/Equirectangular environments for varied lighting.

- Group Visualization
  Toggleable bounding boxes to highlight automatically discovered cuboid clusters.
---

## Data Format Requirements

The viewer accepts .csv files using the following column structure (supports comma or semicolon delimiters):

| Column | Data Type | Description |
|-------:|-----------|-------------|
| 1      | int       | ID (Ignored) |
| 2–4    | int       | Min X, Min Y, Min Z |
| 5–7    | int       | Max X, Max Y, Max Z |

### Eg.
0;0;0;0;5;5;5

1;5;3;1;8;4;4

2;3;2;2;7;3;3

3;3;1;1;6;2;2

4;6;0;0;8;1;1

5;0;0;0;2;2;2

---

## Setup & Requirements

1. Assets: Ensure the following directory structure:

    index.html - For development convenience all viewer code is contained in a single file

        /tex/ - WebP textures (grid, wood, patterns, matcaps, and hemi-maps)

        /wasm/ - The v4_27_adj.wasm binary

        /data_samples/ - Set of 10 uniform, non-uniform and extremely elongated cuboid data for testing purpose

2. Local Server: Due to WASM and Web Worker security policies, this file must be served via a local or remote web server (e.g., npx serve, python HTTP, WAMP).

---

## Feature Set (v4.70.4)
    • Zero-Lag Processing: Threaded WASM grouping off-loads the main thread.
    • Diagnostic Modes: UV checker and MatCap modes for internal structural inspection.
    • Materials: Physical materials (PBR) with adjustable bump and roughness scales.
    • Environmental Fidelity: Image-Based Lighting (IBL) using Hemi-equirectangular maps for realistic shading.
    • Architectural Accuracy: Automatic "Up-Axis" correction and real-time texture rotation (90°).


## Justification: WebGL 2
WebGL 2 (via Three.js) was selected for this task over WebGPU for the following reasons:
    1. Compatibility: WebGL 2 has broader support across stable browser versions (including mobile) as of 2024.
    2. InstancedMesh Support: WebGL 2 provides native support for gl.drawElementsInstanced, which is the backbone of this app's performance.
    3. Shader Maturity: The onBeforeCompile workflow in Three.js allows for rapid prototyping of complex PBR-integrated shaders that would require significantly more boilerplate in WebGPU.

## The Macro Traps: Why GPU/WebGPU Was Avoided
    1. OSX WebGL Instability: Safari and OSX drivers have long-documented issues with high-memory buffers in WebGL, often leading to "Context Lost" errors when processing 500k+ elements.
    2. WebGPU Readiness: While powerful, WebGPU lacks universal support (especially on mobile and older corporate hardware).
    3. The Mobile Gap: Many mobile browsers lack the specific WebGL extensions needed for high-performance bitwise operations or large data textures.
    4. Floating Point Precision: GPUs struggle with exact integer adjacency. At large scales, $3000.0 + 1.0$ can lose precision, leading to "ghost connections" or missing groups.

---

# Architecture Evolution and Design Decisions

The evolution of this code demonstrates a shift from chasing raw GPU power (which is brittle across platforms) to mastering CPU memory architecture and algorithmic efficiency, which is universal. This project evolved from a naïve JavaScript implementation into a high-performance, browser-resident engine capable of processing 1M+ axis-aligned cuboids reliably.

## Early Versions (v1.2 – v2.2)

- Moved parsing and logic into Web Workers to keep the UI responsive.
- Created individual JS objects (Meshes, Geometries), causing memory spikes and GC stalls.
- Brute-force adjacency detection led to O(n²) behavior and browser hangs.

## Algorithmic Pruning (v4.1 – v4.3)

- Introduced per axis plane sweep-line sorting to reduce adjacency checks.
- Map/Set adjacency graphs caused millions of small allocations and heap fragmentation.
- Pathological elongated cuboids could still revert complexity to O(n²).

## Memory-Oriented Programming (v4.6)

- Replaced Map/Set with TypedArray-backed DSU (Union-Find).
- Combined with sorted sweep-line to reduce adjacency search to near-linear.
- **BVH discarded**: slow build, ineffective pruning for long cuboids.
- **Voxelization discarded**: memory explosion and poor cache locality.
- DSU + sweep proved optimal for “needle-like” cuboids, outperforming both alternatives.

## Spatial Decomposition & Parallelism (v4.17 – v4.21.1)

- Introduced 3D spatial grid to limit adjacency checks to local cells.
- Multi-worker DSU merges with flat memory reduced computation time and stabilized memory usage.

## Extreme Memory & Compute Optimizations (v4.18 – v4.28.1)

- Zero-copy transferables replaced expensive structured cloning.
- CSV parsing switched to byte-level Uint8Array processing.
- Adjacency checks moved to WASM, operating directly on shared buffers.
- Grid resolution increased (e.g., 12×12×12) to reduce local adjacency computations.

## Two-Pass Processing & Robustness (v4.29.1)

- **Pass 1**: parallel min/max scan with boundary-safe chunk handling.
- **Pass 2**: parse and bin cuboids in one step.
- Fencepost buffers and clamping ensured safe indexing and correctness on messy CSV data.

## Adaptive Heuristics & Production Stability (v4.30 – v4.31.10)

- Refined grid scaling using log/square-root estimates to prevent memory blowup.
- Multi-instanced rendering with direct Matrix4 writes replaced high-level Three.js overhead.
- Visual variation offloaded to GPU shaders for zero CPU cost.

## High-Fidelity Final (v4.70.5)

- Shifted from "Engineering Tool" to **Production-Grade Visualizer**.
- **Tri-Planar Projection Shader**: Consistent world-space textures across small and long cuboids.
- **PBR & IBL Lighting**: Physically Based Rendering with Light Probes and Environment Maps for realistic materials.
- **MatCap & Shuffle Modes**: Toggle high-contrast silhouette or cinematic PBR view.
- **Tone Mapping**: ACES Filmic tone mapping for balanced exposure and cinematic rendering.

## Final Outcome

- From object-heavy JS to memory-deterministic, parallel, data-oriented engine.
- Efficient for millions of cuboids with exact adjacency detection.
- DSU + sorted sweep + TypedArrays + spatial grid + WASM ensures scalable, robust, predictable performance in a browser.

---

# Discoveries, Insights & Future Prospects

Working with cuboids turned out to be unexpectedly rich and stimulating. What started as “boring 90s math 3D” evolved into a platform for exploring novel rendering techniques, real-time global illumination, and web-based holographic proxies.

Compared to fuzzy clouds of Gaussian splats, cuboids provide a **more potent foundation**: they combine the ground-truth of 3D geometry with radiance fields, enabling new mesh-less, texture-less real-time rendering pipelines.

This approach opens the door to pairing live, browser-based visualization with the **most advanced unbiased 3D renderers**, creating a seamless path from simplified proxies to full-fidelity, cinematic-quality output.


## The "Meta-Geometry" Discoveries

### 1. Cuboid-Shell Baking (The "Proxy" Concept)
- **Concept:** Ultra-complex geometries can be shrink-wrapped into clusters of cuboids.
- **Benefit:** Retain physical bounding boxes for grouping and physics while the shader handles visual complexity.
- **Impact:** Moves rendering from geometry-heavy to texture-heavy workflows, allowing massive scenes to remain performant.

### 2. Voxels with Harmonics
- **Concept:** Treat cuboids as anisotropic voxels storing light data in Spherical Harmonics.
- **Discovery:** Encodes multi-angle illumination per cuboid group, achieving real-time global illumination effects without ray tracing.

### 3. Log-Compressed Normals on Hard Edges
- **Concept:** Apply logarithmic compression to normal data at cuboid edges.
- **Discovery:** Maintains hard-edge visual fidelity while allowing smooth lighting, faking high-poly chamfers without extra triangles.

## Advanced Synthetic & Optical Concepts

### 4. Synthetic Aperture & Depth Synthesis
- **Concept:** Jitter camera positions over multiple sub-frames and average results.
- **Discovery:** Produces true depth-of-field and motion blur with cuboid atoms, giving physically plausible optical effects in real time.

### 5. Baked Speculars, Reflections, and Refractions
- **Speculars:** Bake shininess into LUTs based on cuboid orientation.
- **Refractions:** Use WASM knowledge of group depth to create thickness maps, simulating light bending through cuboid clusters.


## Theoretical "V5" Pipeline



| Innovation        | Implementation           | Result |
|------------------|-------------------------|--------|
| Baking Shells     | Complex mesh → Cuboid proxies | Infinite detail at 60 FPS |
| Log Normals       | Edge-aware normal encoding     | Perfect silhouettes on low-poly |
| Synthetic Aperture| Temporal multi-sampling        | Cinematic realism in browser |
| Harmonic Voxels   | Light-probes per group          | Pre-baked RayTraced web 3d  |


## Philosophical Summary

The "Cuboid Viewer" journey demonstrates that **simplicity can unlock sophistication**. By leveraging the simplest 3D primitive, the box, it is possible to represent complex structures with high fidelity and extreme performance in a browser.
