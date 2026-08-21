/* ============================================================
   benio – Kalorienzähler
   Speicher: localStorage  |  Suche: Open Food Facts API
   Foto-Analyse: Google Gemini API via /api/analyze (Cloudflare Pages Function)
   ============================================================ */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const round = (n, d = 0) => { const f = 10 ** d; return Math.round(n * f) / f; };

const MEAL_INFO = {
  breakfast: { label: 'Frühstück', emoji: '' },
  lunch: { label: 'Mittag', emoji: '' },
  dinner: { label: 'Abend', emoji: '' },
  snack: { label: 'Snack', emoji: '' },
};

/* ---------- State ---------- */
const DB = {
  DB.profile: load('nt_profile', null),
  goals: load('nt_goals', null),
  days: load('nt_days', {}),          // { 'YYYY-MM-DD': { meals:{...}, water, burned } }
  recent: load('nt_recent', []),       // zuletzt genutzte Lebensmittel
  custom: load('nt_custom', []),       // eigene Lebensmittel
};
let currentDate = todayKey();
let pendingFood = null;                  // Lebensmittel im Portions-Sheet

function load(k, def) { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } }
function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
function persist() { save('nt_days', DB.days); save('nt_recent', DB.recent); save('nt_custom', DB.custom); }

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function getDay(key = currentDate) {
  if (!DB.days[key]) DB.days[key] = { meals: { breakfast: [], lunch: [], dinner: [], snack: [] }, water: 0, burned: 0 };
  return DB.days[key];
}

/* ---------- Ziel-Berechnung (Mifflin-St Jeor) ---------- */
function calcGoals(p) {
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
  let cal = bmr * p.activity;
  if (p.goal === 'lose') cal -= 400;
  if (p.goal === 'gain') cal += 400;
  cal = Math.round(cal / 10) * 10;
  return { cal, carbs: 45, protein: 30, fat: 25 }; // Makro-Verteilung in %
}
function macroGrams(goals) {
  return {
    carbs: round(goals.cal * goals.carbs / 100 / 4),
    protein: round(goals.cal * goals.protein / 100 / 4),
    fat: round(goals.cal * goals.fat / 100 / 9),
  };
}

/* ============================================================
   Navigation
   ============================================================ */
const VIEWS = ['view-home', 'view-search', 'view-photo', 'view-settings'];
function show(id) {
  VIEWS.forEach(v => $('#' + v).classList.toggle('hidden', v !== id));
  $('#bottom-nav').classList.toggle('hidden', id === 'view-search' || id === 'view-photo');
}

$('#bottom-nav').addEventListener('click', e => {
  const b = e.target.closest('.nav-item'); if (!b) return;
  const nav = b.dataset.nav;
  $$('.nav-item').forEach(n => n.classList.toggle('active', n === b && nav !== 'photo'));
  if (nav === 'home') { show('view-home'); renderHome(); }
  if (nav === 'settings') { show('view-settings'); fillSettings(); }
  if (nav === 'photo') startPhoto(mealByTime());
});

$('#settings-btn').addEventListener('click', () => { show('view-settings'); fillSettings(); });
$('#settings-back').addEventListener('click', () => { show('view-home'); renderHome(); });
$('#search-back').addEventListener('click', () => { show('view-home'); renderHome(); });

/* Datum wechseln */
$('#prev-day').addEventListener('click', () => shiftDay(-1));
$('#next-day').addEventListener('click', () => shiftDay(1));
function shiftDay(delta) {
  const d = new Date(currentDate); d.setDate(d.getDate() + delta);
  currentDate = todayKey(d); renderHome();
}

/* Mahlzeit anhand der Uhrzeit vorschlagen (für den Foto-Schnellzugriff) */
function mealByTime() {
  const h = new Date().getHours();
  return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snack';
}

/* ============================================================
   Dashboard rendern
   ============================================================ */
