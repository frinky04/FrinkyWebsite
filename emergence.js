// --- Canvas & Grid Setup ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// const gridSize = 60; // Number of cells in width/height - Will be dynamic
let gridWidth;
let gridHeight;
const cellSize = 15; // Size of each cell in pixels
let grid; // Cells are objects: { age: number, opacity: number } or 0 for dead
let nextGrid;

// --- Cell Appearance ---
const baseMaxAge = 15; // Base max age, can be modified by zones
const cellPadding = 3; // Space around each cell circle
const fadeFrames = 2; // Number of frames to fade in/out
const HUE_SHIFT_RANGE = 300; // Cranked up: Degrees to shift hue over cell lifetime

// --- Rules ---
let birthRules = [];
let survivalRules = [];
const GOL_LIKE_PROBABILITY = 0.5; // 40% chance for GOL-like rules

// Weighted lists for GOL-like rule generation
const GOL_BIRTH_NEIGHBORS_WEIGHTED = [0, 1, 2, 2, 3, 3, 3, 3, 3, 4, 4, 5, 6, 7, 8];
const GOL_SURVIVAL_NEIGHBORS_WEIGHTED = [0, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 5, 6, 7, 8];
const RANDOM_NEIGHBORS_UNIFORM = [0, 1, 2, 3, 4, 5, 6, 7, 8];

// --- Environmental Zones ---
const numZoneDivisions = 2; // Creates a 2x2 grid of zones
// const ZONE_HUE_OFFSETS = [0, 60, 120, 240]; // Removed for dynamic shifting

// --- Simulation Control ---
let simulationIntervalId = null;
// const resetIntervalTime = 50000; // Removed: No longer using timed reset
const simulationSpeed = 120; // ms per frame (20 FPS)
let currentInitialDensity = 0.35; // Will be randomized
let globalHueShiftTick = 0;
const ZONE_HUE_SHIFT_SPEED = 0.5; // Degrees per frame for zone base hue shift

// --- Color Helper Functions ---
function parseRgb(rgbString) {
    const match = rgbString.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d\.]+))?\)$/);
    if (!match) return { r: 0, g: 0, b: 0 }; // Default to black if parse fails
    return {
        r: parseInt(match[1]),
        g: parseInt(match[2]),
        b: parseInt(match[3]),
    };
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0; // achromatic
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
}

function setupCanvas() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    canvas.width = vw; // canvas drawing buffer takes full window size
    canvas.height = vh;

    if (vw <= 0 || vh <= 0 || cellSize <= 0) { // Check for non-positive dimensions
        gridWidth = 0;
        gridHeight = 0;
    } else {
        // Ensure logical grid is at least 1x1 if viewport has positive dimensions.
        gridWidth = Math.max(1, Math.floor(vw / cellSize));
        gridHeight = Math.max(1, Math.floor(vh / cellSize));
    }
    // The lines that would make canvas.width/height a multiple of cellSize are still removed/commented.
}

// Helper function to pick an index based on weights
function weightedRandomChoiceIndex(weightsArray) {
    const totalWeight = weightsArray.reduce((sum, w) => sum + w, 0);
    if (totalWeight <= 0) return Math.floor(Math.random() * weightsArray.length); // Fallback for empty/all-zero weights
    let randomNum = Math.random() * totalWeight;
    for (let j = 0; j < weightsArray.length; j++) {
        randomNum -= weightsArray[j];
        if (randomNum < 0) return j;
    }
    return weightsArray.length - 1; // Should ideally not be reached if totalWeight > 0
}

// Helper function to pick N distinct numbers from a (potentially weighted) list of available numbers
function pickDistinctNumbers(availableNumbers, count, weighted = false) {
    const pickedRules = [];
    let currentAvailable = [...availableNumbers];
    
    if (!weighted) {
        // Simple random distinct pick for uniform lists
        currentAvailable.sort(() => 0.5 - Math.random()); // Shuffle
        for(let i=0; i< count && currentAvailable.length > 0; ++i){
            pickedRules.push(currentAvailable.pop());
        }
    } else {
        // Weighted distinct pick
        const uniqueNeighbors = [...new Set(currentAvailable)];
        const neighborWeights = uniqueNeighbors.map(un => currentAvailable.filter(n => n === un).length);

        let tempUniqueNeighbors = [...uniqueNeighbors];
        let tempNeighborWeights = [...neighborWeights];

        for (let i = 0; i < count && tempUniqueNeighbors.length > 0; i++) {
            const chosenIndexInUnique = weightedRandomChoiceIndex(tempNeighborWeights);
            pickedRules.push(tempUniqueNeighbors[chosenIndexInUnique]);
            tempUniqueNeighbors.splice(chosenIndexInUnique, 1);
            tempNeighborWeights.splice(chosenIndexInUnique, 1);
        }
    }
    pickedRules.sort((a, b) => a - b);
    return pickedRules;
}

