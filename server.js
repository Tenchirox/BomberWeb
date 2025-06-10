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

// --- Power-up Constants ---
const POWERUP_TYPES = {
    BOMB_POWER: 'bombPower',
    BOMB_COUNT: 'bombCount'
};
const POWERUP_DURATION = 45000; // 45 seconds
const POWERUP_SPAWN_CHANCE = 0.3; // 30% chance
const POWERUP_ITEM_LIFETIME = 30000; // 30 seconds for item on map
const POWERUP_ITEM_WARNING_DURATION = 5000; // Warning starts 5 seconds before despawn

// Points d'apparition prédéfinis
const spawnPoints = [
    { x: TILE_SIZE + TILE_SIZE / 2, y: TILE_SIZE + TILE_SIZE / 2 },
    { x: (MAP_WIDTH - 2) * TILE_SIZE + TILE_SIZE / 2, y: (MAP_HEIGHT - 2) * TILE_SIZE + TILE_SIZE / 2 },
    { x: TILE_SIZE + TILE_SIZE / 2, y: (MAP_HEIGHT - 2) * TILE_SIZE + TILE_SIZE / 2 },
    { x: (MAP_WIDTH - 2) * TILE_SIZE + TILE_SIZE / 2, y: TILE_SIZE + TILE_SIZE / 2 }
];
let nextSpawnPointIndex = 0;

// --- Game State Initialization Function ---
function initializeGameState() {
    console.log("Initializing new game state..."); // For server logging
    const newMap = generateMap(); // generateMap() should still work as before
    return {
        map: newMap,
        players: {},
        bombs: {},
        explosions: {},
        powerUps: {},
        isGameOver: false,
        winnerName: null,
    };
}

// --- État Global du Jeu ---
let gameState = initializeGameState();


// --- Création du Serveur WebSocket ---
const wss = new WebSocket.Server({ port: PORT });
console.log(`Serveur Bomberman démarré sur le port ${PORT}`);

wss.on('connection', (ws) => {
    console.log('New player attempting to connect.'); // For server logging

    // Reset game state if game is over or server is effectively empty
    if (gameState.isGameOver || Object.keys(gameState.players).length === 0) {
        if (gameState.isGameOver) {
            console.log('Game is over, resetting game state for new game.');
        } else if (Object.keys(gameState.players).length === 0) {
            console.log('No players in game, ensuring fresh state.');
        }
        gameState = initializeGameState(); // Reset the global gameState
        // Reset any other necessary global variables, like nextSpawnPointIndex
        nextSpawnPointIndex = 0; // Reset this
    }

    // Now proceed with adding the player as before
    const playerId = `player_${Math.random().toString(36).substr(2, 9)}`;
    ws.playerId = playerId;

    addPlayer(playerId, "Player"); // Name will be updated by client 'join' message.

    ws.send(JSON.stringify({ type: 'init', playerId }));
    checkAndManageAIPlayer(); // Call after adding human player

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const player = gameState.players[playerId];
            // Add gameState.isGameOver check here
            if (!player || !player.isAlive || gameState.isGameOver) return;

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
        const player = gameState.players[ws.playerId]; // Get player before deleting
        if (player) {
            console.log(`Player ${player.name || ws.playerId} disconnected.`);
            delete gameState.players[ws.playerId];
        } else {
            console.log(`Player ${ws.playerId} disconnected (was not found in gameState).`);
        }

        checkAndManageAIPlayer(); // Call here, after removing the player
    });
});

// --- Logique du Jeu ---
function checkAndManageAIPlayer() {
    const humanPlayers = Object.values(gameState.players).filter(p => !p.isAI);
    const aiPlayers = Object.values(gameState.players).filter(p => p.isAI);

    console.log(`Checking AI status: Humans: ${humanPlayers.length}, AI: ${aiPlayers.length}`);

    if (humanPlayers.length === 1 && aiPlayers.length === 0) {
        // Spawn AI player
        const aiId = `ai_player_${Date.now()}`; // Unique ID for AI
        console.log(`Spawning AI player with ID: ${aiId}`);
        addPlayer(aiId, 'BotBomber', true);
    } else if (aiPlayers.length > 0 && (humanPlayers.length >= 2 || humanPlayers.length === 0)) {
        // Despawn AI player(s)
        aiPlayers.forEach(aiPlayer => {
            console.log(`Despawning AI player ${aiPlayer.name} (ID: ${aiPlayer.id})`);
            delete gameState.players[aiPlayer.id];
        });
    }
}