function renderHome() {
  const g = DB.goals, day = getDay();
  const totals = dayTotals(day);
  const mg = macroGrams(g);

  // Datum
  const isToday = currentDate === todayKey();
  const d = new Date(currentDate);
  $('#current-date').textContent = isToday ? 'Heute'
    : d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
  $('#next-day').style.visibility = isToday ? 'hidden' : 'visible';

  const h = new Date().getHours();
  $('#greeting').textContent = h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';

  // Kalorien
  const remaining = Math.round(g.cal - totals.kcal + day.burned);
  $('#cal-remaining').textContent = remaining;
  $('#cal-goal').textContent = g.cal;
  $('#cal-eaten').textContent = Math.round(totals.kcal);
  $('#cal-burned').textContent = day.burned;

  const pct = clamp(totals.kcal / g.cal, 0, 1);
  const circ = 2 * Math.PI * 86;
  const ring = $('#cal-ring');
  ring.style.strokeDasharray = circ;
  ring.style.strokeDashoffset = circ * (1 - pct);
  ring.style.stroke = totals.kcal > g.cal ? 'var(--danger)' : 'var(--pri)';

  // Makros
  setMacro('carbs', totals.carbs, mg.carbs);
  setMacro('protein', totals.protein, mg.protein);
  setMacro('fat', totals.fat, mg.fat);

  // Wasser
  renderWater(day);

  // Mahlzeiten
  renderMeals(day);
}

function setMacro(name, val, goal) {
  const el = $(`.macro[data-macro=${name}]`);
  el.querySelector('.macro-bar span').style.width = clamp(val / goal * 100, 0, 100) + '%';
  el.querySelector('.macro-val b').textContent = Math.round(val);
  el.querySelector('.macro-val span').textContent = goal;
}

function dayTotals(day) {
  const t = { kcal: 0, carbs: 0, protein: 0, fat: 0 };
  Object.values(day.meals).forEach(items => items.forEach(f => {
    t.kcal += f.kcal; t.carbs += f.carbs; t.protein += f.protein; t.fat += f.fat;
  }));
  return t;
}

function renderMeals(day) {
  const wrap = $('#meals'); wrap.innerHTML = '';
  Object.entries(MEAL_INFO).forEach(([key, info]) => {
    const items = day.meals[key];
    const kcal = Math.round(items.reduce((s, f) => s + f.kcal, 0));
    const el = document.createElement('div');
    el.className = 'meal';
    el.innerHTML = `
      <div class="meal-head" data-meal="${key}">
        <div class="meal-title"><span class="emoji">${info.emoji}</span>${info.label}</div>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="meal-kcal">${kcal} kcal</span>
          <button class="meal-add" data-add="${key}">+</button>
        </div>
      </div>
      ${items.length ? `<div class="meal-items">${items.map((f, i) => `
        <div class="food-item">
          <div class="fi-main">
            <div class="fi-name">${esc(f.name)}</div>
            <div class="fi-sub">${round(f.amount)} g${f.brand ? ' · ' + esc(f.brand) : ''}</div>
          </div>
          <div class="fi-kcal">${Math.round(f.kcal)}</div>
          <button class="fi-del" data-del="${key}:${i}">✕</button>
        </div>`).join('')}</div>`
        : `<div class="meal-empty">Noch nichts hinzugefügt</div>`}
    `;
    wrap.appendChild(el);
  });
}

$('#meals').addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  const del = e.target.closest('[data-del]');
  const head = e.target.closest('.meal-head');
  if (add) { openSearch(add.dataset.add); return; }
  if (del) {
    const [meal, idx] = del.dataset.del.split(':');
    getDay().meals[meal].splice(+idx, 1); persist(); renderHome();
    return;
  }
  if (head) openSearch(head.dataset.meal);
});

/* ---------- Wasser ---------- */
function renderWater(day) {
  const wrap = $('#water-glasses'); wrap.innerHTML = '';
  $('#water-ml').textContent = day.water;
  for (let i = 0; i < 8; i++) {
    const g = document.createElement('div');
    g.className = 'glass' + (i * 250 < day.water ? ' full' : '');
    g.addEventListener('click', () => {
      day.water = (i * 250 < day.water) ? i * 250 : (i + 1) * 250;
      persist(); renderWater(day);
    });
    wrap.appendChild(g);
  }
}

