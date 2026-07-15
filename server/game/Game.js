const { Deck } = require('./Deck');
const Player = require('./Player');
const { determineWinners, HAND_NAMES, evaluateHand } = require('./handEvaluator');

const BETTING_PHASES = ['PRE_FLOP', 'FLOP', 'TURN', 'RIVER'];

class Game {
  constructor(roomId, smallBlind = 5, bigBlind = 10) {
    this.roomId = roomId;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.players = [];
    this.deck = new Deck();
    this.phase = 'WAITING';
    this.communityCards = [];
    this.pot = 0;
    this.pots = [];
    this.dealerIndex = -1;
    this.currentBet = 0;
    this.minRaise = bigBlind;
    this.actionOrder = [];
    this.actionIndex = 0;
    this.handNumber = 0;
    this.smallBlindIndex = -1;
    this.bigBlindIndex = -1;
    this.lastActions = [];
    this.winningPlayers = [];
    this.winningHandName = '';
    this.hasActed = new Set();
    this.hostId = null;
  }

  addPlayer(id, name) {
    if (this.players.find(p => p.id === id)) return false;
    const player = new Player(id, name);
    player.seatIndex = this.players.length;
    this.players.push(player);
    if (this.hostId === null) {
      this.hostId = id;
    }
    if (this.phase === 'WAITING' && this.players.length >= 2) {
      this.dealerIndex = 0;
    }
    return true;
  }

  removePlayer(id) {
    const idx = this.players.findIndex(p => p.id === id);
    if (idx === -1) return false;
    if (this.players.length <= 1 && this.phase !== 'WAITING') {
      this.phase = 'WAITING';
    }
    this.players.splice(idx, 1);
    this.players.forEach((p, i) => { p.seatIndex = i; });
    if (this.dealerIndex >= this.players.length) {
      this.dealerIndex = 0;
    }
    if (this.hostId === id) {
      this.hostId = this.players.length > 0 ? this.players[0].id : null;
    }
    return true;
  }

  getHostId() {
    return this.hostId;
  }

  findDisconnectedPlayer(name) {
    return this.players.find(p => p.disconnected && p.name === name);
  }

  reclaimPlayer(oldId, newId) {
    const player = this.players.find(p => p.id === oldId);
    if (!player) return false;
    player.id = newId;
    player.disconnected = false;
    return true;
  }

  markPlayerDisconnected(id) {
    const player = this.players.find(p => p.id === id);
    if (!player) return;
    player.disconnected = true;

    if (BETTING_PHASES.includes(this.phase)) {
      const currentPlayer = this.getCurrentPlayer();
      if (currentPlayer && currentPlayer.id === id && !player.folded && !player.isAllIn) {
        this.processAction(id, 'fold');
      }
    }
  }

  canStart() {
    const activePlayers = this.players.filter(p => p.isActive);
    return this.phase === 'WAITING' && activePlayers.length >= 2;
  }

  startHand() {
    if (!this.canStart()) return false;

    this.handNumber++;
    this.phase = 'DEALING';
    this.communityCards = [];
    this.pot = 0;
    this.pots = [];
    this.currentBet = 0;
    this.lastActions = [];
    this.winningPlayers = [];
    this.winningHandName = '';
    this.hasActed = new Set();

    this.deck.reset();
    this.deck.shuffle();

    this.players.forEach(p => p.resetForNewHand());

    const activePlayers = this.players.filter(p => p.isActive);
    if (activePlayers.length < 2) {
      this.phase = 'WAITING';
      return false;
    }

    this.dealerIndex = this.dealerIndex % this.players.length;
    this.smallBlindIndex = this.getNextActiveIndex(this.dealerIndex);
    this.bigBlindIndex = this.getNextActiveIndex(this.smallBlindIndex);

    this.actionOrder = this.buildActionOrder();

    this.postBlinds();
    this.dealHoleCards();

    this.phase = 'PRE_FLOP';
    this.minRaise = this.bigBlind;
    this.currentBet = this.bigBlind;

    const sbPlayer = this.players[this.smallBlindIndex];
    if (sbPlayer && !sbPlayer.isAllIn) {
      this.hasActed.add(sbPlayer.id);
    }

    const utgIndex = this.getNextActiveIndex(this.bigBlindIndex);
    this.actionIndex = this.actionOrder.findIndex(p => p.id === this.players[utgIndex]?.id);
    if (this.actionIndex === -1) this.actionIndex = 0;

    return true;
  }

