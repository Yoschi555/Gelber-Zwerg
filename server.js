const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const rooms = new Map();
const roomSubscribers = new Map();

const CHIP_VALUES = { bronze: 1, silver: 2, gold: 5 };
const START_CHIPS = { bronze: 15, silver: 10, gold: 5 };
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 6;
const STANDARD_ELIMINATION_THRESHOLD = 7;
const DEAL_COUNTS = { 3: 15, 4: 12, 5: 9, 6: 8 };
const MODES = ['standard', 'abschiebe', 'chaos'];
const RANKS = [
  { value: 1, label: 'A' }, { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' },
  { value: 5, label: '5' }, { value: 6, label: '6' }, { value: 7, label: '7' }, { value: 8, label: '8' },
  { value: 9, label: '9' }, { value: 10, label: '10' }, { value: 11, label: 'B' }, { value: 12, label: 'D' }, { value: 13, label: 'K' }
];
const SUITS = {
  green: { label: 'Grün' },
  red: { label: 'Rot' },
  flame: { label: 'Flammen' },
  pokeball: { label: 'Pokéball' }
};
const POT_DEFS = {
  greenK: { label: 'Grün König', suit: 'green', rank: 13, required: { bronze: 0, silver: 2, gold: 0 } },
  flameD: { label: 'Flammen Dame', suit: 'flame', rank: 12, required: { bronze: 3, silver: 0, gold: 0 } },
  red10: { label: 'Rot 10', suit: 'red', rank: 10, required: { bronze: 1, silver: 0, gold: 0 } },
  pokeballB: { label: 'Pokéball Bube', suit: 'pokeball', rank: 11, required: { bronze: 0, silver: 1, gold: 0 } },
  red7: { label: 'Rot 7', suit: 'red', rank: 7, required: { bronze: 0, silver: 0, gold: 1 } }
};

const ABILITIES = {
  tauschen: {
    name: 'Tauschen', kind: 'active', maxUses: 1,
    description: 'Einmal pro Runde, direkt zu Beginn: Tausche 2 gewählte Handkarten gegen 2 zufällige Karten aus dem Reststapel.'
  },
  fallensteller: {
    name: 'Fallensteller', kind: 'setup', maxUses: 1,
    description: 'Wähle zu Rundenbeginn geheim einen Rang. Löst ein anderer Spieler ihn zuerst aus, raubst du 2 Silber (Wert 4). Löst du ihn selbst aus, zahlst du jedem anderen Spieler 1 Silber.'
  },
  springer: {
    name: 'Springer', kind: 'active', maxUses: 1,
    description: 'Einmal pro Runde darfst du genau einen benötigten Rang überspringen. Kosten: Wert 5, als je 1 Bronze in jeden Pot. Die Lücke wird erst ganz am Ende geschlossen.'
  },
  kehrtwende: {
    name: 'Kehrtwende', kind: 'active', maxUses: 1,
    description: 'Einmal pro Runde drehst du die Richtung der aktuellen Reihe um. Kosten: 1 Silber (Wert 2) in einen zufälligen Pot.'
  },
  spaeher: {
    name: 'Späher', kind: 'active', maxUses: 1,
    description: 'Einmal pro Runde siehst nur du 2 zufällige Handkarten jedes anderen Spielers und zusätzlich 4 zufällige Karten aus dem Reststapel.'
  },
  nachtreter: {
    name: 'Nachtreter', kind: 'reactive', maxUses: 2,
    description: 'Bis zu zweimal pro Runde fragt dich das Spiel nach dem Zug deines direkten Nachfolgers, ob du noch genau 1 passende Karte nachlegen willst.'
  },
  dieb: {
    name: 'Dieb', kind: 'passive', maxUses: 1,
    description: 'Einmal pro Runde, wenn du einen Spezial-Pot abräumst, raubst du zusätzlich 3 Bronze (Wert 3) vom aktuell chipreichsten anderen Spieler.'
  },
  blockierer: {
    name: 'Blockierer', kind: 'active', maxUses: 1,
    description: 'Einmal pro Runde blockierst du einen Rang. Er bleibt gesperrt, bis du wieder regulär am Zug bist. Liegen alle übrigen 12 Ränge, gilt die Reihe trotzdem als beendet.'
  },
  schmuggler: {
    name: 'Schmuggler', kind: 'active', maxUses: 1,
    description: 'Einmal pro Runde, wenn du sonst skippen müsstest, tauschst du 1 Handkarte gegen 1 zufällige Restkarte. Dein Zug endet danach trotzdem.'
  },
  draengler: {
    name: 'Drängler', kind: 'active', maxUses: 1,
    description: 'Einmal pro Runde kannst du deinen Zug so beenden, dass der direkt nächste aktive Spieler übersprungen wird. Danach läuft die Reihenfolge normal weiter.'
  },
  gluecksritter: {
    name: 'Glücksritter', kind: 'setup', maxUses: 1,
    description: 'Wähle zu Rundenbeginn geheim einen Pot. Räumst du genau diesen Pot selbst ab, erhältst du zusätzlich Wert 3 aus der Bank.'
  },
  halsabschneider: {
    name: 'Halsabschneider', kind: 'setup', maxUses: 1,
    description: 'Wähle zu Rundenbeginn einen Pot. Wird er abgeräumt, erhält der Gewinner nur die Hälfte seines Werts, immer abgerundet. Der Rest bleibt liegen.'
  },
  multiplikator: {
    name: 'Multiplikator', kind: 'passive', maxUses: 1,
    description: 'Einmal pro Runde belohnt dich eine lange Kartenserie: 3 Karten = 1 Bronze, 4 = 2, 5 = 3, 6 = 4, 7 = 5, ab 8 = 6 Bronze.'
  },
  zocker: {
    name: 'Zocker', kind: 'active', maxUses: 2,
    description: 'Bis zu zweimal pro Runde setzt du Wert 2 auf eine Kartenfamilie. Eine zufällige Restkarte wird geprüft. Treffer: Wert 5 aus der Bank; daneben: Einsatz weg.'
  },
  faelscher: {
    name: 'Fälscher', kind: 'active', maxUses: 1,
    description: 'Einmal pro Runde spielst du 1 Handkarte als direkt benachbarten Rang (+1 oder −1, zyklisch). Gefälschte Karten lösen keine Spezial-Pots aus.'
  },
  leichtgewicht: {
    name: 'Leichtgewicht', kind: 'passive', maxUses: 1,
    description: 'Du startest jede Runde mit 1 Handkarte weniger. Dafür zahlst du zu Rundenbeginn 1 Bronze in einen zufälligen Pot.'
  }
};
const ABILITY_IDS = Object.keys(ABILITIES);

function emptyChips() { return { bronze: 0, silver: 0, gold: 0 }; }
function cloneChips(c) { return { bronze: c.bronze, silver: c.silver, gold: c.gold }; }
function chipValue(c) { return c.bronze + c.silver * 2 + c.gold * 5; }
function rankLabel(value) { return RANKS.find(r => r.value === value)?.label || String(value); }
function cardName(card) { return `${SUITS[card.suit].label} ${rankLabel(card.rank)}`; }
function playedRank(card) { return card?.playedRank || card?.rank || null; }
function cardImage(suit, rank) {
  const key = rank === 1 ? 'A' : rank === 11 ? 'B' : rank === 12 ? 'D' : rank === 13 ? 'K' : String(rank);
  return `assets/cards/${suit}-${key}.webp`;
}
function buildDeck() {
  const deck = [];
  for (const suit of Object.keys(SUITS)) {
    for (const rank of RANKS) deck.push({ id: `${suit}-${rank.value}`, suit, rank: rank.value, image: cardImage(suit, rank.value) });
  }
  return deck;
}
function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function randomChoice(array) { return array[Math.floor(Math.random() * array.length)]; }
function chipsForValue(value) {
  const gold = Math.floor(value / 5);
  value -= gold * 5;
  const silver = Math.floor(value / 2);
  const bronze = value - silver * 2;
  return { bronze, silver, gold };
}
function requirementsMet(req, paid) { return ['bronze','silver','gold'].every(t => paid[t] >= req[t]); }
function remainingRequirement(req, paid) {
  return {
    bronze: Math.max(0, req.bronze - paid.bronze),
    silver: Math.max(0, req.silver - paid.silver),
    gold: Math.max(0, req.gold - paid.gold)
  };
}
function multiplyRequirement(req, factor = 1) {
  return { bronze: req.bronze * factor, silver: req.silver * factor, gold: req.gold * factor };
}
function emptyPenaltyMap(players) {
  return Object.fromEntries(players.map(p => [p.id, Object.fromEntries(Object.keys(POT_DEFS).map(potId => [potId, false]))]));
}
function makeAnteRequirements(players, penaltyMap = {}) {
  const requirements = {};
  for (const p of players) {
    requirements[p.id] = {};
    for (const [potId, def] of Object.entries(POT_DEFS)) {
      const factor = penaltyMap?.[p.id]?.[potId] ? 2 : 1;
      requirements[p.id][potId] = multiplyRequirement(def.required, factor);
    }
  }
  return requirements;
}
function personalRequirement(room, playerId, potId) { return room.anteRequirements?.[playerId]?.[potId] || POT_DEFS[potId].required; }
function sortHand(hand) {
  const order = { green: 0, red: 1, flame: 2, pokeball: 3 };
  hand.sort((a,b) => a.rank - b.rank || order[a.suit] - order[b.suit]);
}
function randomId() { return crypto.randomBytes(12).toString('hex'); }
function roomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}
function makeAntePaid(players) {
  const paid = {};
  for (const p of players) {
    paid[p.id] = {};
    for (const potId of Object.keys(POT_DEFS)) paid[p.id][potId] = emptyChips();
  }
  return paid;
}
function createRoom(hostName) {
  const id = randomId();
  const code = roomCode();
  const room = {
    code,
    hostId: id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    round: 1,
    phase: 'lobby',
    gameMode: 'standard',
    endgameStartRound: null,
    players: [{ id, name: hostName, chips: cloneChips(START_CHIPS), eliminated: false, abilityId: null }],
    pots: Object.fromEntries(Object.keys(POT_DEFS).map(potId => [potId, { chips: emptyChips() }])),
    antePaid: {},
    anteRequirements: {},
    anteConfirmed: {},
    anteResolution: {},
    nextAntePenalties: {},
    hands: {},
    leftovers: [],
    activePlayerIndex: 0,
    currentRow: Array(13).fill(null),
    rowOrder: [],
    rowDirection: null,
    rowCursorRank: null,
    rowHistory: [],
    newRowMode: true,
    springerGapRank: null,
    lastPlayedBy: null,
    consecutiveSkips: 0,
    blockedRank: null,
    blockedBy: null,
    pendingReaction: null,
    abilityRound: {},
    playerRoundActions: {},
    turnPlayCounts: {},
    log: [],
    winnerId: null,
    roundSummary: null,
    gameSummary: null
  };
  rooms.set(code, room);
  addLog(room, `${hostName} hat den Raum erstellt.`, 'special');
  return { room, playerId: id };
}
function addLog(room, text, type = '') {
  room.log.push({ text, type, time: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) });
  if (room.log.length > 150) room.log.shift();
  room.updatedAt = Date.now();
}
function findPlayer(room, playerId) { return room.players.find(p => p.id === playerId); }
function requirePlayer(room, playerId) {
  const p = findPlayer(room, playerId);
  if (!p) throw new Error('Spieler nicht im Raum gefunden.');
  return p;
}
function activePlayers(room) { return room.players.filter(p => !p.eliminated); }
function activePlayerCount(room) { return activePlayers(room).length; }
function nextActivePlayerIndex(room, fromIndex, steps = 1) {
  if (!room.players.length) return -1;
  let idx = fromIndex;
  for (let wanted = 0; wanted < steps; wanted++) {
    let found = -1;
    for (let step = 1; step <= room.players.length; step++) {
      const candidate = (idx + step) % room.players.length;
      if (!room.players[candidate].eliminated) { found = candidate; break; }
    }
    if (found < 0) return -1;
    idx = found;
  }
  return idx;
}
function previousActivePlayerIndex(room, fromIndex) {
  if (!room.players.length) return -1;
  for (let step = 1; step <= room.players.length; step++) {
    const idx = (fromIndex - step + room.players.length) % room.players.length;
    if (!room.players[idx].eliminated) return idx;
  }
  return -1;
}
function ensureActiveHost(room) {
  const host = room.players.find(p => p.id === room.hostId);
  if (host && !host.eliminated) return;
  const nextHost = activePlayers(room)[0];
  if (nextHost) {
    room.hostId = nextHost.id;
    addLog(room, `${nextHost.name} ist jetzt Host, weil der bisherige Host ausgeschieden ist.`, 'special');
  }
}
function personalAnteValue(room, playerId) {
  return Object.keys(POT_DEFS).reduce((sum, potId) => sum + chipValue(personalRequirement(room, playerId, potId)), 0);
}
function distributeAllChipsRandomly(room, player) {
  const potIds = Object.keys(POT_DEFS);
  const distributed = Object.fromEntries(potIds.map(potId => [potId, emptyChips()]));
  for (const type of ['bronze','silver','gold']) {
    const count = player.chips[type];
    for (let i = 0; i < count; i++) {
      const potId = randomChoice(potIds);
      room.pots[potId].chips[type] += 1;
      distributed[potId][type] += 1;
      if (room.antePaid[player.id]?.[potId]) room.antePaid[player.id][potId][type] += 1;
    }
    player.chips[type] = 0;
  }
  return distributed;
}
function transferValue(from, to, requested) {
  const available = chipValue(from.chips);
  const paid = Math.min(requested, available);
  from.chips = chipsForValue(available - paid);
  const gain = chipsForValue(paid);
  for (const t of ['bronze','silver','gold']) to.chips[t] += gain[t];
  return paid;
}
function takeValue(player, requested) {
  const available = chipValue(player.chips);
  const paid = Math.min(requested, available);
  player.chips = chipsForValue(available - paid);
  return paid;
}
function addValue(player, value) {
  const gain = chipsForValue(value);
  for (const t of ['bronze','silver','gold']) player.chips[t] += gain[t];
}
function modeUsesEndgame(room) { return room.gameMode === 'abschiebe' || room.gameMode === 'chaos'; }
function endgameStage(room) {
  if (!modeUsesEndgame(room) || room.endgameStartRound == null) return 0;
  return Math.max(1, Math.min(4, 1 + Math.floor((room.round - room.endgameStartRound) / 3)));
}
function cardPenaltyMultiplier(room) {
  const stage = endgameStage(room);
  return stage ? Math.min(5, stage + 1) : 1;
}
function eliminationThreshold(room) {
  const stage = endgameStage(room);
  return stage ? Math.min(15, 7 + stage * 2) : STANDARD_ELIMINATION_THRESHOLD;
}
function activateEndgameIfNeeded(room) {
  if (!modeUsesEndgame(room) || room.endgameStartRound != null) return;
  room.endgameStartRound = room.round;
  addLog(room, `🔥 Endgame aktiviert: Restkarten-Strafe ×2. Ab der nächsten Einzahlphase braucht man mindestens Chipwert 9, um eine Not-Einzahlung zu überleben.`, 'special');
}
function finishGame(room) {
  const remaining = activePlayers(room);
  const standings = remaining.map(p => ({
    playerId: p.id,
    name: p.name,
    value: chipValue(p.chips),
    chips: cloneChips(p.chips)
  })).sort((a,b) => b.value - a.value || a.name.localeCompare(b.name, 'de'));
  const best = standings[0]?.value ?? 0;
  const winners = standings.filter(s => s.value === best);
  room.phase = 'gameOver';
  room.winnerId = winners.length === 1 ? winners[0].playerId : null;
  room.gameSummary = {
    standings,
    winnerName: winners.length === 1 ? winners[0].name : null,
    tied: winners.length > 1,
    tiedNames: winners.map(w => w.name)
  };
  room.hands = {};
  room.leftovers = [];
  resetRow(room);
  room.pendingReaction = null;
  if (winners.length === 1) addLog(room, `🏆 ${winners[0].name} gewinnt die Partie mit Chipwert ${best}.`, 'special');
  else addLog(room, `🤝 Die Partie endet unentschieden bei Chipwert ${best}.`, 'special');
}
function resolveAnteShortfalls(room) {
  room.anteResolution = {};
  const thresholdThisAnte = eliminationThreshold(room);
  let anyoneEliminated = false;
  for (const player of activePlayers(room)) {
    const startingValue = chipValue(player.chips);
    const requiredValue = personalAnteValue(room, player.id);
    if (startingValue >= requiredValue) continue;

    const distributed = distributeAllChipsRandomly(room, player);
    const eliminated = startingValue < thresholdThisAnte;
    room.anteConfirmed[player.id] = true;
    room.anteResolution[player.id] = {
      automatic: true,
      startingValue,
      requiredValue,
      threshold: thresholdThisAnte,
      eliminated,
      distributed
    };
    if (eliminated) {
      player.eliminated = true;
      anyoneEliminated = true;
      addLog(room, `${player.name} konnte nur Chipwert ${startingValue} einzahlen. Die restlichen Chips wurden zufällig verteilt; unter ${thresholdThisAnte} scheidet ${player.name} aus.`, 'bad');
    } else {
      addLog(room, `${player.name} kann den vollen Einsatz nicht zahlen, verteilt deshalb alle Chips im Wert ${startingValue} zufällig auf die Pots und bleibt im Spiel.`, 'special');
    }
  }

  if (anyoneEliminated) activateEndgameIfNeeded(room);
  ensureActiveHost(room);
  if (activePlayerCount(room) <= 2) {
    finishGame(room);
    return;
  }
  if (activePlayers(room).every(p => room.anteConfirmed[p.id])) dealRound(room);
}
function beginAntePhase(room) {
  room.phase = 'ante';
  room.antePaid = makeAntePaid(room.players);
  room.anteRequirements = makeAnteRequirements(room.players, room.nextAntePenalties);
  room.anteConfirmed = Object.fromEntries(room.players.map(p => [p.id, !!p.eliminated]));
  room.anteResolution = {};
  room.nextAntePenalties = emptyPenaltyMap(room.players);
  resolveAnteShortfalls(room);
}
function playerAnteComplete(room, playerId) {
  return Object.keys(POT_DEFS).every(potId => requirementsMet(personalRequirement(room, playerId, potId), room.antePaid[playerId][potId]));
}
function totalPot(room) { return Object.values(room.pots).reduce((sum, pot) => sum + chipValue(pot.chips), 0); }
function wrapRank(value) { return ((value - 1 + 13) % 13) + 1; }
function resetRow(room) {
  room.currentRow = Array(13).fill(null);
  room.rowOrder = [];
  room.rowDirection = null;
  room.rowCursorRank = null;
  room.newRowMode = true;
  room.springerGapRank = null;
  room.lastPlayedBy = null;
  room.consecutiveSkips = 0;
}
function rankBlocked(room, rank) { return room.blockedRank === rank; }
function baseLegalRanks(room) {
  if (room.newRowMode || !room.rowOrder?.length) return RANKS.map(r => r.value);
  const startRank = playedRank(room.rowOrder[0]);
  if (room.rowOrder.length === 1 || room.rowDirection === null) return [wrapRank(startRank - 1), wrapRank(startRank + 1)];
  if (room.springerGapRank && room.currentRow.filter(Boolean).length === 12 && !room.currentRow[room.springerGapRank - 1]) return [room.springerGapRank];
  return [wrapRank(room.rowCursorRank + room.rowDirection)];
}
function legalRanks(room, { ignoreBlock = false } = {}) {
  const seen = new Set();
  return baseLegalRanks(room).filter(rank => {
    if (seen.has(rank)) return false;
    seen.add(rank);
    if (!ignoreBlock && rankBlocked(room, rank)) return false;
    return !room.currentRow[rank - 1];
  });
}
function isPlayable(room, card, asRank = card.rank) {
  return legalRanks(room).includes(asRank);
}
function rowIsComplete(room) {
  const count = room.currentRow.filter(Boolean).length;
  if (count >= 13) return true;
  if (room.blockedRank && count === 12 && !room.currentRow[room.blockedRank - 1]) return true;
  return false;
}
function archiveRow(room, reason) {
  if (room.rowOrder?.length) room.rowHistory.push({ cards: [...room.rowOrder], direction: room.rowDirection, reason });
}
function clearBlockIfOwnerTurn(room, idx) {
  if (idx < 0 || !room.blockedBy) return;
  const p = room.players[idx];
  if (p?.id === room.blockedBy) {
    addLog(room, `🔓 Die Blockade auf ${rankLabel(room.blockedRank)} ist aufgehoben, weil ${p.name} wieder regulär am Zug ist.`, 'special');
    room.blockedRank = null;
    room.blockedBy = null;
  }
}
function setRegularTurn(room, idx) {
  if (idx < 0) return;
  room.activePlayerIndex = idx;
  room.turnPlayCounts[room.players[idx].id] = 0;
  clearBlockIfOwnerTurn(room, idx);
}
function advanceTurn(room, steps = 1) {
  const next = nextActivePlayerIndex(room, room.activePlayerIndex, steps);
  if (next >= 0) setRegularTurn(room, next);
}
function abilityState(room, playerId) {
  if (!room.abilityRound[playerId]) room.abilityRound[playerId] = { uses: 0 };
  return room.abilityRound[playerId];
}
function assignChaosAbilities(room) {
  const pool = shuffle(ABILITY_IDS);
  activePlayers(room).forEach((p, i) => { p.abilityId = pool[i % pool.length]; });
  const assignments = activePlayers(room).map(p => `${p.name}: ${ABILITIES[p.abilityId].name}`).join(' · ');
  addLog(room, `🎲 Chaos-Fähigkeiten wurden ausgelost. ${assignments}`, 'special');
}
function resetAbilityRound(room) {
  room.abilityRound = {};
  room.playerRoundActions = {};
  room.turnPlayCounts = {};
  room.blockedRank = null;
  room.blockedBy = null;
  room.pendingReaction = null;
  for (const p of room.players) {
    room.abilityRound[p.id] = { uses: 0, selectedRank: null, selectedPot: null, triggered: false, info: null, armed: false, lightweightApplied: false };
    room.playerRoundActions[p.id] = { acted: false };
    room.turnPlayCounts[p.id] = 0;
  }
}
function atOwnTurn(room, playerId) {
  return room.phase === 'playing' && !room.pendingReaction && room.players[room.activePlayerIndex]?.id === playerId;
}
function requireTurn(room, playerId) {
  if (room.pendingReaction) throw new Error('Gerade wartet das Spiel auf eine Reaktion.');
  const active = room.players[room.activePlayerIndex];
  if (!active || active.id !== playerId) throw new Error('Du bist gerade nicht am Zug.');
  return active;
}
function hasNormalPlayableCard(room, playerId) {
  const hand = room.hands[playerId] || [];
  const legal = new Set(legalRanks(room));
  return hand.some(c => legal.has(c.rank));
}
function applyLightweight(room, player) {
  if (player.abilityId !== 'leichtgewicht') return;
  const state = abilityState(room, player.id);
  if (chipValue(player.chips) < 1 || !room.hands[player.id]?.length) {
    addLog(room, `🪶 ${player.name} kann Leichtgewicht diese Runde nicht bezahlen und startet normal.`, 'special');
    return;
  }
  takeValue(player, 1);
  const potId = randomChoice(Object.keys(POT_DEFS));
  room.pots[potId].chips.bronze += 1;
  const hand = room.hands[player.id];
  const idx = Math.floor(Math.random() * hand.length);
  const [removed] = hand.splice(idx, 1);
  room.leftovers.push(removed);
  shuffleInPlace(room.leftovers);
  state.uses = 1;
  state.lightweightApplied = true;
  state.selectedPot = potId;
  addLog(room, `🪶 ${player.name} startet durch Leichtgewicht mit einer Karte weniger und zahlt 1 Bronze in ${POT_DEFS[potId].label}.`, 'special');
}
function shuffleInPlace(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function dealRound(room) {
  const participants = activePlayers(room);
  const count = DEAL_COUNTS[participants.length];
  if (!count) throw new Error(`Für ${participants.length} aktive Spieler ist keine Kartenverteilung definiert.`);
  const deck = shuffle(buildDeck());
  room.hands = Object.fromEntries(room.players.map(p => [p.id, []]));
  let cursor = 0;
  for (let r = 0; r < count; r++) for (const p of participants) room.hands[p.id].push(deck[cursor++]);
  room.leftovers = deck.slice(cursor);
  resetAbilityRound(room);
  for (const p of participants) applyLightweight(room, p);
  for (const p of participants) sortHand(room.hands[p.id]);
  const opener = randomChoice(participants);
  room.activePlayerIndex = room.players.findIndex(p => p.id === opener.id);
  resetRow(room);
  room.activePlayerIndex = room.players.findIndex(p => p.id === opener.id);
  room.turnPlayCounts[opener.id] = 0;
  room.phase = 'playing';
  room.winnerId = null;
  room.roundSummary = null;
  room.gameSummary = null;
  addLog(room, `${count} Karten pro aktivem Spieler ausgeteilt${room.gameMode === 'chaos' ? ' (Leichtgewicht ggf. eine weniger)' : ''}. ${room.leftovers.length} Karten bleiben verdeckt.`, 'special');
  addLog(room, `${opener.name} eröffnet die erste Reihe.`, 'special');
}
function makePlayedCard(card, asRank = card.rank, flags = {}) {
  return { ...card, playedRank: asRank, forged: !!flags.forged, springer: !!flags.springer, reaction: !!flags.reaction };
}
function triggerFallensteller(room, entry, actor) {
  if (room.gameMode !== 'chaos') return;
  const rank = playedRank(entry);
  for (const trapper of activePlayers(room)) {
    if (trapper.abilityId !== 'fallensteller') continue;
    const state = abilityState(room, trapper.id);
    if (!state.selectedRank || state.triggered || state.selectedRank !== rank) continue;
    state.triggered = true;
    if (trapper.id === actor.id) {
      const others = activePlayers(room).filter(p => p.id !== trapper.id);
      let totalPaid = 0;
      for (const other of others) totalPaid += transferValue(trapper, other, 2);
      addLog(room, `🪤 ${trapper.name} löst die eigene Falle auf ${rankLabel(rank)} aus und zahlt insgesamt Wert ${totalPaid} an die anderen.`, 'bad');
    } else {
      const paid = transferValue(actor, trapper, 4);
      addLog(room, `🪤 ${actor.name} löst ${trapper.name}s Falle auf ${rankLabel(rank)} aus. ${trapper.name} raubt Wert ${paid}.`, 'special');
    }
    break;
  }
}
function richestOther(room, playerId) {
  const others = activePlayers(room).filter(p => p.id !== playerId);
  if (!others.length) return null;
  const max = Math.max(...others.map(p => chipValue(p.chips)));
  return randomChoice(others.filter(p => chipValue(p.chips) === max));
}
function applyDieb(room, player) {
  if (room.gameMode !== 'chaos' || player.abilityId !== 'dieb') return;
  const state = abilityState(room, player.id);
  if (state.uses >= 1) return;
  const victim = richestOther(room, player.id);
  if (!victim) return;
  const paid = Math.min(3, chipValue(victim.chips));
  if (paid <= 0) return;
  victim.chips = chipsForValue(chipValue(victim.chips) - paid);
  player.chips.bronze += paid;
  state.uses = 1;
  addLog(room, `🦹 ${player.name} nutzt Dieb und raubt ${paid} Bronze-Wert von ${victim.name}.`, 'special');
}
function applyGluecksritter(room, player, potId) {
  if (room.gameMode !== 'chaos' || player.abilityId !== 'gluecksritter') return;
  const state = abilityState(room, player.id);
  if (state.selectedPot !== potId || state.triggered) return;
  state.triggered = true;
  player.chips.bronze += 3;
  addLog(room, `🍀 ${player.name} trifft als Glücksritter den gewählten Pot und erhält 3 Bronze aus der Bank.`, 'special');
}
function payoutSpecial(room, entry, player) {
  if (entry.forged) return;
  const found = Object.entries(POT_DEFS).find(([,def]) => def.suit === entry.suit && def.rank === entry.rank);
  if (!found) return;
  const [potId, def] = found;
  const pot = room.pots[potId].chips;
  const value = chipValue(pot);
  if (value <= 0) {
    addLog(room, `${def.label} wurde gespielt, aber der Pot war leer.`);
    return;
  }

  let paidValue = value;
  const cutter = activePlayers(room).find(p => p.abilityId === 'halsabschneider' && abilityState(room, p.id).selectedPot === potId);
  if (room.gameMode === 'chaos' && cutter) {
    paidValue = Math.floor(value / 2);
    const remainingValue = value - paidValue;
    addValue(player, paidValue);
    room.pots[potId].chips = chipsForValue(remainingValue);
    addLog(room, `🔪 Halsabschneider wirkt auf ${def.label}: ${player.name} erhält nur Wert ${paidValue}; Wert ${remainingValue} bleibt im Pot.`, 'special');
  } else {
    for (const type of ['bronze','silver','gold']) player.chips[type] += pot[type];
    room.pots[potId].chips = emptyChips();
    addLog(room, `💰 ${player.name} spielt ${def.label} und erhält Pot-Wert ${value}.`, 'special');
  }
  applyGluecksritter(room, player, potId);
  applyDieb(room, player);
}
function maybeAwardMultiplier(room, playerId) {
  const player = findPlayer(room, playerId);
  if (!player || player.abilityId !== 'multiplikator' || room.gameMode !== 'chaos') return 0;
  const state = abilityState(room, playerId);
  if (state.uses >= 1) return 0;
  const cards = room.turnPlayCounts[playerId] || 0;
  if (cards < 3) return 0;
  const reward = Math.min(6, cards - 2);
  player.chips.bronze += reward;
  state.uses = 1;
  state.info = { combo: cards, reward };
  addLog(room, `✖️ ${player.name} legt ${cards} Karten am Stück und erhält durch Multiplikator ${reward} Bronze.`, 'special');
  return reward;
}
function markPlayerActed(room, playerId) {
  if (!room.playerRoundActions[playerId]) room.playerRoundActions[playerId] = { acted: false };
  room.playerRoundActions[playerId].acted = true;
}
function placeCard(room, player, handIndex, asRank, flags = {}) {
  const hand = room.hands[player.id] || [];
  const card = hand[handIndex];
  if (!card) throw new Error('Karte nicht auf deiner Hand gefunden.');
  if (!flags.springer && !isPlayable(room, card, asRank)) throw new Error('Diese Karte passt gerade nicht.');
  const entry = makePlayedCard(card, asRank, flags);
  hand.splice(handIndex, 1);

  if (room.newRowMode) {
    resetRow(room);
    room.newRowMode = false;
    room.currentRow[asRank - 1] = entry;
    room.rowOrder.push(entry);
    room.rowCursorRank = asRank;
    addLog(room, `${player.name} startet eine neue Reihe mit ${entry.forged ? `${cardName(card)} als ${rankLabel(asRank)}` : cardName(card)}.`, 'good');
  } else {
    if (room.rowOrder.length === 1 && room.rowDirection === null) {
      const first = playedRank(room.rowOrder[0]);
      room.rowDirection = asRank === wrapRank(first + 1) ? 1 : -1;
      room.rowCursorRank = asRank;
      addLog(room, `${player.name} legt ${entry.forged ? `${cardName(card)} als ${rankLabel(asRank)}` : cardName(card)} – Richtung ${room.rowDirection === 1 ? 'aufwärts' : 'abwärts'} ist festgelegt.`, 'good');
    } else {
      room.rowCursorRank = asRank;
      addLog(room, `${player.name} legt ${entry.forged ? `${cardName(card)} als ${rankLabel(asRank)}` : cardName(card)}${entry.springer ? ' per Springer' : ''}${entry.reaction ? ' als Nachtreter' : ''}.`, 'good');
    }
    room.currentRow[asRank - 1] = entry;
    room.rowOrder.push(entry);
  }

  room.lastPlayedBy = player.id;
  room.consecutiveSkips = 0;
  if (!flags.reaction) room.turnPlayCounts[player.id] = (room.turnPlayCounts[player.id] || 0) + 1;
  markPlayerActed(room, player.id);
  triggerFallensteller(room, entry, player);
  payoutSpecial(room, entry, player);
  return { entry, handEmpty: hand.length === 0, rowComplete: rowIsComplete(room) };
}
function completeRowForPlayer(room, player, reason) {
  archiveRow(room, reason);
  const blockedStill = room.blockedRank;
  room.currentRow = Array(13).fill(null);
  room.rowOrder = [];
  room.rowDirection = null;
  room.rowCursorRank = null;
  room.newRowMode = true;
  room.springerGapRank = null;
  room.lastPlayedBy = player.id;
  room.consecutiveSkips = 0;
  room.activePlayerIndex = room.players.findIndex(p => p.id === player.id);
  addLog(room, blockedStill ? `Die Reihe gilt trotz blockiertem Rang als vollständig. ${player.name} eröffnet sofort neu.` : `Alle benötigten Ränge sind vollständig! ${player.name} eröffnet sofort eine neue Reihe.`, 'special');
}
function checkNachtreterAfterSkip(room, skipperIndex, resumeSteps = 1) {
  if (room.gameMode !== 'chaos' || room.pendingReaction || room.newRowMode) return false;
  const predecessorIndex = previousActivePlayerIndex(room, skipperIndex);
  if (predecessorIndex < 0) return false;
  const candidate = room.players[predecessorIndex];
  if (!candidate || candidate.abilityId !== 'nachtreter') return false;
  const state = abilityState(room, candidate.id);
  if (state.uses >= 2) return false;
  const legal = new Set(legalRanks(room));
  const playableIds = (room.hands[candidate.id] || []).filter(c => legal.has(c.rank)).map(c => c.id);
  if (!playableIds.length) return false;
  const resumeIndex = nextActivePlayerIndex(room, skipperIndex, resumeSteps);
  room.pendingReaction = { type: 'nachtreter', playerId: candidate.id, afterPlayerId: room.players[skipperIndex].id, resumeIndex, playableIds, skipCountAlreadyAdded: true };
  addLog(room, `⚡ ${candidate.name} könnte mit Nachtreter reagieren.`, 'special');
  return true;
}
function finishSkipTransition(room, skipperIndex, stepCount = 1) {
  if (room.consecutiveSkips >= activePlayerCount(room) && room.lastPlayedBy) {
    archiveRow(room, 'unterbrochen nach kompletter Skip-Runde');
    const lastIndex = room.players.findIndex(p => p.id === room.lastPlayedBy);
    room.currentRow = Array(13).fill(null);
    room.rowOrder = [];
    room.rowDirection = null;
    room.rowCursorRank = null;
    room.newRowMode = true;
    room.springerGapRank = null;
    room.consecutiveSkips = 0;
    const next = nextActivePlayerIndex(room, lastIndex);
    setRegularTurn(room, next);
    const opener = room.players[room.activePlayerIndex];
    const lastPlayer = room.players[lastIndex];
    addLog(room, `Niemand konnte die Reihe fortsetzen. Nach ${lastPlayer.name} eröffnet jetzt ${opener.name} eine neue Reihe.`, 'special');
  } else {
    const next = nextActivePlayerIndex(room, skipperIndex, stepCount);
    setRegularTurn(room, next);
  }
}
function endRound(room, winnerId) {
  maybeAwardMultiplier(room, winnerId);
  const winner = requirePlayer(room, winnerId);
  const summary = [];
  let totalReceived = 0;
  const multiplier = cardPenaltyMultiplier(room);
  for (const p of activePlayers(room)) {
    if (p.id === winnerId) continue;
    const cards = room.hands[p.id].length;
    const owed = cards * multiplier;
    const paid = transferValue(p, winner, owed);
    totalReceived += paid;
    summary.push({ name: p.name, cards, multiplier, owed, paid });
    addLog(room, `${p.name} hat ${cards} Karten übrig und zahlt ${cards} × ${multiplier} = Wert ${paid} an ${winner.name}.`, paid === owed ? 'special' : 'bad');
  }
  const nextPenalties = emptyPenaltyMap(room.players);
  const penaltySummary = [];
  for (const p of activePlayers(room)) {
    const hand = room.hands[p.id] || [];
    for (const [potId, def] of Object.entries(POT_DEFS)) {
      if (hand.some(card => card.suit === def.suit && card.rank === def.rank)) {
        nextPenalties[p.id][potId] = true;
        penaltySummary.push({ playerId: p.id, name: p.name, potId, label: def.label, normal: cloneChips(def.required), next: multiplyRequirement(def.required, 2) });
        addLog(room, `⚠️ ${p.name} hat ${def.label} am Rundenende noch auf der Hand und zahlt dafür nächste Runde doppelt.`, 'bad');
      }
    }
  }
  room.nextAntePenalties = nextPenalties;
  room.phase = 'roundEnd';
  room.winnerId = winnerId;
  room.pendingReaction = null;
  room.roundSummary = { winnerName: winner.name, totalReceived, payments: summary, penalties: penaltySummary, cardPenaltyMultiplier: multiplier };
  addLog(room, `🏆 ${winner.name} gewinnt Runde ${room.round}.`, 'special');
}
function startNextRound(room) {
  room.round += 1;
  room.hands = {};
  room.leftovers = [];
  resetRow(room);
  room.rowHistory = [];
  room.blockedRank = null;
  room.blockedBy = null;
  room.pendingReaction = null;
  room.winnerId = null;
  room.roundSummary = null;
  room.gameSummary = null;
  const endgameText = endgameStage(room) ? ` Endgame: Ausscheidungsgrenze ${eliminationThreshold(room)}, Restkarten ×${cardPenaltyMultiplier(room)}.` : '';
  addLog(room, `Runde ${room.round}: Neue Einzahlphase. Nicht geleerte Pots bleiben bestehen.${endgameText}`, 'special');
  beginAntePhase(room);
}
function abilityPublic(room, player) {
  if (room.gameMode !== 'chaos' || !player.abilityId) return null;
  const def = ABILITIES[player.abilityId];
  const state = abilityState(room, player.id);
  const acted = !!room.playerRoundActions[player.id]?.acted;
  const ownTurn = atOwnTurn(room, player.id);
  const result = {
    id: player.abilityId,
    name: def.name,
    kind: def.kind,
    description: def.description,
    uses: state.uses || 0,
    maxUses: def.maxUses,
    canUse: false,
    reason: '',
    options: {},
    selectedRank: state.selectedRank,
    selectedPot: state.selectedPot,
    triggered: !!state.triggered,
    armed: !!state.armed,
    info: state.info || null
  };
  if (player.eliminated || room.phase !== 'playing') { result.reason = player.eliminated ? 'Ausgeschieden' : 'Nur während der Spielrunde'; return result; }
  if (room.pendingReaction) { result.reason = room.pendingReaction.playerId === player.id ? 'Reaktion läuft' : 'Warte auf Reaktion'; return result; }
  switch (player.abilityId) {
    case 'tauschen':
      result.canUse = state.uses < 1 && !acted && (room.hands[player.id]?.length || 0) >= 2 && room.leftovers.length >= 2;
      result.options.cardIds = (room.hands[player.id] || []).map(c => c.id);
      result.reason = result.canUse ? '' : state.uses ? 'Diese Runde benutzt' : acted ? 'Nur vor deiner ersten Spielaktion' : 'Nicht genug Karten im Reststapel';
      break;
    case 'fallensteller':
      result.canUse = state.uses < 1 && !acted;
      result.options.ranks = RANKS.map(r => r.value);
      result.reason = result.canUse ? '' : state.uses ? `Geheim gewählt: ${rankLabel(state.selectedRank)}` : 'Nur vor deiner ersten Spielaktion';
      break;
    case 'springer': {
      const next = room.rowDirection && room.rowCursorRank ? wrapRank(room.rowCursorRank + room.rowDirection) : null;
      const jump = next ? wrapRank(next + room.rowDirection) : null;
      const cards = jump ? (room.hands[player.id] || []).filter(c => c.rank === jump && !room.currentRow[jump - 1] && !rankBlocked(room, jump)).map(c => c.id) : [];
      result.options.cardIds = cards;
      result.options.skippedRank = next;
      result.options.jumpRank = jump;
      result.canUse = state.uses < 1 && ownTurn && room.rowDirection !== null && !room.springerGapRank && chipValue(player.chips) >= 5 && cards.length > 0 && next && !room.currentRow[next - 1];
      result.reason = result.canUse ? '' : state.uses ? 'Diese Runde benutzt' : !ownTurn ? 'Nur in deinem Zug' : room.rowDirection === null ? 'Erst wenn die Richtung feststeht' : room.springerGapRank ? 'In dieser Reihe gibt es schon eine Springer-Lücke' : chipValue(player.chips) < 5 ? 'Du brauchst Chipwert 5' : 'Keine passende Sprungkarte';
      break;
    }
    case 'kehrtwende':
      result.canUse = state.uses < 1 && ownTurn && room.rowDirection !== null && room.rowOrder.length >= 2 && chipValue(player.chips) >= 2;
      result.reason = result.canUse ? '' : state.uses ? 'Diese Runde benutzt' : !ownTurn ? 'Nur in deinem Zug' : room.rowDirection === null ? 'Richtung noch nicht festgelegt' : chipValue(player.chips) < 2 ? 'Du brauchst Chipwert 2' : 'Nicht verfügbar';
      break;
    case 'spaeher':
      result.canUse = state.uses < 1;
      result.reason = result.canUse ? '' : 'Diese Runde benutzt';
      break;
    case 'nachtreter':
      result.reason = `Reaktiv · ${state.uses || 0}/2 genutzt`;
      break;
    case 'dieb':
      result.reason = state.uses ? 'Diese Runde ausgelöst' : 'Löst automatisch beim ersten eigenen Pot-Gewinn aus';
      break;
    case 'blockierer': {
      const ranks = RANKS.map(r => r.value).filter(r => !room.currentRow[r - 1]);
      result.options.ranks = ranks;
      result.canUse = state.uses < 1 && ownTurn && !room.blockedRank && ranks.length > 0;
      result.reason = result.canUse ? '' : state.uses ? 'Diese Runde benutzt' : !ownTurn ? 'Nur in deinem Zug' : room.blockedRank ? 'Es ist bereits ein Rang blockiert' : 'Kein Rang verfügbar';
      break;
    }
    case 'schmuggler':
      result.options.cardIds = (room.hands[player.id] || []).map(c => c.id);
      result.canUse = state.uses < 1 && ownTurn && !room.newRowMode && !hasNormalPlayableCard(room, player.id) && room.leftovers.length > 0 && result.options.cardIds.length > 0;
      result.reason = result.canUse ? '' : state.uses ? 'Diese Runde benutzt' : !ownTurn ? 'Nur in deinem Zug' : room.newRowMode ? 'Beim Eröffnen musst du eine Karte spielen' : hasNormalPlayableCard(room, player.id) ? 'Du hast noch eine normal spielbare Karte' : !room.leftovers.length ? 'Reststapel ist leer' : 'Nicht verfügbar';
      break;
    case 'draengler':
      result.canUse = state.uses < 1 && ownTurn && !state.armed && !room.newRowMode;
      result.reason = state.armed ? 'Aktiviert: Beim Beenden wird der nächste Spieler übersprungen' : result.canUse ? '' : state.uses ? 'Diese Runde benutzt' : !ownTurn ? 'Nur in deinem Zug' : 'Erst nach dem Start einer Reihe';
      break;
    case 'gluecksritter':
    case 'halsabschneider':
      result.canUse = state.uses < 1 && !acted;
      result.options.potIds = Object.keys(POT_DEFS);
      result.reason = result.canUse ? '' : state.uses ? `Gewählt: ${POT_DEFS[state.selectedPot]?.label || '—'}` : 'Nur vor deiner ersten Spielaktion';
      break;
    case 'multiplikator':
      result.reason = state.uses ? `Diese Runde ausgelöst${state.info ? `: ${state.info.combo} Karten → ${state.info.reward} Bronze` : ''}` : 'Wird beim Ende deiner ersten 3+-Karten-Serie automatisch ausgelöst';
      break;
    case 'zocker':
      result.canUse = state.uses < 2 && room.leftovers.length > 0 && chipValue(player.chips) >= 2;
      result.options.suits = Object.keys(SUITS);
      result.reason = result.canUse ? '' : state.uses >= 2 ? 'Beide Versuche verbraucht' : room.leftovers.length <= 0 ? 'Reststapel ist leer' : 'Du brauchst Chipwert 2';
      break;
    case 'faelscher': {
      const opts = [];
      if (ownTurn && state.uses < 1) {
        for (const card of room.hands[player.id] || []) {
          for (const direction of [-1, 1]) {
            const asRank = wrapRank(card.rank + direction);
            if (isPlayable(room, card, asRank)) opts.push({ cardId: card.id, direction, asRank });
          }
        }
      }
      result.options.forgeries = opts;
      result.canUse = state.uses < 1 && ownTurn && opts.length > 0;
      result.reason = result.canUse ? '' : state.uses ? 'Diese Runde benutzt' : !ownTurn ? 'Nur in deinem Zug' : 'Keine sinnvolle Fälschung möglich';
      break;
    }
    case 'leichtgewicht':
      result.reason = state.lightweightApplied ? `Automatisch aktiv · 1 Bronze in ${POT_DEFS[state.selectedPot]?.label || 'einen Pot'}` : 'Automatisch; falls du 1 Wert bezahlen kannst';
      break;
  }
  return result;
}
function endgamePublic(room) {
  return {
    enabled: modeUsesEndgame(room),
    active: room.endgameStartRound != null,
    stage: endgameStage(room),
    startRound: room.endgameStartRound,
    eliminationThreshold: eliminationThreshold(room),
    cardPenaltyMultiplier: cardPenaltyMultiplier(room)
  };
}
function publicState(room, playerId) {
  const player = requirePlayer(room, playerId);
  const effectiveActive = room.pendingReaction ? findPlayer(room, room.pendingReaction.playerId) : room.players[room.activePlayerIndex] || null;
  const reactionForSelf = room.pendingReaction?.playerId === playerId ? {
    type: room.pendingReaction.type,
    playableIds: room.pendingReaction.playableIds
  } : null;
  return {
    code: room.code,
    hostId: room.hostId,
    isHost: room.hostId === playerId,
    round: room.round,
    phase: room.phase,
    gameMode: room.gameMode,
    endgame: endgamePublic(room),
    self: {
      id: player.id,
      name: player.name,
      chips: cloneChips(player.chips),
      hand: room.hands[player.id] || [],
      eliminated: !!player.eliminated,
      ability: abilityPublic(room, player),
      reaction: reactionForSelf
    },
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      chips: cloneChips(p.chips),
      handCount: room.hands[p.id]?.length || 0,
      isHost: p.id === room.hostId,
      isActive: effectiveActive?.id === p.id,
      anteConfirmed: !!room.anteConfirmed[p.id],
      eliminated: !!p.eliminated
    })),
    pots: room.pots,
    potDefs: POT_DEFS,
    antePaid: room.antePaid[playerId] || null,
    anteRequirements: room.anteRequirements?.[playerId] || null,
    anteConfirmed: !!room.anteConfirmed[playerId],
    anteResolution: room.anteResolution?.[playerId] || null,
    activePlayerCount: activePlayerCount(room),
    allAnteConfirmed: room.phase !== 'ante' ? false : activePlayers(room).every(p => room.anteConfirmed[p.id]),
    currentRow: room.currentRow,
    rowOrder: room.rowOrder || [],
    rowDirection: room.rowDirection,
    springerGapRank: room.springerGapRank,
    blockedRank: room.blockedRank,
    blockedByName: room.blockedBy ? findPlayer(room, room.blockedBy)?.name || null : null,
    leftoverCount: room.leftovers.length,
    activePlayerId: effectiveActive?.id || null,
    activePlayerName: effectiveActive?.name || null,
    reactionWaitingName: room.pendingReaction ? findPlayer(room, room.pendingReaction.playerId)?.name || null : null,
    newRowMode: room.newRowMode,
    legalRanks: legalRanks(room),
    consecutiveSkips: room.consecutiveSkips,
    lastPlayedBy: room.lastPlayedBy,
    totalPotValue: totalPot(room),
    winnerId: room.winnerId,
    roundSummary: room.roundSummary,
    gameSummary: room.gameSummary
  };
}