/* ============================================================
   Suche + API (Open Food Facts)
   ============================================================ */
let currentMeal = 'breakfast';
let searchTimer = null;

function openSearch(meal) {
  currentMeal = meal;
  $('#search-meal-title').textContent = MEAL_INFO[meal].label;
  $('#sheet-meal').value = meal;
  show('view-search');
  $('#search-input').value = '';
  switchTab('search');
  $('#search-results').innerHTML = '';
  $('#search-status').textContent = 'Tippe zum Suchen – oder fotografiere dein Gericht';
  setTimeout(() => $('#search-input').focus(), 100);
}

$('#search-input').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { $('#search-results').innerHTML = ''; $('#search-status').textContent = ''; return; }
  searchTimer = setTimeout(() => searchFood(q), 350);
});

async function searchFood(query) {
  const status = $('#search-status'), results = $('#search-results');
  status.innerHTML = '<span class="spinner"></span> Suche läuft…';
  results.innerHTML = '';
  try {
    // Suche läuft über die eigene Server-Funktion (stabiler als OFF direkt);
    // ohne Server (statisches Hosting) Fallback auf Open Food Facts direkt.
    let res = await fetch('/api/search?q=' + encodeURIComponent(query));
    if (res.status === 404 || res.status === 405) {
      const url = 'https://world.openfoodfacts.org/cgi/search.pl?'
        + new URLSearchParams({
          search_terms: query, search_simple: 1, action: 'process', json: 1,
          page_size: 30, fields: 'product_name,product_name_de,brands,nutriments,image_small_url,code,serving_size',
        });
      res = await fetch(url);
    }
    const data = await res.json();
    if (!res.ok) { status.textContent = '⚠️ ' + (data.error || 'Suche gerade nicht möglich.'); return; }
    const foods = (data.products || []).map(mapProduct).filter(Boolean);
    if (!foods.length) { status.textContent = 'Nichts gefunden. Versuch „Eigenes" 👆'; return; }
    status.textContent = `${foods.length} Treffer`;
    foods.forEach(f => results.appendChild(resultEl(f)));
  } catch (err) {
    status.textContent = '⚠️ Keine Verbindung. Prüfe dein Internet.';
  }
}

function mapProduct(p) {
  const n = p.nutriments || {};
  const kcal = n['energy-kcal_100g'] ?? (n['energy_100g'] ? n['energy_100g'] / 4.184 : null);
  if (kcal == null) return null;
  const name = p.product_name_de || p.product_name;
  if (!name) return null;
  return {
    name, brand: (p.brands || '').split(',')[0].trim(),
    kcal100: round(+kcal, 1),
    carbs100: round(+n.carbohydrates_100g || 0, 1),
    protein100: round(+n.proteins_100g || 0, 1),
    fat100: round(+n.fat_100g || 0, 1),
    img: p.image_small_url || null,
    serving: parseServing(p.serving_size),
    code: p.code,
  };
}
function parseServing(s) { const m = /([\d.,]+)\s*g/i.exec(s || ''); return m ? +m[1].replace(',', '.') : null; }

function resultEl(f) {
  const el = document.createElement('div');
  el.className = 'result';
  el.innerHTML = `
    <div class="result-img">${f.img ? `<img src="${f.img}" style="width:100%;height:100%;border-radius:8px;object-fit:cover">` : '🥗'}</div>
    <div class="result-main">
      <div class="result-name">${esc(f.name)}</div>
      <div class="result-sub">${f.brand ? esc(f.brand) + ' · ' : ''}pro 100 g</div>
    </div>
    <div class="result-kcal">${Math.round(f.kcal100)}<small>kcal</small></div>`;
  el.addEventListener('click', () => openSheet(f));
  return el;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- Tabs ---------- */
$('.tabs').addEventListener('click', e => {
  const t = e.target.closest('.tab'); if (t) switchTab(t.dataset.tab);
});
function switchTab(tab) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $('#custom-form').classList.toggle('hidden', tab !== 'custom');
  $('#search-input').parentElement.classList.toggle('hidden', tab === 'custom');
  const results = $('#search-results'), status = $('#search-status');
  results.innerHTML = ''; status.textContent = '';
  if (tab === 'recent') {
    if (!DB.recent.length) { status.textContent = 'Noch keine zuletzt genutzten Lebensmittel.'; return; }
    DB.recent.forEach(f => results.appendChild(resultEl(f)));
  }
  if (tab === 'custom') {
    if (DB.custom.length) DB.custom.forEach(f => results.appendChild(resultEl(f)));
  }
  if (tab === 'search') {
    const q = $('#search-input').value.trim();
    if (q.length >= 2) searchFood(q); else status.textContent = 'Tippe zum Suchen';
  }
}

