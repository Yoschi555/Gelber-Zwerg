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
const ELIMINATION_THRESHOLD = 7;
const DEAL_COUNTS = { 3: 15, 4: 12, 5: 9, 6: 8 };
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

function emptyChips() { return { bronze: 0, silver: 0, gold: 0 }; }
function cloneChips(c) { return { bronze: c.bronze, silver: c.silver, gold: c.gold }; }
function chipValue(c) { return c.bronze + c.silver * 2 + c.gold * 5; }
function rankLabel(value) { return RANKS.find(r => r.value === value)?.label || String(value); }
function cardName(card) { return `${SUITS[card.suit].label} ${rankLabel(card.rank)}`; }
function cardImage(suit, rank) {
  const key = rank === 1 ? 'A' : rank === 11 ? 'B' : rank === 12 ? 'D' : rank === 13 ? 'K' : String(rank);
  return `assets/cards/${suit}-${key}.webp`;
}
function buildDeck() {
  const deck = [];
  for (const suit of Object.keys(SUITS)) {
    for (const rank of RANKS) {
      deck.push({ id: `${suit}-${rank.value}`, suit, rank: rank.value, image: cardImage(suit, rank.value) });
    }
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
function chipsForValue(value) {
  const gold = Math.floor(value / 5);
  value -= gold * 5;
  const silver = Math.floor(value / 2);
  const bronze = value - silver * 2;
  return { bronze, silver, gold };
}
function requirementsMet(req, paid) {
  return ['bronze','silver','gold'].every(t => paid[t] >= req[t]);
}
function remainingRequirement(req, paid) {
  return {
    bronze: Math.max(0, req.bronze - paid.bronze),
    silver: Math.max(0, req.silver - paid.silver),
    gold: Math.max(0, req.gold - paid.gold)
  };
}
function multiplyRequirement(req, factor = 1) {
  return {
    bronze: req.bronze * factor,
    silver: req.silver * factor,
    gold: req.gold * factor
  };
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
function personalRequirement(room, playerId, potId) {
  return room.anteRequirements?.[playerId]?.[potId] || POT_DEFS[potId].required;
}
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
    players: [{ id, name: hostName, chips: cloneChips(START_CHIPS), eliminated: false }],
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
    rowHistory: [],
    newRowMode: true,
    lastPlayedBy: null,
    consecutiveSkips: 0,
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
function requireTurn(room, playerId) {
  const active = room.players[room.activePlayerIndex];
  if (!active || active.id !== playerId) throw new Error('Du bist gerade nicht am Zug.');
  return active;
}
function activePlayers(room) { return room.players.filter(p => !p.eliminated); }
function activePlayerCount(room) { return activePlayers(room).length; }
function nextActivePlayerIndex(room, fromIndex) {
  if (!room.players.length) return -1;
  for (let step = 1; step <= room.players.length; step++) {
    const idx = (fromIndex + step) % room.players.length;
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
      const potId = potIds[Math.floor(Math.random() * potIds.length)];
      room.pots[potId].chips[type] += 1;
      distributed[potId][type] += 1;
      if (room.antePaid[player.id]?.[potId]) room.antePaid[player.id][potId][type] += 1;
    }
    player.chips[type] = 0;
  }
  return distributed;
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
  room.currentRow = Array(13).fill(null);
  room.rowOrder = [];
  room.rowDirection = null;
  room.newRowMode = true;
  if (winners.length === 1) addLog(room, `🏆 ${winners[0].name} gewinnt die Partie mit Chipwert ${best}.`, 'special');
  else addLog(room, `🤝 Die Partie endet unentschieden bei Chipwert ${best}.`, 'special');
}
function resolveAnteShortfalls(room) {
  room.anteResolution = {};
  for (const player of activePlayers(room)) {
    const startingValue = chipValue(player.chips);
    const requiredValue = personalAnteValue(room, player.id);
    if (startingValue >= requiredValue) continue;

    const distributed = distributeAllChipsRandomly(room, player);
    const eliminated = startingValue < ELIMINATION_THRESHOLD;
    room.anteConfirmed[player.id] = true;
    room.anteResolution[player.id] = {
      automatic: true,
      startingValue,
      requiredValue,
      eliminated,
      distributed
    };
    if (eliminated) {
      player.eliminated = true;
      addLog(room, `${player.name} konnte nur Chipwert ${startingValue} einzahlen. Die restlichen Chips wurden zufällig verteilt; ${player.name} scheidet aus.`, 'bad');
    } else {
      addLog(room, `${player.name} kann den vollen Einsatz nicht zahlen, verteilt deshalb alle Chips im Wert ${startingValue} zufällig auf die Pots und bleibt im Spiel.`, 'special');
    }
  }

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
function totalPot(room) {
  return Object.values(room.pots).reduce((sum, pot) => sum + chipValue(pot.chips), 0);
}
function wrapRank(value) {
  return ((value - 1 + 13) % 13) + 1;
}
function legalRanks(room) {
  if (room.newRowMode) return RANKS.map(r => r.value);
  if (!room.rowOrder || room.rowOrder.length === 0) return RANKS.map(r => r.value);

  const lastRank = room.rowOrder[room.rowOrder.length - 1].rank;
  if (room.rowOrder.length === 1 || room.rowDirection === null) {
    // Nach der Startkarte sind beide direkten Nachbarn erlaubt – inklusive K ↔ A.
    return [wrapRank(lastRank - 1), wrapRank(lastRank + 1)];
  }

  // Ab der zweiten Karte ist die Richtung fest und läuft zyklisch weiter.
  return [wrapRank(lastRank + room.rowDirection)];
}
function isPlayable(room, card) { return room.newRowMode || legalRanks(room).includes(card.rank); }
function archiveRow(room, reason) {
  if (room.rowOrder?.length) {
    room.rowHistory.push({ cards: [...room.rowOrder], direction: room.rowDirection, reason });
  }
}
function advanceTurn(room) {
  const next = nextActivePlayerIndex(room, room.activePlayerIndex);
  if (next >= 0) room.activePlayerIndex = next;
}
function payoutSpecial(room, card, player) {
  const found = Object.entries(POT_DEFS).find(([,def]) => def.suit === card.suit && def.rank === card.rank);
  if (!found) return;
  const [potId, def] = found;
  const pot = room.pots[potId].chips;
  const value = chipValue(pot);
  if (value <= 0) {
    addLog(room, `${def.label} wurde gespielt, aber der Pot war leer.`);
    return;
  }
  for (const type of ['bronze','silver','gold']) player.chips[type] += pot[type];
  room.pots[potId].chips = emptyChips();
  addLog(room, `💰 ${player.name} spielt ${def.label} und erhält Pot-Wert ${value}.`, 'special');
}
function transferValue(from, to, requested) {
  const available = chipValue(from.chips);
  const paid = Math.min(requested, available);
  from.chips = chipsForValue(available - paid);
  const gain = chipsForValue(paid);
  for (const t of ['bronze','silver','gold']) to.chips[t] += gain[t];
  return paid;
}
function dealRound(room) {
  const participants = activePlayers(room);
  const count = DEAL_COUNTS[participants.length];
  if (!count) throw new Error(`Für ${participants.length} aktive Spieler ist keine Kartenverteilung definiert.`);
  const deck = shuffle(buildDeck());
  room.hands = Object.fromEntries(room.players.map(p => [p.id, []]));
  let cursor = 0;
  for (let r = 0; r < count; r++) {
    for (const p of participants) room.hands[p.id].push(deck[cursor++]);
  }
  for (const p of participants) sortHand(room.hands[p.id]);
  room.leftovers = deck.slice(cursor);
  const opener = participants[Math.floor(Math.random() * participants.length)];
  room.activePlayerIndex = room.players.findIndex(p => p.id === opener.id);
  room.currentRow = Array(13).fill(null);
  room.rowOrder = [];
  room.rowDirection = null;
  room.rowHistory = [];
  room.newRowMode = true;
  room.lastPlayedBy = null;
  room.consecutiveSkips = 0;
  room.phase = 'playing';
  room.winnerId = null;
  room.roundSummary = null;
  room.gameSummary = null;
  addLog(room, `${count} Karten pro aktivem Spieler ausgeteilt. ${room.leftovers.length} Karten bleiben verdeckt.`, 'special');
  addLog(room, `${opener.name} eröffnet die erste Reihe.`, 'special');
}
function endRound(room, winnerId) {
  const winner = requirePlayer(room, winnerId);
  const summary = [];
  let totalReceived = 0;
  for (const p of activePlayers(room)) {
    if (p.id === winnerId) continue;
    const owed = room.hands[p.id].length;
    const paid = transferValue(p, winner, owed);
    totalReceived += paid;
    summary.push({ name: p.name, cards: owed, paid });
    addLog(room, `${p.name} hat ${owed} Karten übrig und zahlt Wert ${paid} an ${winner.name}.`, paid === owed ? 'special' : 'bad');
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
  room.roundSummary = { winnerName: winner.name, totalReceived, payments: summary, penalties: penaltySummary };
  addLog(room, `🏆 ${winner.name} gewinnt Runde ${room.round}.`, 'special');
}
function startNextRound(room) {
  room.round += 1;
  room.hands = {};
  room.leftovers = [];
  room.currentRow = Array(13).fill(null);
  room.rowOrder = [];
  room.rowDirection = null;
  room.rowHistory = [];
  room.newRowMode = true;
  room.lastPlayedBy = null;
  room.consecutiveSkips = 0;
  room.winnerId = null;
  room.roundSummary = null;
  room.gameSummary = null;
  addLog(room, `Runde ${room.round}: Neue Einzahlphase. Nicht geleerte Pots bleiben bestehen.`, 'special');
  beginAntePhase(room);
}

function publicState(room, playerId) {
  const player = requirePlayer(room, playerId);
  const active = room.players[room.activePlayerIndex] || null;
  return {
    code: room.code,
    hostId: room.hostId,
    isHost: room.hostId === playerId,
    round: room.round,
    phase: room.phase,
    self: { id: player.id, name: player.name, chips: cloneChips(player.chips), hand: room.hands[player.id] || [], eliminated: !!player.eliminated },
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      chips: cloneChips(p.chips),
      handCount: room.hands[p.id]?.length || 0,
      isHost: p.id === room.hostId,
      isActive: active?.id === p.id,
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
    leftoverCount: room.leftovers.length,
    activePlayerId: active?.id || null,
    activePlayerName: active?.name || null,
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
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}
function broadcastRoom(room) {
  const byPlayer = roomSubscribers.get(room.code);
  if (!byPlayer) return;
  for (const [playerId, listeners] of byPlayer.entries()) {
    let payload;
    try { payload = { state: publicState(room, playerId) }; }
    catch { continue; }
    for (const res of [...listeners]) {
      if (!sendEvent(res, payload)) removeSubscriber(room.code, playerId, res);
    }
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
  req.on('close', () => {
    clearInterval(heartbeat);
    removeSubscriber(room.code, playerId, res);
  });
}

function cleanName(input) {
  const name = String(input || '').trim().replace(/\s+/g, ' ').slice(0, 18);
  if (name.length < 2) throw new Error('Bitte einen Spielernamen mit mindestens 2 Zeichen eingeben.');
  return name;
}
function cleanCode(input) { return String(input || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); }

async function readJson(req) {
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 100_000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Ungültige Anfrage.')); }
    });
    req.on('error', reject);
  });
}
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function ok(res, body = {}) { sendJson(res, 200, { ok: true, ...body }); }
function fail(res, status, message) { sendJson(res, status, { ok: false, error: message }); }

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
      room.players.push({ id: playerId, name, chips: cloneChips(START_CHIPS), eliminated: false });
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

      if (action === 'start') {
        if (room.hostId !== playerId) throw new Error('Nur der Host kann das Spiel starten.');
        if (room.phase !== 'lobby') throw new Error('Das Spiel wurde bereits gestartet.');
        if (room.players.length < MIN_PLAYERS || room.players.length > MAX_PLAYERS) throw new Error(`Es werden ${MIN_PLAYERS} bis ${MAX_PLAYERS} Spieler benötigt.`);
        room.nextAntePenalties = emptyPenaltyMap(room.players);
        addLog(room, 'Das Spiel startet. Alle zahlen jetzt ihre Pflichtchips ein.', 'special');
        beginAntePhase(room);
      } else if (player.eliminated && ['deposit','autoAnte','confirmAnte','play','skip'].includes(action)) {
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
      } else if (action === 'play') {
        if (room.phase !== 'playing') throw new Error('Die Runde läuft gerade nicht.');
        requireTurn(room, playerId);
        const cardId = String(body.cardId || '');
        const hand = room.hands[playerId] || [];
        const index = hand.findIndex(c => c.id === cardId);
        if (index < 0) throw new Error('Karte nicht auf deiner Hand gefunden.');
        const card = hand[index];
        if (!isPlayable(room, card)) throw new Error('Diese Karte passt gerade nicht.');
        hand.splice(index, 1);
        if (room.newRowMode) {
          room.currentRow = Array(13).fill(null);
          room.rowOrder = [];
          room.rowDirection = null;
          room.currentRow[card.rank - 1] = card;
          room.rowOrder.push(card);
          room.newRowMode = false;
          addLog(room, `${player.name} startet eine neue Reihe mit ${cardName(card)}.`, 'good');
        } else {
          const previousRank = room.rowOrder[room.rowOrder.length - 1].rank;
          if (room.rowOrder.length === 1) {
            room.rowDirection = card.rank === wrapRank(previousRank + 1) ? 1 : -1;
            addLog(room, `${player.name} legt ${cardName(card)} – Richtung ${room.rowDirection === 1 ? 'aufwärts' : 'abwärts'} ist festgelegt.`, 'good');
          } else {
            addLog(room, `${player.name} legt ${cardName(card)}.`, 'good');
          }
          room.currentRow[card.rank - 1] = card;
          room.rowOrder.push(card);
        }
        room.lastPlayedBy = playerId;
        room.consecutiveSkips = 0;
        payoutSpecial(room, card, player);
        if (hand.length === 0) {
          endRound(room, playerId);
        } else if (room.rowOrder.length === 13) {
          archiveRow(room, 'vollständiger 13er-Zyklus');
          room.currentRow = Array(13).fill(null);
          room.rowOrder = [];
          room.rowDirection = null;
          room.newRowMode = true;
          room.activePlayerIndex = room.players.findIndex(p => p.id === playerId);
          addLog(room, `Alle 13 Ränge sind vollständig! ${player.name} eröffnet sofort eine neue Reihe.`, 'special');
        } else {
          // Erfolgreiches Legen beendet den Zug NICHT mehr. Der Spieler darf so lange
          // weitere passende Karten legen, bis er freiwillig skippt oder nicht mehr kann.
          room.activePlayerIndex = room.players.findIndex(p => p.id === playerId);
        }
      } else if (action === 'skip') {
        if (room.phase !== 'playing') throw new Error('Die Runde läuft gerade nicht.');
        requireTurn(room, playerId);
        if (room.newRowMode) throw new Error('Du musst eine neue Reihe eröffnen und kannst jetzt nicht skippen.');
        room.consecutiveSkips += 1;
        addLog(room, `${player.name} skippt.`);
        if (room.consecutiveSkips >= activePlayerCount(room) && room.lastPlayedBy) {
          archiveRow(room, 'unterbrochen nach kompletter Skip-Runde');
          room.currentRow = Array(13).fill(null);
          room.rowOrder = [];
          room.rowDirection = null;
          room.newRowMode = true;
          const lastIndex = room.players.findIndex(p => p.id === room.lastPlayedBy);
          room.activePlayerIndex = nextActivePlayerIndex(room, lastIndex);
          room.consecutiveSkips = 0;
          const opener = room.players[room.activePlayerIndex];
          const lastPlayer = room.players[lastIndex];
          addLog(room, `Niemand konnte die Reihe fortsetzen. Nach ${lastPlayer.name} eröffnet jetzt der nachfolgende Spieler ${opener.name} eine neue Reihe.`, 'special');
        } else {
          advanceTurn(room);
        }
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
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
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

  // Hosting health check (z. B. Render). Enthält keine Spiel- oder Nutzerdaten.
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'gelber-zwerg', rooms: rooms.size });
  }

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
  console.log(`Gelber Zwerg läuft auf http://localhost:${PORT}`);
});