function addSubscriber(room, playerId, res) {
  if (!roomSubscribers.has(room.code)) roomSubscribers.set(room.code, new Map());
  const byPlayer = roomSubscribers.get(room.code);
  if (!byPlayer.has(playerId)) byPlayer.set(playerId, new Set());
  byPlayer.get(playerId).add(res);
}
function removeSubscriber(roomCode, playerId, res) {
  const byPlayer = roomSubscribers.get(roomCode);
  if (!byPlayer) return;
  const set = byPlayer.get(playerId);
  if (set) {
    set.delete(res);
    if (!set.size) byPlayer.delete(playerId);
  }
  if (!byPlayer.size) roomSubscribers.delete(roomCode);
}
function sendEvent(res, payload) {
  if (res.writableEnded || res.destroyed) return false;
  try { res.write(`data: ${JSON.stringify(payload)}\n\n`); return true; } catch { return false; }
}
function broadcastRoom(room) {
  const byPlayer = roomSubscribers.get(room.code);
  if (!byPlayer) return;
  for (const [playerId, listeners] of byPlayer.entries()) {
    let payload;
    try { payload = { state: publicState(room, playerId) }; } catch { continue; }
    for (const res of [...listeners]) if (!sendEvent(res, payload)) removeSubscriber(room.code, playerId, res);
  }
}
function openEventStream(req, res, room, playerId) {
  requirePlayer(room, playerId);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 1500\n\n');
  addSubscriber(room, playerId, res);
  sendEvent(res, { state: publicState(room, playerId) });
  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) return clearInterval(heartbeat);
    try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); }
  }, 20000);
  req.on('close', () => { clearInterval(heartbeat); removeSubscriber(room.code, playerId, res); });
}
function cleanName(input) {
  const name = String(input || '').trim().replace(/\s+/g, ' ').slice(0, 18);
  if (name.length < 2) throw new Error('Bitte einen Spielernamen mit mindestens 2 Zeichen eingeben.');
  return name;
}
function cleanCode(input) { return String(input || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); }
async function readJson(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 100000) throw new Error('Anfrage zu groß.');
  }
  if (!data) return {};
  try { return JSON.parse(data); } catch { throw new Error('Ungültige Anfrage.'); }
}
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function ok(res, body = {}) { sendJson(res, 200, { ok: true, ...body }); }
function fail(res, status, message) { sendJson(res, status, { ok: false, error: message }); }

