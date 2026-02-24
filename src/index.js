import * as PIXI from 'pixi.js';

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

    // Create a placeholder sprite using Graphics (temporary until we have image assets)
    function createPlayerSprite() {
        const sprite = new PIXI.Graphics();
        sprite.rect(0, 0, 32, 32);
        sprite.fill(0xFF6B6B);
        return sprite;
    }

    // Create player
    const player = createPlayerSprite();
    player.position.set(window.innerWidth / 2 - 16, window.innerHeight / 2 - 16);
    app.stage.addChild(player);

    // Input tracking
    const keys = {};
    const SPEED = 200; // pixels per second

    window.addEventListener('keydown', (e) => {
        keys[e.key.toLowerCase()] = true;
    });

    window.addEventListener('keyup', (e) => {
        keys[e.key.toLowerCase()] = false;
    });

    // Game loop - update player position based on input
    app.ticker.add((delta) => {
        // W or Up Arrow
        if (keys['w'] || keys['arrowup']) {
            player.position.y -= SPEED * delta.deltaTime / 60;
        }
        // S or Down Arrow
        if (keys['s'] || keys['arrowdown']) {
            player.position.y += SPEED * delta.deltaTime / 60;
        }
        // A or Left Arrow
        if (keys['a'] || keys['arrowleft']) {
            player.position.x -= SPEED * delta.deltaTime / 60;
        }
        // D or Right Arrow
        if (keys['d'] || keys['arrowright']) {
            player.position.x += SPEED * delta.deltaTime / 60;
        }
    });

    // Handle window resize
    window.addEventListener('resize', () => {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        player.position.set(window.innerWidth / 2 - 16, window.innerHeight / 2 - 16);
    });

    console.log('🐱 Purrmadeath initialized');
}

// Start the app
init();