  getNextActiveIndex(fromIndex) {
    const count = this.players.length;
    for (let i = 1; i <= count; i++) {
      const idx = (fromIndex + i) % count;
      if (this.players[idx] && this.players[idx].isActive) {
        return idx;
      }
    }
    return fromIndex;
  }

  buildActionOrder() {
    const order = [];
    for (let i = 0; i < this.players.length; i++) {
      const idx = (this.dealerIndex + 1 + i) % this.players.length;
      if (this.players[idx].isActive) {
        order.push(this.players[idx]);
      }
    }
    return order;
  }

  postBlinds() {
    const sbPlayer = this.players[this.smallBlindIndex];
    const bbPlayer = this.players[this.bigBlindIndex];

    if (sbPlayer) {
      const sbAmount = Math.min(this.smallBlind, sbPlayer.chips);
      sbPlayer.bet(sbAmount);
      this.lastActions.push({ playerId: sbPlayer.id, action: 'small_blind', amount: sbAmount });
    }
    if (bbPlayer) {
      const bbAmount = Math.min(this.bigBlind, bbPlayer.chips);
      bbPlayer.bet(bbAmount);
      this.lastActions.push({ playerId: bbPlayer.id, action: 'big_blind', amount: bbAmount });
    }
  }

  dealHoleCards() {
    for (let i = 0; i < 2; i++) {
      for (const player of this.actionOrder) {
        if (player.isActive) {
          player.cards.push(...this.deck.deal(1));
        }
      }
    }
  }

  dealCommunityCards(count) {
    this.deck.deal(1);
    this.communityCards.push(...this.deck.deal(count));
  }

  getCurrentPlayer() {
    if (this.actionOrder.length === 0) return null;
    return this.actionOrder[this.actionIndex];
  }

  processAction(playerId, action, amount = 0) {
    if (!BETTING_PHASES.includes(this.phase)) {
      return { success: false, error: 'Cannot act during ' + this.phase };
    }

    const player = this.players.find(p => p.id === playerId);
    if (!player) return { success: false, error: 'Player not found' };
    if (player.folded || player.isAllIn) return { success: false, error: 'Cannot act' };

    const currentPlayer = this.getCurrentPlayer();
    if (!currentPlayer) return { success: false, error: 'No active player' };
    if (currentPlayer.id !== playerId) return { success: false, error: 'Not your turn' };

    this.lastActions = [];

    switch (action) {
      case 'fold':
        return this.handleFold(player);
      case 'check':
        return this.handleCheck(player);
      case 'call':
        return this.handleCall(player);
      case 'raise':
        return this.handleRaise(player, amount);
      case 'all_in':
        return this.handleAllIn(player);
      default:
        return { success: false, error: 'Invalid action' };
    }
  }

  handleFold(player) {
    player.folded = true;
    player.lastAction = 'fold';
    this.hasActed.add(player.id);
    this.lastActions.push({ playerId: player.id, action: 'fold', amount: 0 });

    const activeNonFolded = this.actionOrder.filter(p => !p.folded && p.isActive);
    if (activeNonFolded.length <= 1) {
      return this.endHand();
    }

    this.advanceAction();
    return { success: true };
  }

  handleCheck(player) {
    if (this.currentBet > player.currentBet) {
      return { success: false, error: 'Cannot check, must call or raise' };
    }
    player.lastAction = 'check';
    this.hasActed.add(player.id);
    this.lastActions.push({ playerId: player.id, action: 'check', amount: 0 });
    this.advanceAction();
    return { success: true };
  }

  handleCall(player) {
    const callAmount = this.currentBet - player.currentBet;
    this.hasActed.add(player.id);

    if (callAmount <= 0) {
      player.lastAction = 'check';
      this.lastActions.push({ playerId: player.id, action: 'check', amount: 0 });
      this.advanceAction();
      return { success: true };
    }

    const actual = player.bet(callAmount);
    player.lastAction = 'call';
    this.lastActions.push({ playerId: player.id, action: 'call', amount: actual });
    this.advanceAction();
    return { success: true };
  }

