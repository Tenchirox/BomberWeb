// server.js
// Pour lancer: node server.js
const WebSocket = require('ws');

// --- Constantes du Jeu ---
const PORT = 8088; // Port mis à jour
const TICK_RATE_MS = 1000 / 30; // 30 ticks par seconde
const MAP_WIDTH = 15;
const MAP_HEIGHT = 13;
const PLAYER_SPEED = 2.5; // Pixels par tick
const TILE_SIZE = 40;
const BOMB_TIMER = 7000; // 7 secondes
const EXPLOSION_LIFETIME = 500; // 0.5 seconde
const RESPAWN_DELAY = 3000; // 3 secondes

// Points d'apparition prédéfinis
const spawnPoints = [
    { x: TILE_SIZE + TILE_SIZE / 2, y: TILE_SIZE + TILE_SIZE / 2 },
    { x: (MAP_WIDTH - 2) * TILE_SIZE + TILE_SIZE / 2, y: (MAP_HEIGHT - 2) * TILE_SIZE + TILE_SIZE / 2 },
    { x: TILE_SIZE + TILE_SIZE / 2, y: (MAP_HEIGHT - 2) * TILE_SIZE + TILE_SIZE / 2 },
    { x: (MAP_WIDTH - 2) * TILE_SIZE + TILE_SIZE / 2, y: TILE_SIZE + TILE_SIZE / 2 }
];
let nextSpawnPointIndex = 0;

// --- État Global du Jeu ---
// Initialisation de gameState APRÈS les constantes dont il dépend
let gameState = {
    map: generateMap(),
    players: {},
    bombs: {},
    explosions: {}
};


// --- Création du Serveur WebSocket ---
const wss = new WebSocket.Server({ port: PORT });
console.log(`Serveur Bomberman démarré sur le port ${PORT}`);

wss.on('connection', (ws) => {
    console.log('Nouveau joueur connecté.');

    const playerId = `player_${Math.random().toString(36).substr(2, 9)}`;
    ws.playerId = playerId;

    addPlayer(playerId, "Joueur");

    ws.send(JSON.stringify({ type: 'init', playerId }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const player = gameState.players[playerId];
            if (!player || !player.isAlive) return;

            switch (data.type) {
                case 'join':
                    player.name = data.name;
                    break;
                case 'input':
                    player.inputs = data.inputs;
                    break;
                case 'placeBomb':
                    placeBomb(playerId);
                    break;
            }
        } catch (error) {
            console.error('Message invalide reçu:', message);
        }
    });

    ws.on('close', () => {
        console.log(`Joueur ${gameState.players[playerId]?.name || playerId} déconnecté.`);
        delete gameState.players[playerId];
    });
});

// --- Logique du Jeu ---
function getNextSpawnPoint() {
    const point = spawnPoints[nextSpawnPointIndex];
    nextSpawnPointIndex = (nextSpawnPointIndex + 1) % spawnPoints.length; // Cycle through spawn points
    return point;
}

function addPlayer(playerId, name) {
    const spawnPoint = getNextSpawnPoint();
    gameState.players[playerId] = {
        id: playerId,
        name: name,
        x: spawnPoint.x,
        y: spawnPoint.y,
        speed: PLAYER_SPEED,
        isAlive: true,
        lives: 3,
        bombPower: 1,
        bombCountMax: 1,
        inputs: { up: false, down: false, left: false, right: false },
        // ghostBombId n'est plus nécessaire avec la nouvelle logique
    };
}

function generateMap() {
    // 0 = Sol, 1 = Mur Indestructible, 2 = Mur Destructible
    const grid = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
        const row = [];
        for (let x = 0; x < MAP_WIDTH; x++) {
            if (y === 0 || y === MAP_HEIGHT - 1 || x === 0 || x === MAP_WIDTH - 1 || (x % 2 === 0 && y % 2 === 0)) {
                row.push(1);
            } else {
                row.push(Math.random() < 0.75 ? 2 : 0);
            }
        }
        grid.push(row);
    }
    
    // Zones de départ sûres
    spawnPoints.forEach(({x, y}) => {
        const gridX = Math.floor(x / TILE_SIZE);
        const gridY = Math.floor(y / TILE_SIZE);
        if (grid[gridY] && grid[gridY][gridX] !== undefined) grid[gridY][gridX] = 0;
        if (grid[gridY+1] && grid[gridY+1][gridX] !== undefined) grid[gridY+1][gridX] = 0;
        if (grid[gridY] && grid[gridY][gridX+1] !== undefined) grid[gridY][gridX+1] = 0;
        if (grid[gridY-1] && grid[gridY-1][gridX] !== undefined) grid[gridY-1][gridX] = 0;
        if (grid[gridY] && grid[gridY][gridX-1] !== undefined) grid[gridY][gridX-1] = 0;
    });

    return { grid, width: MAP_WIDTH, height: MAP_HEIGHT };
}

function placeBomb(playerId) {
    const player = gameState.players[playerId];
    if (!player) return;

    const gridX = Math.floor(player.x / TILE_SIZE);
    const gridY = Math.floor(player.y / TILE_SIZE);

    const bombExists = Object.values(gameState.bombs).some(b => b.x === gridX && b.y === gridY);
    if (bombExists) return;
    
    const playerBombs = Object.values(gameState.bombs).filter(b => b.ownerId === playerId).length;
    if (playerBombs >= player.bombCountMax) return;
    
    const bombId = `bomb_${Date.now()}_${playerId}`;
    gameState.bombs[bombId] = {
        id: bombId,
        ownerId: playerId,
        x: gridX,
        y: gridY,
        timer: BOMB_TIMER,
        power: player.bombPower
    };
}

