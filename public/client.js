let socket = null;
let myPlayerId = null;
let gameState = null;
let myCards = [];

const SUIT_SYMBOLS = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠'
};

const SUIT_COLORS = {
  hearts: '#e74c3c',
  diamonds: '#e74c3c',
  clubs: '#2c3e50',
  spades: '#2c3e50'
};

const PHASE_LABELS = {
  WAITING: 'Waiting for players...',
  PRE_FLOP: 'Pre-Flop',
  FLOP: 'Flop',
  TURN: 'Turn',
  RIVER: 'River',
  SHOWDOWN: 'Showdown',
  HAND_END: 'Hand Over'
};

const lobby = document.getElementById('lobby');
const gameDiv = document.getElementById('game');
const serverUrlInput = document.getElementById('serverUrlInput');
const roomIdInput = document.getElementById('roomIdInput');
const playerNameInput = document.getElementById('playerNameInput');
const smallBlindInput = document.getElementById('smallBlindInput');
const bigBlindInput = document.getElementById('bigBlindInput');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const lobbyError = document.getElementById('lobbyError');
const connectionStatus = document.getElementById('connectionStatus');
const startGameBtn = document.getElementById('startGameBtn');
const newHandBtn = document.getElementById('newHandBtn');
const addChipsBtn = document.getElementById('addChipsBtn');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');

serverUrlInput.value = window.location.origin || 'http://localhost:3001';

function setStatus(text, isError) {
  connectionStatus.textContent = text;
  connectionStatus.className = 'status-text' + (isError ? ' error' : '');
}

function connectToServer(serverUrl) {
  return new Promise((resolve, reject) => {
    if (socket && socket.connected) {
      resolve(socket);
      return;
    }

    if (socket) {
      socket.disconnect();
      socket = null;
    }

    setStatus('Connecting to ' + serverUrl + '...', false);

    try {
      socket = io(serverUrl, {
        transports: ['websocket', 'polling'],
        timeout: 8000
      });
    } catch (e) {
      setStatus('Invalid server URL', true);
      reject(new Error('Invalid server URL'));
      return;
    }

    socket.on('connect', () => {
      setStatus('Connected', false);
      setupSocketListeners();
      resolve(socket);
    });

    socket.on('connect_error', (err) => {
      setStatus('Connection failed: ' + err.message, true);
      reject(err);
    });

    socket.on('disconnect', () => {
      setStatus('Disconnected. Trying to reconnect...', true);
    });
  });
}

function setupSocketListeners() {
  socket.on('yourCards', (data) => {
    if (data && data.cards) {
      myCards = data.cards;
      renderMyCards();
    }
  });

  socket.on('gameUpdate', (state) => {
    updateGameState(state);
  });

  socket.on('chatMessage', (data) => {
    const messagesDiv = document.getElementById('chat-messages');
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message';
    msgEl.innerHTML = `<strong>${escapeHtml(data.from)}:</strong> ${escapeHtml(data.message)}`;
    messagesDiv.appendChild(msgEl);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });
}

createRoomBtn.addEventListener('click', async () => {
  const serverUrl = serverUrlInput.value.trim();
  const roomId = roomIdInput.value.trim();
  const playerName = playerNameInput.value.trim();
  if (!serverUrl || !roomId || !playerName) {
    lobbyError.textContent = 'Please fill all fields';
    return;
  }
  lobbyError.textContent = '';

  try {
    await connectToServer(serverUrl);
  } catch {
    return;
  }

  socket.emit('createRoom', {
    roomId,
    playerName,
    smallBlind: parseInt(smallBlindInput.value) || 5,
    bigBlind: parseInt(bigBlindInput.value) || 10
  }, (response) => {
    if (!response.success) {
      lobbyError.textContent = response.error;
    } else {
      enterGame(roomId, response.gameState);
    }
  });
});

joinRoomBtn.addEventListener('click', async () => {
  const serverUrl = serverUrlInput.value.trim();
  const roomId = roomIdInput.value.trim();
  const playerName = playerNameInput.value.trim();
  if (!serverUrl || !roomId || !playerName) {
    lobbyError.textContent = 'Please fill all fields';
    return;
  }
  lobbyError.textContent = '';

  try {
    await connectToServer(serverUrl);
  } catch {
    return;
  }

  socket.emit('joinRoom', { roomId, playerName }, (response) => {
    if (!response.success) {
      lobbyError.textContent = response.error;
    } else {
      enterGame(roomId, response.gameState);
    }
  });
});

startGameBtn.addEventListener('click', () => {
  socket.emit('startGame', {}, (response) => {
    if (response && !response.success) {
      alert(response.error);
    }
  });
});

