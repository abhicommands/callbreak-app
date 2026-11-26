const SUITS = ["S", "H", "C", "D"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const DECK = SUITS.flatMap((suit) => RANKS.map((rank) => suit + rank));

export const nextSeat = (seat) => (seat + 1) % 4;
export const seatPosition = (seat, viewer) => ["south", "east", "north", "west"][(seat - viewer + 4) % 4];

export function randomIndex(size) {
  const sample = new Uint32Array(1);
  const limit = 2 ** 32 - (2 ** 32 % size);
  do crypto.getRandomValues(sample); while (sample[0] >= limit);
  return sample[0] % size;
}

export function shuffled(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = randomIndex(index + 1);
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

export function dealHands() {
  const cards = shuffled(DECK);
  return Array.from({ length: 4 }, (_, seat) =>
    cards.slice(seat * 13, (seat + 1) * 13).sort((a, b) => DECK.indexOf(a) - DECK.indexOf(b)));
}

function strength(card, lead) {
  const rank = RANKS.indexOf(card.slice(1));
  if (card[0] === "S") return rank + 13;
  return card[0] === lead ? rank : -1;
}

export function winningPlay(trick) {
  const lead = trick[0].card[0];
  return trick.reduce((winner, play) =>
    strength(play.card, lead) > strength(winner.card, lead) ? play : winner);
}

export function legalCards(hand, trick) {
  if (!trick.length) return hand;
  const lead = trick[0].card[0];
  const winner = strength(winningPlay(trick).card, lead);
  const following = hand.filter((card) => card[0] === lead);
  const candidates = following.length ? following : hand;
  const winning = candidates.filter((card) => strength(card, lead) > winner);
  return winning.length ? winning : candidates;
}