/* ---------- Eigenes Lebensmittel ---------- */
$('#c-save').addEventListener('click', () => {
  const name = $('#c-name').value.trim();
  const kcal = +$('#c-kcal').value;
  if (!name || !kcal) { toast('Name & Kalorien nötig'); return; }
  const f = {
    name, brand: 'Eigenes', kcal100: kcal, portion: +$('#c-portion').value || 100,
    carbs100: +$('#c-carbs').value || 0, protein100: +$('#c-protein').value || 0, fat100: +$('#c-fat').value || 0,
  };
  DB.custom.unshift(f); persist();
  ['#c-name', '#c-kcal', '#c-carbs', '#c-protein', '#c-fat'].forEach(s => $(s).value = '');
  openSheet(f);
});

/* ============================================================
   Portions-Sheet
   ============================================================ */
function openSheet(f) {
  pendingFood = f;
  $('#sheet-name').textContent = f.name;
  $('#sheet-brand').textContent = f.brand || '';
  const unit = $('#sheet-unit');
  unit.innerHTML = '<option value="1">Gramm</option>';
  const serving = f.serving || f.portion;
  if (serving) unit.innerHTML += `<option value="${serving}" selected>Portion (${serving} g)</option>`;
  $('#sheet-amount').value = serving ? 1 : 100;
  $('#sheet-meal').value = currentMeal;
  updateSheet();
  $('#sheet').classList.remove('hidden');
}
function updateSheet() {
  const amt = (+$('#sheet-amount').value || 0) * (+$('#sheet-unit').value || 1);
  const f = pendingFood, k = amt / 100;
  $('#sheet-cal').textContent = Math.round(f.kcal100 * k);
  $('#sheet-macros').innerHTML =
    `<span>KH <b>${round(f.carbs100 * k)}g</b></span>
     <span>Prot <b>${round(f.protein100 * k)}g</b></span>
     <span>Fett <b>${round(f.fat100 * k)}g</b></span>`;
}
$('#sheet-amount').addEventListener('input', updateSheet);
$('#sheet-unit').addEventListener('change', updateSheet);
$('#sheet-cancel').addEventListener('click', closeSheet);
$('.sheet-backdrop').addEventListener('click', closeSheet);
function closeSheet() { $('#sheet').classList.add('hidden'); pendingFood = null; }

$('#sheet-add').addEventListener('click', () => {
  const f = pendingFood, meal = $('#sheet-meal').value;
  const amt = (+$('#sheet-amount').value || 0) * (+$('#sheet-unit').value || 1);
  if (!amt) { toast('Menge angeben'); return; }
  const k = amt / 100;
  getDay().meals[meal].push({
    name: f.name, brand: f.brand, amount: amt,
    kcal: f.kcal100 * k, carbs: f.carbs100 * k, protein: f.protein100 * k, fat: f.fat100 * k,
  });
  // in "zuletzt" aufnehmen
  DB.recent = [f, ...DB.recent.filter(r => r.name !== f.name)].slice(0, 25);
  persist();
  closeSheet();
  toast(`${f.name} hinzugefügt ✓`);
  show('view-home'); renderHome();
});

/* ============================================================
   Foto-Analyse (Claude Vision)
   Ablauf: Foto aufnehmen → verkleinern → an /api/analyze schicken
   → erkannte Komponenten mit editierbaren Gramm-Angaben anzeigen
   ============================================================ */
const photoInput = $('#photo-input');
let photoResult = null;   // Ergebnis der Analyse (items mit Nährwerten pro 100 g)

