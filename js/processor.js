// Main File Processor: Coordinates the multi-step pipeline
//  1. Scan -> 2. Adaptive Grid Math -> 3. Bin -> 4. WASM Grouping -> 5. Scene Build
export async function processFile(file, stepEl, createWorker, buildScene) {
    const totalStart = performance.now();
    stepEl.innerHTML = "Processing..."; // Now it can find stepEl

    const THREADS = Math.min(navigator.hardwareConcurrency || 4, 16);
    const wasmUrl = new URL('wasm/v4_27_adj.wasm', window.location.href).href;

    const fullBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(fullBuffer);

    // 1. SCAN PHASE // Finds the min/max world bounds across all threads
    const scanParseStart = performance.now();
    const scanPromises = Array.from({length: THREADS}, (_, i) => {
        let start = i * Math.floor(bytes.length/THREADS);
        let end = (i === THREADS-1) ? bytes.length : (i+1) * Math.floor(bytes.length/THREADS);
        // Align chunk start/end to line breaks
        if(i > 0) { while(start < bytes.length && bytes[start-1] !== 10) start++; }
        if(i < THREADS-1) { while(end < bytes.length && bytes[end-1] !== 10) end++; }
        const chunk = fullBuffer.slice(start, end);
        const w = createWorker();
        return new Promise(res => {
            w.onmessage = e => { res(e.data.res); w.terminate(); };
            w.postMessage({ mode: 'scan', chunk }, [chunk]);
        });
    });

    const scanRes = await Promise.all(scanPromises);
    let minX=2e9, minY=2e9, minZ=2e9, maxX=-2e9, maxY=-2e9, maxZ=-2e9;
    scanRes.forEach(r => {
        minX=Math.min(minX, r.minX); minY=Math.min(minY, r.minY); minZ=Math.min(minZ, r.minZ);
        maxX=Math.max(maxX, r.maxX); maxY=Math.max(maxY, r.maxY); maxZ=Math.max(maxZ, r.maxZ);
    });

    // 2. ADAPTIVE GRID CALCULATION // Logic to determine grid resolution based on cuboid density and total volume span
    const spanX = maxX - minX, spanY = maxY - minY, spanZ = maxZ - minZ;
    const maxS = Math.max(spanX, spanY, spanZ);
    const estCount = bytes.length / 50;

    let baseDim = Math.max(2, Math.floor(Math.pow(estCount / 10000, 0.5) * 10));
    baseDim = Math.min(baseDim, 65); // Safety cap

    const nx = Math.max(4, Math.round((spanX / maxS) * baseDim));
    const ny = Math.max(4, Math.round((spanY / maxS) * baseDim));
    const nz = Math.max(4, Math.round((spanZ / maxS) * baseDim));

    console.log(`🚀 Adaptive Grid: ${nx}x${ny}x${nz} | Target Dim: ${baseDim}`);

    const gridParams = {
        min: { x: minX - 1, y: minY - 1, z: minZ - 1 },
        sz:  { x: (spanX + 2) / nx, y: (spanY + 2) / ny, z: (spanZ + 2) / nz },
        nx, ny, nz
    };

    // 3. BINNING PHASE // Distribute cuboids into the grid cells
    const binPromises = Array.from({length: THREADS}, (_, i) => {
        let start = i * Math.floor(bytes.length/THREADS);
        let end = (i === THREADS-1) ? bytes.length : (i+1) * Math.floor(bytes.length/THREADS);
        if(i > 0) { while(start < bytes.length && bytes[start-1] !== 10) start++; }
        if(i < THREADS-1) { while(end < bytes.length && bytes[end-1] !== 10) end++; }
        const chunk = fullBuffer.slice(start, end);
        const w = createWorker();
        return new Promise(res => {
            w.onmessage = e => { res(e.data.res); w.terminate(); };
            w.postMessage({ mode: 'parseAndBin', chunk, gridParams }, [chunk]);
        });
    });

    const workerData = await Promise.all(binPromises);
    console.log(`Scan/Parse: ${Math.round(performance.now() - scanParseStart)}ms`);

    // 4. GROUPING PHASE // Combine local results and perform adjacency grouping via WASM
    const groupStart = performance.now();
    const totalCount = workerData.reduce((acc, r) => acc + r.rowCount, 0);
    document.getElementById('stat-count').innerText = totalCount.toLocaleString();

    const cuboidsInt = new Int32Array(totalCount * 6);
    const globalGrid = Array.from({ length: nx * ny * nz }, () => []);

    let rowOffset = 0;
    for (const res of workerData) {
        cuboidsInt.set(res.coords, rowOffset * 6);
        res.localGrid.forEach((cell, i) => {
            for (let j = 0; j < cell.length; j++) {
                globalGrid[i].push(cell[j] + rowOffset);
            }
        });
        rowOffset += res.rowCount;
    }

    const groupWorkerPromises = Array.from({length: THREADS}, (_, i) => new Promise(res => {
        const w = createWorker();
        const slice = globalGrid.slice(Math.floor(i * (globalGrid.length / THREADS)), Math.floor((i + 1) * (globalGrid.length / THREADS)));
        w.onmessage = e => { res(new Int32Array(e.data.data)); w.terminate(); };
        w.postMessage({ mode: 'group', wasmUrl, cuboidsInt, cells: slice });
    }));

    const groupResults = await Promise.all(groupWorkerPromises);

    const parent = new Int32Array(totalCount).fill(-1);
    const find = i => parent[i] < 0 ? i : (parent[i] = find(parent[i]));
    groupResults.forEach(res => {
        for (let i = 0; i < res.length; i++) {
            if (res[i] >= 0) {
                let a = find(i), b = find(res[i]);
                if (a !== b) {
                    if (parent[a] > parent[b]) [a, b] = [b, a];
                    parent[a] += parent[b]; parent[b] = a;
                }
            }
        }
    });

    const groupsMap = new Map();
    for (let i = 0; i < totalCount; i++) {
        const r = find(i);
        if (!groupsMap.has(r)) groupsMap.set(r, []);
        groupsMap.get(r).push(i);
    }
    console.log(`Grouping: ${Math.round(performance.now() - groupStart)}ms`);

    // 5. SCENE BUILD PHASE
    const filtered = [...groupsMap.values()].filter(g => g.length >= 2);
    document.getElementById('stat-groups').innerText = filtered.length.toLocaleString();

    buildScene(cuboidsInt, filtered, minX, minY, minZ, maxX, maxY, maxZ);

    const finalElapsed = Math.round(performance.now() - totalStart);
    console.log(`Total processing: ${finalElapsed}ms`);
    document.getElementById('stat-time').innerText = `${finalElapsed}ms`;
}