function randomizeRulesAndDensity() {
    birthRules = [];
    survivalRules = [];

    if (Math.random() < GOL_LIKE_PROBABILITY) {
        // GOL-like rules
        const numBirth = Math.floor(Math.random() * 2) + 1; // 1 or 2 birth conditions
        birthRules = pickDistinctNumbers(GOL_BIRTH_NEIGHBORS_WEIGHTED, numBirth, true);

        const numSurvival = Math.floor(Math.random() * 2) + 2; // 2 or 3 survival conditions
        survivalRules = pickDistinctNumbers(GOL_SURVIVAL_NEIGHBORS_WEIGHTED, numSurvival, true);
    } else {
        // Fully random rules
        const numBirth = Math.floor(Math.random() * 4) + 1; // 1 to 4 conditions
        birthRules = pickDistinctNumbers(RANDOM_NEIGHBORS_UNIFORM, numBirth, false);

        const numSurvival = Math.floor(Math.random() * 4) + 1; // 1 to 4 conditions
        survivalRules = pickDistinctNumbers(RANDOM_NEIGHBORS_UNIFORM, numSurvival, false);
    }
    // Ensure rules are not empty, especially for GOL-like if weighted pick fails due to small N for count
    if (birthRules.length === 0) birthRules = pickDistinctNumbers(RANDOM_NEIGHBORS_UNIFORM, 1, false); 
    if (survivalRules.length === 0) survivalRules = pickDistinctNumbers(RANDOM_NEIGHBORS_UNIFORM, 2, false); 

    currentInitialDensity = Math.random() * 0.6 + 0.1;
    // console.log(`Rules: B${birthRules.join('')}/S${survivalRules.join('')}, Density: ${currentInitialDensity.toFixed(2)} Mode: ${Math.random() < GOL_LIKE_PROBABILITY ? 'GOL-Like' : 'Random'}`);
}

function initializeGrid() {
    grid = new Array(gridHeight).fill(null).map(() => new Array(gridWidth).fill(0));
    nextGrid = new Array(gridHeight).fill(null).map(() => new Array(gridWidth).fill(0));

    for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
            if (Math.random() < currentInitialDensity) {
                // Initialize with full opacity and age 1 for simplicity on first draw
                grid[y][x] = { age: 1, opacity: 1 }; 
            }
        }
    }
}

function drawGrid() {
    // get fill style from body background
    // ctx.fillStyle = getComputedStyle(document.body).backgroundColor; // Changed: Use fixed color
    ctx.fillStyle = "#000000"; // Fixed background color for the canvas
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const baseRadius = (cellSize / 2) - cellPadding;
    const radius = baseRadius / 4; // User preference for smaller cells

    // const bodyFgColorString = getComputedStyle(document.body).color; // Changed: Use fixed color
    const cellBaseColorString = "rgb(9, 255, 0)"; // Changed to rgb() format for parseRgb
    const { r, g, b } = parseRgb(cellBaseColorString);
    const { h: bodyHue, s: baseS, l: baseL } = rgbToHsl(r, g, b);

    for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
            const cell = grid[y][x];
            if (cell !== 0 && cell.opacity > 0) { // Only draw if cell object exists and has opacity
                const age = cell.age;
                const zone = getZone(x, y);
                const initialZoneSeparation = zone * 90; // Base separation (0, 90, 180, 270)
                const dynamicZoneShift = globalHueShiftTick * ZONE_HUE_SHIFT_SPEED;
                const zoneHueOffset = (initialZoneSeparation + dynamicZoneShift) % 360;
                const cellBaseHue = (bodyHue + zoneHueOffset) % 360;
                const currentMaxAge = getZoneMaxAge(x, y); // Use zone-specific maxAge for dimming
                const ageRatio = Math.min((age -1) / (currentMaxAge -1), 1); // 0 for new, 1 for oldest
                const dimmedLightness = baseL * (1 - ageRatio * 0.6); // Dims original lightness by up to 60%
                const shiftedHue = (cellBaseHue + ageRatio * HUE_SHIFT_RANGE) % 360;
                ctx.fillStyle = `hsla(${shiftedHue}, ${baseS}%, ${dimmedLightness}%, ${cell.opacity})`;
                
                ctx.beginPath();
                ctx.arc(
                    x * cellSize + cellSize / 2, 
                    y * cellSize + cellSize / 2, 
                    radius, // Using the user-defined smaller radius
                    0, 
                    Math.PI * 2
                );
                ctx.fill();
            }
        }
    }
}