function startPhoto(meal) {
  currentMeal = meal;
  photoInput.click();
}
$('#photo-btn').addEventListener('click', () => startPhoto(currentMeal));
$('#photo-close').addEventListener('click', () => { show('view-home'); renderHome(); });
$('#photo-retry').addEventListener('click', () => photoInput.click());
$('#photo-again').addEventListener('click', () => photoInput.click());

photoInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  photoInput.value = '';
  if (!file) return;

  show('view-photo');
  photoResult = null;
  setPhotoState('loading');
  try {
    const { dataUrl, base64, mediaType } = await downscaleImage(file);
    $('#photo-preview').src = dataUrl;
    const result = await analyzeImage(base64, mediaType);
    if (!result.is_food || !result.items.length) { setPhotoState('nofood'); return; }
    photoResult = result;
    renderPhotoResult();
  } catch (err) {
    setPhotoState('error', err.message);
  }
});

/* Bild auf max. 1120 px verkleinern und als JPEG kodieren – spart Tokens & Upload-Zeit */
function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1120;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve({ dataUrl, base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht geladen werden.')); };
    img.src = url;
  });
}

async function analyzeImage(base64, mediaType) {
  let res;
  try {
    res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, media_type: mediaType }),
    });
  } catch {
    return analyzeDirect(base64, mediaType); // z. B. lokale Datei ohne Server
  }
  if (res.status === 404 || res.status === 405) {
    return analyzeDirect(base64, mediaType); // Function nicht deployed (statisches Hosting)
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Analyse fehlgeschlagen.');
  return data;
}

/* Fallback ohne Server: direkter Browser-Aufruf der Gemini API mit eigenem Key.
   Prompt und Schema müssen mit functions/api/analyze.js übereinstimmen. */
async function analyzeDirect(base64, mediaType) {
  const key = localStorage.getItem('nt_apikey') || '';
  if (!key) throw new Error('Kein Server erreichbar. Hinterlege einen Gemini API-Key in den Einstellungen.');

  const SYSTEM_PROMPT = `Du bist Ernährungsexperte und analysierst Fotos von Mahlzeiten.

Gehe in drei Schritten vor:
1. Identifiziere das Gericht und alle sichtbaren Komponenten (z. B. „Reis", „Hähnchenbrust", „Brokkoli"). Führe Saucen, Dressings und Bratöl als eigene Komponente auf, wenn sie sichtbar oder sehr wahrscheinlich sind.
2. Schätze für jede Komponente die Portionsgröße in Gramm (verzehrfertig zubereitet). Nutze sichtbare Referenzen: Standardteller ≈ 26 cm, Gabel ≈ 20 cm, Handfläche, Glas. Berücksichtige Schichthöhe und Perspektive. Portionen werden auf Fotos häufig unterschätzt – sei realistisch.
3. Gib für jede Komponente typische Nährwerte pro 100 g des zubereiteten Lebensmittels an (kcal, Kohlenhydrate, Protein, Fett) – z. B. gekochter Reis, nicht roher.

Regeln:
- dish_name: kurzer deutscher Name des Gesamtgerichts.
- portion_hint: ein Satz, worauf sich deine Mengenschätzung stützt (Referenzobjekte, Tellergröße …).
- confidence: "hoch" | "mittel" | "niedrig".
- Zeigt das Bild kein Essen (oder nur geschlossene Verpackung), setze is_food auf false und lass items leer.`;

  const ITEM_PROPS = {
    name: { type: 'STRING' }, amount_g: { type: 'NUMBER' },
    kcal_per_100g: { type: 'NUMBER' }, carbs_per_100g: { type: 'NUMBER' },
    protein_per_100g: { type: 'NUMBER' }, fat_per_100g: { type: 'NUMBER' },
  };
  const SCHEMA = {
    type: 'OBJECT',
    properties: {
      is_food: { type: 'BOOLEAN' },
      dish_name: { type: 'STRING' },
      confidence: { type: 'STRING', enum: ['hoch', 'mittel', 'niedrig'] },
      portion_hint: { type: 'STRING' },
      items: { type: 'ARRAY', items: { type: 'OBJECT', properties: ITEM_PROPS, required: Object.keys(ITEM_PROPS) } },
    },
    required: ['is_food', 'dish_name', 'confidence', 'portion_hint', 'items'],
  };

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: mediaType, data: base64 } },
            { text: 'Analysiere dieses Gericht und schätze die Nährwerte.' },
          ],
        }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA },
      }),
    },
  );
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 429) throw new Error('Tageslimit der kostenlosen Gemini-API erreicht. Versuch es später erneut.');
    throw new Error(data.error?.message || 'Fehler bei der Gemini-API.');
  }
  const candidate = data.candidates?.[0];
  if (!candidate || candidate.finishReason === 'SAFETY') throw new Error('Die Analyse wurde abgelehnt. Bitte anderes Foto versuchen.');
  const text = candidate.content?.parts?.map(p => p.text || '').join('');
  if (!text) throw new Error('Leere Antwort der Analyse.');
  return JSON.parse(text);
}

