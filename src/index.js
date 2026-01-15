import * as PIXI from 'pixi.js';

// Create Pixi application
const app = new PIXI.Application({
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: 0x1a1a1a
});

// Add canvas to page
document.body.appendChild(app.canvas);

// Handle window resize
window.addEventListener('resize', () => {
    app.renderer.resize(window.innerWidth, window.innerHeight);
});

console.log('🐱 Purrmadeath initialized - blank canvas ready');
