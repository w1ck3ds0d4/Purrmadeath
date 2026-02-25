import * as PIXI from 'pixi.js';

// Simple noise function for procedural generation
function noise(x, y) {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
}

// Initialize app with modern Pixi.js v8 API
async function init() {
    const app = new PIXI.Application();
    await app.init({
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: 0x1a1a1a
    });

    // Add canvas to page
    document.body.appendChild(app.canvas);

    // World container - will hold all tiles and scroll with camera
    const world = new PIXI.Container();
    app.stage.addChild(world);

    // Tile settings
    const TILE_SIZE = 32;
    const GRASS_COLOR = 0x2d5016;
    const WATER_COLOR = 0x1e3a5f;

    // Check if a tile coordinate is water - much more grass than water
    function isTileWater(tileX, tileY) {
        const chunkX = Math.floor(tileX / 6);
        const chunkY = Math.floor(tileY / 6);
        const value = noise(chunkX, chunkY);
        return value < 0.15;  // Only 15% water, 85% grass
    }

    // Find a safe spawn position (on grass, not water)
    function findSafeSpawnPosition() {
        let searchRadius = 1;
        while (searchRadius < 20) {
            for (let x = -searchRadius; x <= searchRadius; x++) {
                for (let y = -searchRadius; y <= searchRadius; y++) {
                    if (Math.abs(x) === searchRadius || Math.abs(y) === searchRadius) {
                        if (!isTileWater(x, y)) {
                            return { x: x * TILE_SIZE + 16, y: y * TILE_SIZE + 16 };
                        }
                    }
                }
            }
            searchRadius++;
        }
        // Fallback (shouldn't reach here)
        return { x: 0, y: 0 };
    }

    // Generate and render tiles
    function createTileAt(x, y) {
        const isWater = isTileWater(x, y);
        const color = isWater ? WATER_COLOR : GRASS_COLOR;

        const tile = new PIXI.Graphics();
        tile.rect(0, 0, TILE_SIZE, TILE_SIZE);
        tile.fill(color);
        tile.stroke({ width: 1, color: 0x000000 });
        
        tile.position.set(x * TILE_SIZE, y * TILE_SIZE);
        return tile;
    }

    // Persistent tile cache - keeps tiles after they leave viewport
    const tileCache = new Map();
    const LOAD_BUFFER = 3;  // Load tiles this many tiles beyond viewport
    
    function updateTiles() {
        const screenCenterX = world.position.x;
        const screenCenterY = world.position.y;
        
        const tilesAcross = Math.ceil(window.innerWidth / TILE_SIZE) + 2;
        const tilesDown = Math.ceil(window.innerHeight / TILE_SIZE) + 2;
        
        const startTileX = Math.floor(-screenCenterX / TILE_SIZE) - LOAD_BUFFER;
        const startTileY = Math.floor(-screenCenterY / TILE_SIZE) - LOAD_BUFFER;
        const endTileX = startTileX + tilesAcross + LOAD_BUFFER;
        const endTileY = startTileY + tilesDown + LOAD_BUFFER;

        // Create new tiles that aren't in cache yet
        for (let y = startTileY; y < endTileY; y++) {
            for (let x = startTileX; x < endTileX; x++) {
                const key = `${x},${y}`;
                if (!tileCache.has(key)) {
                    const tile = createTileAt(x, y);
                    world.addChild(tile);
                    tileCache.set(key, tile);
                }
            }
        }

        // Remove tiles that are too far away (cleanup buffer)
        const cleanupDistance = LOAD_BUFFER + 5;
        for (const [key, tile] of tileCache) {
            const [x, y] = key.split(',').map(Number);
            if (x < startTileX - cleanupDistance || 
                x > endTileX + cleanupDistance ||
                y < startTileY - cleanupDistance || 
                y > endTileY + cleanupDistance) {
                tile.destroy();
                tileCache.delete(key);
            }
        }
    }

    // Initial tile generation
    updateTiles();

    // Create a placeholder sprite using Graphics (temporary until we have image assets)
    function createPlayerSprite() {
        const sprite = new PIXI.Graphics();
        sprite.rect(0, 0, 32, 32);
        sprite.fill(0xFF6B6B);
        return sprite;
    }

    // Create player - positioned at screen center (always visible)
    const player = createPlayerSprite();
    player.position.set(window.innerWidth / 2 - 16, window.innerHeight / 2 - 16);
    app.stage.addChild(player);

    // Track player world position separately
    const spawnWorldPos = findSafeSpawnPosition();
    let playerWorldX = spawnWorldPos.x;
    let playerWorldY = spawnWorldPos.y;

    // Input tracking
    const keys = {};
    const SPEED = 200; // pixels per second

    window.addEventListener('keydown', (e) => {
        keys[e.key.toLowerCase()] = true;
    });

    window.addEventListener('keyup', (e) => {
        keys[e.key.toLowerCase()] = false;
    });

    // Game loop - update player position and camera
    app.ticker.add((delta) => {
        const moveDistance = SPEED * delta.deltaTime / 60;
        let newWorldX = playerWorldX;
        let newWorldY = playerWorldY;

        // W or Up Arrow
        if (keys['w'] || keys['arrowup']) {
            newWorldY -= moveDistance;
        }
        // S or Down Arrow
        if (keys['s'] || keys['arrowdown']) {
            newWorldY += moveDistance;
        }
        // A or Left Arrow
        if (keys['a'] || keys['arrowleft']) {
            newWorldX -= moveDistance;
        }
        // D or Right Arrow
        if (keys['d'] || keys['arrowright']) {
            newWorldX += moveDistance;
        }

        // Check collision with water using center of player sprite
        const centerX = newWorldX + TILE_SIZE / 2;
        const centerY = newWorldY + TILE_SIZE / 2;
        const tileX = Math.floor(centerX / TILE_SIZE);
        const tileY = Math.floor(centerY / TILE_SIZE);

        // Only allow movement if not moving into water
        if (!isTileWater(tileX, tileY)) {
            playerWorldX = newWorldX;
            playerWorldY = newWorldY;
        }

        // Camera follows player - keep player centered on screen
        world.position.x = window.innerWidth / 2 - playerWorldX - 16;
        world.position.y = window.innerHeight / 2 - playerWorldY - 16;

        // Update visible tiles
        updateTiles();
    });

    // Handle window resize
    window.addEventListener('resize', () => {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        updateTiles();
    });

    console.log('🐱 Purrmadeath initialized - exploring random world');
}

// Start the app
init();
