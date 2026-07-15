const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const Game = require('./game/Game');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

const games = new Map();
const playerSessions = new Map();
const reconnectTokens = new Map();
const rateLimits = new Map();

const RATE_WINDOW_MS = 500;
const DISCONNECT_TIMEOUT_MS = 30000;
const MAX_NAME_LENGTH = 20;
const MAX_ROOM_ID_LENGTH = 30;
const MIN_BLIND = 1;
const MAX_BLIND = 100000;
const MAX_RAISE = 100000000;

function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().slice(0, MAX_NAME_LENGTH);
}

function sanitizeRoomId(roomId) {
  if (typeof roomId !== 'string') return '';
  const cleaned = roomId.replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned.slice(0, MAX_ROOM_ID_LENGTH);
}

function validatePositiveInt(val, min, max) {
  const num = parseInt(val);
  if (isNaN(num) || num < min || num > max) return null;
  return num;
}

function checkRateLimit(socketId) {
  const now = Date.now();
  const last = rateLimits.get(socketId) || 0;
  if (now - last < RATE_WINDOW_MS) return false;
  rateLimits.set(socketId, now);
  return true;
}

function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function cleanupStaleRateLimits() {
  const now = Date.now();
  for (const [id, ts] of rateLimits) {
    if (now - ts > 60000) rateLimits.delete(id);
  }
}
setInterval(cleanupStaleRateLimits, 60000);

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('createRoom', ({ roomId, playerName, smallBlind, bigBlind }, callback) => {
    if (!checkRateLimit(socket.id)) {
      return callback({ success: false, error: 'Too fast, slow down' });
    }

    const name = sanitizeName(playerName);
    const rId = sanitizeRoomId(roomId);
    const sb = validatePositiveInt(smallBlind, MIN_BLIND, MAX_BLIND) || 5;
    const bb = validatePositiveInt(bigBlind, MIN_BLIND, MAX_BLIND) || 10;

    if (!rId || !name) {
      return callback({ success: false, error: 'Room ID and player name required' });
    }
    if (games.has(rId)) {
      return callback({ success: false, error: 'Room already exists' });
    }

    const game = new Game(rId, sb, bb);
    games.set(rId, game);

    game.addPlayer(socket.id, name);
    playerSessions.set(socket.id, { roomId: rId, playerId: socket.id, playerName: name });

    const token = generateToken();
    reconnectTokens.set(token, { roomId: rId, playerName: name, originalSocketId: socket.id });

    socket.join(rId);
    callback({ success: true, gameState: game.getPublicState(), token });
    io.to(rId).emit('gameUpdate', game.getPublicState());
    io.to(rId).emit('chatMessage', {
      from: 'System',
      message: `${name} created the room`
    });
  });

  socket.on('joinRoom', ({ roomId, playerName }, callback) => {
    if (!checkRateLimit(socket.id)) {
      return callback({ success: false, error: 'Too fast, slow down' });
    }

    const name = sanitizeName(playerName);
    const rId = sanitizeRoomId(roomId);

    if (!rId || !name) {
      return callback({ success: false, error: 'Room ID and player name required' });
    }

    const game = games.get(rId);
    if (!game) {
      return callback({ success: false, error: 'Room not found' });
    }

    if (game.phase !== 'WAITING') {
      return callback({ success: false, error: 'Game already in progress' });
    }

    if (game.players.length >= 10) {
      return callback({ success: false, error: 'Room is full (max 10 players)' });
    }

    const added = game.addPlayer(socket.id, name);
    if (!added) {
      return callback({ success: false, error: 'Could not join room' });
    }

    playerSessions.set(socket.id, { roomId: rId, playerId: socket.id, playerName: name });

    const token = generateToken();
    reconnectTokens.set(token, { roomId: rId, playerName: name, originalSocketId: socket.id });

    socket.join(rId);
    callback({ success: true, gameState: game.getPublicState(), token });
    socket.emit('yourCards', game.getPrivateState(socket.id));
    io.to(rId).emit('gameUpdate', game.getPublicState());
    io.to(rId).emit('chatMessage', {
      from: 'System',
      message: `${name} joined the room`
    });
  });

  socket.on('rejoin', ({ token }, callback) => {
    if (!token || !reconnectTokens.has(token)) {
      return callback({ success: false, error: 'Invalid or expired session' });
    }

    const session = reconnectTokens.get(token);
    const game = games.get(session.roomId);
    if (!game) {
      reconnectTokens.delete(token);
      return callback({ success: false, error: 'Room no longer exists' });
    }

    const reclaimed = game.reclaimPlayer(session.originalSocketId, socket.id);
    if (!reclaimed) {
      reconnectTokens.delete(token);
      return callback({ success: false, error: 'Could not rejoin. The seat may have been taken.' });
    }

    reconnectTokens.delete(token);
    const newToken = generateToken();
    reconnectTokens.set(newToken, {
      roomId: session.roomId,
      playerName: session.playerName,
      originalSocketId: socket.id
    });
    playerSessions.set(socket.id, {
      roomId: session.roomId,
      playerId: socket.id,
      playerName: session.playerName
    });

    socket.join(session.roomId);
    callback({ success: true, gameState: game.getPublicState(), token: newToken });

    io.to(session.roomId).emit('gameUpdate', game.getPublicState());
    io.to(session.roomId).emit('chatMessage', {
      from: 'System',
      message: `${session.playerName} reconnected`
    });
    socket.emit('yourCards', game.getPrivateState(socket.id));
  });

  socket.on('startGame', (_, callback) => {
    if (!checkRateLimit(socket.id)) {
      return callback?.({ success: false, error: 'Too fast' });
    }

    const session = playerSessions.get(socket.id);
    if (!session) return callback?.({ success: false, error: 'Not in a room' });

    const game = games.get(session.roomId);
    if (!game) return callback?.({ success: false, error: 'Game not found' });

    if (socket.id !== game.getHostId()) {
      return callback?.({ success: false, error: 'Only the room host can start the game' });
    }

    const started = game.startHand();
    if (!started) {
      return callback?.({ success: false, error: 'Need at least 2 active players' });
    }

    broadcastGameState(game);
    callback?.({ success: true });
  });

  socket.on('playerAction', ({ action, amount }, callback) => {
    if (!checkRateLimit(socket.id)) {
      return callback?.({ success: false, error: 'Too fast' });
    }

    const session = playerSessions.get(socket.id);
    if (!session) return callback?.({ success: false, error: 'Not in a room' });

    const game = games.get(session.roomId);
    if (!game) return callback?.({ success: false, error: 'Game not found' });

    const validatedAmount = validatePositiveInt(amount, 0, MAX_RAISE) || 0;

    const result = game.processAction(socket.id, action, validatedAmount);
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
        message: `${actionPlayer.name} ${action}${action === 'raise' || action === 'all_in' ? ' ' + validatedAmount : ''}`
      });
    }

    callback?.({ success: true, gameState: game.getPublicState() });
  });

  socket.on('newHand', (_, callback) => {
    if (!checkRateLimit(socket.id)) {
      return callback?.({ success: false, error: 'Too fast' });
    }

    const session = playerSessions.get(socket.id);
    if (!session) return callback?.({ success: false, error: 'Not in a room' });

    const game = games.get(session.roomId);
    if (!game) return callback?.({ success: false, error: 'Game not found' });

    if (socket.id !== game.getHostId()) {
      return callback?.({ success: false, error: 'Only the room host can start a new hand' });
    }

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

    if (game.phase !== 'WAITING' && game.phase !== 'HAND_END') {
      return callback?.({ success: false, error: 'Can only add chips between hands' });
    }

    const player = game.players.find(p => p.id === socket.id);
    if (!player) return callback?.({ success: false, error: 'Player not found' });

    const validatedAmount = validatePositiveInt(amount, 100, 100000) || 1000;
    player.chips += validatedAmount;
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

    const trimmed = (typeof message === 'string' ? message.trim() : '').slice(0, 300);
    if (!trimmed) return;

    io.to(game.roomId).emit('chatMessage', {
      from: player.name,
      message: trimmed
    });
  });

  socket.on('listRooms', (_, callback) => {
    const rooms = [];
    for (const [roomId, game] of games) {
      rooms.push({
        roomId,
        playerCount: game.players.length,
        phase: game.phase,
        smallBlind: game.smallBlind,
        bigBlind: game.bigBlind,
        playerNames: game.players.map(p => p.name)
      });
    }
    callback({ success: true, rooms });
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

    game.markPlayerDisconnected(socket.id);
    playerSessions.delete(socket.id);
    io.to(session.roomId).emit('gameUpdate', game.getPublicState());
    io.to(session.roomId).emit('chatMessage', {
      from: 'System',
      message: `${session.playerName} disconnected`
    });

    setTimeout(() => {
      const p = game.players.find(pl => pl.disconnected && pl.id === socket.id);
      if (p && p.disconnected) {
        game.removePlayer(socket.id);
        if (game.players.length === 0) {
          games.delete(session.roomId);
        } else {
          io.to(session.roomId).emit('gameUpdate', game.getPublicState());
        }
        for (const [tok, data] of reconnectTokens) {
          if (data.roomId === session.roomId && data.originalSocketId === socket.id) {
            reconnectTokens.delete(tok);
          }
        }
      }
    }, DISCONNECT_TIMEOUT_MS);
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