function getNextSpawnPoint() {
    const point = spawnPoints[nextSpawnPointIndex];
    nextSpawnPointIndex = (nextSpawnPointIndex + 1) % spawnPoints.length; // Cycle through spawn points
    return point;
}

function addPlayer(playerId, name, isAI = false) { // Added isAI parameter with default
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
        activePowerUps: [],
        kills: 0,
        isAI: isAI, // Store the isAI flag
        inputs: { up: false, down: false, left: false, right: false },
        // aiState will be initialized lazily later if player.isAI is true
    };
    console.log(`${isAI ? 'AI Player' : 'Human Player'} ${name} (ID: ${playerId}) added to game.`); // Log player type
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
        // 1. Explicit boundary check (NEW)
        if (gx < 0 || gx >= MAP_WIDTH || gy < 0 || gy >= MAP_HEIGHT) {
            return true; // Collision with map boundary
        }

        // 2. Collision avec les murs (indestructible or destructible)
        const tile = gameState.map.grid[gy][gx]; // No `?` needed after boundary check
        if (tile === 1 || tile === 2) { // 1=Indestructible, 2=Destructible
            return true;
        }
        
        // 3. Collision avec les bombes
        const bomb = Object.values(gameState.bombs).find(b => b.x === gx && b.y === gy);
        if (bomb) {
            // Allow player to pass through their own bomb
            if (bomb.ownerId === playerId) {
                return false; // No collision with own bomb
            }
            return true; // Collision with other players' bombs
        }
        return false; // No collision with empty tile
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
    if (gameState.isGameOver) {
        // Game is over, halt most updates.
        // Active explosions will still run their course based on current logic
        // unless explicitly cleared or their update loop also checks isGameOver.
        // To freeze explosions, their update loop also needs this check.
        // Bombs also won't tick down if we return early from player input processing.
        return;
    }

    // Mettre à jour la position des joueurs
    for (const id in gameState.players) {
        const player = gameState.players[id];
        if (!player.isAlive) continue;

        // AI Logic Block - sets player.inputs for AI players
        if (player.isAI && player.isAlive) {
            if (!player.aiState) {
                player.aiState = { currentDirection: null, stepsToTake: 0, decisionCooldown: 0, stuckX: player.x, stuckY: player.y, stuckCount: 0 };
            }

            player.inputs = { up: false, down: false, left: false, right: false }; // Reset inputs for AI

            if (player.aiState.decisionCooldown > 0) {
                player.aiState.decisionCooldown--;
            } else {
                // Stuck detection: Check if position changed since last AI decision for movement
                if (player.x === player.aiState.stuckX && player.y === player.aiState.stuckY) {
                    player.aiState.stuckCount++;
                } else {
                    player.aiState.stuckCount = 0; // Reset if moved
                    player.aiState.stuckX = player.x; // Update last known position
                    player.aiState.stuckY = player.y;
                }

                if (player.aiState.stepsToTake <= 0 || player.aiState.stuckCount > 3) { // Stuck or finished path
                    const directions = ['up', 'down', 'left', 'right'];
                    player.aiState.currentDirection = directions[Math.floor(Math.random() * directions.length)];
                    player.aiState.stepsToTake = TILE_SIZE * (Math.floor(Math.random() * 2) + 1); // 1-2 tiles
                    player.aiState.decisionCooldown = Math.floor(Math.random() * 10) + 10; // 10-19 ticks cooldown
                    player.aiState.stuckCount = 0;
                    player.aiState.stuckX = player.x; // Reset stuck anchor position
                    player.aiState.stuckY = player.y;
                    // console.log(`AI ${player.id} new decision: dir=${player.aiState.currentDirection}, steps=${player.aiState.stepsToTake.toFixed(1)}`);
                }
            }

            // Set input based on current direction if steps remain
            if (player.aiState.stepsToTake > 0 && player.aiState.currentDirection && player.aiState.decisionCooldown === 0) {
                player.inputs[player.aiState.currentDirection] = true;
                player.aiState.stepsToTake -= player.speed; // Decrement intended steps
                if (player.aiState.stepsToTake < 0) player.aiState.stepsToTake = 0;
            }

            // AI Bomb Placement Logic
            if (player.aiState.bombCooldown === undefined) {
                player.aiState.bombCooldown = 0;
            }

            if (player.aiState.bombCooldown > 0) {
                player.aiState.bombCooldown--;
            } else {
                if (Math.random() < 0.02) { // 2% chance per tick if cooldown is 0
                    const currentBombsByAI = Object.values(gameState.bombs).filter(b => b.ownerId === player.id).length;
                    if (currentBombsByAI < player.bombCountMax) {
                        const playerGridX = Math.floor(player.x / TILE_SIZE);
                        const playerGridY = Math.floor(player.y / TILE_SIZE);
                        const bombAtCurrentLocation = Object.values(gameState.bombs).some(b => b.x === playerGridX && b.y === playerGridY);

                        if (!bombAtCurrentLocation) {
                            placeBomb(player.id);
                            console.log(`AI ${player.name} (ID: ${player.id}) placed a bomb.`);
                            player.aiState.bombCooldown = 50; // Cooldown for ~1.6 seconds

                            // Optional: Force AI to try and move after placing a bomb
                            player.aiState.stepsToTake = 0;
                            player.aiState.decisionCooldown = 0; // Allow immediate new movement decision
                        }
                    }
                }
            }
        }

        // Generic Player Movement (processes player.inputs set by human or AI)
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

        // NEW: Check for power-up collection
        if (player.isAlive) { // Only living players can collect power-ups
            const playerGridX = Math.floor(player.x / TILE_SIZE);
            const playerGridY = Math.floor(player.y / TILE_SIZE);

            for (const powerUpId in gameState.powerUps) {
                const powerUp = gameState.powerUps[powerUpId];
                if (powerUp.x === playerGridX && powerUp.y === playerGridY) {
                    // Player collects the power-up
                    let statToModify;
                    // let originalStatValue; // Not used in this version of the logic yet

                    if (powerUp.type === POWERUP_TYPES.BOMB_POWER) {
                        statToModify = 'bombPower';
                        // originalStatValue = player.bombPower;
                        player.bombPower++;
                    } else if (powerUp.type === POWERUP_TYPES.BOMB_COUNT) {
                        statToModify = 'bombCountMax';
                        // originalStatValue = player.bombCountMax;
                        player.bombCountMax++;
                    }

                    // Add to active power-ups for timed effect
                    const buffId = `buff_${player.id}_${Date.now()}`;
                    player.activePowerUps.push({
                        id: buffId,
                        powerUpId: powerUp.id, // ID of the power-up item collected
                        type: powerUp.type,
                        statModified: statToModify,
                        valueChange: 1, // For now, all power-ups grant +1
                        expiresAt: Date.now() + POWERUP_DURATION
                    });

                    delete gameState.powerUps[powerUpId]; // Remove power-up from map
                    // TODO: Send message to client about power-up collection (will be handled in a later step)
                    break; // Player can only collect one power-up per tick
                }
            }
        }
    }

    // Update Power-up Lifecycles (items on map)
    for (const powerUpId in gameState.powerUps) {
        const powerUp = gameState.powerUps[powerUpId];
        // Ensure createdAt exists to prevent errors if a powerUp somehow misses it
        if (powerUp.createdAt) {
            const age = Date.now() - powerUp.createdAt;

            if (age > POWERUP_ITEM_LIFETIME) {
                delete gameState.powerUps[powerUpId]; // Despawn: remove if lifetime exceeded
            } else if (age > POWERUP_ITEM_LIFETIME - POWERUP_ITEM_WARNING_DURATION) {
                powerUp.isDespawning = true; // Flag for client to flash
            }
            // No need for an else to set isDespawning to false,
            // as it's only added when true, and object is deleted otherwise or when collected.
        }
    }

    // Mettre à jour les bombes
    if (!gameState.isGameOver) { // Add this check
        for (const id in gameState.bombs) {
            const bomb = gameState.bombs[id];
            bomb.timer -= TICK_RATE_MS;
            if (bomb.timer <= 0) {
                explodeBomb(bomb);
                delete gameState.bombs[id];
            }
        }
    } // End of check
    
    // Mettre à jour les explosions
    if (!gameState.isGameOver) { // Add this check
        for (const id in gameState.explosions) {
            const explosion = gameState.explosions[id];
            explosion.lifetime -= TICK_RATE_MS;
            if (explosion.lifetime <= 0) {
                delete gameState.explosions[id];
            }
        }
    } // End of check

    // NEW: Handle Power-up Expiry (for player buffs)
    for (const playerId in gameState.players) {
        const player = gameState.players[playerId];
        if (!player.activePowerUps || player.activePowerUps.length === 0) {
            continue; // Skip if player has no active power-ups
        }

        const remainingPowerUps = [];
        for (let i = 0; i < player.activePowerUps.length; i++) {
            const powerUpBuff = player.activePowerUps[i];
            if (Date.now() >= powerUpBuff.expiresAt) {
                // Power-up has expired, revert the stat
                if (powerUpBuff.statModified === 'bombPower') {
                    player.bombPower -= powerUpBuff.valueChange;
                    if (player.bombPower < 1) player.bombPower = 1; // Ensure stat doesn't go below base
                } else if (powerUpBuff.statModified === 'bombCountMax') {
                    player.bombCountMax -= powerUpBuff.valueChange;
                    if (player.bombCountMax < 1) player.bombCountMax = 1; // Ensure stat doesn't go below base
                }
                // TODO: Send message to client about power-up expiry (will be handled in a later step)
            } else {
                // Power-up is still active
                remainingPowerUps.push(powerUpBuff);
            }
        }
        player.activePowerUps = remainingPowerUps;
    }

    // Check for Game End Condition
    if (!gameState.isGameOver) { // Only check if game is not already over
        // USE THIS: Count players who have lives remaining
        const playersWithLivesRemaining = Object.values(gameState.players).filter(p => p.lives > 0);
        const totalPlayers = Object.keys(gameState.players).length; // Total registered players

        if (totalPlayers === 1) {
            // Single player scenario: game ends if the player has no lives left
            if (playersWithLivesRemaining.length === 0) {
                gameState.isGameOver = true;
                // Ensure the player object actually exists before trying to access name,
                // though if totalPlayers is 1, it should.
                // For winnerName, it's more of a "Game Over" status for solo.
                gameState.winnerName = "Game Over";
            }
        } else if (totalPlayers > 1) {
            // Multi-player scenario
            if (playersWithLivesRemaining.length === 1) {
                gameState.isGameOver = true;
                gameState.winnerName = playersWithLivesRemaining[0].name; // The sole survivor
            } else if (playersWithLivesRemaining.length === 0) {
                // All players have 0 lives (e.g., simultaneous elimination)
                gameState.isGameOver = true;
                gameState.winnerName = "Draw!";
            }
        }
        // If totalPlayers === 0, no game to end.
        // If (totalPlayers === 1 and playersWithLivesRemaining === 1), game continues.
        // If (totalPlayers > 1 and playersWithLivesRemaining > 1), game continues.
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
            
            if (tile === 1) break; // Indestructible wall
            if (tile === 2) { // Destructible wall
                gameState.map.grid[y][x] = 0; // Clear the wall

                // Check if there's already a bomb or power-up at this location
                const existingBomb = Object.values(gameState.bombs).find(b => b.x === x && b.y === y);
                const existingPowerUp = Object.values(gameState.powerUps).find(p => p.x === x && p.y === y);

                if (!existingBomb && !existingPowerUp && Math.random() < POWERUP_SPAWN_CHANCE) {
                    const powerUpId = `powerup_${Date.now()}_${x}_${y}`;
                    const chosenType = Math.random() < 0.5 ? POWERUP_TYPES.BOMB_POWER : POWERUP_TYPES.BOMB_COUNT;
                    gameState.powerUps[powerUpId] = {
                        id: powerUpId,
                        x: x,
                        y: y,
                        type: chosenType,
                        createdAt: Date.now() // Add this line
                    };
                }
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

            // Check for non-self-kill and increment score for the bomb owner
            if (bomb.ownerId !== victimId) {
                const killerPlayer = gameState.players[bomb.ownerId];
                if (killerPlayer) { // Ensure killer exists
                    killerPlayer.kills = (killerPlayer.kills || 0) + 1; // Increment kills for bomb owner
                }
            }
            
            const killer = gameState.players[bomb.ownerId]; // This line is repeated, but it's fine for getting the name
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