newHandBtn.addEventListener('click', () => {
  socket.emit('newHand', {}, (response) => {
    if (response && !response.success) {
      alert(response.error);
    }
  });
});

addChipsBtn.addEventListener('click', () => {
  socket.emit('addChips', { amount: 1000 });
});

leaveRoomBtn.addEventListener('click', () => {
  location.reload();
});

const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');

sendChatBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

function sendChat() {
  const message = chatInput.value.trim();
  if (!message) return;
  socket.emit('chatMessage', { message });
  chatInput.value = '';
}

const foldBtn = document.getElementById('foldBtn');
const checkBtn = document.getElementById('checkBtn');
const callBtn = document.getElementById('callBtn');
const raiseBtn = document.getElementById('raiseBtn');
const allInBtn = document.getElementById('allInBtn');
const raiseSlider = document.getElementById('raiseSlider');
const raiseInput = document.getElementById('raiseInput');

foldBtn.addEventListener('click', () => socket.emit('playerAction', { action: 'fold' }));
checkBtn.addEventListener('click', () => socket.emit('playerAction', { action: 'check' }));
callBtn.addEventListener('click', () => socket.emit('playerAction', { action: 'call' }));
allInBtn.addEventListener('click', () => socket.emit('playerAction', { action: 'all_in' }));

raiseBtn.addEventListener('click', () => {
  const amount = parseInt(raiseInput.value) || 0;
  if (amount <= 0) return;
  socket.emit('playerAction', { action: 'raise', amount });
});

raiseSlider.addEventListener('input', () => {
  raiseInput.value = raiseSlider.value;
});

raiseInput.addEventListener('input', () => {
  raiseSlider.value = raiseInput.value;
});

document.getElementById('winner-close-btn').addEventListener('click', () => {
  document.getElementById('winner-overlay').classList.add('hidden');
});

function enterGame(roomId, state) {
  myPlayerId = socket.id;
  lobby.classList.add('hidden');
  gameDiv.classList.remove('hidden');
  document.getElementById('roomIdDisplay').textContent = roomId;
  updateGameState(state);
}