  handleRaise(player, amount) {
    const minTotalBet = this.currentBet + this.minRaise;
    if (amount < minTotalBet && amount < player.chips + player.currentBet) {
      return { success: false, error: `Minimum raise is ${minTotalBet - player.currentBet}` };
    }

    const raiseAmount = amount - player.currentBet;
    const actual = player.bet(raiseAmount);
    const isFullRaise = actual >= this.minRaise;

    this.currentBet = player.currentBet;
    this.hasActed.clear();
    this.hasActed.add(player.id);

    if (isFullRaise) {
      this.lastRaiseIndex = this.actionIndex;
    }

    player.lastAction = isFullRaise ? 'raise' : 'all_in';
    this.lastActions.push({ playerId: player.id, action: player.lastAction, amount: actual });

    this.advanceAction();
    return { success: true };
  }

  handleAllIn(player) {
    const callAmount = this.currentBet - player.currentBet;
    const allInAmount = player.chips;

    if (allInAmount > callAmount) {
      const actual = player.bet(allInAmount);
      const isFullRaise = actual > callAmount && actual >= this.minRaise;

      if (player.currentBet > this.currentBet) {
        this.currentBet = player.currentBet;
      }

      this.hasActed.clear();
      this.hasActed.add(player.id);

      if (isFullRaise) {
        this.lastRaiseIndex = this.actionIndex;
      }

      player.lastAction = 'all_in';
      this.lastActions.push({ playerId: player.id, action: 'all_in', amount: actual });
    } else {
      const actual = player.bet(callAmount);
      this.hasActed.add(player.id);
      player.lastAction = 'call';
      this.lastActions.push({ playerId: player.id, action: 'call', amount: actual });
    }

    this.advanceAction();
    return { success: true };
  }

  advanceAction() {
    const activePlayers = this.actionOrder.filter(p => !p.folded && !p.isAllIn);

    if (activePlayers.length <= 1) {
      this.completeBettingRound();
      return;
    }

    let nextIndex = this.actionIndex;
    for (let i = 0; i < this.actionOrder.length; i++) {
      nextIndex = (nextIndex + 1) % this.actionOrder.length;
      const nextPlayer = this.actionOrder[nextIndex];
      if (!nextPlayer.folded && !nextPlayer.isAllIn) {
        break;
      }
    }

    this.actionIndex = nextIndex;

    if (this.isBettingRoundComplete()) {
      this.completeBettingRound();
    }
  }

  isBettingRoundComplete() {
    const activePlayersNotAllIn = this.actionOrder.filter(p => !p.folded && !p.isAllIn);
    if (activePlayersNotAllIn.length === 0) return true;

    const allHaveActed = activePlayersNotAllIn.every(p => this.hasActed.has(p.id));
    if (!allHaveActed) return false;

    const allEqualBet = activePlayersNotAllIn.every(p => p.currentBet === this.currentBet);
    return allEqualBet;
  }

  completeBettingRound() {
    const activeNonAllIn = this.actionOrder.filter(p => !p.folded && !p.isAllIn);

    if (activeNonAllIn.length <= 1) {
      while (this.phase !== 'RIVER' && this.phase !== 'SHOWDOWN' && this.phase !== 'HAND_END') {
        this.fastForwardStreet();
      }
      if (this.phase !== 'SHOWDOWN' && this.phase !== 'HAND_END') {
        this.endHand();
      }
      return;
    }

    switch (this.phase) {
      case 'PRE_FLOP':
        this.dealCommunityCards(3);
        this.phase = 'FLOP';
        this.startNewBettingRound();
        break;
      case 'FLOP':
        this.dealCommunityCards(1);
        this.phase = 'TURN';
        this.startNewBettingRound();
        break;
      case 'TURN':
        this.dealCommunityCards(1);
        this.phase = 'RIVER';
        this.startNewBettingRound();
        break;
      case 'RIVER':
        this.endHand();
        break;
    }
  }

  fastForwardStreet() {
    switch (this.phase) {
      case 'PRE_FLOP':
        this.dealCommunityCards(3);
        this.phase = 'FLOP';
        break;
      case 'FLOP':
        this.dealCommunityCards(1);
        this.phase = 'TURN';
        break;
      case 'TURN':
        this.dealCommunityCards(1);
        this.phase = 'RIVER';
        break;
      case 'RIVER':
        this.endHand();
        break;
    }
  }

  startNewBettingRound() {
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.hasActed = new Set();

    this.actionOrder.forEach(p => {
      p.currentBet = 0;
      p.lastAction = null;
    });

    const firstPlayer = this.actionOrder.find(p => !p.folded && !p.isAllIn);
    if (firstPlayer) {
      this.actionIndex = this.actionOrder.indexOf(firstPlayer);
    } else {
      this.actionIndex = 0;
    }

    const activeNonAllIn = this.actionOrder.filter(p => !p.folded && !p.isAllIn);
    if (activeNonAllIn.length <= 0) {
      this.endHand();
    }
  }