function isColliding(x, y, playerId, radius = TILE_SIZE / 3) {
    const player = gameState.players[playerId];
    // Case actuelle du joueur (arrondie au plus proche)
    const playerCurrentGridX = Math.floor(player.x / TILE_SIZE);
    const playerCurrentGridY = Math.floor(player.y / TILE_SIZE);

    const checkCollisionAt = (gx, gy) => {
        // Collision avec les murs
        const tile = gameState.map.grid[gy]?.[gx];
        if (tile === 1 || tile === 2) return true;
        
        // Collision avec les bombes
        const bomb = Object.values(gameState.bombs).find(b => b.x === gx && b.y === gy);
        if (bomb) {
            // Si le joueur est SUR la case de la bombe, il peut la traverser pour en sortir.
            if (bomb.x === playerCurrentGridX && bomb.y === playerCurrentGridY) {
                return false; 
            }
            // Toute autre bombe est un obstacle solide.
            return true;
        }
        return false;
    };
    
    // Vérifier les 4 coins de la "hitbox" du joueur à la position future potentielle (x,y)
    const gridX1 = Math.floor((x - radius) / TILE_SIZE);
    const gridY1 = Math.floor((y - radius) / TILE_SIZE);
    const gridX2 = Math.floor((x + radius) / TILE_SIZE);
    const gridY2 = Math.floor((y + radius) / TILE_SIZE);

    if (checkCollisionAt(gridX1, gridY1)) return true;
    if (checkCollisionAt(gridX2, gridY1)) return true;
    if (checkCollisionAt(gridX1, gridY2)) return true;
    if (checkCollisionAt(gridX2, gridY2)) return true;

    return false;
}

function updateGameState() {
    // Mettre à jour la position des joueurs
    for (const id in gameState.players) {
        const player = gameState.players[id];
        if (!player.isAlive) continue;

        let dx = 0;
        let dy = 0;

        if (player.inputs.up) dy -= player.speed;
        if (player.inputs.down) dy += player.speed;
        if (player.inputs.left) dx -= player.speed;
        if (player.inputs.right) dx += player.speed;
        
        // Gérer les collisions séparément pour X et Y pour un meilleur "glissement"
        if (!isColliding(player.x + dx, player.y, id)) {
            player.x += dx;
        }
        if (!isColliding(player.x, player.y + dy, id)) {
            player.y += dy;
        }
    }

    // Mettre à jour les bombes
    for (const id in gameState.bombs) {
        const bomb = gameState.bombs[id];
        bomb.timer -= TICK_RATE_MS;
        if (bomb.timer <= 0) {
            explodeBomb(bomb);
            delete gameState.bombs[id];
        }
    }
    
    // Mettre à jour les explosions
    for (const id in gameState.explosions) {
        const explosion = gameState.explosions[id];
        explosion.lifetime -= TICK_RATE_MS;
        if (explosion.lifetime <= 0) {
            delete gameState.explosions[id];
        }
    }
}

function explodeBomb(bomb) {
    const explosionId = `explosion_${Date.now()}`;
    const segments = [{ x: bomb.x, y: bomb.y }]; 

    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    directions.forEach(([dx, dy]) => {
        for (let i = 1; i <= bomb.power; i++) {
            const x = bomb.x + dx * i;
            const y = bomb.y + dy * i;
            if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) break;
            
            const tile = gameState.map.grid[y][x];
            segments.push({ x, y });
            
            if (tile === 1) break;
            if (tile === 2) {
                gameState.map.grid[y][x] = 0;
                break;
            }
        }
    });
    
    gameState.explosions[explosionId] = {
        id: explosionId,
        segments: segments,
        lifetime: EXPLOSION_LIFETIME
    };

    // Vérifier les collisions avec les joueurs
    for (const victimId in gameState.players) {
        const player = gameState.players[victimId];
        if(!player.isAlive) continue;

        const playerGridX = Math.floor(player.x / TILE_SIZE);
        const playerGridY = Math.floor(player.y / TILE_SIZE);

        if (segments.some(seg => seg.x === playerGridX && seg.y === playerGridY)) {
            player.lives--;
            
            const killer = gameState.players[bomb.ownerId];
            const killerName = killer ? killer.name : "une bombe";
            
            // Envoyer un message spécifique au joueur tué
            wss.clients.forEach(client => {
                if(client.playerId === victimId && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        type: 'playerKilled',
                        playerId: victimId,
                        by: killerName
                    }));
                }
            });

            if (player.lives > 0) {
                player.isAlive = false; // Le joueur est "mort" temporairement
                setTimeout(() => {
                    const spawnPoint = getNextSpawnPoint();
                    player.x = spawnPoint.x;
                    player.y = spawnPoint.y;
                    player.isAlive = true;
                }, RESPAWN_DELAY);
            } else {
                 player.isAlive = false; // Mort permanente
            }
        }
    }
}

function broadcastGameState() {
    const message = JSON.stringify({ type: 'gameState', state: gameState });
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// --- Boucle de Jeu Principale ---
setInterval(() => {
    updateGameState();
    broadcastGameState();
}, TICK_RATE_MS);