function updateGameState(state) {
  if (!state) return;
  gameState = state;
  renderGame();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderGame() {
  if (!gameState) return;

  document.getElementById('handNumber').textContent = gameState.handNumber;
  document.getElementById('phase-display').textContent = PHASE_LABELS[gameState.phase] || gameState.phase;
  document.getElementById('blindsDisplay').textContent = `SB: ${gameState.currentBet > 0 ? gameState.currentBet : ''}`;
  document.getElementById('potAmount').textContent = gameState.pot;

  renderCommunityCards();
  renderPlayers();
  renderMyArea();
  renderActions();
  renderControls();
  updateRaiseSlider();

  if (gameState.phase === 'SHOWDOWN' || gameState.phase === 'HAND_END') {
    showWinnerOverlay();
  }
}

function renderCommunityCards() {
  for (let i = 0; i < 5; i++) {
    const cardEl = document.querySelector(`.community-card[data-index="${i}"]`);
    if (gameState.communityCards[i]) {
      const card = gameState.communityCards[i];
      cardEl.className = `community-card card ${SUIT_COLORS[card.suit] === '#e74c3c' ? 'red' : 'black'}`;
      cardEl.innerHTML = `<span class="card-rank">${card.rank}</span><span class="card-suit">${SUIT_SYMBOLS[card.suit]}</span>`;
    } else {
      cardEl.className = 'community-card card empty';
      cardEl.innerHTML = '';
    }
  }
}

function renderPlayers() {
  const container = document.getElementById('players-container');
  container.innerHTML = '';

  const otherPlayers = gameState.players.filter(p => p.id !== myPlayerId);

  otherPlayers.forEach((p) => {
    const playerEl = document.createElement('div');
    playerEl.className = 'player-slot';
    playerEl.id = `player-${p.id}`;

    const isActive = gameState.currentPlayerId === p.id;
    if (isActive) playerEl.classList.add('active-turn');

    let statusBadge = '';
    if (p.folded) statusBadge = '<span class="badge folded">FOLDED</span>';
    else if (p.isAllIn) statusBadge = '<span class="badge allin">ALL IN</span>';

    const dealerBadge = p.seatIndex === gameState.dealerIndex ? '<span class="badge dealer">D</span>' : '';
    const sbBadge = p.seatIndex === gameState.smallBlindIndex ? '<span class="badge blind">SB</span>' : '';
    const bbBadge = p.seatIndex === gameState.bigBlindIndex ? '<span class="badge blind">BB</span>' : '';

    playerEl.innerHTML = `
      <div class="player-name">${dealerBadge}${sbBadge}${bbBadge} ${escapeHtml(p.name)}</div>
      <div class="player-chips">${p.chips} chips</div>
      ${p.currentBet > 0 ? `<div class="player-bet">Bet: ${p.currentBet}</div>` : ''}
      ${statusBadge}
      <div class="player-cards-back">
        <div class="mini-card back"></div>
        <div class="mini-card back"></div>
      </div>
    `;
    container.appendChild(playerEl);
  });
}

function renderMyCards() {
  for (let i = 0; i < 2; i++) {
    const cardEl = document.querySelector(`.hole-card[data-index="${i}"]`);
    if (myCards[i]) {
      const card = myCards[i];
      cardEl.className = `hole-card card ${SUIT_COLORS[card.suit] === '#e74c3c' ? 'red' : 'black'}`;
      cardEl.innerHTML = `<span class="card-rank">${card.rank}</span><span class="card-suit">${SUIT_SYMBOLS[card.suit]}</span>`;
    } else {
      cardEl.className = 'hole-card card empty';
      cardEl.innerHTML = '';
    }
  }
}

function renderMyArea() {
  const me = gameState.players.find(p => p.id === myPlayerId);
  if (!me) return;

  document.getElementById('my-name').textContent = me.name;
  document.getElementById('my-chips').textContent = `${me.chips} chips`;
  document.getElementById('my-bet').textContent = me.currentBet > 0 ? `Bet: ${me.currentBet}` : '';
}

function renderActions() {
  const me = gameState.players.find(p => p.id === myPlayerId);
  const isMyTurn = gameState.currentPlayerId === myPlayerId;
  const canAct = isMyTurn && !me?.folded && !me?.isAllIn &&
    ['PRE_FLOP', 'FLOP', 'TURN', 'RIVER'].includes(gameState.phase);

  document.getElementById('actions').style.display = canAct ? 'flex' : 'none';

  if (!canAct) return;

  const callAmount = (me ? gameState.currentBet - me.currentBet : 0);

  foldBtn.style.display = 'inline-block';
  allInBtn.style.display = 'inline-block';

  if (callAmount <= 0) {
    checkBtn.style.display = 'inline-block';
    callBtn.style.display = 'none';
  } else {
    checkBtn.style.display = 'none';
    callBtn.style.display = 'inline-block';
    callBtn.textContent = callAmount < me?.chips ? `Call ${callAmount}` : `All In ${me?.chips}`;
  }

  const maxRaise = me ? me.chips : 0;
  raiseSlider.max = maxRaise;
  raiseInput.max = maxRaise;

  if (maxRaise <= 0) {
    raiseBtn.style.display = 'none';
    raiseSlider.style.display = 'none';
    raiseInput.style.display = 'none';
  } else {
    raiseBtn.style.display = 'inline-block';
    raiseSlider.style.display = 'inline-block';
    raiseInput.style.display = 'inline-block';
  }
}

function updateRaiseSlider() {
  const me = gameState.players.find(p => p.id === myPlayerId);
  if (!me) return;

  const callAmount = Math.max(0, gameState.currentBet - me.currentBet);
  const minRaise = gameState.minRaise || 10;
  const maxRaise = me.chips;

  raiseSlider.min = Math.min(callAmount + minRaise, maxRaise);
  raiseSlider.max = maxRaise;
  raiseSlider.value = Math.min(callAmount + minRaise, maxRaise);
  raiseInput.min = raiseSlider.min;
  raiseInput.max = maxRaise;
  raiseInput.value = raiseSlider.value;
}

function renderControls() {
  const me = gameState.players.find(p => p.id === myPlayerId);
  const isHost = gameState.players.length > 0 && gameState.players[0].id === myPlayerId;

  if (gameState.phase === 'WAITING') {
    startGameBtn.style.display = isHost ? 'inline-block' : 'none';
    newHandBtn.style.display = 'none';
  } else if (gameState.phase === 'HAND_END') {
    startGameBtn.style.display = 'none';
    newHandBtn.style.display = isHost ? 'inline-block' : 'none';
  } else {
    startGameBtn.style.display = 'none';
    newHandBtn.style.display = 'none';
  }
}

function showWinnerOverlay() {
  const overlay = document.getElementById('winner-overlay');
  const text = document.getElementById('winner-text');

  const winnerIds = gameState.winningPlayers || [];
  const winners = gameState.players.filter(p => winnerIds.includes(p.id));
  const winnerNames = winners.map(p => p.name).join(', ');

  if (winnerNames) {
    text.innerHTML = `
      <div class="winner-title">${winnerNames} wins!</div>
      <div class="winner-hand">${gameState.winningHandName || ''}</div>
      <div class="winner-pot">Pot: ${gameState.pot} chips</div>
    `;
    overlay.classList.remove('hidden');
  }
}
