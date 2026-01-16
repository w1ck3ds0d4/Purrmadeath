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

    // Handle window resize
    window.addEventListener('resize', () => {
        app.renderer.resize(window.innerWidth, window.innerHeight);
        player.position.set(window.innerWidth / 2 - 16, window.innerHeight / 2 - 16);
    });

    console.log('🐱 Purrmadeath initialized - player sprite ready for animation');
}

// Start the app
init();
