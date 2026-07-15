const { RANK_VALUE } = require('./Deck');

const HAND_RANK = {
  HIGH_CARD: 1,
  ONE_PAIR: 2,
  TWO_PAIR: 3,
  THREE_OF_A_KIND: 4,
  STRAIGHT: 5,
  FLUSH: 6,
  FULL_HOUSE: 7,
  FOUR_OF_A_KIND: 8,
  STRAIGHT_FLUSH: 9
};

const HAND_NAMES = {
  1: 'High Card',
  2: 'One Pair',
  3: 'Two Pair',
  4: 'Three of a Kind',
  5: 'Straight',
  6: 'Flush',
  7: 'Full House',
  8: 'Four of a Kind',
  9: 'Straight Flush'
};

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const result = [];
  const first = arr[0];
  const rest = arr.slice(1);
  for (const combo of combinations(rest, k - 1)) {
    result.push([first, ...combo]);
  }
  for (const combo of combinations(rest, k)) {
    result.push(combo);
  }
  return result;
}

function evaluateFiveCards(cards) {
  const sorted = [...cards].sort((a, b) => b.value - a.value);
  const values = sorted.map(c => c.value);
  const suits = sorted.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);

  const uniqueValues = [...new Set(values)];
  const isStraightNormal =
    uniqueValues.length === 5 && values[0] - values[4] === 4;

  const isWheel =
    uniqueValues.length === 5 &&
    values[0] === 14 && values[1] === 5 && values[2] === 4 &&
    values[3] === 3 && values[4] === 2;

  const isStraight = isStraightNormal || isWheel;
  const straightHigh = isWheel ? 5 : values[0];

  if (isFlush && isStraight) {
    return { rank: HAND_RANK.STRAIGHT_FLUSH, value: straightHigh, kickers: [] };
  }

  const freq = {};
  for (const v of values) {
    freq[v] = (freq[v] || 0) + 1;
  }
  const groups = Object.entries(freq)
    .map(([val, count]) => ({ val: parseInt(val), count }))
    .sort((a, b) => b.count - a.count || b.val - a.val);

  const groupValues = groups.map(g => g.val);
  const groupCounts = groups.map(g => g.count);

  if (groupCounts[0] === 4) {
    return {
      rank: HAND_RANK.FOUR_OF_A_KIND,
      value: groupValues[0],
      kickers: [groupValues[1]]
    };
  }

  if (groupCounts[0] === 3 && groupCounts[1] === 2) {
    return {
      rank: HAND_RANK.FULL_HOUSE,
      value: groupValues[0],
      kickers: [groupValues[1]]
    };
  }

  if (isFlush) {
    return { rank: HAND_RANK.FLUSH, value: values[0], kickers: values.slice(1) };
  }

  if (isStraight) {
    return { rank: HAND_RANK.STRAIGHT, value: straightHigh, kickers: [] };
  }

  if (groupCounts[0] === 3) {
    return {
      rank: HAND_RANK.THREE_OF_A_KIND,
      value: groupValues[0],
      kickers: groupValues.slice(1)
    };
  }

  if (groupCounts[0] === 2 && groupCounts[1] === 2) {
    return {
      rank: HAND_RANK.TWO_PAIR,
      value: Math.max(groupValues[0], groupValues[1]),
      kickers: [Math.min(groupValues[0], groupValues[1]), groupValues[2]]
    };
  }

  if (groupCounts[0] === 2) {
    return {
      rank: HAND_RANK.ONE_PAIR,
      value: groupValues[0],
      kickers: groupValues.slice(1)
    };
  }

  return { rank: HAND_RANK.HIGH_CARD, value: values[0], kickers: values.slice(1) };
}

function evaluateHand(holeCards, communityCards) {
  const allCards = [...holeCards, ...communityCards];
  if (allCards.length < 5) return null;

  const combos = combinations(allCards, 5);
  let best = null;

  for (const combo of combos) {
    const result = evaluateFiveCards(combo);
    if (!best || compareHands(result, best) > 0) {
      best = { ...result, cards: combo };
    }
  }

  return best;
}

function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.value !== b.value) return a.value - b.value;
  const maxKickers = Math.max(a.kickers.length, b.kickers.length);
  for (let i = 0; i < maxKickers; i++) {
    const ka = a.kickers[i] || 0;
    const kb = b.kickers[i] || 0;
    if (ka !== kb) return ka - kb;
  }
  return 0;
}

function determineWinners(players, communityCards) {
  const activePlayers = players.filter(p => !p.folded && p.isActive);
  if (activePlayers.length === 0) {
    const livePlayers = players.filter(p => !p.folded);
    return [livePlayers.length > 0 ? livePlayers : players];
  }

  if (activePlayers.length === 1) {
    return [activePlayers];
  }

  const evaluations = activePlayers.map(p => ({
    player: p,
    hand: evaluateHand(p.cards, communityCards)
  }));

  evaluations.sort((a, b) => compareHands(b.hand, a.hand));

  const winners = [evaluations[0].player];
  for (let i = 1; i < evaluations.length; i++) {
    if (compareHands(evaluations[i].hand, evaluations[0].hand) === 0) {
      winners.push(evaluations[i].player);
    }
  }

  return winners;
}

module.exports = { evaluateHand, evaluateFiveCards, compareHands, determineWinners, HAND_RANK, HAND_NAMES, combinations };
