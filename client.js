document.addEventListener('DOMContentLoaded', () => {
    const connectionScreen = document.getElementById('connection-screen');
    const gameArea = document.getElementById('game-area');
    const connectButton = document.getElementById('connect-button');
    const playerNameInput = document.getElementById('player-name');
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    const statusBar = document.getElementById('status-bar');
    const powerUpTimersUI = document.getElementById('power-up-timers'); // Add this

    let socket;
    let gameState = {};
    let myPlayerId = null;
    
    const TILE_SIZE = 40;

    connectButton.addEventListener('click', () => {
        const playerName = playerNameInput.value.trim() || `Player${Math.floor(Math.random() * 1000)}`;
        connect(playerName);
    });

    function connect(name) {
        // Remplacer 'localhost' par l'adresse de votre serveur si nécessaire
        socket = new WebSocket('ws://localhost:8088');

        socket.onopen = () => {
            console.log('Connecté au serveur WebSocket.');
            connectionScreen.style.display = 'none';
            gameArea.style.display = 'flex';
            // Envoyer le nom du joueur au serveur
            socket.send(JSON.stringify({ type: 'join', name }));
        };

        socket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            
            if (message.type === 'init') {
                myPlayerId = message.playerId;
            }
            
            if (message.type === 'gameState') {
                gameState = message.state;
                const playerCount = Object.keys(gameState.players).length;
                const myPlayer = gameState.players[myPlayerId];
                const livesText = myPlayer ? ` | Vies: ${myPlayer.lives}` : '';
                const killsText = myPlayer ? ` | Kills: ${myPlayer.kills || 0}` : ''; // Add this
                statusBar.textContent = `Joueurs: ${playerCount}${livesText}${killsText}`; // Modify this
            }

            if (message.type === 'playerKilled') {
                if(myPlayerId === message.playerId) {
                    alert(`Vous avez été tué par ${message.by}`);
                }
            }
        };

        socket.onclose = () => {
            console.log('Déconnecté du serveur.');
            gameArea.style.display = 'none';
            connectionScreen.style.display = 'block';
            statusBar.textContent = "Déconnecté. Veuillez vous reconnecter.";
        };

        socket.onerror = (error) => {
            console.error('Erreur WebSocket:', error);
            statusBar.textContent = "Erreur de connexion.";
        };
    }

    // --- Logique de Rendu ---
    function draw() {
        // Effacer le canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#3c3c3c'; // Background color
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (!gameState.map) {
            requestAnimationFrame(draw);
            return;
        }

        if (gameState.isGameOver) {
            ctx.fillStyle = 'white';
            ctx.font = 'bold 30px "Press Start 2P"';
            ctx.textAlign = 'center';
            ctx.fillText('Game Over!', canvas.width / 2, canvas.height / 3);

            ctx.font = 'bold 24px "Press Start 2P"';
            const winnerText = gameState.winnerName ? `Winner: ${gameState.winnerName}` : "It's a Draw!";
            ctx.fillText(winnerText, canvas.width / 2, canvas.height / 2);

            ctx.font = '16px "Press Start 2P"';
            let scoreYPos = canvas.height / 2 + 60;
            ctx.fillText("Scores:", canvas.width / 2, scoreYPos);
            scoreYPos += 30;

            for (const playerId in gameState.players) {
                const p = gameState.players[playerId];
                ctx.fillText(`${p.name}: ${p.kills || 0} kills`, canvas.width / 2, scoreYPos);
                scoreYPos += 25;
            }
            // Keep RAF for potential future "play again" UI.
            requestAnimationFrame(draw); 
            return; 
        }
        
        // Dessiner la grille
        const { grid, width, height } = gameState.map;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const tile = grid[y][x];
                if (tile === 1) { // Mur indestructible
                    ctx.fillStyle = '#6e6e6e';
                } else if (tile === 2) { // Mur destructible
                    ctx.fillStyle = '#a86f32';
                } else {
                    ctx.fillStyle = '#4a4a4a'; // Sol
                }
                ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            }
        }

        // Dessiner les Power-ups
        if (gameState.powerUps) { // Check if powerUps object exists
            for (const id in gameState.powerUps) {
                const powerUp = gameState.powerUps[id];

                // Flashing logic for despawning power-ups
                if (powerUp.isDespawning === true) {
                    // Flash every 250ms (toggle visibility)
                    // Adjust 250 to change flash speed
                    if (Math.floor(Date.now() / 250) % 2 === 0) {
                        continue; // Skip drawing this frame to make it flash
                    }
                }
                
                const drawX = powerUp.x * TILE_SIZE + TILE_SIZE / 2;
                const drawY = powerUp.y * TILE_SIZE + TILE_SIZE / 2;
                const radius = TILE_SIZE / 4; // Slightly smaller than bombs

                ctx.beginPath();
                if (powerUp.type === 'bombPower') { // Assuming 'bombPower' is the type string from server
                    ctx.fillStyle = 'red'; // Example: Red for Bomb Power
                    // Draw a simple 'P' for Power
                    ctx.arc(drawX, drawY, radius, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = 'white';
                    ctx.font = 'bold 12px "Press Start 2P"';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('P', drawX, drawY);
                } else if (powerUp.type === 'bombCount') { // Assuming 'bombCount' is the type string from server
                    ctx.fillStyle = 'blue'; // Example: Blue for Bomb Count
                    // Draw a simple 'C' for Count
                    ctx.arc(drawX, drawY, radius, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = 'white';
                    ctx.font = 'bold 12px "Press Start 2P"';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('C', drawX, drawY);
                }
                // Add more types here if needed in the future
            }
        }
        
        // Dessiner les bombes
        for (const id in gameState.bombs) {
            const bomb = gameState.bombs[id];
            ctx.fillStyle = 'black';
            ctx.beginPath();
            ctx.arc(bomb.x * TILE_SIZE + TILE_SIZE / 2, bomb.y * TILE_SIZE + TILE_SIZE / 2, TILE_SIZE / 3, 0, Math.PI * 2);
            ctx.fill();
            
            // Dessiner le compte à rebours
            ctx.fillStyle = 'white';
            ctx.font = 'bold 18px "Press Start 2P"';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const countdown = Math.ceil(bomb.timer / 1000);
            ctx.fillText(countdown, bomb.x * TILE_SIZE + TILE_SIZE / 2, bomb.y * TILE_SIZE + TILE_SIZE / 2);
        }

        // Dessiner les explosions
        for (const id in gameState.explosions) {
            const explosion = gameState.explosions[id];
            ctx.fillStyle = '#ff9f43'; // Couleur de l'explosion
            explosion.segments.forEach(segment => {
                ctx.fillRect(segment.x * TILE_SIZE, segment.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            });
        }

        // Dessiner les joueurs
        for (const id in gameState.players) {
            const player = gameState.players[id];
            if (!player.isAlive) continue; // Ne pas dessiner les joueurs morts
            ctx.fillStyle = (id === myPlayerId) ? '#ffcc00' : '#d63031'; // Couleur différente pour "moi"
            ctx.beginPath();
            ctx.arc(player.x, player.y, TILE_SIZE / 2.5, 0, Math.PI * 2);
            ctx.fill();
            
            // Dessiner le nom
            ctx.fillStyle = 'white';
            ctx.font = '10px "Press Start 2P"';
            ctx.textAlign = 'center';
            ctx.fillText(player.name, player.x, player.y - TILE_SIZE / 2);
        }

        // Display Active Power-up Timers for myPlayer
        if (myPlayerId && gameState.players && gameState.players[myPlayerId] && gameState.players[myPlayerId].activePowerUps) {
            const myPlayer = gameState.players[myPlayerId];
            let timersHTML = '';
            myPlayer.activePowerUps.forEach(buff => {
                const remainingTime = Math.max(0, Math.ceil((buff.expiresAt - Date.now()) / 1000));
                let buffName = '';
                if (buff.type === 'bombPower') buffName = 'Power';
                else if (buff.type === 'bombCount') buffName = 'Count';
                
                if (remainingTime > 0) {
                    timersHTML += `<div>${buffName}: ${remainingTime}s</div>`;
                }
            });
            powerUpTimersUI.innerHTML = timersHTML;
        } else if (powerUpTimersUI) { // Ensure powerUpTimersUI exists
            powerUpTimersUI.innerHTML = ''; // Clear if no player data or no active buffs
        }
        
        requestAnimationFrame(draw);
    }

    // --- Gestion des Entrées ---
    const inputs = { up: false, down: false, left: false, right: false };
    window.addEventListener('keydown', (e) => {
        if (gameState.isGameOver) return; // Add this line at the start
        let changed = false;
        switch (e.key) {
            case 'ArrowUp': case 'w': if (!inputs.up) { inputs.up = true; changed = true; } break;
            case 'ArrowDown': case 's': if (!inputs.down) { inputs.down = true; changed = true; } break;
            case 'ArrowLeft': case 'a': if (!inputs.left) { inputs.left = true; changed = true; } break;
            case 'ArrowRight': case 'd': if (!inputs.right) { inputs.right = true; changed = true; } break;
            case ' ': 
                if (socket && socket.readyState === WebSocket.OPEN) {
                   socket.send(JSON.stringify({ type: 'placeBomb' }));
                }
                break;
        }
        if (changed && socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'input', inputs }));
        }
    });
    window.addEventListener('keyup', (e) => {
        let changed = false;
        switch (e.key) {
            case 'ArrowUp': case 'w': if (inputs.up) { inputs.up = false; changed = true; } break;
            case 'ArrowDown': case 's': if (inputs.down) { inputs.down = false; changed = true; } break;
            case 'ArrowLeft': case 'a': if (inputs.left) { inputs.left = false; changed = true; } break;
            case 'ArrowRight': case 'd': if (inputs.right) { inputs.right = false; changed = true; } break;
        }
         if (changed && socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'input', inputs }));
        }
    });

    // Lancer la boucle de rendu
    draw();
});