  endHand() {
    this.phase = 'SHOWDOWN';
    this.calculatePots();
    this.distributePots();
  }

  calculatePots() {
    this.pots = [];
    this.pot = 0;

    const nonFolded = this.players.filter(p => !p.folded);
    if (nonFolded.length === 0) return;

    const allPlayers = this.players;
    const contributionLevels = new Set();
    for (const p of allPlayers) {
      contributionLevels.add(p.totalBetThisRound);
    }
    const sortedLevels = [...contributionLevels].sort((a, b) => a - b);

    let previousLevel = 0;
    for (const level of sortedLevels) {
      if (level === 0) {
        previousLevel = 0;
        continue;
      }
      const playersAtLevel = allPlayers.filter(p => p.totalBetThisRound >= level);
      const eligiblePlayers = playersAtLevel.filter(p => !p.folded);
      const increment = (level - previousLevel) * playersAtLevel.length;
      if (increment > 0 && eligiblePlayers.length > 0) {
        this.pots.push({
          amount: increment,
          eligible: eligiblePlayers.map(p => p.id)
        });
        this.pot += increment;
      }
      previousLevel = level;
    }
  }

  distributePots() {
    const nonFolded = this.players.filter(p => !p.folded);
    if (nonFolded.length === 0) {
      this.phase = 'HAND_END';
      return;
    }

    for (const pot of this.pots) {
      const eligiblePlayers = this.players.filter(p => pot.eligible.includes(p.id) && !p.folded);
      if (eligiblePlayers.length === 0) continue;

      let winners;
      if (this.communityCards.length >= 3) {
        winners = determineWinners(eligiblePlayers, this.communityCards);
      } else {
        winners = [eligiblePlayers[0]];
      }

      const share = Math.floor(pot.amount / winners.length);
      const remainder = pot.amount - share * winners.length;

      for (let i = 0; i < winners.length; i++) {
        winners[i].chips += share + (i === 0 ? remainder : 0);
      }

      this.winningPlayers = winners;
      if (winners.length > 0 && this.communityCards.length >= 3) {
        const bestHand = evaluateHand(winners[0].cards, this.communityCards);
        if (bestHand) {
          this.winningHandName = HAND_NAMES[bestHand.rank] || 'Unknown';
        }
      }
    }

    this.phase = 'HAND_END';
  }

  resetAndStartNewHand() {
    this.phase = 'WAITING';
    this.communityCards = [];
    this.pot = 0;
    this.pots = [];
    this.currentBet = 0;
    this.lastActions = [];
    this.winningPlayers = [];
    this.winningHandName = '';
    this.hasActed = new Set();

    this.players.forEach(p => {
      p.cards = [];
      p.currentBet = 0;
      p.totalBetThisRound = 0;
      p.folded = false;
      p.isAllIn = false;
      p.lastAction = null;
      p.disconnected = false;
      if (p.chips > 0) p.isActive = true;
    });

    this.dealerIndex = (this.dealerIndex + 1) % this.players.length;

    const activePlayers = this.players.filter(p => p.isActive);
    if (activePlayers.length >= 2) {
      this.startHand();
    }
  }

  getPublicState() {
    return {
      roomId: this.roomId,
      phase: this.phase,
      pot: this.pot,
      communityCards: this.communityCards,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      dealerIndex: this.dealerIndex,
      smallBlindIndex: this.smallBlindIndex,
      bigBlindIndex: this.bigBlindIndex,
      handNumber: this.handNumber,
      lastActions: this.lastActions,
      winningPlayers: this.winningPlayers.map(p => p.id),
      winningHandName: this.winningHandName,
      currentPlayerId: this.getCurrentPlayer()?.id || null,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        chips: p.chips,
        currentBet: p.currentBet,
        folded: p.folded,
        isAllIn: p.isAllIn,
        isActive: p.isActive,
        seatIndex: p.seatIndex,
        lastAction: p.lastAction,
        cardCount: p.isActive ? p.cards.length : 0,
        disconnected: p.disconnected || false
      }))
    };
  }

  getPrivateState(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return { cards: [] };
    return {
      cards: player.folded ? [] : player.cards
    };
  }
}

module.exports = Game;