function handleAbility(room, player, body) {
  if (room.gameMode !== 'chaos') throw new Error('Fähigkeiten gibt es nur im Chaos-Modus.');
  if (room.phase !== 'playing') throw new Error('Fähigkeiten können nur während der Spielrunde benutzt werden.');
  if (player.eliminated) throw new Error('Du bist ausgeschieden.');
  if (room.pendingReaction) throw new Error('Gerade wartet das Spiel auf eine Reaktion.');
  const abilityId = player.abilityId;
  const state = abilityState(room, player.id);
  const acted = !!room.playerRoundActions[player.id]?.acted;
  const payload = body.payload || {};

  if (abilityId === 'tauschen') {
    if (state.uses >= 1 || acted) throw new Error('Tauschen geht nur einmal und vor deiner ersten Spielaktion der Runde.');
    const ids = Array.isArray(payload.cardIds) ? [...new Set(payload.cardIds.map(String))] : [];
    if (ids.length !== 2) throw new Error('Wähle genau 2 Handkarten.');
    if (room.leftovers.length < 2) throw new Error('Im Reststapel liegen nicht genug Karten.');
    const hand = room.hands[player.id];
    const indices = ids.map(id => hand.findIndex(c => c.id === id));
    if (indices.some(i => i < 0)) throw new Error('Eine gewählte Karte ist nicht mehr auf deiner Hand.');
    const draws = [];
    for (let i = 0; i < 2; i++) draws.push(room.leftovers.splice(Math.floor(Math.random() * room.leftovers.length), 1)[0]);
    const returned = indices.sort((a,b) => b-a).map(i => hand.splice(i, 1)[0]);
    hand.push(...draws);
    room.leftovers.push(...returned);
    shuffleInPlace(room.leftovers);
    sortHand(hand);
    state.uses = 1;
    state.info = { drew: draws };
    addLog(room, `🔄 ${player.name} tauscht zwei Handkarten gegen zwei zufällige Restkarten.`, 'special');
    return;
  }

  if (abilityId === 'fallensteller') {
    if (state.uses >= 1 || acted) throw new Error('Die Falle muss vor deiner ersten Spielaktion gewählt werden.');
    const rank = Number(payload.rank);
    if (!RANKS.some(r => r.value === rank)) throw new Error('Ungültiger Rang.');
    state.uses = 1;
    state.selectedRank = rank;
    addLog(room, `🪤 ${player.name} hat geheim eine Falle vorbereitet.`, 'special');
    return;
  }

  if (abilityId === 'springer') {
    requireTurn(room, player.id);
    if (state.uses >= 1) throw new Error('Springer wurde diese Runde schon benutzt.');
    if (room.rowDirection === null || room.newRowMode) throw new Error('Springer geht erst, wenn die Reihenrichtung feststeht.');
    if (room.springerGapRank) throw new Error('Diese Reihe hat bereits eine Springer-Lücke.');
    if (chipValue(player.chips) < 5) throw new Error('Springer kostet Chipwert 5.');
    const normalNext = wrapRank(room.rowCursorRank + room.rowDirection);
    const jumpRank = wrapRank(normalNext + room.rowDirection);
    if (room.currentRow[normalNext - 1]) throw new Error('Der zu überspringende Rang ist bereits belegt.');
    if (rankBlocked(room, jumpRank) || room.currentRow[jumpRank - 1]) throw new Error('Das Sprungziel ist blockiert oder bereits belegt.');
    const cardId = String(payload.cardId || '');
    const hand = room.hands[player.id] || [];
    const index = hand.findIndex(c => c.id === cardId && c.rank === jumpRank);
    if (index < 0) throw new Error(`Du brauchst eine ${rankLabel(jumpRank)} für den Sprung.`);
    takeValue(player, 5);
    for (const potId of Object.keys(POT_DEFS)) room.pots[potId].chips.bronze += 1;
    room.springerGapRank = normalNext;
    state.uses = 1;
    state.info = { skippedRank: normalNext };
    const result = placeCard(room, player, index, jumpRank, { springer: true });
    addLog(room, `🦘 ${player.name} überspringt ${rankLabel(normalNext)} und zahlt je 1 Bronze in alle fünf Pots.`, 'special');
    if (result.handEmpty) return endRound(room, player.id);
    if (result.rowComplete) completeRowForPlayer(room, player, 'Springer-Reihe vollständig');
    return;
  }

  if (abilityId === 'kehrtwende') {
    requireTurn(room, player.id);
    if (state.uses >= 1) throw new Error('Kehrtwende wurde diese Runde schon benutzt.');
    if (room.rowDirection === null || room.rowOrder.length < 2) throw new Error('Die Richtung muss zuerst feststehen.');
    if (chipValue(player.chips) < 2) throw new Error('Kehrtwende kostet Chipwert 2.');
    takeValue(player, 2);
    const potId = randomChoice(Object.keys(POT_DEFS));
    room.pots[potId].chips.silver += 1;
    room.rowDirection *= -1;
    room.rowCursorRank = playedRank(room.rowOrder[0]);
    state.uses = 1;
    state.info = { potId };
    addLog(room, `↩️ ${player.name} nutzt Kehrtwende. Die Reihe läuft nun ${room.rowDirection === 1 ? 'aufwärts' : 'abwärts'} vom Startpunkt weiter; 1 Silber geht in ${POT_DEFS[potId].label}.`, 'special');
    return;
  }

  if (abilityId === 'spaeher') {
    if (state.uses >= 1) throw new Error('Späher wurde diese Runde schon benutzt.');
    const players = activePlayers(room).filter(p => p.id !== player.id).map(p => ({
      playerId: p.id,
      name: p.name,
      cards: shuffle(room.hands[p.id] || []).slice(0, 2)
    }));
    const leftovers = shuffle(room.leftovers).slice(0, 4);
    state.uses = 1;
    state.info = { players, leftovers };
    addLog(room, `🔭 ${player.name} nutzt Späher.`, 'special');
    return;
  }

  if (abilityId === 'blockierer') {
    requireTurn(room, player.id);
    if (state.uses >= 1) throw new Error('Blockierer wurde diese Runde schon benutzt.');
    if (room.blockedRank) throw new Error('Es ist bereits ein Rang blockiert.');
    const rank = Number(payload.rank);
    if (!RANKS.some(r => r.value === rank) || room.currentRow[rank - 1]) throw new Error('Dieser Rang kann nicht blockiert werden.');
    room.blockedRank = rank;
    room.blockedBy = player.id;
    state.uses = 1;
    state.selectedRank = rank;
    addLog(room, `⛔ ${player.name} blockiert Rang ${rankLabel(rank)}, bis ${player.name} wieder regulär am Zug ist.`, 'special');
    return;
  }

  if (abilityId === 'schmuggler') {
    requireTurn(room, player.id);
    if (state.uses >= 1) throw new Error('Schmuggler wurde diese Runde schon benutzt.');
    if (room.newRowMode) throw new Error('Beim Eröffnen einer Reihe musst du spielen.');
    if (hasNormalPlayableCard(room, player.id)) throw new Error('Schmuggler geht nur, wenn du sonst skippen müsstest.');
    if (!room.leftovers.length) throw new Error('Der Reststapel ist leer.');
    const cardId = String(payload.cardId || '');
    const hand = room.hands[player.id] || [];
    const index = hand.findIndex(c => c.id === cardId);
    if (index < 0) throw new Error('Karte nicht gefunden.');
    const drawn = room.leftovers.splice(Math.floor(Math.random() * room.leftovers.length), 1)[0];
    const [returned] = hand.splice(index, 1);
    hand.push(drawn);
    room.leftovers.push(returned);
    shuffleInPlace(room.leftovers);
    sortHand(hand);
    state.uses = 1;
    state.info = { drew: drawn };
    markPlayerActed(room, player.id);
    room.consecutiveSkips += 1;
    addLog(room, `🧳 ${player.name} schmuggelt eine Handkarte in den Reststapel und zieht eine neue. Der Zug endet.`, 'special');
    const idx = room.players.findIndex(p => p.id === player.id);
    if (!checkNachtreterAfterSkip(room, idx)) finishSkipTransition(room, idx);
    return;
  }

  if (abilityId === 'draengler') {
    requireTurn(room, player.id);
    if (state.uses >= 1 || state.armed) throw new Error('Drängler ist diese Runde schon verbraucht oder aktiviert.');
    if (room.newRowMode) throw new Error('Erst eine Reihe eröffnen, dann kannst du Drängler für dein Zugende aktivieren.');
    state.armed = true;
    addLog(room, `🚧 ${player.name} aktiviert Drängler für das Ende dieses Zuges.`, 'special');
    return;
  }

  if (abilityId === 'gluecksritter' || abilityId === 'halsabschneider') {
    if (state.uses >= 1 || acted) throw new Error('Die Pot-Wahl muss vor deiner ersten Spielaktion erfolgen.');
    const potId = String(payload.potId || '');
    if (!POT_DEFS[potId]) throw new Error('Ungültiger Pot.');
    state.uses = 1;
    state.selectedPot = potId;
    addLog(room, abilityId === 'gluecksritter' ? `🍀 ${player.name} hat geheim einen Glücksritter-Pot gewählt.` : `🔪 ${player.name} hat einen Pot für Halsabschneider markiert.`, 'special');
    return;
  }

  if (abilityId === 'zocker') {
    if (state.uses >= 2) throw new Error('Du hast beide Zocker-Versuche dieser Runde verbraucht.');
    if (chipValue(player.chips) < 2) throw new Error('Du brauchst Chipwert 2 als Einsatz.');
    if (!room.leftovers.length) throw new Error('Der Reststapel ist leer.');
    const suit = String(payload.suit || '');
    if (!SUITS[suit]) throw new Error('Ungültige Kartenfamilie.');
    takeValue(player, 2);
    const revealed = randomChoice(room.leftovers);
    const won = revealed.suit === suit;
    if (won) player.chips.gold += 1;
    state.uses += 1;
    state.info = { suit, revealed, won, attempt: state.uses };
    addLog(room, `🎰 ${player.name} zockt auf ${SUITS[suit].label} und ${won ? 'gewinnt Wert 5 aus der Bank' : 'verliert den Einsatz'}.`, won ? 'special' : 'bad');
    return;
  }

  if (abilityId === 'faelscher') {
    requireTurn(room, player.id);
    if (state.uses >= 1) throw new Error('Fälscher wurde diese Runde schon benutzt.');
    const cardId = String(payload.cardId || '');
    const direction = Number(payload.direction);
    if (![1, -1].includes(direction)) throw new Error('Wähle +1 oder −1.');
    const hand = room.hands[player.id] || [];
    const index = hand.findIndex(c => c.id === cardId);
    if (index < 0) throw new Error('Karte nicht gefunden.');
    const card = hand[index];
    const asRank = wrapRank(card.rank + direction);
    if (!isPlayable(room, card, asRank)) throw new Error(`Die Karte kann gerade nicht als ${rankLabel(asRank)} gelegt werden.`);
    state.uses = 1;
    state.info = { cardId, fromRank: card.rank, asRank };
    const result = placeCard(room, player, index, asRank, { forged: true });
    addLog(room, `🃏 ${player.name} fälscht ${rankLabel(card.rank)} zu ${rankLabel(asRank)}. Spezial-Pots werden dadurch nicht ausgelöst.`, 'special');
    if (result.handEmpty) return endRound(room, player.id);
    if (result.rowComplete) completeRowForPlayer(room, player, 'gefälschte Reihe vollständig');
    return;
  }

  throw new Error('Diese Fähigkeit wird automatisch oder reaktiv ausgelöst.');
}

