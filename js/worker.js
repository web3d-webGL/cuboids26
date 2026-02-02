// Scans the raw byte array to find the global min/max bounds of all cuboids
function scanBounds(bytes) {
    let minX=2e9, minY=2e9, minZ=2e9, maxX=-2e9, maxY=-2e9, maxZ=-2e9;
    let val=0, sign=1, col=0;
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b === 45) { sign = -1; continue; }
        if (b >= 48 && b <= 57) { val = val * 10 + (b - 48); }
        else if (b === 44 || b === 59 || b === 10 || b === 13) {
            if (col === 1) minX = Math.min(minX, val * sign);
            else if (col === 2) minY = Math.min(minY, val * sign);
            else if (col === 3) minZ = Math.min(minZ, val * sign);
            else if (col === 4) maxX = Math.max(maxX, val * sign);
            else if (col === 5) maxY = Math.max(maxY, val * sign);
            else if (col === 6) maxZ = Math.max(maxZ, val * sign);
            if (b === 10 || b === 13) col = 0; else col++;
            val = 0; sign = 1;
        }
    }
    return { minX, minY, minZ, maxX, maxY, maxZ };
}

// Fast integer parsing and spatial voxel binning
function parseAndBin(bytes, params) {
    const { min, sz, nx, ny, nz } = params;
    const coords = new Int32Array(Math.floor(bytes.length / 8) * 6);
    const localGrid = Array.from({length: nx*ny*nz}, () => []);
    let val = 0, sign = 1, col = 0, row = 0, idx = 0;
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b === 45) { sign = -1; continue; }
        if (b >= 48 && b <= 57) { val = val * 10 + (b - 48); }
        else if (b === 44 || b === 59 || b === 10 || b === 13) {
            if (col > 0) coords[idx++] = val * sign;
            if (b === 10 || b === 13) {
                const r = row * 6;
                if (idx >= r + 6) {
                    // Assign cuboid to grid cells based on min/max coords
                    let gx = Math.floor((coords[r] - min.x) / sz.x), gy = Math.floor((coords[r+1] - min.y) / sz.y), gz = Math.floor((coords[r+2] - min.z) / sz.z);
                    let gx2 = Math.floor((coords[r+3] - min.x) / sz.x), gy2 = Math.floor((coords[r+4] - min.y) / sz.y), gz2 = Math.floor((coords[r+5] - min.z) / sz.z);
                    for(let x = Math.max(0, gx); x <= Math.min(nx-1, gx2); x++)
                        for(let y = Math.max(0, gy); y <= Math.min(ny-1, gy2); y++)
                            for(let z = Math.max(0, gz); z <= Math.min(nz-1, gz2); z++)
                                localGrid[x + nx*(y + ny*z)].push(row);
                    row++;
                }
                col = 0;
            } else col++;
            val = 0; sign = 1;
        }
    }
    return { coords: coords.slice(0, idx), localGrid, rowCount: row };
}

// Message handler for the Worker thread
self.onmessage = async e => {
    const { mode, chunk, wasmUrl, cuboidsInt, cells, gridParams } = e.data;
    if(mode === 'scan') {
        self.postMessage({ mode: 'scanned', res: scanBounds(new Uint8Array(chunk)) });
    } else if(mode === 'parseAndBin') {
        const res = parseAndBin(new Uint8Array(chunk), gridParams);
        self.postMessage({ mode: 'parsed', res }, [res.coords.buffer]);
    } else if(mode === 'group') {
        // WASM integration for high-performance adjacency checks
        const count = cuboidsInt.length / 6;
        const wasmMemory = new WebAssembly.Memory({ initial: Math.ceil((cuboidsInt.length*4 + 4000000)/65536)+20 });
        const { instance } = await WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), { env: { memory: wasmMemory } });
        const wasmProcessCell = instance.exports.process_cell || instance.exports._process_cell;
        const ptrs = { cuboidsPtr: 0, cellIndicesPtr: cuboidsInt.length*4, outPairsPtr: cuboidsInt.length*4 + 150000 };
        new Int32Array(wasmMemory.buffer, ptrs.cuboidsPtr, cuboidsInt.length).set(cuboidsInt);

        // Union-Find (Disjoint Set) logic for connectivity grouping
        const parent = new Int32Array(count).fill(-1);
        const find = i => parent[i] < 0 ? i : (parent[i] = find(parent[i]));
        const union = (a, b) => { a=find(a); b=find(b); if(a!==b){ if(parent[a]>parent[b]) [a,b]=[b,a]; parent[a]+=parent[b]; parent[b]=a; }};

        const cBuf = new Int32Array(wasmMemory.buffer, ptrs.cellIndicesPtr, 60000);
        const pBuf = new Int32Array(wasmMemory.buffer, ptrs.outPairsPtr, 120000);
        for(const cell of cells) {
            if(cell.length < 2) continue;
            cBuf.set(cell);
            const found = wasmProcessCell(ptrs.cuboidsPtr, ptrs.cellIndicesPtr, cell.length, ptrs.outPairsPtr, 60000);
            for(let p=0; p<found; p++) union(pBuf[p*2], pBuf[p*2+1]);
        }
        self.postMessage({ mode: 'grouped', data: parent.buffer }, [parent.buffer]);
    }
};
