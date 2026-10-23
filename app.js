(() => {
  'use strict';
  const PLAYERS = ['Amber', 'Rishikh', 'Bhavya', 'Pratik', 'Ansh', 'Tanmay', 'Chaitanya'];
  const STORAGE_KEY = 'iimspoker_demo_entries_v3';
  const OLD_STORAGE_KEYS = ['iimspoker_demo_entries_v1', 'iimspoker_demo_entries_v2'];
  const PIN_KEY = 'iimspoker_club_pin';
  const DEVICE_KEY = 'iimspoker_demo_device_id_v1';
  const $ = (id) => document.getElementById(id);
  function getDemoDeviceId() {
    const bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    const fresh = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    try {
      const id = localStorage.getItem(DEVICE_KEY);
      if (id && /^[0-9a-f-]{36}$/i.test(id)) return id;
      localStorage.setItem(DEVICE_KEY, fresh);
    } catch (err) {
      // Shared mode uses the HttpOnly server cookie instead; this fallback is only for a restricted local preview.
    }
    return fresh;
  }
  const state = { mode: 'checking', entries: [], pin: '', deviceId: getDemoDeviceId(), demoNoticeDismissed: false, noticeTimer: null };
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const roundMoney = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const money = (amount, signed = true) => {
    const n = roundMoney(amount);
    if (n === 0) return '₹0';
    const abs = Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(absSafe(n)) ? 0 : 2 });
    return n > 0 ? `${signed ? '+' : ''}₹${abs}` : `−₹${abs}`;
  };
  function absSafe(n) { return Math.abs(n); }
  const moneyClass = (n) => n > 0 ? 'money-positive' : n < 0 ? 'money-negative' : 'money-zero';
  const byDefaultOrder = (name) => PLAYERS.indexOf(name);
  const formatDate = (date, short = false) => {
    if (!date) return '—';
    const d = new Date(`${date}T12:00:00`);
    return d.toLocaleDateString('en-IN', short ? { day: '2-digit', month: 'short' } : { day: '2-digit', month: 'short', year: 'numeric' });
  };
  function shiftDay(date, amount) {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + amount);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function readDemoEntries() {
    try {
      // Clear the earlier sample-data stores so the preview starts with a clean ledger.
      for (const key of OLD_STORAGE_KEYS) localStorage.removeItem(key);
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.filter(isValidStoredEntry);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
      return [];
    } catch (err) {
      return [];
    }
  }
  function isValidStoredEntry(e) {
    return e && PLAYERS.includes(e.name) && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && Number.isFinite(Number(e.amount));
  }
  function saveDemoEntries() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.entries));
  }
  async function fetchRemote(pin = '') {
    const headers = {};
    if (pin) headers['x-club-pin'] = pin;
    return fetch('./api/entries', { method: 'GET', headers, cache: 'no-store' });
  }
  function isLocalPreviewHost() {
    return window.location.protocol === 'file:' || ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  }
  async function initialise() {
    $('result-date').value = todayISO();
    state.pin = sessionStorage.getItem(PIN_KEY) || '';
    try {
      const res = await fetchRemote(state.pin);
      if (res.status === 503 || res.status === 404 || res.status === 405) {
        if (isLocalPreviewHost()) enterDemoMode();
        else showFatal('The shared database API is unavailable or not configured. Check the Netlify Function deployment and environment variables. Local demo mode is disabled on hosted sites to prevent unsynced entries.');
        return;
      }
      if (res.status === 401) {
        state.mode = 'remote';
        $('loading').classList.add('is-hidden');
        $('gate').classList.remove('is-hidden');
        if (state.pin) {
          state.pin = '';
          sessionStorage.removeItem(PIN_KEY);
          $('gate-error').textContent = 'That access code was not accepted. Try again.';
        }
        return;
      }
      if (res.ok) {
        state.mode = 'remote';
        state.entries = normaliseRemote(await res.json());
        showApp();
        return;
      }
      // If the backend is reachable but misconfigured, fail safely instead of silently showing demo data.
      if (res.status >= 500) {
        showFatal('The shared database is temporarily unavailable. Check the deployment settings and try again.');
        return;
      }
      enterDemoMode();
    } catch (e) {
      // Only use browser-only demo storage on a local preview. A hosted site must not silently accept unsynced records.
      if (isLocalPreviewHost()) enterDemoMode();
      else showFatal('Could not reach the shared database. Check your connection and Netlify Function deployment. The hosted site will not save records locally.');
    }
  }
  function normaliseRemote(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map((e) => ({ id: e.id, name: e.name, date: e.date || e.result_date, amount: Number(e.amount), updatedAt: e.updatedAt || e.updated_at || null, canDelete: e.canDelete === true, originKnown: e.originKnown === true })).filter(isValidStoredEntry);
  }
  function enterDemoMode() {
    state.mode = 'demo';
    state.entries = readDemoEntries();
    $('mode-badge').classList.add('demo');
    $('mode-text').textContent = 'Browser demo';
    $('demo-notice').classList.remove('is-hidden');
    $('loading').classList.add('is-hidden');
    showApp();
  }
  function showApp() {
    $('loading').classList.add('is-hidden');
    $('gate').classList.add('is-hidden');
    $('app').classList.remove('is-hidden');
    if (state.mode === 'remote') {
      $('mode-badge').classList.remove('demo');
      $('mode-text').textContent = 'Shared ledger';
      $('access-button').classList.remove('is-hidden');
      $('demo-notice').classList.add('is-hidden');
    }
    render();
  }
  function showFatal(message) {
    $('loading').classList.add('is-hidden');
    $('gate').classList.remove('is-hidden');
    $('gate-title').textContent = 'Ledger unavailable.';
    document.querySelector('#gate-card .muted');
    $('gate-error').textContent = message;
    $('club-pin').disabled = true;
    $('gate-form').querySelector('button').disabled = true;
  }
  function totalsAndRanks() {
    const totals = Object.fromEntries(PLAYERS.map((p) => [p, 0]));
    const seen = new Set();
    for (const e of state.entries) {
      if (totals[e.name] !== undefined) {
        totals[e.name] = roundMoney(totals[e.name] + Number(e.amount));
        seen.add(e.name);
      }
    }
    const order = [...PLAYERS].sort((a, b) => (totals[b] - totals[a]) || (byDefaultOrder(a) - byDefaultOrder(b)));
    let previous = null;
    let rank = 0;
    const ranks = {};
    order.forEach((name, index) => {
      if (previous === null || totals[name] !== previous) rank = index + 1;
      ranks[name] = rank;
      previous = totals[name];
    });
    return { totals, active: seen, order, ranks };
  }
  function render() {
    const { totals, active, order, ranks } = totalsAndRanks();
    const dates = [...new Set(state.entries.map((e) => e.date))].sort((a, b) => a.localeCompare(b));
    $('dates-count').textContent = String(dates.length).padStart(2, '0');
    $('active-count').innerHTML = `${active.size}<span class="stat-denominator"> / 7</span>`;
    const leader = order[0];
    $('leader-name').textContent = state.entries.length ? leader : '—';
    $('leader-total').textContent = state.entries.length ? money(totals[leader]) : '₹0';
    $('leader-total').className = `stat-foot ${totals[leader] > 0 ? 'positive' : ''}`;
    $('scorecard-summary').textContent = `7 players · ${state.entries.length} daily ${state.entries.length === 1 ? 'entry' : 'entries'}`;
    $('activity-count').textContent = `${state.entries.length} ${state.entries.length === 1 ? 'entry' : 'entries'}`;
    renderScorecard(order, totals, ranks, dates);
    renderActivity();
  }
  function renderScorecard(order, totals, ranks, dates) {
    const head = $('scorecard-head');
    const body = $('scorecard-body');
    head.innerHTML = '';
    body.innerHTML = '';
    $('empty-scorecard').classList.toggle('is-hidden', state.entries.length > 0);
    $('scorecard').classList.remove('is-hidden');
    const header = document.createElement('tr');
    header.innerHTML = `<th scope="col">RANK</th><th scope="col">PLAYER</th>${dates.map((d, i) => `<th scope="col" title="${escapeHTML(formatDate(d))}">D${String(i + 1).padStart(2,'0')}<br><span class="date-heading">${escapeHTML(formatDate(d, true))}</span></th>`).join('')}<th scope="col">ALL-TIME P/L</th>`;
    head.appendChild(header);
    for (const name of order) {
      const row = document.createElement('tr');
      const rank = ranks[name];
      const marker = name === order[0] ? 'leader-marker' : '';
      const cells = dates.map((date) => {
        const entry = state.entries.find((e) => e.name === name && e.date === date);
        if (!entry) return '<td><span class="money-missing">—</span></td>';
        const amount = Number(entry.amount);
        return `<td><span class="${moneyClass(amount)}">${escapeHTML(money(amount))}</span></td>`;
      }).join('');
      row.innerHTML = `<td><span class="rank-pill ${rank === 1 ? 'rank-one' : ''}">${String(rank).padStart(2,'0')}</span></td><td><div class="player-cell"><span class="player-marker ${marker}">${escapeHTML(name.slice(0,1).toUpperCase())}</span><span>${escapeHTML(name)}</span></div></td>${cells}<td class="leader-total-cell"><span class="${moneyClass(totals[name])}">${escapeHTML(money(totals[name]))}</span></td>`;
      body.appendChild(row);
    }
  }
  function renderActivity() {
    const body = $('activity-body');
    body.innerHTML = '';
    const allEntries = [...state.entries].sort((a, b) => b.date.localeCompare(a.date) || (PLAYERS.indexOf(a.name) - PLAYERS.indexOf(b.name)) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    $('empty-activity').classList.toggle('is-hidden', allEntries.length > 0);
    document.querySelector('.activity-table').classList.toggle('is-hidden', allEntries.length === 0);
    for (const entry of allEntries) {
      const value = Number(entry.amount);
      const status = value > 0 ? ['PROFIT', 'status-profit'] : value < 0 ? ['LOSS', 'status-loss'] : ['BREAK EVEN', 'status-even'];
      const canDelete = state.mode === 'demo' ? entry.deviceId === state.deviceId : entry.canDelete === true;
      const ownershipLabel = entry.originKnown ? 'Other device' : 'Not available';
      const action = canDelete
        ? `<button type="button" class="entry-delete-button" data-delete-entry="${escapeHTML(entry.id)}" aria-label="Delete ${escapeHTML(entry.name)} result for ${escapeHTML(formatDate(entry.date))}">Delete</button>`
        : `<span class="delete-unavailable" title="Only the browser that originally created an entry can delete it">${state.mode === 'remote' && entry.originKnown ? 'Other device' : ownershipLabel}</span>`;
      const row = document.createElement('tr');
      row.innerHTML = `<td class="activity-player">${escapeHTML(entry.name)}</td><td>${escapeHTML(formatDate(entry.date))}</td><td class="${moneyClass(value)}">${escapeHTML(money(value))}</td><td><span class="activity-status ${status[1]}">${status[0]}</span></td><td class="entry-action-cell">${action}</td>`;
      body.appendChild(row);
    }
  }
  function showMessage(message, type = 'success') {
    const box = $('form-message');
    box.textContent = message;
    box.className = `form-message ${type}`;
    if (state.noticeTimer) clearTimeout(state.noticeTimer);
    state.noticeTimer = setTimeout(() => box.classList.add('is-hidden'), 6500);
  }
  async function refreshRemote() {
    const res = await fetchRemote(state.pin);
    if (res.status === 401) {
      sessionStorage.removeItem(PIN_KEY);
      state.pin = '';
      $('app').classList.add('is-hidden');
      $('gate').classList.remove('is-hidden');
      $('gate-error').textContent = 'Your access code is no longer valid. Enter it again.';
      throw new Error('Access code rejected');
    }
    if (!res.ok) throw new Error((await getError(res)) || 'Could not load the shared ledger.');
    state.entries = normaliseRemote(await res.json());
  }
  async function getError(res) {
    try { const body = await res.json(); return body.error || body.message || ''; } catch { return ''; }
  }
  $('result-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('player-name').value.trim();
    const date = $('result-date').value;
    const rawAmount = $('result-amount').value;
    const amount = roundMoney(Number(rawAmount));
    if (!PLAYERS.includes(name)) {
      showMessage(`Name must match exactly: ${PLAYERS.join(', ')}. Check the spelling and capitalisation.`, 'error');
      $('player-name').focus();
      return;
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(new Date(`${date}T12:00:00`).getTime())) {
      showMessage('Choose a valid date.', 'error');
      return;
    }
    if (rawAmount === '' || !Number.isFinite(Number(rawAmount)) || Math.abs(amount) > 10000000) {
      showMessage('Enter a valid result between −₹1,00,00,000 and +₹1,00,00,000.', 'error');
      $('result-amount').focus();
      return;
    }
    const button = $('submit-result');
    button.disabled = true;
    button.classList.add('is-saving');
    button.innerHTML = 'Saving…';
    try {
      const existing = state.entries.find((e) => e.name === name && e.date === date);
      if (state.mode === 'remote') {
        const response = await fetch('./api/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-club-pin': state.pin },
          body: JSON.stringify({ name, date, amount })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Could not save the result.');
        await refreshRemote();
        showMessage(`${name}'s result for ${formatDate(date)} ${payload.action === 'updated' ? 'was updated' : 'was saved'}. All-time totals and ranks are up to date.`, 'success');
      } else {
        const index = state.entries.findIndex((e) => e.name === name && e.date === date);
        const previous = index >= 0 ? state.entries[index] : null;
        const entry = { id: previous ? previous.id : `demo-${Date.now()}`, name, date, amount, deviceId: previous ? previous.deviceId : state.deviceId };
        if (index >= 0) state.entries[index] = entry;
        else state.entries.push(entry);
        saveDemoEntries();
        showMessage(`${name}'s result for ${formatDate(date)} ${existing ? 'was updated' : 'was saved'}. All-time totals and ranks are up to date.`, 'success');
      }
      render();
      $('player-name').value = '';
      $('result-amount').value = '';
      $('player-name').focus();
    } catch (error) {
      showMessage(error.message || 'Could not save the result. Check the connection and try again.', 'error');
    } finally {
      button.disabled = false;
      button.classList.remove('is-saving');
      button.innerHTML = 'Save result <span aria-hidden="true">↗</span>';
    }
  });
  $('activity-body').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete-entry]');
    if (!button) return;
    const id = button.getAttribute('data-delete-entry');
    const entry = state.entries.find((item) => String(item.id) === String(id));
    if (!entry) return;
    const allowedHere = state.mode === 'demo' ? entry.deviceId === state.deviceId : entry.canDelete === true;
    if (!allowedHere) {
      showMessage('This entry can only be deleted from the browser that originally created it.', 'error');
      return;
    }
    if (!window.confirm(`Delete ${entry.name}'s result for ${formatDate(entry.date)} (${money(entry.amount)})? This cannot be undone.`)) return;
    button.disabled = true;
    button.textContent = 'Deleting…';
    try {
      if (state.mode === 'remote') {
        const response = await fetch('./api/entries', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'x-club-pin': state.pin },
          body: JSON.stringify({ id })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Could not delete this entry.');
        await refreshRemote();
      } else {
        state.entries = state.entries.filter((item) => !(String(item.id) === String(id) && item.deviceId === state.deviceId));
        saveDemoEntries();
      }
      render();
      showMessage(`${entry.name}'s result for ${formatDate(entry.date)} was deleted. Totals and rankings have been recalculated.`, 'success');
    } catch (error) {
      showMessage(error.message || 'Could not delete this entry. Please try again.', 'error');
      renderActivity();
    }
  });

  $('gate-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const pin = $('club-pin').value;
    $('gate-error').textContent = '';
    const button = $('gate-form').querySelector('button');
    button.disabled = true;
    button.innerHTML = 'Checking…';
    try {
      const res = await fetchRemote(pin);
      if (!res.ok) {
        const body = await getError(res);
        $('gate-error').textContent = res.status === 401 ? 'That access code was not accepted.' : (body || 'Could not connect to the shared ledger.');
        return;
      }
      state.pin = pin;
      sessionStorage.setItem(PIN_KEY, pin);
      state.mode = 'remote';
      state.entries = normaliseRemote(await res.json());
      $('club-pin').value = '';
      showApp();
    } catch (err) {
      $('gate-error').textContent = 'Could not connect. Check your internet connection and try again.';
    } finally {
      button.disabled = false;
      button.innerHTML = 'Unlock ledger <span aria-hidden="true">↗</span>';
    }
  });
  $('access-button').addEventListener('click', () => {
    sessionStorage.removeItem(PIN_KEY);
    state.pin = '';
    $('app').classList.add('is-hidden');
    $('gate').classList.remove('is-hidden');
    $('gate-error').textContent = '';
    $('gate-title').textContent = 'Welcome to the club.';
    $('club-pin').disabled = false;
    $('gate-form').querySelector('button').disabled = false;
    $('club-pin').focus();
  });
  $('dismiss-demo-notice').addEventListener('click', () => $('demo-notice').classList.add('is-hidden'));
  initialise();
})();