function countLiveNeighbors(x, y) {
    let count = 0;
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            if (i === 0 && j === 0) continue;
            const newX = (x + j + gridWidth) % gridWidth;
            const newY = (y + i + gridHeight) % gridHeight;
            // A cell is considered live for rule purposes if it's an object (i.e., not 0)
            if (grid[newY][newX] !== 0) { 
                count++;
            }
        }
    }
    return count;
}

function getZone(x, y) {
    const zoneWidth = gridWidth / numZoneDivisions;
    const zoneHeight = gridHeight / numZoneDivisions;
    const zoneCol = Math.floor(x / zoneWidth);
    const zoneRow = Math.floor(y / zoneHeight);
    return zoneRow * numZoneDivisions + zoneCol; // 0, 1, 2, 3 for a 2x2 grid
}

function getZoneMaxAge(x,y){
    const zone = getZone(x,y);
    if (zone === 3) { // Bottom-right zone: Faster Aging
        return Math.max(1, Math.floor(baseMaxAge / 2)); // Ensure maxAge is at least 1
    }
    return baseMaxAge;
}

function updateGrid() {
    randomizeRulesAndDensity(); // Generate new rules every frame update

    for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
            let liveNeighbors = countLiveNeighbors(x, y);
            const currentCell = grid[y][x];
            const zone = getZone(x, y);
            let currentMaxAge = getZoneMaxAge(x,y);

            // Apply zone modifiers
            if (zone === 1) { // Top-right zone: Easier Birth
                // This modifier applies only when checking for birth
            } else if (zone === 2) { // Bottom-left zone: Harder Survival
                // This modifier applies only when checking for survival
            }
            // Zone 3 (Faster Aging) is handled by currentMaxAge

            if (currentCell === 0) { // Currently dead
                let birthCheckNeighbors = liveNeighbors;
                if (zone === 1) birthCheckNeighbors = Math.min(8, liveNeighbors + 1); // Easier birth

                if (birthRules.includes(birthCheckNeighbors)) {
                    nextGrid[y][x] = { age: 1, opacity: 1 / fadeFrames }; // Born, starts fading in
                } else {
                    nextGrid[y][x] = 0; // Stays dead
                }
            } else { // Currently an object (alive, fading in, or fading out)
                let survivalCheckNeighbors = liveNeighbors;
                if (zone === 2) survivalCheckNeighbors = Math.max(0, liveNeighbors - 1); // Harder survival
                
                if (survivalRules.includes(survivalCheckNeighbors) && currentCell.age < currentMaxAge) {
                    // Survives and is not too old
                    nextGrid[y][x] = {
                        age: currentCell.age + 1,
                        opacity: Math.min(1, currentCell.opacity + 1 / fadeFrames)
                    };
                } else {
                    // Dies (by rule or old age)
                    const newOpacity = currentCell.opacity - 1 / fadeFrames;
                    if (newOpacity > 0) {
                        nextGrid[y][x] = { age: currentCell.age, opacity: newOpacity }; // Continues fading out
                    } else {
                        nextGrid[y][x] = 0; // Fully faded, now truly dead
                    }
                }
            }
        }
    }

    let temp = grid;
    grid = nextGrid;
    nextGrid = temp;
}

function gameStep() {
    updateGrid();
    drawGrid();
    globalHueShiftTick++; // Increment global hue shift counter

    // Check for extinction
    let liveCellsFound = false;
    for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
            // A cell is live if it's an object (even if fading out)
            if (grid[y][x] !== 0) { 
                liveCellsFound = true;
                break;
            }
        }
        if (liveCellsFound) break;
    }

    if (!liveCellsFound) {
        // console.log("Extinction event! Resetting.");
        startNewSimulation(); // Reset immediately
    }
}

function startNewSimulation() {
    if (simulationIntervalId) {
        clearInterval(simulationIntervalId);
    }
    globalHueShiftTick = 0; // Reset hue shift tick on full simulation reset
    initializeGrid();
    drawGrid();
    simulationIntervalId = setInterval(gameStep, simulationSpeed);
}

// --- Main ---
document.addEventListener('DOMContentLoaded', () => {
    setupCanvas();
    startNewSimulation();
    // setInterval(startNewSimulation, resetIntervalTime); // Removed: No longer using timed reset

    window.addEventListener('resize', () => {
        setupCanvas();
        startNewSimulation();
    });
}); 