function setPhotoState(state, msg) {
  const status = $('#photo-status'), result = $('#photo-result'), again = $('#photo-again');
  result.classList.add('hidden');
  again.classList.add('hidden');
  status.classList.remove('hidden');
  if (state === 'loading') {
    status.innerHTML = '<span class="spinner"></span> KI analysiert dein Gericht…';
  } else if (state === 'nofood') {
    status.textContent = 'Auf dem Foto wurde kein Essen erkannt. Versuch es mit einem anderen Bild.';
    again.classList.remove('hidden');
  } else if (state === 'error') {
    status.textContent = '⚠️ ' + (msg || 'Analyse fehlgeschlagen.');
    again.classList.remove('hidden');
  } else {
    status.classList.add('hidden');
  }
}

function renderPhotoResult() {
  setPhotoState('done');
  const r = photoResult;
  $('#ai-dish').textContent = r.dish_name;
  $('#ai-hint').textContent = r.portion_hint;
  const conf = $('#ai-conf');
  conf.textContent = r.confidence;
  conf.className = 'badge ' + r.confidence;
  $('#photo-meal').value = currentMeal;

  $('#ai-items').innerHTML = r.items.map((it, i) => `
    <div class="ai-item">
      <div class="ai-name">${esc(it.name)}<small>${round(it.kcal_per_100g)} kcal / 100 g</small></div>
      <div class="ai-grams"><input type="number" inputmode="decimal" value="${round(it.amount_g)}" data-grams="${i}" /><span>g</span></div>
      <div class="ai-kcal" data-kcal="${i}"></div>
    </div>`).join('');
  updatePhotoTotals();
  $('#photo-result').classList.remove('hidden');
}

$('#ai-items').addEventListener('input', e => {
  const inp = e.target.closest('[data-grams]'); if (!inp) return;
  photoResult.items[+inp.dataset.grams].amount_g = +inp.value || 0;
  updatePhotoTotals();
});

function updatePhotoTotals() {
  const t = { kcal: 0, carbs: 0, protein: 0, fat: 0 };
  photoResult.items.forEach((it, i) => {
    const k = it.amount_g / 100;
    const kcal = it.kcal_per_100g * k;
    t.kcal += kcal; t.carbs += it.carbs_per_100g * k;
    t.protein += it.protein_per_100g * k; t.fat += it.fat_per_100g * k;
    $(`[data-kcal="${i}"]`).innerHTML = `${Math.round(kcal)}<small> kcal</small>`;
  });
  $('#ai-total-kcal').textContent = Math.round(t.kcal);
  $('#ai-total-macros').innerHTML =
    `<span>KH <b>${round(t.carbs)}g</b></span>
     <span>Prot <b>${round(t.protein)}g</b></span>
     <span>Fett <b>${round(t.fat)}g</b></span>`;
}

