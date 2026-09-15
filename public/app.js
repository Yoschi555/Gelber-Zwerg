(() => {
  const CHIP_VALUES = { bronze: 1, silver: 2, gold: 5 };
  const CHIP_LABELS = { bronze: 'Bronze', silver: 'Silber', gold: 'Gold' };
  const RANK_LABELS = { 1:'A',2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'B',12:'D',13:'K' };
  const els = Object.fromEntries([
    'entryScreen','lobbyScreen','gameScreen','playerName','roomCodeInput','createRoomBtn','joinRoomBtn','entryError',
    'roomCodeLabel','copyRoomBtn','lobbyPlayers','lobbyCountText','hostBadge','startGameBtn','lobbyWaitText','leaveLobbyBtn',
    'gameRoomCode','roundLabel','phaseTitle','copyGameLinkBtn','rulesBtn','leaveGameBtn','playersStrip','statusPhase','statusActive','statusRow','statusPot',
    'potHint','potTotal','potLegend','antePanel','anteStateText','chipInventory','autoAnteBtn','confirmAnteBtn','turnPanel','turnText','skipBtn','gameLog',
    'playSection','rowHint','leftoverCount','skipCount','rankTrack','handHint','myHandCount','handCards','rulesDialog','closeRulesBtn','roundDialog','roundTitle',
    'roundSummary','nextRoundBtn','roundWaitText','toast'
  ].map(id => [id, document.getElementById(id)]));

  let session = loadSession();
  let gameState = null;
  let pollTimer = null;
  let selectedChip = null;
  let toastTimer = null;
  let busy = false;

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
  function loadSession() {
    try { return JSON.parse(localStorage.getItem('gelberZwergSession') || 'null'); } catch { return null; }
  }
  function clearSession() {
    session = null; gameState = null; selectedChip = null;
    localStorage.removeItem('gelberZwergSession');
    stopPolling();
    showScreen('entry');
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await res.json().catch(() => ({ ok:false, error:'Serverantwort konnte nicht gelesen werden.' }));
    if (!res.ok || !data.ok) throw new Error(data.error || 'Unbekannter Fehler.');
    return data;
  }

  function cleanCode(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5); }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  function initials(name) { return String(name).trim().split(/\s+/).filter(Boolean).slice(0,2).map(p => p[0]?.toUpperCase() || '').join('') || '?'; }
  function chipValue(c) { return c.bronze + c.silver*2 + c.gold*5; }
  function formatChips(c) { return `🟤 ${c.bronze} · ⚪ ${c.silver} · 🟡 ${c.gold}`; }
  function reqText(c) {
    const parts=[]; if(c.bronze) parts.push(`${c.bronze} Bronze`); if(c.silver) parts.push(`${c.silver} Silber`); if(c.gold) parts.push(`${c.gold} Gold`); return parts.join(', ') || '–';
  }
  function requirementsMet(req, paid) { return ['bronze','silver','gold'].every(t => (paid?.[t] || 0) >= req[t]); }
  function remaining(req, paid) { return { bronze:Math.max(0,req.bronze-(paid?.bronze||0)), silver:Math.max(0,req.silver-(paid?.silver||0)), gold:Math.max(0,req.gold-(paid?.gold||0)) }; }

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

  function setBusy(on) {
    busy = on;
    els.createRoomBtn.disabled = on;
    els.joinRoomBtn.disabled = on;
  }
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
    stopPolling();
    pollTimer = setInterval(() => refreshState(), 900);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  function routeByState() {
    if (!gameState) return;
    if (gameState.phase === 'lobby') { showScreen('lobby'); renderLobby(); }
    else { showScreen('game'); renderGame(); }
  }

  function renderLobby() {
    els.roomCodeLabel.textContent = gameState.code;
    els.lobbyCountText.textContent = `${gameState.players.length}/4 Spieler`;
    els.hostBadge.classList.toggle('hidden', !gameState.isHost);
    els.lobbyPlayers.innerHTML = [...Array(4)].map((_,i) => {
      const p = gameState.players[i];
      if (!p) return `<div class="lobby-player empty"><div class="avatar">${i+1}</div><div><strong>Freier Platz</strong><span>Warte auf Mitspieler</span></div></div>`;
      return `<div class="lobby-player"><div class="avatar">${escapeHtml(initials(p.name))}</div><div><strong>${escapeHtml(p.name)}</strong><span>${p.isHost ? 'Host' : 'Spieler'}${p.id===gameState.self.id ? ' · Du' : ''}</span></div></div>`;
    }).join('');
    const enough = gameState.players.length >= 3 && gameState.players.length <= 4;
    els.startGameBtn.classList.toggle('hidden', !gameState.isHost);
    els.startGameBtn.disabled = !enough;
    els.lobbyWaitText.textContent = gameState.isHost
      ? (enough ? 'Alle bereit? Dann kannst du starten.' : 'Mindestens 3 Spieler werden benötigt.')
      : 'Warte darauf, dass der Host das Spiel startet …';
  }

  function renderGame() {
    els.gameRoomCode.textContent = gameState.code;
    els.roundLabel.textContent = gameState.round;
    const phaseTitle = gameState.phase === 'ante' ? 'Einsatzphase' : gameState.phase === 'playing' ? 'Spielrunde' : 'Runde beendet';
    els.phaseTitle.textContent = phaseTitle;
    els.statusPhase.textContent = phaseTitle;
    els.statusPot.textContent = gameState.totalPotValue;
    els.potTotal.textContent = gameState.totalPotValue;

    renderPlayers();
    renderPots();
    renderLog();

    if (gameState.phase === 'ante') {
      els.statusActive.textContent = gameState.anteConfirmed ? 'Einsatz bestätigt' : gameState.self.name;
      const confirmed = gameState.players.filter(p => p.anteConfirmed).length;
      els.statusRow.textContent = `${confirmed}/${gameState.players.length} bereit`;
      els.antePanel.classList.remove('hidden');
      els.turnPanel.classList.add('hidden');
      els.playSection.classList.add('hidden');
      renderAnte();
    } else if (gameState.phase === 'playing') {
      els.statusActive.textContent = gameState.activePlayerName || '—';
      els.statusRow.textContent = gameState.newRowMode ? 'Neue Reihe' : `${directionText()} · Nächster Rang: ${legalRankText()}`;
      els.antePanel.classList.add('hidden');
      els.turnPanel.classList.remove('hidden');
      els.playSection.classList.remove('hidden');
      renderPlay();
    } else {
      els.statusActive.textContent = gameState.roundSummary?.winnerName || '—';
      els.statusRow.textContent = 'Runde abgeschlossen';
      els.antePanel.classList.add('hidden');
      els.turnPanel.classList.add('hidden');
      els.playSection.classList.remove('hidden');
      renderPlay();
      showRoundDialog();
    }
  }

  function renderPlayers() {
    els.playersStrip.innerHTML = gameState.players.map(p => {
      const tag = p.id === gameState.self.id ? 'Du' : p.isHost ? 'Host' : p.isActive ? 'Am Zug' : '';
      return `<div class="player-card ${p.isActive && gameState.phase==='playing' ? 'active' : ''}">
        <div class="avatar">${escapeHtml(initials(p.name))}</div>
        <div>
          <div class="player-name-line"><span>${escapeHtml(p.name)}</span>${tag ? `<span class="tag">${tag}</span>` : ''}</div>
          <div class="player-meta"><span>Hand <strong>${p.handCount}</strong></span><span>Chipwert <strong>${chipValue(p.chips)}</strong></span>${gameState.phase==='ante'?`<span>${p.anteConfirmed?'✓ bereit':'zahlt ein'}</span>`:''}</div>
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
        if (def.required[selectedChip] > paid[selectedChip]) zone.classList.add('selected-target');
      }
    });

    els.potLegend.innerHTML = Object.entries(gameState.potDefs).map(([potId,def]) => {
      const pot = gameState.pots[potId].chips;
      let status = '<span>Auszahlung beim Ausspielen</span>';
      if (gameState.phase==='ante') {
        const paid = gameState.antePaid?.[potId] || {bronze:0,silver:0,gold:0};
        status = requirementsMet(def.required, paid)
          ? '<span class="req-ok">✓ von dir bezahlt</span>'
          : `<span class="req-missing">Offen: ${reqText(remaining(def.required, paid))}</span>`;
      }
      return `<div class="pot-legend-item"><strong>${def.label}</strong>${status}<span>Pflicht: ${reqText(def.required)} · Potwert ${chipValue(pot)}</span></div>`;
    }).join('');
  }

  function potChipIcons(chips) {
    const out=[];
    for(const type of ['bronze','silver','gold']){
      const count=Math.min(chips[type],5);
      for(let i=0;i<count;i++) out.push(`<span class="tiny-chip ${type}"></span>`);
      if(chips[type]>5) out.push(`<span class="tiny-more">+${chips[type]-5}</span>`);
    }
    return out.join('');
  }

  function renderAnte() {
    const self = gameState.self;
    els.potHint.textContent = gameState.anteConfirmed ? 'Dein Einsatz ist bestätigt. Warte auf die anderen.' : 'Ziehe Chips auf die passenden Pot-Felder oder zahle automatisch ein.';
    els.anteStateText.textContent = gameState.anteConfirmed ? 'Einsatz bestätigt – du bist bereit.' : 'Pflicht pro Runde: Gesamtwert 15.';
    els.chipInventory.innerHTML = ['bronze','silver','gold'].map(type => `
      <div class="chip-pack">
        <div class="chip ${type} ${selectedChip===type?'selected':''}" data-chip="${type}" draggable="${!gameState.anteConfirmed && self.chips[type]>0}">${CHIP_VALUES[type]}</div>
        <div><div class="chip-count">${self.chips[type]} × ${CHIP_LABELS[type]}</div><div class="chip-value">Wert ${CHIP_VALUES[type]}</div></div>
      </div>`).join('');
    els.autoAnteBtn.disabled = gameState.anteConfirmed;
    els.confirmAnteBtn.disabled = gameState.anteConfirmed || !myAnteComplete();
    els.confirmAnteBtn.textContent = gameState.anteConfirmed ? '✓ Einsatz bestätigt' : 'Einsatz bestätigen';
  }
  function myAnteComplete(){
    if(!gameState.antePaid) return false;
    return Object.entries(gameState.potDefs).every(([potId,def])=>requirementsMet(def.required,gameState.antePaid[potId]));
  }

  function renderPlay() {
    const myTurn = gameState.activePlayerId === gameState.self.id && gameState.phase === 'playing';
    const prompt = gameState.newRowMode ? 'Eine beliebige Karte eröffnet die neue Reihe.' : `Du bleibst am Zug. Nächster Rang: ${legalRankText()}.`;
    els.turnText.textContent = myTurn ? prompt : `Warte auf ${gameState.activePlayerName || 'den aktiven Spieler'} …`;
    els.skipBtn.disabled = !myTurn || gameState.newRowMode;
    els.rowHint.textContent = gameState.newRowMode ? `${gameState.activePlayerName} darf eine beliebige Karte ausspielen.` : `${directionText()} · Anlegen: ${legalRankText()} · Symbol egal · erfolgreiche Karte = derselbe Spieler bleibt am Zug.`;
    els.leftoverCount.textContent = gameState.leftoverCount;
    els.skipCount.textContent = gameState.consecutiveSkips;
    els.rankTrack.innerHTML = Array.from({length:13},(_,i)=>{
      const rank=i+1, card=gameState.currentRow[i];
      const edge=!gameState.newRowMode && edgeRank(rank);
      return `<div class="rank-slot ${edge?'edge':''}"><span class="rank-label">${RANK_LABELS[rank]}</span>${card?`<img src="${card.image}" alt="${escapeHtml(card.id)}" />`:''}</div>`;
    }).join('');
    els.myHandCount.textContent = gameState.self.hand.length;
    els.handHint.textContent = myTurn ? prompt : 'Du siehst nur deine eigenen Karten. Die Handkarten der anderen bleiben verborgen.';
    els.handCards.innerHTML = gameState.self.hand.map(card => {
      const playable = myTurn && (gameState.newRowMode || gameState.legalRanks.includes(card.rank));
      return `<button class="hand-card ${playable?'playable':'unplayable'}" data-card-id="${card.id}" ${playable?'':'disabled'}><img src="${card.image}" alt="${escapeHtml(card.id)}" />${playable?'<span class="legal-pill">spielbar</span>':''}</button>`;
    }).join('');
  }
  function legalRankText(){ return (gameState.legalRanks || []).map(r=>RANK_LABELS[r]).join(' oder ') || 'keine'; }
  function directionText(){
    if (gameState.newRowMode) return 'Neue Reihe';
    if (gameState.rowDirection === 1) return 'Richtung ↑ zyklisch';
    if (gameState.rowDirection === -1) return 'Richtung ↓ zyklisch';
    return 'Richtung noch offen';
  }
  function edgeRank(rank){
    return !gameState.newRowMode && (gameState.legalRanks || []).includes(rank);
  }

  function renderLog() {
    els.gameLog.innerHTML = [...gameState.log].reverse().map(e=>`<div class="log-entry ${e.type||''}"><strong>${escapeHtml(e.time)}</strong> · ${escapeHtml(e.text)}</div>`).join('');
  }

  function showRoundDialog() {
    if (gameState.phase !== 'roundEnd' || !gameState.roundSummary) return;
    const s = gameState.roundSummary;
    els.roundTitle.textContent = `${s.winnerName} gewinnt Runde ${gameState.round}!`;
    els.roundSummary.innerHTML = `<div class="summary-row"><strong>Gewinner</strong><span>${escapeHtml(s.winnerName)}</span></div>
      <div class="summary-row"><strong>Erhaltener Restkarten-Wert</strong><span>${s.totalReceived}</span></div>
      ${s.payments.map(p=>`<div class="summary-row"><span>${escapeHtml(p.name)} · ${p.cards} Restkarten</span><strong>−${p.paid}</strong></div>`).join('')}
      <div class="subtle">Nicht geleerte Pots bleiben für die nächste Runde liegen.</div>`;
    els.nextRoundBtn.classList.toggle('hidden', !gameState.isHost);
    els.roundWaitText.classList.toggle('hidden', gameState.isHost);
    if (!els.roundDialog.open) els.roundDialog.showModal();
  }

  async function action(action, extra={}) {
    if (!session || busy) return;
    busy = true;
    try {
      const data = await api('/api/action', { method:'POST', body:JSON.stringify({ roomCode:session.roomCode, playerId:session.playerId, action, ...extra }) });
      gameState = data.state;
      selectedChip = null;
      routeByState();
    } catch(e){ toast(e.message); }
    finally{ busy=false; }
  }

  async function copyInvite() {
    if (!session) return;
    const url = new URL(location.href);
    url.searchParams.set('room', session.roomCode);
    try { await navigator.clipboard.writeText(url.toString()); toast('Einladungslink kopiert.'); }
    catch { toast(`Raumcode: ${session.roomCode}`); }
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>els.toast.classList.remove('show'),2200);
  }

  function leave() {
    if (!confirm('Spiel auf diesem Gerät verlassen?')) return;
    clearSession();
  }

  function setupEvents() {
    els.createRoomBtn.addEventListener('click', createRoom);
    els.joinRoomBtn.addEventListener('click', joinRoom);
    els.roomCodeInput.addEventListener('input', e => e.target.value = cleanCode(e.target.value));
    els.playerName.addEventListener('input', clearEntryError);
    els.roomCodeInput.addEventListener('keydown', e => { if(e.key==='Enter') joinRoom(); });
    els.playerName.addEventListener('keydown', e => { if(e.key==='Enter' && cleanCode(els.roomCodeInput.value).length===5) joinRoom(); });
    els.copyRoomBtn.addEventListener('click', copyInvite);
    els.copyGameLinkBtn.addEventListener('click', copyInvite);
    els.startGameBtn.addEventListener('click', ()=>action('start'));
    els.leaveLobbyBtn.addEventListener('click', leave);
    els.leaveGameBtn.addEventListener('click', leave);
    els.rulesBtn.addEventListener('click', ()=>els.rulesDialog.showModal());
    els.closeRulesBtn.addEventListener('click', ()=>els.rulesDialog.close());
    els.nextRoundBtn.addEventListener('click', ()=>{ if(els.roundDialog.open) els.roundDialog.close(); action('nextRound'); });
    els.skipBtn.addEventListener('click', ()=>action('skip'));
    els.autoAnteBtn.addEventListener('click', ()=>action('autoAnte'));
    els.confirmAnteBtn.addEventListener('click', ()=>action('confirmAnte'));

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
  }

  async function bootstrap() {
    setupEvents();
    const roomFromUrl = cleanCode(new URL(location.href).searchParams.get('room'));
    if (roomFromUrl) els.roomCodeInput.value = roomFromUrl;
    if (session?.name) els.playerName.value = session.name;
    if (session?.roomCode && session?.playerId) {
      try {
        await refreshState({silent:false});
        if (gameState) { startPolling(); return; }
      } catch {}
    }
    showScreen('entry');
  }

  bootstrap();
})();
