#include <emscripten.h>
#include <stdint.h>

/**
 * MATH & LOGIC: check_adj
 * -----------------------
 * Determines if two Axis-Aligned Bounding Boxes (AABBs) are "face-adjacent."
 * * Each cuboid is represented as: [xMin, yMin, zMin, xMax, yMax, zMax]
 * Indices:                         0     1     2     3     4     5
 * * Sequence:
 * 1. It checks if the Max of one cuboid exactly meets the Min of the other on one axis.
 * 2. It then checks if the projections on the OTHER two axes overlap.
 * * Overlap Math: Two intervals [L1, R1] and [L2, R2] overlap if:
 * (L1 < R2) AND (L2 < R1)
 */
static inline int check_adj(const int32_t* a, const int32_t* b) {
    // Scenario 1: Touching on the X-axis (Left/Right faces)
    // Check if X-faces meet AND Y-intervals overlap AND Z-intervals overlap
    if ((a[3] == b[0] || b[3] == a[0]) && (a[1] < b[4] && b[1] < a[4]) && (a[2] < b[5] && b[2] < a[5])) return 1;

    // Scenario 2: Touching on the Y-axis (Top/Bottom faces)
    // Check if Y-faces meet AND X-intervals overlap AND Z-intervals overlap
    if ((a[4] == b[1] || b[4] == a[1]) && (a[0] < b[3] && b[0] < a[3]) && (a[2] < b[5] && b[2] < a[5])) return 1;

    // Scenario 3: Touching on the Z-axis (Front/Back faces)
    // Check if Z-faces meet AND X-intervals overlap AND Y-intervals overlap
    if ((a[5] == b[2] || b[5] == a[2]) && (a[0] < b[3] && b[0] < a[3]) && (a[1] < b[4] && b[1] < a[4])) return 1;

    return 0; // No face-to-face contact found
}

/**
 * ROLE: process_cell
 * -----------------
 * This is the main entry point called from JavaScript. It performs an O(N^2)
 * comparison within a limited set of cuboids (a "cell") to find adjacency pairs.
 * * @param cuboids: A flat array of all cuboid coordinates in the scene.
 * @param cellIndices: An array of global indices belonging to this specific spatial cell.
 * @param count: How many cuboids are in this cell.
 * @param outPairs: A flat buffer to write results into: [idxA1, idxB1, idxA2, idxB2...].
 * @param maxPairs: Safety limit to prevent writing outside the allocated WASM memory.
 */
EMSCRIPTEN_KEEPALIVE
int process_cell(const int32_t* cuboids, const int32_t* cellIndices, int count, int32_t* outPairs, int maxPairs) {
    int pairCount = 0;

    // STEP 1: Outer Loop - Iterate through every cuboid index in the cell
    for (int i = 0; i < count; i++) {
        int idxA = cellIndices[i];
        // Calculate pointer to the start of Cuboid A's 6 coordinates
        const int32_t* a = &cuboids[idxA * 6];

        // STEP 2: Inner Loop - Compare Cuboid A with all subsequent cuboids (i + 1)
        // This avoids comparing A-with-A and double-comparing A-with-B and B-with-A.
        for (int j = i + 1; j < count; j++) {
            int idxB = cellIndices[j];
            const int32_t* b = &cuboids[idxB * 6];

            // STEP 3: Adjacency Test
            if (check_adj(a, b)) {
                // STEP 4: Capacity Check & Storage
                if (pairCount < maxPairs) {
                    // Store the global indices as a pair for the Disjoint Set Union (DSU) in JS
                    outPairs[pairCount * 2] = idxA;
                    outPairs[pairCount * 2 + 1] = idxB;
                    pairCount++;
                } else {
                    // Buffer full - return to avoid overflow
                    return pairCount;
                }
            }
        }
    }

    // Returns the total number of pairs found to JavaScript
    return pairCount;
}

// compile wasm
// emcc v4_27_adj.c -O3 -s WASM=1 -s SIDE_MODULE=1 -o v4_27_adj.wasm