$('#photo-add').addEventListener('click', () => {
  const meal = $('#photo-meal').value;
  const items = photoResult.items.filter(it => it.amount_g > 0);
  if (!items.length) { toast('Keine Mengen angegeben'); return; }
  items.forEach(it => {
    const k = it.amount_g / 100;
    getDay().meals[meal].push({
      name: it.name, brand: photoResult.dish_name, amount: it.amount_g,
      kcal: it.kcal_per_100g * k, carbs: it.carbs_per_100g * k,
      protein: it.protein_per_100g * k, fat: it.fat_per_100g * k,
    });
  });
  persist();
  toast(`${photoResult.dish_name} hinzugefügt ✓`);
  photoResult = null;
  show('view-home'); renderHome();
});

/* ============================================================
   Einstellungen
   ============================================================ */
function fillSettings() {
  const g = DB.goals, p = DB.profile;
  $('#s-cal').value = g.cal; $('#s-carbs').value = g.carbs;
  $('#s-protein').value = g.protein; $('#s-fat').value = g.fat;
  $('#s-age').value = p.age; $('#s-height').value = p.height; $('#s-weight').value = p.weight;
  $('#s-apikey').value = localStorage.getItem('nt_apikey') || '';
  macroSumHint();
}
['#s-carbs', '#s-protein', '#s-fat'].forEach(s => $(s).addEventListener('input', macroSumHint));
function macroSumHint() {
  const sum = (+$('#s-carbs').value || 0) + (+$('#s-protein').value || 0) + (+$('#s-fat').value || 0);
  const el = $('#macro-sum-hint');
  el.textContent = `Summe: ${sum}%` + (sum === 100 ? ' ✓' : ' (sollte 100% sein)');
  el.style.color = sum === 100 ? 'var(--pri)' : 'var(--danger)';
}
$('#s-recalc').addEventListener('click', () => {
  DB.profile.age = +$('#s-age').value; DB.profile.height = +$('#s-height').value; DB.profile.weight = +$('#s-weight').value;
  const g = calcGoals(DB.profile);
  $('#s-cal').value = g.cal; $('#s-carbs').value = g.carbs; $('#s-protein').value = g.protein; $('#s-fat').value = g.fat;
  macroSumHint(); toast('Neu berechnet');
});
$('#s-save').addEventListener('click', () => {
  DB.goals = { cal: +$('#s-cal').value, carbs: +$('#s-carbs').value, protein: +$('#s-protein').value, fat: +$('#s-fat').value };
  DB.profile = { ...DB.profile, age: +$('#s-age').value, height: +$('#s-height').value, weight: +$('#s-weight').value };
  save('nt_goals', DB.goals); save('nt_profile', DB.profile);
  const key = $('#s-apikey').value.trim();
  if (key) localStorage.setItem('nt_apikey', key); else localStorage.removeItem('nt_apikey');
  toast('Gespeichert ✓'); show('view-home'); renderHome();
});
$('#s-reset').addEventListener('click', () => {
  if (!confirm('Wirklich ALLE Daten löschen?')) return;
  localStorage.clear(); location.reload();
});

/* ============================================================
   Onboarding
   ============================================================ */
$$('.chips').forEach(c => c.addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  $$('.chip', c).forEach(x => x.classList.remove('active'));
  b.classList.add('active');
}));
$('#ob-finish').addEventListener('click', () => {
  const profile = {
    goal: $('.chips[data-field=goal] .chip.active').dataset.value,
    sex: $('.chips[data-field=sex] .chip.active').dataset.value,
    activity: +$('#ob-activity').value,
    age: +$('#ob-age').value || 25,
    height: +$('#ob-height').value || 170,
    weight: +$('#ob-weight').value || 70,
  };
  DB.profile = profile;
  DB.goals = calcGoals(profile);
  save('nt_profile', profile); save('nt_goals', DB.goals);
  $('#onboarding').classList.add('hidden');
  show('view-home'); renderHome();
  toast('Willkommen bei benio!');
});

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ============================================================
   Init
   ============================================================ */
function init() {
  if (!DB.profile || !DB.goals) {
    $('#onboarding').classList.remove('hidden');
    VIEWS.forEach(v => $('#' + v).classList.add('hidden'));
    $('#bottom-nav').classList.add('hidden');
  } else {
    show('view-home'); renderHome();
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
}
init();
