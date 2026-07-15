class Player {
  constructor(id, name, chips = 1000) {
    this.id = id;
    this.name = name;
    this.chips = chips;
    this.cards = [];
    this.currentBet = 0;
    this.totalBetThisRound = 0;
    this.folded = false;
    this.isAllIn = false;
    this.isActive = true;
    this.seatIndex = -1;
    this.lastAction = null;
  }

  resetForNewHand() {
    this.cards = [];
    this.currentBet = 0;
    this.totalBetThisRound = 0;
    this.folded = false;
    this.isAllIn = false;
    this.lastAction = null;
    if (this.chips <= 0) {
      this.isActive = false;
    } else {
      this.isActive = true;
    }
  }

  bet(amount) {
    const actual = Math.min(amount, this.chips);
    this.chips -= actual;
    this.currentBet += actual;
    this.totalBetThisRound += actual;
    if (this.chips === 0) {
      this.isAllIn = true;
    }
    return actual;
  }

  getBetDelta() {
    return this.currentBet;
  }

  getState() {
    return {
      id: this.id,
      name: this.name,
      chips: this.chips,
      currentBet: this.currentBet,
      folded: this.folded,
      isAllIn: this.isAllIn,
      isActive: this.isActive,
      seatIndex: this.seatIndex,
      lastAction: this.lastAction,
      cards: this.folded ? [] : this.cards.map(c => null)
    };
  }

  getPrivateState() {
    return {
      cards: this.cards
    };
  }
}

module.exports = Player;
