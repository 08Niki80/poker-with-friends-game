const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const Game = require('./game/Game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'public')));

const games = new Map();
const playerSessions = new Map();

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('createRoom', ({ roomId, playerName, smallBlind, bigBlind }, callback) => {
    if (!roomId || !playerName) {
      return callback({ success: false, error: 'Room ID and player name required' });
    }
    if (games.has(roomId)) {
      return callback({ success: false, error: 'Room already exists' });
    }

    const sb = smallBlind || 5;
    const bb = bigBlind || 10;
    const game = new Game(roomId, sb, bb);
    games.set(roomId, game);

    game.addPlayer(socket.id, playerName);
    playerSessions.set(socket.id, { roomId, playerId: socket.id });

    socket.join(roomId);
    callback({ success: true, gameState: game.getPublicState() });
    io.to(roomId).emit('gameUpdate', game.getPublicState());
    io.to(roomId).emit('chatMessage', {
      from: 'System',
      message: `${playerName} created the room`
    });
  });

  socket.on('joinRoom', ({ roomId, playerName }, callback) => {
    if (!roomId || !playerName) {
      return callback({ success: false, error: 'Room ID and player name required' });
    }

    const game = games.get(roomId);
    if (!game) {
      return callback({ success: false, error: 'Room not found' });
    }

    if (game.phase !== 'WAITING') {
      return callback({ success: false, error: 'Game already in progress' });
    }

    const added = game.addPlayer(socket.id, playerName);
    if (!added) {
      return callback({ success: false, error: 'Could not join room' });
    }

    playerSessions.set(socket.id, { roomId, playerId: socket.id });
    socket.join(roomId);

    callback({ success: true, gameState: game.getPublicState() });
    socket.emit('yourCards', game.getPrivateState(socket.id));
    io.to(roomId).emit('gameUpdate', game.getPublicState());
    io.to(roomId).emit('chatMessage', {
      from: 'System',
      message: `${playerName} joined the room`
    });
  });

  socket.on('startGame', (_, callback) => {
    const session = playerSessions.get(socket.id);
    if (!session) return callback?.({ success: false, error: 'Not in a room' });

    const game = games.get(session.roomId);
    if (!game) return callback?.({ success: false, error: 'Game not found' });

    const started = game.startHand();
    if (!started) {
      return callback?.({ success: false, error: 'Need at least 2 active players' });
    }

    broadcastGameState(game);
    callback?.({ success: true });
  });

  socket.on('playerAction', ({ action, amount }, callback) => {
    const session = playerSessions.get(socket.id);
    if (!session) return callback?.({ success: false, error: 'Not in a room' });

    const game = games.get(session.roomId);
    if (!game) return callback?.({ success: false, error: 'Game not found' });

    const result = game.processAction(socket.id, action, amount || 0);
    if (!result.success) {
      return callback?.({ success: false, error: result.error });
    }

    broadcastGameState(game);

    const currentPlayer = game.getCurrentPlayer();
    if (currentPlayer) {
      io.to(currentPlayer.id).emit('yourCards', game.getPrivateState(currentPlayer.id));
    }

    const actionPlayer = game.players.find(p => p.id === socket.id);
    if (actionPlayer) {
      io.to(game.roomId).emit('chatMessage', {
        from: 'System',
        message: `${actionPlayer.name} ${action}${amount ? ' ' + amount : ''}`
      });
    }

    callback?.({ success: true, gameState: game.getPublicState() });
  });

  socket.on('newHand', (_, callback) => {
    const session = playerSessions.get(socket.id);
    if (!session) return callback?.({ success: false, error: 'Not in a room' });

    const game = games.get(session.roomId);
    if (!game) return callback?.({ success: false, error: 'Game not found' });

    if (game.phase !== 'HAND_END' && game.phase !== 'WAITING') {
      return callback?.({ success: false, error: 'Cannot start new hand now' });
    }

    game.resetAndStartNewHand();
    broadcastGameState(game);
    callback?.({ success: true, gameState: game.getPublicState() });
  });

  socket.on('addChips', ({ amount }, callback) => {
    const session = playerSessions.get(socket.id);
    if (!session) return callback?.({ success: false, error: 'Not in a room' });

    const game = games.get(session.roomId);
    if (!game) return callback?.({ success: false, error: 'Game not found' });

    const player = game.players.find(p => p.id === socket.id);
    if (!player) return callback?.({ success: false, error: 'Player not found' });

    player.chips += (amount || 1000);
    broadcastGameState(game);
    callback?.({ success: true, gameState: game.getPublicState() });
  });

  socket.on('chatMessage', ({ message }) => {
    const session = playerSessions.get(socket.id);
    if (!session) return;

    const game = games.get(session.roomId);
    if (!game) return;

    const player = game.players.find(p => p.id === socket.id);
    if (!player) return;

    io.to(game.roomId).emit('chatMessage', {
      from: player.name,
      message: message
    });
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    const session = playerSessions.get(socket.id);
    if (!session) return;

    const game = games.get(session.roomId);
    if (!game) {
      playerSessions.delete(socket.id);
      return;
    }

    game.removePlayer(socket.id);
    playerSessions.delete(socket.id);

    if (game.players.length === 0) {
      games.delete(session.roomId);
    } else {
      io.to(session.roomId).emit('gameUpdate', game.getPublicState());
    }
  });
});

function broadcastGameState(game) {
  io.to(game.roomId).emit('gameUpdate', game.getPublicState());

  for (const player of game.players) {
    io.to(player.id).emit('yourCards', game.getPrivateState(player.id));
  }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
