(() => {
  const CHIP_VALUES = { bronze: 1, silver: 2, gold: 5 };
  const CHIP_LABELS = { bronze: 'Bronze', silver: 'Silber', gold: 'Gold' };
  const RANK_LABELS = { 1:'A',2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'B',12:'D',13:'K' };
  const SUIT_LABELS = { green:'Grün', red:'Rot', flame:'Flammen', pokeball:'Pokéball' };
  const MODE_LABELS = { standard:'Standard', abschiebe:'Abschiebe', chaos:'Chaos' };
  const els = Object.fromEntries([
    'entryScreen','lobbyScreen','gameScreen','playerName','roomCodeInput','createRoomBtn','joinRoomBtn','entryError',
    'roomCodeLabel','copyRoomBtn','lobbyPlayers','lobbyCountText','hostBadge','startGameBtn','lobbyWaitText','leaveLobbyBtn','modeChoices','modeHelp','modeBadge',
    'gameRoomCode','roundLabel','gameModeLabel','phaseTitle','copyGameLinkBtn','rulesBtn','leaveGameBtn','playersStrip','statusPhase','statusActive','statusRow','statusPot',
    'rowSection','potHint','potTotal','potLegend','antePanel','anteStateText','chipInventory','autoAnteBtn','confirmAnteBtn','turnPanel','turnText','skipBtn',
    'abilityPanel','abilityName','abilityUses','abilityDescription','abilityStatus','abilityBtn','handPanel','rowHint','leftoverCount','skipCount','rankTrack','handHint','myHandCount','handCards',
    'rulesDialog','closeRulesBtn','roundDialog','roundTitle','roundSummary','nextRoundBtn','gameOverLeaveBtn','roundWaitText',
    'abilityDialog','abilityDialogTitle','abilityDialogBody','closeAbilityBtn','reactionDialog','reactionCards','reactionPassBtn','toast'
  ].map(id => [id, document.getElementById(id)]));

  let session = loadSession();
  let gameState = null;
  let pollTimer = null;
  let eventSource = null;
  let selectedChip = null;
  let toastTimer = null;
  let busy = false;
  let selectedAbilityCards = new Set();

  function showScreen(name) {
    for (const screen of [els.entryScreen, els.lobbyScreen, els.gameScreen]) screen.classList.remove('active');
    if (name === 'entry') els.entryScreen.classList.add('active');
    if (name === 'lobby') els.lobbyScreen.classList.add('active');
    if (name === 'game') els.gameScreen.classList.add('active');
  }
  function saveSession(roomCode, playerId, name) {
    session = { roomCode, playerId, name };
    localStorage.setItem('gelberZwergSession', JSON.stringify(session));
  }
  function loadSession() { try { return JSON.parse(localStorage.getItem('gelberZwergSession') || 'null'); } catch { return null; } }
  function clearSession() {
    session = null; gameState = null; selectedChip = null;
    localStorage.removeItem('gelberZwergSession');
    stopPolling();
    [els.roundDialog, els.abilityDialog, els.reactionDialog].forEach(d => { if (d?.open) d.close(); });
    showScreen('entry');
  }
  async function api(path, options = {}) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    const data = await res.json().catch(() => ({ ok:false, error:'Serverantwort konnte nicht gelesen werden.' }));
    if (!res.ok || !data.ok) throw new Error(data.error || 'Unbekannter Fehler.');
    return data;
  }
  function cleanCode(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function initials(name) { return String(name).trim().split(/\s+/).filter(Boolean).slice(0,2).map(p => p[0]?.toUpperCase() || '').join('') || '?'; }
  function chipValue(c) { return (c?.bronze || 0) + (c?.silver || 0)*2 + (c?.gold || 0)*5; }
  function formatChips(c) { return `🟤 ${c.bronze} · ⚪ ${c.silver} · 🟡 ${c.gold}`; }
  function reqText(c) {
    const parts=[]; if(c?.bronze) parts.push(`${c.bronze} Bronze`); if(c?.silver) parts.push(`${c.silver} Silber`); if(c?.gold) parts.push(`${c.gold} Gold`); return parts.join(', ') || '–';
  }
  function requirementsMet(req, paid) { return ['bronze','silver','gold'].every(t => (paid?.[t] || 0) >= (req?.[t] || 0)); }
  function remaining(req, paid) { return { bronze:Math.max(0,req.bronze-(paid?.bronze||0)), silver:Math.max(0,req.silver-(paid?.silver||0)), gold:Math.max(0,req.gold-(paid?.gold||0)) }; }
  function selfCard(id) { return gameState?.self?.hand?.find(c => c.id === id); }
  function cardLabel(card) { return card ? `${SUIT_LABELS[card.suit]} ${RANK_LABELS[card.rank]}` : 'Karte'; }

  async function createRoom() {
    const name = els.playerName.value.trim();
    if (name.length < 2) return showEntryError('Bitte zuerst einen Spielernamen eingeben.');
    setBusy(true);
    try {
      const data = await api('/api/create', { method:'POST', body: JSON.stringify({ name }) });
      saveSession(data.roomCode, data.playerId, name);
      gameState = data.state;
      routeByState();
      startPolling();
    } catch (e) { showEntryError(e.message); }
    finally { setBusy(false); }
  }
  async function joinRoom() {
    const name = els.playerName.value.trim();
    const roomCode = cleanCode(els.roomCodeInput.value);
    if (name.length < 2) return showEntryError('Bitte zuerst einen Spielernamen eingeben.');
    if (roomCode.length !== 5) return showEntryError('Bitte einen gültigen 5-stelligen Raumcode eingeben.');
    setBusy(true);
    try {
      const data = await api('/api/join', { method:'POST', body: JSON.stringify({ name, roomCode }) });
      saveSession(data.roomCode, data.playerId, name);
      gameState = data.state;
      routeByState();
      startPolling();
    } catch (e) { showEntryError(e.message); }
    finally { setBusy(false); }
  }
  function setBusy(on) { busy = on; els.createRoomBtn.disabled = on; els.joinRoomBtn.disabled = on; }
  function showEntryError(msg) { els.entryError.textContent = msg; els.entryError.classList.remove('hidden'); }
  function clearEntryError() { els.entryError.classList.add('hidden'); }

  async function refreshState({silent=true} = {}) {
    if (!session || busy) return;
    try {
      const data = await api(`/api/state?room=${encodeURIComponent(session.roomCode)}&playerId=${encodeURIComponent(session.playerId)}`);
      gameState = data.state;
      routeByState();
    } catch (e) {
      if (!silent) toast(e.message);
      if (/nicht gefunden|abgelaufen|Spieler nicht/.test(e.message)) clearSession();
    }
  }
  function startPolling() {
    stopPolling(); startRealtime();
    pollTimer = setInterval(() => refreshState(), 5000);
  }
  function startRealtime() {
    if (!session || typeof EventSource === 'undefined') return;
    const url = `/api/events?room=${encodeURIComponent(session.roomCode)}&playerId=${encodeURIComponent(session.playerId)}`;
    eventSource = new EventSource(url);
    eventSource.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data?.state) { gameState = data.state; routeByState(); }
      } catch {}
    };
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer); pollTimer = null;
    if (eventSource) eventSource.close(); eventSource = null;
  }

  function routeByState() {
    if (!gameState) return;
    if (!['roundEnd','gameOver'].includes(gameState.phase) && els.roundDialog.open) els.roundDialog.close();
    if (gameState.phase === 'lobby') { showScreen('lobby'); renderLobby(); }
    else { showScreen('game'); renderGame(); }
    syncReactionDialog();
  }

  function renderLobby() {
    els.roomCodeLabel.textContent = gameState.code;
    els.lobbyCountText.textContent = `${gameState.players.length}/6 Spieler`;
    els.hostBadge.classList.toggle('hidden', !gameState.isHost);
    els.lobbyPlayers.innerHTML = [...Array(6)].map((_,i) => {
      const p = gameState.players[i];
      if (!p) return `<div class="lobby-player empty"><div class="avatar">${i+1}</div><div><strong>Freier Platz</strong><span>Warte auf Mitspieler</span></div></div>`;
      return `<div class="lobby-player"><div class="avatar">${escapeHtml(initials(p.name))}</div><div><strong>${escapeHtml(p.name)}</strong><span>${p.isHost ? 'Host' : 'Spieler'}${p.id===gameState.self.id ? ' · Du' : ''}</span></div></div>`;
    }).join('');
    const mode = gameState.gameMode || 'standard';
    els.modeBadge.textContent = MODE_LABELS[mode];
    els.modeHelp.textContent = gameState.isHost ? 'Wähle den Modus vor dem Start.' : `Der Host hat ${MODE_LABELS[mode]} gewählt.`;
    els.modeChoices.querySelectorAll('[data-mode]').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.mode === mode);
      btn.disabled = !gameState.isHost;
    });
    const enough = gameState.players.length >= 3 && gameState.players.length <= 6;
    els.startGameBtn.classList.toggle('hidden', !gameState.isHost);
    els.startGameBtn.disabled = !enough;
    els.lobbyWaitText.textContent = gameState.isHost
      ? (enough ? `${MODE_LABELS[mode]} ist gewählt. Wenn alle bereit sind: starten.` : 'Mindestens 3 Spieler werden benötigt; maximal 6 können mitspielen.')
      : 'Warte darauf, dass der Host das Spiel startet …';
  }

  function renderGame() {
    els.gameRoomCode.textContent = gameState.code;
    els.roundLabel.textContent = gameState.round;
    els.gameModeLabel.textContent = MODE_LABELS[gameState.gameMode] || gameState.gameMode;
    const phaseTitle = gameState.phase === 'ante' ? 'Einsatzphase' : gameState.phase === 'playing' ? 'Spielrunde' : gameState.phase === 'gameOver' ? 'Partie beendet' : 'Runde beendet';
    els.phaseTitle.textContent = phaseTitle;
    els.statusPhase.textContent = phaseTitle;
    els.potTotal.textContent = gameState.totalPotValue;
    if (gameState.endgame?.active) els.statusPot.textContent = `🔥 Grenze ${gameState.endgame.eliminationThreshold} · ×${gameState.endgame.cardPenaltyMultiplier} · Pot ${gameState.totalPotValue}`;
    else els.statusPot.textContent = `Pot ${gameState.totalPotValue}`;

    renderPlayers();
    renderPots();
    renderAbility();

    if (gameState.phase === 'ante') {
      els.statusActive.textContent = gameState.self.eliminated ? 'Ausgeschieden' : (gameState.anteConfirmed ? 'Einsatz bestätigt' : gameState.self.name);
      const active = gameState.players.filter(p => !p.eliminated);
      const confirmed = active.filter(p => p.anteConfirmed).length;
      els.statusRow.textContent = `${confirmed}/${active.length} bereit`;
      els.antePanel.classList.remove('hidden');
      els.turnPanel.classList.add('hidden');
      els.rowSection.classList.add('hidden');
      els.handPanel.classList.add('hidden');
      renderAnte();
    } else if (gameState.phase === 'playing') {
      els.statusActive.textContent = gameState.reactionWaitingName ? `${gameState.reactionWaitingName} reagiert` : (gameState.activePlayerName || '—');
      els.statusRow.textContent = gameState.newRowMode ? 'Neue Reihe' : `${directionText()} · ${legalRankText()}`;
      els.antePanel.classList.add('hidden');
      els.turnPanel.classList.toggle('hidden', !!gameState.self.eliminated);
      els.rowSection.classList.remove('hidden');
      els.handPanel.classList.remove('hidden');
      renderPlay();
    } else if (gameState.phase === 'roundEnd') {
      els.statusActive.textContent = gameState.roundSummary?.winnerName || '—';
      els.statusRow.textContent = 'Runde abgeschlossen';
      els.antePanel.classList.add('hidden'); els.turnPanel.classList.add('hidden');
      els.rowSection.classList.remove('hidden'); els.handPanel.classList.remove('hidden');
      renderPlay(); showRoundDialog();
    } else if (gameState.phase === 'gameOver') {
      els.statusActive.textContent = gameState.gameSummary?.winnerName || (gameState.gameSummary?.tied ? 'Unentschieden' : '—');
      els.statusRow.textContent = 'Partie beendet';
      els.antePanel.classList.add('hidden'); els.turnPanel.classList.add('hidden'); els.rowSection.classList.add('hidden'); els.handPanel.classList.add('hidden');
      showGameOverDialog();
    }
  }

  function renderPlayers() {
    els.playersStrip.innerHTML = gameState.players.map(p => {
      const tag = p.eliminated ? 'Raus' : p.id === gameState.self.id ? 'Du' : p.isHost ? 'Host' : p.isActive ? 'Am Zug' : '';
      return `<div class="player-card ${p.isActive && gameState.phase==='playing' ? 'active' : ''} ${p.eliminated ? 'eliminated' : ''}">
        <div class="avatar">${escapeHtml(initials(p.name))}</div>
        <div class="player-card-body">
          <div class="player-name-line"><span>${escapeHtml(p.name)}</span>${tag ? `<span class="tag">${tag}</span>` : ''}</div>
          <div class="player-meta"><span>🂠 <strong>${p.handCount}</strong></span><span>Wert <strong>${chipValue(p.chips)}</strong></span>${gameState.phase==='ante'?`<span>${p.eliminated?'raus':p.anteConfirmed?'✓':'zahlt'}</span>`:''}</div>
          <div class="mini-chips">${miniChip('bronze',p.chips.bronze)}${miniChip('silver',p.chips.silver)}${miniChip('gold',p.chips.gold)}</div>
        </div>
      </div>`;
    }).join('');
  }
  function miniChip(type,count){ return `<span class="mini-chip ${type}">${count}</span>`; }

  function renderPots() {
    Object.entries(gameState.potDefs).forEach(([potId, def]) => {
      const zone = document.querySelector(`[data-pot="${potId}"]`);
      if (!zone) return;
      const chips = gameState.pots[potId].chips;
      zone.innerHTML = `<div class="pot-chip-stack">${potChipIcons(chips)}</div><div class="pot-badge"><span>${formatChips(chips)}</span><strong>${chipValue(chips)}</strong></div>`;
      zone.title = def.label;
      zone.classList.remove('selected-target');
      if (gameState.phase==='ante' && selectedChip && !gameState.anteConfirmed) {
        const paid = gameState.antePaid?.[potId] || {bronze:0,silver:0,gold:0};
        const required = gameState.anteRequirements?.[potId] || def.required;
        if (required[selectedChip] > paid[selectedChip]) zone.classList.add('selected-target');
      }
    });
    const ability = gameState.self.ability;
    els.potLegend.innerHTML = Object.entries(gameState.potDefs).map(([potId,def]) => {
      const pot = gameState.pots[potId].chips;
      let status = '<span>Auszahlung beim Ausspielen</span>';
      const required = gameState.anteRequirements?.[potId] || def.required;
      const doubled = chipValue(required) > chipValue(def.required);
      if (gameState.phase==='ante') {
        const paid = gameState.antePaid?.[potId] || {bronze:0,silver:0,gold:0};
        if (gameState.anteResolution?.automatic) status = '<span class="req-ok">Zufällige Not-Einzahlung</span>';
        else status = requirementsMet(required, paid) ? '<span class="req-ok">✓ bezahlt</span>' : `<span class="req-missing">Offen: ${reqText(remaining(required, paid))}</span>`;
      }
      const marker = gameState.gameMode==='chaos' && ability?.selectedPot === potId
        ? ability.id === 'gluecksritter' ? '<span class="ability-marker">🍀 Dein Ziel</span>' : ability.id === 'halsabschneider' ? '<span class="ability-marker">🔪 Markiert</span>' : ''
        : '';
      return `<div class="pot-legend-item"><strong>${def.label}</strong>${status}${marker}<span>Pflicht: ${reqText(required)}${doubled ? ' · ⚠ doppelt' : ''} · Pot ${chipValue(pot)}</span></div>`;
    }).join('');
  }
  function potChipIcons(chips) {
    const out=[];
    for(const type of ['bronze','silver','gold']){
      const count=Math.min(chips[type],4);
      for(let i=0;i<count;i++) out.push(`<span class="tiny-chip ${type}"></span>`);
      if(chips[type]>4) out.push(`<span class="tiny-more">+${chips[type]-4}</span>`);
    }
    return out.join('');
  }

  function renderAnte() {
    const self = gameState.self;
    const resolution = gameState.anteResolution;
    const reqs = gameState.anteRequirements || Object.fromEntries(Object.entries(gameState.potDefs).map(([id,def]) => [id,def.required]));
    const personalTotal = Object.values(reqs).reduce((sum, req) => sum + chipValue(req), 0);
    const hasPenalty = Object.entries(gameState.potDefs).some(([potId,def]) => chipValue(reqs[potId] || def.required) > chipValue(def.required));
    const threshold = resolution?.threshold || gameState.endgame?.eliminationThreshold || 7;

    if (self.eliminated) {
      els.potHint.textContent = 'Deine restlichen Chips wurden zufällig auf die Pots verteilt.';
      els.anteStateText.textContent = `Du hattest vor der Einzahlung Chipwert ${resolution?.startingValue ?? 0}. Unter ${threshold} scheidest du aus und kannst zuschauen.`;
      els.chipInventory.innerHTML = '<div class="subtle">Du erhältst keine Karten mehr.</div>';
      els.autoAnteBtn.disabled = true; els.confirmAnteBtn.disabled = true; els.confirmAnteBtn.textContent = 'Ausgeschieden';
      return;
    }
    if (resolution?.automatic) {
      els.potHint.textContent = 'Dein kompletter Restbestand wurde automatisch zufällig auf die fünf Pots verteilt.';
      els.anteStateText.textContent = `Du hattest Chipwert ${resolution.startingValue}, konntest Einsatz ${resolution.requiredValue} nicht zahlen und bleibst ab ${threshold} im Spiel.`;
      els.chipInventory.innerHTML = '<div class="subtle">Alle vorhandenen Chips wurden eingezahlt. Warte auf die übrigen Spieler.</div>';
      els.autoAnteBtn.disabled = true; els.confirmAnteBtn.disabled = true; els.confirmAnteBtn.textContent = '✓ Automatisch eingezahlt';
      return;
    }
    els.potHint.textContent = gameState.anteConfirmed ? 'Dein Einsatz ist bestätigt.' : 'Ziehe Chips auf die Pot-Felder oder zahle automatisch ein.';
    els.anteStateText.textContent = gameState.anteConfirmed ? 'Einsatz bestätigt – du bist bereit.' : `Pflicht-Einsatz: Wert ${personalTotal}${hasPenalty ? ' · Doppel-Einsatz aktiv' : ''}. Ausscheidungsgrenze bei Not-Einzahlung: ${threshold}.`;
    els.chipInventory.innerHTML = ['bronze','silver','gold'].map(type => `
      <div class="chip-pack"><div class="chip ${type} ${selectedChip===type?'selected':''}" data-chip="${type}" draggable="${!gameState.anteConfirmed && self.chips[type]>0}">${CHIP_VALUES[type]}</div>
      <div><div class="chip-count">${self.chips[type]} × ${CHIP_LABELS[type]}</div><div class="chip-value">Wert ${CHIP_VALUES[type]}</div></div></div>`).join('');
    els.autoAnteBtn.disabled = gameState.anteConfirmed;
    els.confirmAnteBtn.disabled = gameState.anteConfirmed || !myAnteComplete();
    els.confirmAnteBtn.textContent = gameState.anteConfirmed ? '✓ Einsatz bestätigt' : 'Einsatz bestätigen';
  }
  function myAnteComplete(){
    if(!gameState.antePaid) return false;
    return Object.entries(gameState.potDefs).every(([potId,def])=>requirementsMet(gameState.anteRequirements?.[potId] || def.required,gameState.antePaid[potId]));
  }

  function renderPlay() {
    const reaction = !!gameState.self.reaction;
    const myTurn = !reaction && !gameState.self.eliminated && gameState.activePlayerId === gameState.self.id && gameState.phase === 'playing';
    const prompt = gameState.newRowMode ? 'Eine beliebige nicht blockierte Karte eröffnet die neue Reihe.' : `Du bleibst am Zug. Nächster Rang: ${legalRankText()}.`;
    els.turnText.textContent = reaction ? 'Nachtreter-Reaktion: Wähle eine Karte oder lehne ab.' : myTurn ? prompt : `Warte auf ${gameState.activePlayerName || 'den aktiven Spieler'} …`;
    els.skipBtn.disabled = !myTurn || gameState.newRowMode;
    const extras = [];
    if (gameState.blockedRank) extras.push(`⛔ ${RANK_LABELS[gameState.blockedRank]} blockiert${gameState.blockedByName ? ` von ${gameState.blockedByName}` : ''}`);
    if (gameState.springerGapRank) extras.push(`🦘 Lücke: ${RANK_LABELS[gameState.springerGapRank]}`);
    els.rowHint.textContent = gameState.newRowMode
      ? `${gameState.activePlayerName} darf eine neue Reihe eröffnen.${extras.length ? ` ${extras.join(' · ')}` : ''}`
      : `${directionText()} · Anlegen: ${legalRankText()} · ${extras.join(' · ')}`.replace(/ · $/,'');
    els.leftoverCount.textContent = gameState.leftoverCount;
    els.skipCount.textContent = gameState.consecutiveSkips;
    els.rankTrack.innerHTML = Array.from({length:13},(_,i)=>{
      const rank=i+1, card=gameState.currentRow[i];
      const edge=!gameState.newRowMode && edgeRank(rank);
      const blocked=gameState.blockedRank===rank;
      const gap=gameState.springerGapRank===rank && !card;
      const badge = card?.forged ? '<span class="slot-badge">Fälschung</span>' : card?.springer ? '<span class="slot-badge">Sprung</span>' : card?.reaction ? '<span class="slot-badge">Nachtritt</span>' : gap ? '<span class="slot-badge gap">Lücke</span>' : blocked ? '<span class="slot-badge blocked">BLOCK</span>' : '';
      return `<div class="rank-slot ${edge?'edge':''} ${blocked?'blocked':''} ${gap?'gap':''}"><span class="rank-label">${RANK_LABELS[rank]}</span>${card?`<img src="${card.image}" alt="${escapeHtml(card.id)}" />`:''}${badge}</div>`;
    }).join('');
    els.myHandCount.textContent = gameState.self.hand.length;
    els.handHint.textContent = gameState.self.eliminated ? 'Du bist ausgeschieden und schaust zu.' : reaction ? 'Nachtreter ist aktiv – spiele genau eine angebotene Karte im Pop-up.' : myTurn ? prompt : 'Deine Karten bleiben privat. Die Hand überlappt automatisch, damit sie groß bleibt.';
    els.handCards.innerHTML = gameState.self.hand.map((card, index) => {
      const playable = myTurn && (gameState.newRowMode || gameState.legalRanks.includes(card.rank));
      return `<button class="hand-card ${playable?'playable':'unplayable'}" style="--card-index:${index}" data-card-id="${card.id}" ${playable?'':'disabled'}><img src="${card.image}" alt="${escapeHtml(card.id)}" />${playable?'<span class="legal-pill">spielbar</span>':''}</button>`;
    }).join('');
  }
  function legalRankText(){ return (gameState.legalRanks || []).map(r=>RANK_LABELS[r]).join(' oder ') || 'keine'; }
  function directionText(){
    if (gameState.newRowMode) return 'Neue Reihe';
    if (gameState.rowDirection === 1) return 'Richtung ↑ zyklisch';
    if (gameState.rowDirection === -1) return 'Richtung ↓ zyklisch';
    return 'Richtung noch offen';
  }
  function edgeRank(rank){ return !gameState.newRowMode && (gameState.legalRanks || []).includes(rank); }

  function renderAbility() {
    const ability = gameState.self.ability;
    const show = gameState.gameMode === 'chaos' && ability;
    els.abilityPanel.classList.toggle('hidden', !show);
    if (!show) return;
    els.abilityName.textContent = ability.name;
    els.abilityDescription.textContent = ability.description;
    els.abilityStatus.textContent = ability.reason || (ability.canUse ? 'Bereit.' : 'Aktuell nicht verfügbar.');
    if (ability.kind === 'passive') els.abilityUses.textContent = 'Passiv';
    else if (ability.kind === 'reactive') els.abilityUses.textContent = `${ability.uses}/${ability.maxUses}`;
    else els.abilityUses.textContent = `${ability.uses}/${ability.maxUses}`;
    const nonButton = ['passive','reactive'].includes(ability.kind);
    const reviewable = !!ability.info && ['spaeher','zocker','tauschen','schmuggler'].includes(ability.id);
    els.abilityBtn.disabled = ((!ability.canUse && !reviewable) || nonButton || busy);
    els.abilityBtn.textContent = ability.kind === 'passive' ? 'Automatisch' : ability.kind === 'reactive' ? 'Automatisch gefragt' : ability.armed ? 'Aktiviert' : (!ability.canUse && reviewable ? 'Infos ansehen' : 'Fähigkeit nutzen');
  }

  function showRoundDialog() {
    if (gameState.phase !== 'roundEnd' || !gameState.roundSummary) return;
    els.gameOverLeaveBtn.classList.add('hidden');
    const s = gameState.roundSummary;
    els.roundTitle.textContent = `${s.winnerName} gewinnt Runde ${gameState.round}!`;
    const penalties = s.penalties || [];
    els.roundSummary.innerHTML = `<div class="summary-row"><strong>Gewinner</strong><span>${escapeHtml(s.winnerName)}</span></div>
      <div class="summary-row"><strong>Restkarten-Strafe</strong><span>×${s.cardPenaltyMultiplier || 1}</span></div>
      <div class="summary-row"><strong>Erhaltener Wert</strong><span>${s.totalReceived}</span></div>
      ${s.payments.map(p=>`<div class="summary-row"><span>${escapeHtml(p.name)} · ${p.cards} Karten × ${p.multiplier}</span><strong>−${p.paid}</strong></div>`).join('')}
      ${penalties.length ? `<div class="subtle"><strong>⚠ Doppel-Einsatz nächste Runde:</strong></div>${penalties.map(p=>`<div class="summary-row"><span>${escapeHtml(p.name)} · ${escapeHtml(p.label)}</span><strong>${reqText(p.next)}</strong></div>`).join('')}` : ''}
      ${gameState.endgame?.active ? `<div class="endgame-note">🔥 Endgame aktiv · aktuelle Ausscheidungsgrenze ${gameState.endgame.eliminationThreshold} · Restkarten ×${gameState.endgame.cardPenaltyMultiplier}</div>` : ''}`;
    els.nextRoundBtn.classList.toggle('hidden', !gameState.isHost);
    els.roundWaitText.classList.toggle('hidden', gameState.isHost);
    if (!els.roundDialog.open) els.roundDialog.showModal();
  }
  function showGameOverDialog() {
    if (gameState.phase !== 'gameOver' || !gameState.gameSummary) return;
    const s = gameState.gameSummary;
    els.roundTitle.textContent = s.tied ? 'Partie beendet – Unentschieden' : `${s.winnerName} gewinnt die Partie!`;
    els.roundSummary.innerHTML = `${s.standings.map((p,i)=>`<div class="summary-row"><span>${i+1}. ${escapeHtml(p.name)}</span><strong>Chipwert ${p.value}</strong></div>`).join('')}
      <div class="subtle">Die Partie endet, sobald nach der Einzahl-/Ausscheidungsphase nur noch zwei aktive Spieler übrig sind.</div>`;
    els.nextRoundBtn.classList.add('hidden'); els.roundWaitText.classList.add('hidden'); els.gameOverLeaveBtn.classList.remove('hidden');
    if (!els.roundDialog.open) els.roundDialog.showModal();
  }

  function cardChoiceHtml(card, attrs='') {
    return `<button class="ability-card-choice" ${attrs}><img src="${card.image}" alt="${escapeHtml(card.id)}"><span>${escapeHtml(cardLabel(card))}</span></button>`;
  }
  function openAbilityDialog() {
    const ability = gameState.self.ability;
    if (!ability || (!ability.canUse && !ability.info)) return;
    selectedAbilityCards = new Set();
    els.abilityDialogTitle.textContent = ability.name;
    els.abilityDialogBody.innerHTML = abilityDialogContent(ability);
    if (!els.abilityDialog.open) els.abilityDialog.showModal();
  }
  function abilityDialogContent(a) {
    const info = abilityInfoHtml(a);
    if (!a.canUse) return info || `<p class="subtle">${escapeHtml(a.reason || 'Aktuell nicht verfügbar.')}</p>`;
    if (a.id === 'tauschen') {
      return `<p>Wähle genau <strong>2 Karten</strong>, die du gegen zwei zufällige Restkarten tauschen willst.</p><div class="ability-card-grid">${gameState.self.hand.map(c=>cardChoiceHtml(c,`data-ability-card="${c.id}"`)).join('')}</div><button class="btn primary full" data-ability-confirm="tauschen" disabled>Tauschen</button>${info}`;
    }
    if (a.id === 'fallensteller' || a.id === 'blockierer') {
      const ranks = a.options.ranks || [];
      return `<p>${a.id==='fallensteller'?'Wähle den geheimen Fallen-Rang.':'Wähle den Rang, der bis zu deinem nächsten regulären Zug blockiert bleibt.'}</p><div class="choice-grid rank-choices">${ranks.map(r=>`<button class="choice-btn" data-rank="${r}">${RANK_LABELS[r]}</button>`).join('')}</div>${info}`;
    }
    if (a.id === 'springer') {
      const cards = (a.options.cardIds || []).map(selfCard).filter(Boolean);
      return `<p>Du überspringst <strong>${RANK_LABELS[a.options.skippedRank]}</strong> und legst direkt <strong>${RANK_LABELS[a.options.jumpRank]}</strong>. Kosten: je 1 Bronze in alle fünf Pots.</p><div class="ability-card-grid">${cards.map(c=>cardChoiceHtml(c,`data-springer-card="${c.id}"`)).join('')}</div>${info}`;
    }
    if (a.id === 'kehrtwende') return `<p>Die Richtung wird vom Startpunkt der Reihe aus umgedreht. Kosten: <strong>1 Silber</strong> in einen zufälligen Pot.</p><button class="btn primary full" data-simple-ability="kehrtwende">Kehrtwende aktivieren</button>${info}`;
    if (a.id === 'spaeher') return `<p>Du siehst privat 2 zufällige Karten jedes Gegners und 4 Karten aus dem Reststapel.</p><button class="btn primary full" data-simple-ability="spaeher">Jetzt spähen</button>${info}`;
    if (a.id === 'schmuggler') return `<p>Wähle die Karte, die in den Reststapel zurückgeht. Du ziehst zufällig eine andere und dein Zug endet.</p><div class="ability-card-grid">${gameState.self.hand.map(c=>cardChoiceHtml(c,`data-schmuggler-card="${c.id}"`)).join('')}</div>${info}`;
    if (a.id === 'draengler') return `<p>Aktiviere Drängler. Wenn du danach deinen Zug mit Skip beendest, wird der direkt nächste aktive Spieler übersprungen.</p><button class="btn primary full" data-simple-ability="draengler">Drängler aktivieren</button>${info}`;
    if (a.id === 'gluecksritter' || a.id === 'halsabschneider') {
      return `<p>${a.id==='gluecksritter'?'Wähle geheim deinen Ziel-Pot. Räumst du ihn selbst ab, bekommst du 3 Bronze aus der Bank.':'Wähle den Pot, dessen Auszahlung diese Runde halbiert wird.'}</p><div class="choice-grid pot-choices">${Object.entries(gameState.potDefs).map(([id,d])=>`<button class="choice-btn" data-pot-choice="${id}">${escapeHtml(d.label)}<small>Wert ${chipValue(gameState.pots[id].chips)}</small></button>`).join('')}</div>${info}`;
    }
    if (a.id === 'zocker') {
      return `<p>Setze <strong>Wert 2</strong> auf eine Familie. Treffer bringt <strong>Wert 5</strong> aus der Bank.</p><div class="choice-grid suit-choices">${Object.entries(SUIT_LABELS).map(([id,label])=>`<button class="choice-btn" data-suit="${id}">${label}</button>`).join('')}</div>${info}`;
    }
    if (a.id === 'faelscher') {
      const opts = a.options.forgeries || [];
      return `<p>Spiele eine Karte einmalig als direkten Nachbarrang. Die Fälschung löst keinen Spezial-Pot aus.</p><div class="forgery-list">${opts.map(o=>{const c=selfCard(o.cardId);return `<button class="forgery-option" data-forge-card="${o.cardId}" data-forge-direction="${o.direction}"><img src="${c?.image}" alt=""><span>${escapeHtml(cardLabel(c))} → <strong>${RANK_LABELS[o.asRank]}</strong></span></button>`}).join('')}</div>${info}`;
    }
    return info || '<p class="subtle">Diese Fähigkeit läuft automatisch.</p>';
  }
  function abilityInfoHtml(a) {
    if (!a?.info) return '';
    if (a.id === 'spaeher') {
      const players = (a.info.players || []).map(p => `<div class="scout-group"><strong>${escapeHtml(p.name)}</strong><div class="scout-cards">${(p.cards||[]).map(c=>`<img src="${c.image}" alt="${escapeHtml(c.id)}" title="${escapeHtml(cardLabel(c))}">`).join('') || '<span>Keine Karten</span>'}</div></div>`).join('');
      const rest = (a.info.leftovers || []).map(c=>`<img src="${c.image}" alt="${escapeHtml(c.id)}" title="${escapeHtml(cardLabel(c))}">`).join('');
      return `<div class="ability-result"><h4>Deine Späher-Infos</h4>${players}<div class="scout-group"><strong>Reststapel</strong><div class="scout-cards">${rest || '<span>Keine Karten</span>'}</div></div></div>`;
    }
    if (a.id === 'zocker') {
      const r=a.info.revealed;
      return `<div class="ability-result ${a.info.won?'won':'lost'}"><h4>${a.info.won?'🎉 Treffer!':'💥 Daneben'}</h4><p>Du hast auf ${SUIT_LABELS[a.info.suit]} gesetzt. Aufgedeckt wurde:</p>${r?`<img class="result-card" src="${r.image}" alt="${escapeHtml(r.id)}"><strong>${escapeHtml(cardLabel(r))}</strong>`:''}</div>`;
    }
    if (a.id === 'tauschen' && a.info.drew) return `<div class="ability-result"><h4>Neu gezogen</h4><div class="scout-cards">${a.info.drew.map(c=>`<img src="${c.image}" alt="${escapeHtml(c.id)}" title="${escapeHtml(cardLabel(c))}">`).join('')}</div></div>`;
    if (a.id === 'schmuggler' && a.info.drew) return `<div class="ability-result"><h4>Geschmuggelt</h4><img class="result-card" src="${a.info.drew.image}" alt="${escapeHtml(a.info.drew.id)}"><strong>${escapeHtml(cardLabel(a.info.drew))}</strong></div>`;
    return '';
  }
  async function useAbility(payload = {}, showResult = false) {
    const beforeId = gameState.self.ability?.id;
    if (els.abilityDialog.open) els.abilityDialog.close();
    await action('useAbility', { payload });
    if (showResult && gameState?.self?.ability?.id === beforeId && gameState.self.ability.info) {
      els.abilityDialogTitle.textContent = gameState.self.ability.name;
      els.abilityDialogBody.innerHTML = abilityInfoHtml(gameState.self.ability) || `<p class="subtle">Fähigkeit ausgeführt.</p>`;
      els.abilityDialog.showModal();
    }
  }

  function syncReactionDialog() {
    const reaction = gameState?.self?.reaction;
    if (!reaction || gameState.phase !== 'playing') {
      if (els.reactionDialog.open) els.reactionDialog.close();
      return;
    }
    const cards = (reaction.playableIds || []).map(selfCard).filter(Boolean);
    els.reactionCards.innerHTML = cards.map(c=>cardChoiceHtml(c,`data-reaction-card="${c.id}"`)).join('');
    if (!els.reactionDialog.open) els.reactionDialog.showModal();
  }

  async function action(actionName, extra={}) {
    if (!session || busy) return;
    busy = true;
    try {
      const data = await api('/api/action', { method:'POST', body:JSON.stringify({ roomCode:session.roomCode, playerId:session.playerId, action:actionName, ...extra }) });
      gameState = data.state;
      selectedChip = null;
      routeByState();
    } catch(e){ toast(e.message); }
    finally{ busy=false; renderAbility(); }
  }
  async function copyInvite() {
    if (!session) return;
    const url = new URL(location.href); url.searchParams.set('room', session.roomCode);
    try { await navigator.clipboard.writeText(url.toString()); toast('Einladungslink kopiert.'); }
    catch { toast(`Raumcode: ${session.roomCode}`); }
  }
  function toast(msg) {
    els.toast.textContent = msg; els.toast.classList.add('show'); clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>els.toast.classList.remove('show'),2400);
  }
  function leave() { if (confirm('Spiel auf diesem Gerät verlassen?')) clearSession(); }

  function setupEvents() {
    els.createRoomBtn.addEventListener('click', createRoom);
    els.joinRoomBtn.addEventListener('click', joinRoom);
    els.roomCodeInput.addEventListener('input', e => e.target.value = cleanCode(e.target.value));
    els.playerName.addEventListener('input', clearEntryError);
    els.roomCodeInput.addEventListener('keydown', e => { if(e.key==='Enter') joinRoom(); });
    els.playerName.addEventListener('keydown', e => { if(e.key==='Enter' && cleanCode(els.roomCodeInput.value).length===5) joinRoom(); });
    els.copyRoomBtn.addEventListener('click', copyInvite); els.copyGameLinkBtn.addEventListener('click', copyInvite);
    els.startGameBtn.addEventListener('click', ()=>action('start'));
    els.modeChoices.addEventListener('click', e => { const btn=e.target.closest('[data-mode]'); if(btn && gameState?.isHost) action('setMode',{mode:btn.dataset.mode}); });
    els.leaveLobbyBtn.addEventListener('click', leave); els.leaveGameBtn.addEventListener('click', leave);
    els.rulesBtn.addEventListener('click', ()=>els.rulesDialog.showModal()); els.closeRulesBtn.addEventListener('click', ()=>els.rulesDialog.close());
    els.nextRoundBtn.addEventListener('click', ()=>{ if(els.roundDialog.open) els.roundDialog.close(); action('nextRound'); });
    els.gameOverLeaveBtn.addEventListener('click', ()=>{ if(els.roundDialog.open) els.roundDialog.close(); clearSession(); });
    els.skipBtn.addEventListener('click', ()=>action('skip'));
    els.autoAnteBtn.addEventListener('click', ()=>action('autoAnte')); els.confirmAnteBtn.addEventListener('click', ()=>action('confirmAnte'));
    els.abilityBtn.addEventListener('click', openAbilityDialog); els.closeAbilityBtn.addEventListener('click', ()=>els.abilityDialog.close());

    els.chipInventory.addEventListener('click', e=>{
      const chip=e.target.closest('[data-chip]'); if(!chip || gameState?.anteConfirmed)return;
      selectedChip=selectedChip===chip.dataset.chip?null:chip.dataset.chip; renderGame();
    });
    els.chipInventory.addEventListener('dragstart', e=>{
      const chip=e.target.closest('[data-chip]'); if(!chip || chip.getAttribute('draggable')!=='true')return;
      e.dataTransfer.setData('text/plain',chip.dataset.chip); e.dataTransfer.effectAllowed='move';
    });
    document.querySelectorAll('.pot-zone').forEach(zone=>{
      zone.addEventListener('dragover',e=>{ if(gameState?.phase==='ante'&&!gameState.anteConfirmed){e.preventDefault();zone.classList.add('dragover');} });
      zone.addEventListener('dragleave',()=>zone.classList.remove('dragover'));
      zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('dragover'); const t=e.dataTransfer.getData('text/plain'); if(t)action('deposit',{potId:zone.dataset.pot,chipType:t});});
      zone.addEventListener('click',()=>{ if(gameState?.phase==='ante'&&selectedChip&&!gameState.anteConfirmed) action('deposit',{potId:zone.dataset.pot,chipType:selectedChip}); });
    });
    els.handCards.addEventListener('click',e=>{ const card=e.target.closest('[data-card-id]'); if(card&&!card.disabled)action('play',{cardId:card.dataset.cardId}); });

    els.abilityDialogBody.addEventListener('click', e => {
      const selectable = e.target.closest('[data-ability-card]');
      if (selectable) {
        const id=selectable.dataset.abilityCard;
        if(selectedAbilityCards.has(id)) selectedAbilityCards.delete(id); else if(selectedAbilityCards.size<2) selectedAbilityCards.add(id);
        selectable.classList.toggle('selected',selectedAbilityCards.has(id));
        els.abilityDialogBody.querySelector('[data-ability-confirm="tauschen"]')?.toggleAttribute('disabled', selectedAbilityCards.size!==2);
        return;
      }
      const confirmSwap=e.target.closest('[data-ability-confirm="tauschen"]'); if(confirmSwap){ useAbility({cardIds:[...selectedAbilityCards]},true); return; }
      const rank=e.target.closest('[data-rank]'); if(rank){ useAbility({rank:Number(rank.dataset.rank)}); return; }
      const spring=e.target.closest('[data-springer-card]'); if(spring){ useAbility({cardId:spring.dataset.springerCard}); return; }
      const simple=e.target.closest('[data-simple-ability]'); if(simple){ useAbility({}); return; }
      const smug=e.target.closest('[data-schmuggler-card]'); if(smug){ useAbility({cardId:smug.dataset.schmugglerCard},true); return; }
      const pot=e.target.closest('[data-pot-choice]'); if(pot){ useAbility({potId:pot.dataset.potChoice}); return; }
      const suit=e.target.closest('[data-suit]'); if(suit){ useAbility({suit:suit.dataset.suit},true); return; }
      const forge=e.target.closest('[data-forge-card]'); if(forge){ useAbility({cardId:forge.dataset.forgeCard,direction:Number(forge.dataset.forgeDirection)}); return; }
    });
    els.reactionCards.addEventListener('click', e => { const c=e.target.closest('[data-reaction-card]'); if(c){ if(els.reactionDialog.open)els.reactionDialog.close(); action('reactionPlay',{cardId:c.dataset.reactionCard}); } });
    els.reactionPassBtn.addEventListener('click', ()=>{ if(els.reactionDialog.open)els.reactionDialog.close(); action('reactionPass'); });

    window.addEventListener('focus', () => refreshState());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshState(); });
  }

  async function bootstrap() {
    setupEvents();
    const roomFromUrl = cleanCode(new URL(location.href).searchParams.get('room'));
    if (roomFromUrl) els.roomCodeInput.value = roomFromUrl;
    if (session?.name) els.playerName.value = session.name;
    if (session?.roomCode && session?.playerId) {
      try { await refreshState({silent:false}); if (gameState) { startPolling(); return; } } catch {}
    }
    showScreen('entry');
  }
  bootstrap();
})();