async function handleApi(req, res, url) {
  try {
    if (req.method === 'POST' && url.pathname === '/api/create') {
      const body = await readJson(req);
      const name = cleanName(body.name);
      const { room, playerId } = createRoom(name);
      return ok(res, { roomCode: room.code, playerId, state: publicState(room, playerId) });
    }

    if (req.method === 'POST' && url.pathname === '/api/join') {
      const body = await readJson(req);
      const name = cleanName(body.name);
      const code = cleanCode(body.roomCode);
      const room = rooms.get(code);
      if (!room) return fail(res, 404, 'Raum nicht gefunden.');
      if (room.phase !== 'lobby') return fail(res, 409, 'Dieses Spiel wurde bereits gestartet.');
      if (room.players.length >= MAX_PLAYERS) return fail(res, 409, 'Der Raum ist bereits voll.');
      if (room.players.some(p => p.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'))) return fail(res, 409, 'Dieser Spielername ist im Raum bereits vergeben.');
      const playerId = randomId();
      room.players.push({ id: playerId, name, chips: cloneChips(START_CHIPS), eliminated: false, abilityId: null });
      if (room.nextAntePenalties) room.nextAntePenalties[playerId] = Object.fromEntries(Object.keys(POT_DEFS).map(potId => [potId, false]));
      addLog(room, `${name} ist dem Raum beigetreten.`, 'good');
      broadcastRoom(room);
      return ok(res, { roomCode: code, playerId, state: publicState(room, playerId) });
    }

    if (req.method === 'GET' && url.pathname === '/api/events') {
      const code = cleanCode(url.searchParams.get('room'));
      const playerId = String(url.searchParams.get('playerId') || '');
      const room = rooms.get(code);
      if (!room) return fail(res, 404, 'Raum nicht gefunden oder abgelaufen.');
      return openEventStream(req, res, room, playerId);
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      const code = cleanCode(url.searchParams.get('room'));
      const playerId = String(url.searchParams.get('playerId') || '');
      const room = rooms.get(code);
      if (!room) return fail(res, 404, 'Raum nicht gefunden oder abgelaufen.');
      requirePlayer(room, playerId);
      return ok(res, { state: publicState(room, playerId) });
    }

    if (req.method === 'POST' && url.pathname === '/api/action') {
      const body = await readJson(req);
      const code = cleanCode(body.roomCode);
      const playerId = String(body.playerId || '');
      const action = String(body.action || '');
      const room = rooms.get(code);
      if (!room) return fail(res, 404, 'Raum nicht gefunden oder abgelaufen.');
      const player = requirePlayer(room, playerId);

      if (action === 'setMode') {
        if (room.hostId !== playerId) throw new Error('Nur der Host kann den Spielmodus ändern.');
        if (room.phase !== 'lobby') throw new Error('Der Modus kann nur in der Lobby geändert werden.');
        const mode = String(body.mode || '');
        if (!MODES.includes(mode)) throw new Error('Ungültiger Spielmodus.');
        room.gameMode = mode;
        addLog(room, `Spielmodus: ${mode === 'standard' ? 'Standard' : mode === 'abschiebe' ? 'Abschiebe' : 'Chaos'}.`, 'special');
      } else if (action === 'start') {
        if (room.hostId !== playerId) throw new Error('Nur der Host kann das Spiel starten.');
        if (room.phase !== 'lobby') throw new Error('Das Spiel wurde bereits gestartet.');
        if (room.players.length < MIN_PLAYERS || room.players.length > MAX_PLAYERS) throw new Error(`Es werden ${MIN_PLAYERS} bis ${MAX_PLAYERS} Spieler benötigt.`);
        room.nextAntePenalties = emptyPenaltyMap(room.players);
        room.endgameStartRound = null;
        if (room.gameMode === 'chaos') assignChaosAbilities(room);
        else room.players.forEach(p => { p.abilityId = null; });
        addLog(room, `Das Spiel startet im ${room.gameMode === 'standard' ? 'Standard-' : room.gameMode === 'abschiebe' ? 'Abschiebe-' : 'Chaos-'}Modus.`, 'special');
        beginAntePhase(room);
      } else if (player.eliminated && ['deposit','autoAnte','confirmAnte','play','skip','useAbility','reactionPlay','reactionPass'].includes(action)) {
        throw new Error('Du bist aus der Partie ausgeschieden und kannst nur noch zuschauen.');
      } else if (action === 'deposit') {
        if (room.phase !== 'ante') throw new Error('Aktuell ist keine Einsatzphase.');
        if (room.anteConfirmed[playerId]) throw new Error('Du hast deinen Einsatz bereits bestätigt.');
        const potId = String(body.potId || '');
        const chipType = String(body.chipType || '');
        const def = POT_DEFS[potId];
        if (!def || !CHIP_VALUES[chipType]) throw new Error('Ungültiger Pot oder Chip.');
        const paid = room.antePaid[playerId][potId];
        const required = personalRequirement(room, playerId, potId);
        if (!required[chipType]) throw new Error(`${def.label} verlangt keinen ${chipType}-Chip.`);
        if (paid[chipType] >= required[chipType]) throw new Error(`${def.label} ist mit diesem Chip-Typ bereits bezahlt.`);
        if (player.chips[chipType] <= 0) throw new Error('Diesen Chip besitzt du nicht mehr.');
        player.chips[chipType] -= 1;
        room.pots[potId].chips[chipType] += 1;
        paid[chipType] += 1;
        room.updatedAt = Date.now();
      } else if (action === 'autoAnte') {
        if (room.phase !== 'ante') throw new Error('Aktuell ist keine Einsatzphase.');
        if (room.anteConfirmed[playerId]) throw new Error('Du hast deinen Einsatz bereits bestätigt.');
        const remaining = {};
        let requiredValue = 0;
        for (const potId of Object.keys(POT_DEFS)) {
          const required = personalRequirement(room, playerId, potId);
          remaining[potId] = remainingRequirement(required, room.antePaid[playerId][potId]);
          requiredValue += chipValue(remaining[potId]);
        }
        if (chipValue(player.chips) < requiredValue) throw new Error('Du hast nicht genug Chip-Wert für den Pflicht-Einsatz.');
        const totals = emptyChips();
        for (const reqChips of Object.values(remaining)) for (const t of ['bronze','silver','gold']) totals[t] += reqChips[t];
        const exact = ['bronze','silver','gold'].every(t => player.chips[t] >= totals[t]);
        if (!exact) {
          player.chips = chipsForValue(chipValue(player.chips) - requiredValue);
          addLog(room, `${player.name} nutzt die Wechselbank für passende Pflichtchips.`);
        } else {
          for (const t of ['bronze','silver','gold']) player.chips[t] -= totals[t];
        }
        for (const [potId, reqChips] of Object.entries(remaining)) {
          for (const t of ['bronze','silver','gold']) {
            room.pots[potId].chips[t] += reqChips[t];
            room.antePaid[playerId][potId][t] += reqChips[t];
          }
        }
      } else if (action === 'confirmAnte') {
        if (room.phase !== 'ante') throw new Error('Aktuell ist keine Einsatzphase.');
        if (!playerAnteComplete(room, playerId)) throw new Error('Es fehlen noch Pflichtchips.');
        room.anteConfirmed[playerId] = true;
        addLog(room, `${player.name} ist mit dem Einsatz fertig.`, 'good');
        if (activePlayers(room).every(p => room.anteConfirmed[p.id])) dealRound(room);
      } else if (action === 'useAbility') {
        handleAbility(room, player, body);
      } else if (action === 'reactionPlay') {
        if (!room.pendingReaction || room.pendingReaction.playerId !== playerId || room.pendingReaction.type !== 'nachtreter') throw new Error('Es gibt gerade keine Nachtreter-Reaktion für dich.');
        const cardId = String(body.cardId || '');
        if (!room.pendingReaction.playableIds.includes(cardId)) throw new Error('Diese Karte ist für Nachtreter nicht spielbar.');
        const resumeIndex = room.pendingReaction.resumeIndex;
        const hand = room.hands[playerId] || [];
        const index = hand.findIndex(c => c.id === cardId);
        if (index < 0) throw new Error('Karte nicht gefunden.');
        room.pendingReaction = null;
        const state = abilityState(room, playerId);
        state.uses += 1;
        const result = placeCard(room, player, index, hand[index].rank, { reaction: true });
        if (result.handEmpty) endRound(room, playerId);
        else if (result.rowComplete) completeRowForPlayer(room, player, 'durch Nachtreter vervollständigt');
        else setRegularTurn(room, resumeIndex);
      } else if (action === 'reactionPass') {
        if (!room.pendingReaction || room.pendingReaction.playerId !== playerId || room.pendingReaction.type !== 'nachtreter') throw new Error('Es gibt gerade keine Nachtreter-Reaktion für dich.');
        const afterPlayerId = room.pendingReaction.afterPlayerId;
        const skipperIndex = room.players.findIndex(p => p.id === afterPlayerId);
        room.pendingReaction = null;
        finishSkipTransition(room, skipperIndex);
      } else if (action === 'play') {
        if (room.phase !== 'playing') throw new Error('Die Runde läuft gerade nicht.');
        requireTurn(room, playerId);
        const cardId = String(body.cardId || '');
        const hand = room.hands[playerId] || [];
        const index = hand.findIndex(c => c.id === cardId);
        if (index < 0) throw new Error('Karte nicht auf deiner Hand gefunden.');
        const card = hand[index];
        if (!isPlayable(room, card)) throw new Error('Diese Karte passt gerade nicht.');
        const result = placeCard(room, player, index, card.rank);
        if (result.handEmpty) endRound(room, playerId);
        else if (result.rowComplete) completeRowForPlayer(room, player, room.blockedRank ? 'vollständig trotz Blockade' : 'vollständiger 13er-Zyklus');
        else room.activePlayerIndex = room.players.findIndex(p => p.id === playerId);
      } else if (action === 'skip') {
        if (room.phase !== 'playing') throw new Error('Die Runde läuft gerade nicht.');
        requireTurn(room, playerId);
        if (room.newRowMode) throw new Error('Du musst eine neue Reihe eröffnen und kannst jetzt nicht skippen.');
        maybeAwardMultiplier(room, playerId);
        markPlayerActed(room, playerId);
        room.consecutiveSkips += 1;
        addLog(room, `${player.name} skippt.`);
        const idx = room.players.findIndex(p => p.id === playerId);
        const aState = room.gameMode === 'chaos' && player.abilityId === 'draengler' ? abilityState(room, playerId) : null;
        const dränglerActive = !!aState?.armed;
        if (dränglerActive) {
          aState.armed = false;
          aState.uses = 1;
          addLog(room, `🚧 ${player.name} drängelt: der direkt nächste aktive Spieler wird übersprungen.`, 'special');
        }
        if (!checkNachtreterAfterSkip(room, idx, dränglerActive ? 2 : 1)) finishSkipTransition(room, idx, dränglerActive ? 2 : 1);
      } else if (action === 'nextRound') {
        if (room.hostId !== playerId) throw new Error('Nur der Host kann die nächste Runde starten.');
        if (room.phase !== 'roundEnd') throw new Error('Die aktuelle Runde ist noch nicht beendet.');
        startNextRound(room);
      } else {
        throw new Error('Unbekannte Aktion.');
      }
      broadcastRoom(room);
      return ok(res, { state: publicState(room, playerId) });
    }

    return fail(res, 404, 'API-Endpunkt nicht gefunden.');
  } catch (err) {
    return fail(res, 400, err.message || 'Fehler bei der Anfrage.');
  }
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
      '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml'
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': ['.html','.js','.css'].includes(ext) ? 'no-cache, no-store, must-revalidate' : 'public, max-age=86400' });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/health') return sendJson(res, 200, { ok: true, service: 'gelber-zwerg', rooms: rooms.size });
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  serveStatic(req, res, url);
});

setInterval(() => {
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  for (const [code, room] of rooms) {
    if (room.updatedAt < cutoff) {
      rooms.delete(code);
      const byPlayer = roomSubscribers.get(code);
      if (byPlayer) for (const listeners of byPlayer.values()) for (const res of listeners) { try { res.end(); } catch {} }
      roomSubscribers.delete(code);
    }
  }
}, 30 * 60 * 1000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Gelber Zwerg V4 läuft auf http://localhost:${PORT}`);
});
