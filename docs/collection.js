/* Riftbound Price Tracker - "My collection" tab: binder, my cards, decklists.
 * Saves in this browser; optionally syncs to docs/data/collection.json in your GitHub repo. */
(() => {
'use strict';

/* ------------------------------------------------------------------ state */
const LS_COLL = 'rbt_collection', LS_SYNC = 'rbt_sync';
const REPO_PATH = 'data/collection.json';   // outside docs/, so saving doesn't rebuild the website
const SECTIONS = [['legend','Legend'],['champion','Champion'],['main','Main deck'],['battlefield','Battlefields'],['rune','Runes'],['side','Sideboard']];
const PER_PAGE = 9;
const C = {
  ready:false, cards:[], sets:[], slot:{}, byName:{}, byCode:{}, item:{},
  coll:{version:1, cards:{}, decks:[], updated:null},
  sub:'binder', set:null, page:0, show:'all', rar:'', q:'',
  mcSort:'value', mcQ:'', mcMissing:false, deck:null, importing:false,
  sync:{token:'', owner:'', repo:'', sha:null, status:'local', msg:''}, dirty:false, hist:null,
};
const $c = s => document.querySelector(s);
const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = v => v==null ? '–' : v.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' €';
const norm = s => String(s||'').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'')
  .replace(/[’‘`´]/g,"'").replace(/[^a-z0-9]+/g,' ').trim();
const P = () => (typeof S !== 'undefined' ? S : null);   // the Prices page's state
const imgBase = () => (P() && P().meta && P().meta.image_base) || 'https://openrift.app/media/cards/';
const img = (slot, size) => slot && slot.img ? `${imgBase()}${slot.img}-${size}.webp` : null;
const cmUrl = id => `https://www.cardmarket.com/en/Riftbound/Products?idProduct=${id}`;

/* ----------------------------------------------------------------- styles */
document.head.insertAdjacentHTML('beforeend', `<style>
.csum{display:flex;flex-wrap:wrap;gap:12px;align-items:stretch;margin-bottom:16px}
.csum .box{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 14px;min-width:120px}
.csum .box span{display:block;color:var(--muted);font-size:11px} .csum .box b{font-size:19px;font-variant-numeric:tabular-nums}
.csum .chartbox{flex:1;min-width:240px}
.csum .syncbox{display:flex;flex-direction:column;justify-content:center;gap:6px;min-width:220px}
.sync-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:var(--muted)}
.sync-ok{background:var(--up)} .sync-busy{background:var(--accent)} .sync-err{background:var(--down)}
.subtabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
.subtabs button{background:var(--panel2);border:1px solid var(--line);color:var(--muted);border-radius:99px;padding:6px 14px;font:inherit;font-size:13px;cursor:pointer}
.subtabs button.on{background:var(--accent);border-color:var(--accent);color:#1a1405;font-weight:600}
.setchips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.setchips button{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:6px 10px;font:inherit;font-size:12px;cursor:pointer;text-align:left}
.setchips button small{display:block;color:var(--muted);font-size:10px}
.setchips button.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
.btool{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:12px}
.btool input[type=search]{flex:1;min-width:180px}
.spread{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media (max-width:900px){.spread{grid-template-columns:1fr}}
.bpage{background:linear-gradient(180deg,#14171d,#101216);border:1px solid var(--line);border-radius:10px;padding:12px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;position:relative}
.bpage::before{content:attr(data-p);position:absolute;bottom:-18px;left:0;right:0;text-align:center;color:var(--muted);font-size:11px}
.pocket{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:6px;display:flex;flex-direction:column;gap:5px;min-width:0}
.pocket.emptyp{visibility:hidden}
.pocket .pimg{position:relative;aspect-ratio:744/1039;border-radius:6px;overflow:hidden;background:var(--panel3);cursor:pointer}
.pocket .pimg img{width:100%;height:100%;object-fit:cover;display:block}
.pocket.missing .pimg img{filter:grayscale(1) brightness(.45)}
.pocket.missing .pimg .ph{opacity:.5}
.pocket .pimg .ph{width:100%;height:100%;border-radius:0}
.qbadge{position:absolute;top:5px;right:5px;background:var(--accent);color:#1a1405;font-weight:700;font-size:12px;border-radius:99px;padding:1px 7px;box-shadow:0 1px 4px #000}
.dbadge{position:absolute;bottom:5px;left:5px;background:rgba(15,17,21,.88);color:var(--text);font-size:10px;border-radius:99px;padding:1px 6px;border:1px solid var(--line)}
.pname{font-size:11px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pmeta{font-size:10px;color:var(--muted);display:flex;justify-content:space-between;gap:4px}
.ctr{display:flex;align-items:center;justify-content:space-between;gap:4px;font-size:11px;background:var(--panel);border-radius:6px;padding:2px 3px}
.ctr .lbl{color:var(--muted);padding-left:3px;min-width:34px} .ctr .lbl.foil{color:var(--foil)}
.ctr button{width:22px;height:22px;border-radius:5px;border:1px solid var(--line);background:var(--panel2);color:var(--text);cursor:pointer;font:inherit;line-height:1;padding:0}
.ctr button:hover{border-color:var(--accent)}
.ctr b{min-width:16px;text-align:center;font-variant-numeric:tabular-nums}
.pager{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:28px}
.pager input{width:56px}
.mc td.loc{white-space:normal;font-size:12px;min-width:200px}
.st-ok{color:var(--up)} .st-short{color:var(--down)} .st-spare{color:var(--muted)}
.decks{display:grid;grid-template-columns:280px 1fr;gap:16px}
@media (max-width:860px){.decks{grid-template-columns:1fr}}
.dlist{display:flex;flex-direction:column;gap:8px}
.ditem{display:flex;gap:10px;align-items:center;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:8px;cursor:pointer}
.ditem.on{border-color:var(--accent)} .ditem:hover{border-color:var(--accent)}
.ditem img,.ditem .ph{width:44px;height:61px;border-radius:5px;object-fit:cover;flex:0 0 44px}
.ditem b{display:block;font-size:13px;line-height:1.2} .ditem span{font-size:11px;color:var(--muted)}
.bar{height:5px;background:var(--panel3);border-radius:99px;overflow:hidden;margin-top:4px}
.bar i{display:block;height:100%;background:var(--up)}
.dhead{display:flex;gap:14px;align-items:flex-start;margin-bottom:12px;flex-wrap:wrap}
.dhead .heroes{display:flex;gap:8px}
.dhead .heroes img,.dhead .heroes .ph{width:96px;height:134px;border-radius:7px;object-fit:cover}
.dhead h3{margin:0 0 6px;font-size:20px}
.dstats{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
.dstats .stat{min-width:120px}
.dsec{margin-top:14px} .dsec h4{margin:0 0 6px;font-size:13px;color:var(--muted);font-weight:600}
.dtable td{padding:5px 8px} .dtable .thumb{width:30px;height:42px}
textarea.deckin{width:100%;min-height:260px;background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:10px;font:13px/1.45 ui-monospace,Consolas,monospace}
.cmodal .vers{display:flex;flex-direction:column;gap:6px;margin-top:10px}
.cmodal .ver{display:flex;gap:8px;align-items:center;background:var(--panel2);border-radius:8px;padding:6px 8px;font-size:12px;flex-wrap:wrap}
.cmodal .ver .ctr{min-width:150px}
.unm{background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.35);color:#f3c1c1;border-radius:10px;padding:8px 12px;font-size:12px;margin-bottom:10px}
.fieldrow{display:flex;flex-direction:column;gap:4px;margin:10px 0}
.fieldrow input{background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:7px;padding:8px;font:inherit}
.ctr .lbl .short{display:none}
@media (max-width:560px){
  .bpage{padding:6px;gap:5px} .pocket{padding:4px;gap:4px}
  .ctr{padding:1px} .ctr .lbl{min-width:12px;padding-left:2px} .ctr .lbl .long{display:none} .ctr .lbl .short{display:inline}
  .ctr button{width:26px;height:26px} .pmeta{flex-direction:column;gap:0} .pmeta .rr{display:none}
  .dbadge{font-size:9px}
}
.steps{font-size:13px;line-height:1.6;color:#cfd3db;padding-left:18px}
</style>`);

/* ------------------------------------------------------------ data load */
function indexCards(data){
  C.cards = data.cards; C.sets = data.sets;
  C.slot = {}; C.byName = {}; C.byCode = {};
  for (const s of C.cards){
    C.slot[s.k] = s;
    (C.byName[norm(s.name)] ||= []).push(s);
    const short = s.k.split('/')[0].split('|')[0];
    (C.byCode[norm(short)] ||= []).push(s);
    (C.byCode[norm(s.k.split('|')[0])] ||= []).push(s);
  }
}
function indexPrices(){
  C.item = {};
  for (const it of (P() && P().items) || []) C.item[it.k] = it;
}
const priceN = s => { const p = s.cm && s.cm.normal; return p ? (C.item[String(p)] || {}).price ?? null : null; };
const priceF = s => { const p = s.cm && (s.cm.foil || s.cm.normal); return p ? ((C.item[p+'f'] || {}).price ?? null) : null; };
const pidN = s => s.cm && s.cm.normal, pidF = s => s.cm && (s.cm.foil || s.cm.normal);
const q = k => C.coll.cards[k] || {n:0, f:0};
const owned = k => { const x = q(k); return (x.n||0) + (x.f||0); };
const slotValue = s => { const x = q(s.k); return (x.n||0)*(priceN(s)||0) + (x.f||0)*(priceF(s)||priceN(s)||0); };
function ownedByName(name){ return (C.byName[norm(name)]||[]).reduce((t,s)=>t+owned(s.k),0); }
function cheapest(name){
  const list = C.byName[norm(name)] || [];
  let best = null;
  for (const s of list){ const p = priceN(s); if (p!=null && (!best || p < best.price)) best = {slot:s, price:p, foil:false}; }
  if (!best) for (const s of list){ const p = priceF(s); if (p!=null && (!best || p < best.price)) best = {slot:s, price:p, foil:true}; }
  return best;
}
const slotFor = name => { const l = C.byName[norm(name)] || []; return l.find(s=>owned(s.k)) || (cheapest(name)||{}).slot || l[0]; };

/* deck usage: name -> [{deck, qty}] */
function usage(){
  const u = {};
  for (const d of C.coll.decks) for (const c of d.cards){
    if (c.sec === 'side') continue;
    const key = norm(c.name), arr = (u[key] ||= []);
    const ex = arr.find(x=>x.deck===d); if (ex) ex.qty += c.qty; else arr.push({deck:d, qty:c.qty});
  }
  return u;
}

/* ------------------------------------------------------------- persistence */
function loadLocal(){
  try { const c = JSON.parse(localStorage.getItem(LS_COLL)||'null'); if (c && c.cards) C.coll = Object.assign({version:1,cards:{},decks:[]}, c); } catch(e){}
  try { Object.assign(C.sync, JSON.parse(localStorage.getItem(LS_SYNC)||'{}')); } catch(e){}
  try { C.dirty = localStorage.getItem(LS_COLL+'_dirty') === '1'; } catch(e){}
  if (!C.sync.owner && location.hostname.endsWith('.github.io')){
    C.sync.owner = location.hostname.split('.')[0];
    C.sync.repo = location.pathname.split('/').filter(Boolean)[0] || location.hostname;
  }
}
function saveLocal(){
  try { localStorage.setItem(LS_COLL, JSON.stringify(C.coll)); localStorage.setItem(LS_COLL+'_dirty', C.dirty?'1':'0'); } catch(e){}
}
function saveSync(){ try { localStorage.setItem(LS_SYNC, JSON.stringify({token:C.sync.token, owner:C.sync.owner, repo:C.sync.repo})); } catch(e){} }

let pushTimer = null;
function changed(){
  C.coll.updated = new Date().toISOString(); C.dirty = true; saveLocal();
  if (C.sync.token){ setStatus('busy','Saving…'); clearTimeout(pushTimer); pushTimer = setTimeout(push, 4000); }
  else setStatus('local');
}

const b64enc = str => { const b = new TextEncoder().encode(str); let s=''; for (let i=0;i<b.length;i+=0x8000) s += String.fromCharCode.apply(null, b.subarray(i,i+0x8000)); return btoa(s); };
const b64dec = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g,'')), c=>c.charCodeAt(0)));
const api = () => `https://api.github.com/repos/${encodeURIComponent(C.sync.owner)}/${encodeURIComponent(C.sync.repo)}/contents/${REPO_PATH}`;
const hdrs = () => ({Authorization:`Bearer ${C.sync.token}`, Accept:'application/vnd.github+json'});

async function ghGet(){
  const r = await fetch(api() + '?t=' + Date.now(), {headers:hdrs(), cache:'no-store'});
  if (r.status === 404) return {data:null, sha:null};
  if (!r.ok) throw new Error(r.status === 401 ? 'GitHub key not accepted (401). Check or renew it.' : r.status === 403 ? 'GitHub key has no access to this repo (403). Give it Contents: Read and write.' : `GitHub error ${r.status}`);
  const j = await r.json();
  return {data: JSON.parse(b64dec(j.content)), sha: j.sha};
}
async function ghPut(retry=true){
  const body = {message:`Update collection (${C.coll.decks.length} decks)`, content: b64enc(JSON.stringify(C.coll, null, 1))};
  if (C.sync.sha) body.sha = C.sync.sha;
  const r = await fetch(api(), {method:'PUT', headers:{...hdrs(), 'Content-Type':'application/json'}, body:JSON.stringify(body)});
  if ((r.status === 409 || r.status === 422) && retry){ const g = await ghGet(); C.sync.sha = g.sha; return ghPut(false); }
  if (!r.ok) throw new Error(r.status === 401 ? 'GitHub key not accepted (401).' : r.status === 403 || r.status === 404 ? 'GitHub key cannot write to this repo. Give it Contents: Read and write.' : `GitHub error ${r.status}`);
  C.sync.sha = (await r.json()).content.sha;
}
async function push(){
  pushTimer = null;
  try { await ghPut(); C.dirty = false; saveLocal(); setStatus('ok', 'Saved to GitHub ' + new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})); }
  catch(e){ setStatus('err', e.message + ' Your changes are kept on this device.'); }
}
async function pull(){
  setStatus('busy','Loading from GitHub…');
  const g = await ghGet(); C.sync.sha = g.sha;
  const remote = g.data;
  if (!remote){ await push(); return; }
  const localNewer = C.dirty && C.coll.updated && (!remote.updated || C.coll.updated > remote.updated);
  if (localNewer){ await push(); return; }
  C.coll = Object.assign({version:1,cards:{},decks:[]}, remote); C.dirty = false; saveLocal();
  setStatus('ok','Synced with GitHub');
}
function setStatus(kind, msg){
  C.sync.status = kind; C.sync.msg = msg || (C.sync.token ? '' : 'Saved on this device only');
  const el = $c('#syncStatus'); if (el) el.innerHTML = statusHtml();
}
const statusHtml = () => `<span class="sync-dot ${C.sync.status==='ok'?'sync-ok':C.sync.status==='busy'?'sync-busy':C.sync.status==='err'?'sync-err':''}"></span>${E(C.sync.msg || (C.sync.token?'Synced with GitHub':'Saved on this device only'))}`;

/* ------------------------------------------------------------ decklists */
const HEADERS = [[/^legend/, 'legend'], [/^champion/, 'champion'], [/^(main|maindeck|main deck|deck|cards?)$/, 'main'],
  [/^battlefields?/, 'battlefield'], [/^runes?( deck)?$/, 'rune'], [/^(side|sideboard|side deck)/, 'side']];
function findCard(name){
  let n = name.replace(/\s*[\[(][^\])]*[\])]\s*$/, '').replace(/\*+$/,'').trim();
  const tries = [n, n.replace(/\s+-\s+/, ', '), n.replace(/\s*,\s*/, ', ')];
  for (const t of tries){ const l = C.byName[norm(t)] || C.byCode[norm(t)]; if (l && l.length) return l[0]; }
  const m = n.match(/^([A-Za-z]{2,4})-?(\d{1,3})([a-z*]?)/); // set codes like OGN-001, OGN-001a
  if (m){ const code = `${m[1]}-${m[2].padStart(3,'0')}${m[3]||''}`; const l = C.byCode[norm(code)]; if (l) return l[0]; }
  return null;
}
function parseDeck(text){
  const out = [], unmatched = []; let sec = null, headers = false, block = 0, inBlock = false;
  for (const raw of text.split(/\r?\n/)){
    const line = raw.trim();
    if (!line){ if (inBlock){ block++; inBlock = false; } continue; }
    const h = line.replace(/[:\s]+$/,'').toLowerCase();
    const hdr = !/^\d/.test(line) && HEADERS.find(([re]) => re.test(h));
    if (hdr && line.length < 30){ sec = hdr[1]; headers = true; continue; }
    const m = line.match(/^(\d+)\s*[x×]?\s+(.+)$/i) || line.match(/^(.+?)\s+[x×]?(\d+)$/i);
    if (!m){ unmatched.push(line); continue; }
    const [qty, name] = /^\d/.test(line) ? [parseInt(m[1]), m[2]] : [parseInt(m[2]), m[1]];
    const slot = findCard(name);
    if (!slot){ unmatched.push(line); continue; }
    inBlock = true;
    out.push({name: slot.name, qty, sec, block, type: slot.type || ''});
  }
  // No headers (Piltover Archive plain text): sort by card type, legend first then champion block.
  for (const c of out){
    if (headers && c.sec) continue;
    const t = c.type.toLowerCase();
    c.sec = t.includes('legend') ? 'legend' : t.includes('battlefield') ? 'battlefield' : t.includes('rune') ? 'rune' : 'main';
  }
  if (!headers){
    const legendBlock = out.find(c=>c.sec==='legend');
    if (legendBlock){
      const nb = out.filter(c=>c.block === legendBlock.block + 1);
      if (nb.length === 1 && nb[0].qty === 1 && nb[0].type.toLowerCase().includes('champion')) nb[0].sec = 'champion';
    }
  }
  const merged = [];
  for (const c of out){ const ex = merged.find(x=>x.name===c.name && x.sec===c.sec); if (ex) ex.qty += c.qty; else merged.push({name:c.name, qty:c.qty, sec:c.sec}); }
  return {cards: merged, unmatched};
}
function deckText(d){
  return SECTIONS.map(([k,l]) => { const cs = d.cards.filter(c=>c.sec===k); return cs.length ? `${l}:\n` + cs.map(c=>`${c.qty} ${c.name}`).join('\n') : ''; })
    .filter(Boolean).join('\n\n');
}
function deckName(cards){
  const lg = cards.find(c=>c.sec==='legend'), ch = cards.find(c=>c.sec==='champion');
  let base = lg ? lg.name : ch ? ch.name : 'New deck';
  let n = base, i = 2; while (C.coll.decks.some(d=>d.name===n)) n = `${base} (${i++})`;
  return n;
}
function deckStats(d){
  let total = 0, need = 0, needCost = 0, cards = 0, have = 0, unpriced = 0;
  for (const c of d.cards){
    if (c.sec === 'side') continue;
    const ch = cheapest(c.name), own = ownedByName(c.name);
    cards += c.qty; have += Math.min(c.qty, own);
    if (ch) total += ch.price * c.qty; else unpriced++;
    const miss = Math.max(0, c.qty - own); need += miss; if (ch) needCost += ch.price * miss;
  }
  return {total, need, needCost, cards, have, unpriced, pct: cards ? have/cards : 0};
}

/* ---------------------------------------------------------------- render */
function render(){
  const root = $c('#coll'); if (!root || $c('#tab-collection').hidden) return;
  if (!C.ready){ root.innerHTML = C.loadError || 'Loading your collection…'; return; }
  const sub = (location.hash.split('/')[1] || C.sub);
  C.sub = ['binder','cards','decks'].includes(sub) ? sub : 'binder';
  root.innerHTML = summary() + `<div class="subtabs">
      <button data-sub="binder" class="${C.sub==='binder'?'on':''}">📖 Binder</button>
      <button data-sub="cards" class="${C.sub==='cards'?'on':''}">🗂 My cards</button>
      <button data-sub="decks" class="${C.sub==='decks'?'on':''}">🃏 Decklists (${C.coll.decks.length})</button></div>
    <div class="card" id="csub">${C.sub==='binder' ? binder() : C.sub==='cards' ? myCards() : decks()}</div>`;
  const bs = $c('#bshow'); if (bs) bs.value = C.show; const br = $c('#brar'); if (br) br.value = C.rar; const ms = $c('#mcsort'); if (ms) ms.value = C.mcSort;
}

function summary(){
  let copies = 0, unique = 0, value = 0;
  for (const [k, x] of Object.entries(C.coll.cards)){ const s = C.slot[k]; const n=(x.n||0)+(x.f||0); if (!n) continue; copies += n; unique++; if (s) value += slotValue(s); }
  const h = C.hist;
  let chart = '<span class="small muted">Value history appears once GitHub sync is on and the daily update has run twice.</span>';
  if (h && h.dates.length >= 2){
    const v = h.value, lo = Math.min(...v), hi = Math.max(...v), r = (hi-lo)||1, W=300, H=40;
    const pts = v.map((x,i)=>`${(i/(v.length-1)*W).toFixed(1)},${(H-3-(x-lo)/r*(H-6)).toFixed(1)}`).join(' ');
    const ch = v[v.length-1] - v[0];
    chart = `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:40px"><polyline points="${pts}" fill="none" stroke="${ch>=0?'var(--up)':'var(--down)'}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
      <span class="small muted">${h.dates[0]} → ${h.dates[h.dates.length-1]}: <b class="${ch>=0?'up':'down'}">${ch>=0?'+':''}${money(ch)}</b></span>`;
  }
  return `<div class="csum">
    <div class="box"><span>Collection value</span><b>${money(value)}</b></div>
    <div class="box"><span>Cards owned</span><b>${copies.toLocaleString()}</b></div>
    <div class="box"><span>Different cards</span><b>${unique.toLocaleString()}</b></div>
    <div class="box chartbox"><span>Value over time</span>${chart}</div>
    <div class="box syncbox"><div class="small" id="syncStatus">${statusHtml()}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn" data-act="sync">☁ ${C.sync.token?'Sync settings':'Sync across devices'}</button>
      <button class="btn" data-act="export" title="Download a backup file">⬇ Backup</button><button class="btn" data-act="import" title="Load a backup file">⬆ Restore</button></div></div>
  </div>`;
}

const ctr = (k, fin) => { const x = q(k), v = fin==='foil' ? x.f||0 : x.n||0;
  return `<div class="ctr"><span class="lbl ${fin==='foil'?'foil':''}"><span class="long">${fin==='foil'?'Foil':'Normal'}</span><span class="short">${fin==='foil'?'F':'N'}</span></span><button data-dec="${E(k)}" data-fin="${fin}" title="Remove one">−</button><b>${v}</b><button data-inc="${E(k)}" data-fin="${fin}" title="Add one">+</button></div>`; };

function pimg(s, size){
  const u = img(s, size);
  return u ? `<img loading="lazy" src="${u}" alt="${E(s.name)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:this.alt}))">` : `<div class="ph">${E(s.name)}</div>`;
}

function binderList(){
  let list;
  if (C.q){ const qq = norm(C.q); list = C.cards.filter(s => norm(s.name + ' ' + s.k).includes(qq)); }
  else { if (!C.set) C.set = (C.sets[0]||{}).slug; list = C.cards.filter(s=>s.set===C.set); }
  if (C.rar) list = list.filter(s=>s.rar===C.rar);
  if (C.show==='owned') list = list.filter(s=>owned(s.k));
  if (C.show==='missing') list = list.filter(s=>!owned(s.k));
  return list;
}
function binder(){
  const u = usage();
  const chips = C.sets.map(st => { const all = C.cards.filter(s=>s.set===st.slug); const have = all.filter(s=>owned(s.k)).length;
    return `<button data-set="${E(st.slug)}" class="${!C.q && C.set===st.slug?'on':''}">${E(st.slug)} · ${E(st.name)}<small>${have} / ${all.length} owned</small></button>`; }).join('');
  const rars = [...new Set(C.cards.map(s=>s.rar).filter(Boolean))];
  const list = binderList();
  const perSpread = window.innerWidth > 900 ? PER_PAGE*2 : PER_PAGE;
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
  const spreads = Math.max(1, Math.ceil(list.length / perSpread));
  if (C.page >= spreads) C.page = spreads - 1;
  const start = C.page * perSpread;
  const pageHtml = (off) => { if (off >= list.length && off > 0) return '';
    const cells = []; for (let i=0;i<PER_PAGE;i++){ const s = list[off+i]; cells.push(s ? pocket(s, u) : '<div class="pocket emptyp"></div>'); }
    return `<div class="bpage" data-p="Page ${off/PER_PAGE+1} of ${pages}">${cells.join('')}</div>`; };
  return `<div class="setchips">${chips}</div>
    <div class="btool">
      <input type="search" id="bq" placeholder="Find a card in all sets…" value="${E(C.q)}">
      <label class="small muted">Show <select id="bshow"><option value="all">All cards</option><option value="owned">Owned</option><option value="missing">Missing</option></select></label>
      <label class="small muted">Rarity <select id="brar"><option value="">All</option>${rars.map(r=>`<option>${E(r)}</option>`).join('')}</select></label>
    </div>
    ${list.length ? `<div class="spread">${pageHtml(start)}${perSpread>PER_PAGE ? pageHtml(start+PER_PAGE) : ''}</div>
    <div class="pager"><button class="btn" data-pg="-1" ${C.page<=0?'disabled':''}>◀ Previous</button>
      <span class="small muted">Spread <input type="number" id="pgjump" min="1" max="${spreads}" value="${C.page+1}"> of ${spreads}</span>
      <button class="btn" data-pg="1" ${C.page>=spreads-1?'disabled':''}>Next ▶</button></div>`
    : '<div class="empty">No cards match.</div>'}`;
}
function pocket(s, u){
  const own = owned(s.k), uses = (u[norm(s.name)]||[]).reduce((t,x)=>t+x.qty,0);
  const pn = priceN(s), pf = priceF(s);
  return `<div class="pocket ${own?'':'missing'}">
    <div class="pimg" data-slot="${E(s.k)}">${pimg(s,'240w')}${own?`<span class="qbadge">×${own}</span>`:''}${uses?`<span class="dbadge" title="Copies used in your decks">🃏 ${uses} in decks</span>`:''}</div>
    <div class="pname" title="${E(s.name)}">${E(s.name)}</div>
    <div class="pmeta"><span>${E(s.k.split('|')[0].split('/')[0])}${s.rar?`<span class="rr"> · <span class="r-${E(s.rar)}">${E(s.rar)}</span></span>`:''}</span><span>${pn!=null?money(pn):pf!=null?`<span style="color:var(--foil)">${money(pf)}</span>`:''}</span></div>
    ${s.fin.map(f=>ctr(s.k,f)).join('')}
  </div>`;
}

function myCards(){
  const u = usage(); const groups = {};
  for (const [k,x] of Object.entries(C.coll.cards)){
    const s = C.slot[k]; if (!s || !((x.n||0)+(x.f||0))) continue;
    const g = (groups[norm(s.name)] ||= {name:s.name, slots:[], own:0, value:0});
    g.slots.push(s); g.own += (x.n||0)+(x.f||0); g.value += slotValue(s);
  }
  if (C.mcMissing) for (const [key, arr] of Object.entries(u)) if (!groups[key]){ const s = slotFor(arr[0].deck.cards.find(c=>norm(c.name)===key).name); if (s) groups[key] = {name:s.name, slots:[], own:0, value:0}; }
  let rows = Object.values(groups);
  if (C.mcQ){ const qq = norm(C.mcQ); rows = rows.filter(g=>norm(g.name).includes(qq)); }
  rows.forEach(g => { g.uses = u[norm(g.name)] || []; g.need = g.uses.reduce((t,x)=>t+x.qty,0); });
  const sorts = {value:(a,b)=>b.value-a.value, name:(a,b)=>a.name.localeCompare(b.name), own:(a,b)=>b.own-a.own, short:(a,b)=>(b.need-b.own)-(a.need-a.own)};
  rows.sort(sorts[C.mcSort] || sorts.value);
  const body = rows.map(g => {
    const s = g.slots[0] || slotFor(g.name);
    const vers = g.slots.map(sl => { const x = q(sl.k); return [x.n?`${x.n}× ${sl.k.split('|')[0]}`:'', x.f?`<span style="color:var(--foil)">${x.f}× ${sl.k.split('|')[0]} foil</span>`:''].filter(Boolean).join(', '); }).join(', ');
    const loc = g.uses.length ? g.uses.map(x=>`<b>${x.qty}×</b> <a href="#collection/decks" data-deck="${E(x.deck.id)}">${E(x.deck.name)}</a>`).join(' · ') : '<span class="muted">Not in any deck</span>';
    const diff = g.own - g.need;
    const st = !g.need ? `<span class="st-spare">${g.own} free</span>` : diff >= 0 ? `<span class="st-ok">✓ ${diff ? diff+' spare' : 'all in decks'}</span>` : `<span class="st-short">short ${-diff}</span>`;
    return `<tr><td style="width:40px">${s && img(s,'120w') ? `<img class="thumb" loading="lazy" src="${img(s,'120w')}" alt="" data-slot="${E(s.k)}" style="cursor:pointer">` : ''}</td>
      <td class="name"><a href="javascript:void 0" data-slot="${E(s ? s.k : '')}" style="color:var(--text)">${E(g.name)}</a><div class="small muted">${vers || 'not owned'}</div></td>
      <td class="num">${g.own}</td><td class="num">${money(g.value)}</td><td class="loc">${loc}</td><td class="num small">${st}</td></tr>`;
  }).join('');
  return `<div class="btool"><input type="search" id="mcq" placeholder="Search your cards…" value="${E(C.mcQ)}">
      <label class="small muted">Sort <select id="mcsort"><option value="value">Value</option><option value="name">Name</option><option value="own">Copies</option><option value="short">Short for decks first</option></select></label>
      <label class="small muted"><input type="checkbox" id="mcmiss" ${C.mcMissing?'checked':''}> Include deck cards I don't own</label></div>
    ${rows.length ? `<div style="overflow-x:auto"><table class="mc"><tr><th></th><th>Card</th><th class="num">Owned</th><th class="num">Value</th><th>Where it is</th><th class="num">Status</th></tr>${body}</table></div>`
      : '<div class="empty">No cards yet. Add cards in the Binder with the + buttons, or import a deck under Decklists.</div>'}`;
}

function decks(){
  const list = C.coll.decks.map(d => { const st = deckStats(d); const lg = slotFor((d.cards.find(c=>c.sec==='legend')||d.cards[0]||{}).name || '');
    return `<div class="ditem ${C.deck===d.id && !C.importing?'on':''}" data-deck="${E(d.id)}">${lg && img(lg,'120w') ? `<img src="${img(lg,'120w')}" alt="">` : '<div class="ph">🃏</div>'}
      <div style="flex:1;min-width:0"><b>${E(d.name)}</b><span>${money(st.total)} · ${st.have}/${st.cards} owned</span><div class="bar"><i style="width:${Math.round(st.pct*100)}%"></i></div></div></div>`; }).join('');
  const d = C.coll.decks.find(x=>x.id===C.deck);
  const right = C.importing || !d ? importForm() : deckView(d);
  return `<div class="decks"><div class="dlist"><button class="btn" data-act="newdeck">＋ Import a deck</button>${list || '<div class="empty small">No decks yet.</div>'}</div><div>${right}</div></div>`;
}
function importForm(){
  const editing = C.importing && C.importing !== true ? C.coll.decks.find(x=>x.id===C.importing) : null;
  return `<h3 style="margin:0 0 6px">${editing ? 'Edit ' + E(editing.name) : 'Import a deck'}</h3>
    ${editing ? '' : `<ol class="steps"><li>On <a href="https://piltoverarchive.com" target="_blank" rel="noopener">Piltover Archive</a>, open the deck and click <b>Export</b> → <b>Export as Text</b> (copy it).</li>
      <li>Paste it below and click <b>Save deck</b>.</li></ol>
      <p class="small muted">Lists from riftbound.gg, Rift Atlas and most other sites work too: one card per line, like <code>3 Kai'Sa, Survivor</code> or <code>3x Kai'Sa - Survivor</code>.</p>`}
    <div class="fieldrow"><label class="small muted">Deck name (leave empty to use the legend's name)</label><input id="dname" value="${E(editing ? editing.name : '')}"></div>
    <textarea class="deckin" id="dtext" placeholder="1 Rengar, Pridestalker&#10;&#10;1 Rengar, Trophy Hunter&#10;&#10;3 Kai'Sa, Survivor&#10;3 ...&#10;&#10;12 Calm Rune">${E(editing ? deckText(editing) : '')}</textarea>
    <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" data-act="savedeck" style="border-color:var(--accent)">💾 Save deck</button>${C.coll.decks.length?'<button class="btn" data-act="cancelimport">Cancel</button>':''}</div>
    <div id="importmsg"></div>`;
}
function deckView(d){
  const st = deckStats(d), u = usage();
  const lg = d.cards.find(c=>c.sec==='legend'), ch = d.cards.find(c=>c.sec==='champion');
  const hero = c => { const s = c && slotFor(c.name); return s ? `<div data-slot="${E(s.k)}" style="cursor:pointer">${img(s,'240w') ? `<img src="${img(s,'240w')}" alt="${E(s.name)}">` : `<div class="ph">${E(s.name)}</div>`}</div>` : ''; };
  const secs = SECTIONS.map(([k,l]) => {
    const cs = d.cards.filter(c=>c.sec===k); if (!cs.length) return '';
    const n = cs.reduce((t,c)=>t+c.qty,0);
    return `<div class="dsec"><h4>${l} (${n})</h4><table class="dtable">` + cs.map(c => {
      const s = slotFor(c.name), chp = cheapest(c.name), own = ownedByName(c.name);
      const others = (u[norm(c.name)]||[]).filter(x=>x.deck!==d);
      const ok = own >= c.qty;
      return `<tr><td style="width:36px">${s && img(s,'120w') ? `<img class="thumb" src="${img(s,'120w')}" alt="" data-slot="${E(s.k)}" style="cursor:pointer">` : '<div class="thumb ph"></div>'}</td>
        <td style="width:30px"><b>${c.qty}×</b></td>
        <td class="name"><a href="javascript:void 0" data-slot="${E(s ? s.k : '')}" style="color:var(--text)">${E(c.name)}</a>${others.length?`<div class="small muted">also in ${others.map(x=>`${x.qty}× ${E(x.deck.name)}`).join(', ')}</div>`:''}</td>
        <td class="num small ${ok?'st-ok':'st-short'}" title="Copies you own (all versions)">${ok?'✓':''} ${own}/${c.qty}</td>
        <td class="num small muted">${chp ? money(chp.price) + ' each' : 'no price'}</td>
        <td class="num">${chp ? money(chp.price*c.qty) : '–'}</td></tr>`; }).join('') + '</table></div>';
  }).join('');
  return `<div class="dhead"><div class="heroes">${hero(lg)}${hero(ch)}</div><div style="flex:1;min-width:220px">
      <h3>${E(d.name)}</h3>
      <div class="dstats">
        <div class="stat"><span>Deck price (Cardmarket)</span><b>${money(st.total)}</b></div>
        <div class="stat"><span>You own</span><b>${st.have} / ${st.cards}</b></div>
        <div class="stat"><span>Missing cards cost</span><b class="${st.need?'down':'up'}">${st.need ? money(st.needCost) : '0,00 €'}</b></div>
      </div>
      <div class="small muted">Prices use the cheapest version of each card (Cardmarket trend). Sideboard not included.${st.unpriced?` ${st.unpriced} card(s) have no price yet.`:''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        <button class="btn" data-act="editdeck">✏ Edit list / name</button><button class="btn" data-act="copydeck">📋 Copy list</button>
        ${st.need?'<button class="btn" data-act="addmissing" title="Mark the missing copies as owned (cheapest version), e.g. after buying them">✔ I bought the missing cards</button>':''}
        <button class="btn" data-act="deldeck" style="color:var(--down)">🗑 Delete</button></div>
    </div></div>
    ${d.unmatched && d.unmatched.length ? `<div class="unm">These lines weren't recognised: ${d.unmatched.map(E).join(' · ')}. Click <b>Edit list</b> to fix the names.</div>` : ''}
    ${secs}`;
}

/* -------------------------------------------------------------- card modal */
function openCard(k){
  const s = C.slot[k]; if (!s) return;
  const vers = C.byName[norm(s.name)] || [s];
  const u = (usage()[norm(s.name)] || []);
  const ov = $c('#cov') || document.body.appendChild(Object.assign(document.createElement('div'), {id:'cov', className:'overlay'}));
  const pids = [...new Set(vers.flatMap(v=>[pidN(v), pidF(v)]).filter(Boolean))];
  ov.innerHTML = `<div class="detail cmodal"><div class="cimg ${owned(k)?'':''}" style="width:280px;flex:0 0 280px">${pimg(s,'full')}</div>
    <div class="right"><button class="btn close" data-act="closecard">✕</button>
      <h3>${E(s.name)}</h3><div class="muted">${E(s.rar)} · ${E(s.type)} · ${E((C.sets.find(x=>x.slug===s.set)||{}).name||s.set)}</div>
      <div class="small" style="margin-top:4px">${pids.slice(0,1).map(p=>`<a href="${cmUrl(p)}" target="_blank" rel="noopener">Open on Cardmarket ↗</a>`).join('')}${s.card?` · <a href="https://openrift.app/cards/${E(s.card)}" target="_blank" rel="noopener">OpenRift ↗</a>`:''}</div>
      <h4 style="margin:14px 0 4px;font-size:13px">Your copies (${ownedByName(s.name)} in total)</h4>
      <div class="vers">${vers.map(v=>`<div class="ver" ${v.k===k?'style="outline:1px solid var(--accent)"':''}>
        ${img(v,'120w')?`<img class="thumb" src="${img(v,'120w')}" alt="">`:''}<div style="flex:1;min-width:120px"><b>${E(v.k.split('|')[0])}</b> <span class="r-${E(v.rar)}">${E(v.rar)}</span>${v.sig?' · signed':''}${v.art?` · ${E(v.art)}`:''}
        <div class="muted">${priceN(v)!=null?`Normal ${money(priceN(v))}`:''}${priceF(v)!=null?` · <span style="color:var(--foil)">Foil ${money(priceF(v))}</span>`:''}</div></div>
        <div style="display:flex;flex-direction:column;gap:3px">${v.fin.map(f=>ctr(v.k,f)).join('')}</div></div>`).join('')}</div>
      <h4 style="margin:14px 0 4px;font-size:13px">Where it is</h4>
      <div class="small">${u.length ? u.map(x=>`<b>${x.qty}×</b> ${E(x.deck.name)}`).join('<br>') + `<div class="muted" style="margin-top:4px">${Math.max(0, ownedByName(s.name) - u.reduce((t,x)=>t+x.qty,0))} copies not in a deck${ownedByName(s.name) < u.reduce((t,x)=>t+x.qty,0) ? ` · <span class="st-short">short ${u.reduce((t,x)=>t+x.qty,0)-ownedByName(s.name)} for your decks</span>` : ''}</div>` : '<span class="muted">Not used in any of your decks.</span>'}</div>
    </div></div>`;
  ov.classList.add('open'); ov.dataset.k = k;
}
function refreshOpenCard(){ const ov = $c('#cov'); if (ov && ov.classList.contains('open')) openCard(ov.dataset.k); }

/* ------------------------------------------------------------- sync dialog */
function openSync(){
  const ov = $c('#cov') || document.body.appendChild(Object.assign(document.createElement('div'), {id:'cov', className:'overlay'}));
  ov.innerHTML = `<div class="detail" style="display:block;max-width:640px"><button class="btn close" data-act="closecard">✕</button>
    <h3>☁ Sync your collection across devices</h3>
    <p class="small muted">Without sync, your collection and decks are saved in this browser only. With sync, they're saved in your GitHub repo (<code>${REPO_PATH}</code>) so your PC and phone share them, and the daily update tracks your collection's value. Your repo is public, so anyone with the link could see your card list (but not change it).</p>
    <ol class="steps">
      <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → New fine-grained token</a> (log in if asked).</li>
      <li><b>Token name:</b> <code>riftbound collection</code>. <b>Expiration:</b> pick the longest you're comfortable with, e.g. 1 year.</li>
      <li><b>Repository access:</b> <i>Only select repositories</i> → choose <b>${E(C.sync.repo||'riftbound-prices')}</b>.</li>
      <li><b>Permissions → Repository permissions → Contents:</b> <i>Read and write</i>. Leave everything else as it is.</li>
      <li>Click <b>Generate token</b>, copy it (it starts with <code>github_pat_</code>) and paste it below. Do this once on each device.</li>
    </ol>
    <div class="fieldrow"><label class="small muted">GitHub token</label><input id="stoken" type="password" placeholder="github_pat_…" value="${E(C.sync.token)}" autocomplete="off"></div>
    <div style="display:flex;gap:10px"><div class="fieldrow" style="flex:1"><label class="small muted">GitHub username</label><input id="sowner" value="${E(C.sync.owner)}"></div>
      <div class="fieldrow" style="flex:1"><label class="small muted">Repository name</label><input id="srepo" value="${E(C.sync.repo)}"></div></div>
    <p class="small muted">The token is stored only in this browser and is only sent to GitHub. Never share it.</p>
    <div style="display:flex;gap:8px"><button class="btn" data-act="savesync" style="border-color:var(--accent)">Connect</button>${C.sync.token?'<button class="btn" data-act="unsync">Disconnect this device</button>':''}</div>
    <div id="syncmsg" class="small" style="margin-top:10px"></div></div>`;
  ov.classList.add('open'); delete ov.dataset.k;
}

/* --------------------------------------------------------------- events */
function bump(k, fin, d){
  const x = Object.assign({n:0,f:0}, C.coll.cards[k]);
  const key = fin==='foil' ? 'f' : 'n'; x[key] = Math.max(0, (x[key]||0) + d);
  if (x.n || x.f) C.coll.cards[k] = x; else delete C.coll.cards[k];
  changed();
}
document.addEventListener('click', async e => {
  const inTab = e.target.closest('#tab-collection, #cov'); if (!inTab) return;
  const t = e.target;
  const inc = t.closest('[data-inc]'), dec = t.closest('[data-dec]');
  if (inc || dec){ const b = inc || dec; bump(b.dataset.inc || b.dataset.dec, b.dataset.fin, inc ? 1 : -1); render(); refreshOpenCard(); return; }
  const sub = t.closest('[data-sub]'); if (sub){ location.hash = 'collection/' + sub.dataset.sub; return; }
  const st = t.closest('[data-set]'); if (st){ C.set = st.dataset.set; C.q = ''; C.page = 0; render(); return; }
  const pg = t.closest('[data-pg]'); if (pg){ C.page += parseInt(pg.dataset.pg); render(); $c('.setchips') && $c('#csub').scrollIntoView({block:'start'}); return; }
  const dk = t.closest('[data-deck]'); if (dk){ e.preventDefault(); C.deck = dk.dataset.deck; C.importing = false; if (C.sub!=='decks') location.hash='collection/decks'; else render(); return; }
  const sl = t.closest('[data-slot]'); if (sl && sl.dataset.slot){ e.preventDefault(); openCard(sl.dataset.slot); return; }
  const act = t.closest('[data-act]'); if (!act) { if (t.id==='cov') t.classList.remove('open'); return; }
  const d = C.coll.decks.find(x=>x.id===C.deck);
  switch (act.dataset.act){
    case 'closecard': $c('#cov').classList.remove('open'); break;
    case 'newdeck': C.importing = true; render(); break;
    case 'cancelimport': C.importing = false; render(); break;
    case 'editdeck': C.importing = d.id; render(); break;
    case 'savedeck': {
      const text = $c('#dtext').value, res = parseDeck(text);
      if (!res.cards.length){ $c('#importmsg').innerHTML = `<div class="unm" style="margin-top:10px">No cards recognised. Paste the deck's text export, one card per line like <code>3 Kai'Sa, Survivor</code>.</div>`; return; }
      const name = $c('#dname').value.trim();
      if (C.importing && C.importing !== true){ const x = C.coll.decks.find(y=>y.id===C.importing); x.cards = res.cards; x.unmatched = res.unmatched; if (name) x.name = name; }
      else { const id = 'd' + Date.now().toString(36); C.coll.decks.push({id, name: name || deckName(res.cards), cards:res.cards, unmatched:res.unmatched, created:new Date().toISOString().slice(0,10)}); C.deck = id; }
      C.importing = false; changed(); render(); break; }
    case 'copydeck': try { await navigator.clipboard.writeText(deckText(d)); act.textContent = '✓ Copied'; } catch(err){ C.importing = d.id; render(); } break;
    case 'deldeck': if (confirm(`Delete the deck "${d.name}"? Your collection is not changed.`)){ C.coll.decks = C.coll.decks.filter(x=>x!==d); C.deck = (C.coll.decks[0]||{}).id || null; changed(); render(); } break;
    case 'addmissing': {
      if (!confirm('Add the missing copies of this deck to your collection (as the cheapest version of each card)?')) break;
      for (const c of d.cards){ if (c.sec==='side') continue; const miss = c.qty - ownedByName(c.name); const ch = cheapest(c.name) || {slot: slotFor(c.name), foil:false};
        if (miss > 0 && ch.slot) for (let i=0;i<miss;i++) bump(ch.slot.k, ch.foil || !ch.slot.fin.includes('normal') ? 'foil' : 'normal', 1); }
      render(); break; }
    case 'sync': openSync(); break;
    case 'savesync': {
      C.sync.token = $c('#stoken').value.trim(); C.sync.owner = $c('#sowner').value.trim(); C.sync.repo = $c('#srepo').value.trim();
      const msg = $c('#syncmsg'); msg.textContent = 'Connecting…';
      try { await pull(); saveSync(); msg.innerHTML = '<span class="up">✓ Connected. Your collection is now saved to GitHub.</span>'; render(); }
      catch(err){ msg.innerHTML = `<span class="down">${E(err.message)}</span>`; C.sync.token = ''; setStatus('local'); }
      break; }
    case 'unsync': C.sync.token = ''; C.sync.sha = null; saveSync(); setStatus('local'); $c('#cov').classList.remove('open'); render(); break;
    case 'export': {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(C.coll, null, 1)], {type:'application/json'}));
      a.download = `riftbound-collection-${new Date().toISOString().slice(0,10)}.json`; a.click(); break; }
    case 'import': {
      const inp = Object.assign(document.createElement('input'), {type:'file', accept:'.json,application/json'});
      inp.onchange = async () => { try { const data = JSON.parse(await inp.files[0].text()); if (!data.cards) throw new Error('not a collection backup');
        if (confirm(`Replace your current collection with this backup (${Object.keys(data.cards).length} cards, ${(data.decks||[]).length} decks)?`)){ C.coll = Object.assign({version:1,cards:{},decks:[]}, data); changed(); render(); } }
        catch(err){ alert('That file is not a collection backup: ' + err.message); } };
      inp.click(); break; }
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'bq'){ C.q = e.target.value; C.page = 0; const pos = e.target.selectionStart; render(); const el = $c('#bq'); el.focus(); el.setSelectionRange(pos,pos); }
  if (e.target.id === 'mcq'){ C.mcQ = e.target.value; const pos = e.target.selectionStart; render(); const el = $c('#mcq'); el.focus(); el.setSelectionRange(pos,pos); }
});
document.addEventListener('change', e => {
  const id = e.target.id;
  if (id === 'bshow'){ C.show = e.target.value; C.page = 0; render(); }
  if (id === 'brar'){ C.rar = e.target.value; C.page = 0; render(); }
  if (id === 'mcsort'){ C.mcSort = e.target.value; render(); }
  if (id === 'mcmiss'){ C.mcMissing = e.target.checked; render(); }
  if (id === 'pgjump'){ C.page = Math.max(0, (parseInt(e.target.value)||1) - 1); render(); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape'){ const ov = $c('#cov'); if (ov) ov.classList.remove('open'); }
  if ($c('#tab-collection').hidden || C.sub !== 'binder' || /input|textarea|select/i.test(document.activeElement.tagName)) return;
  if (e.key === 'ArrowRight'){ const b = $c('[data-pg="1"]'); if (b && !b.disabled) b.click(); }
  if (e.key === 'ArrowLeft'){ const b = $c('[data-pg="-1"]'); if (b && !b.disabled) b.click(); }
});
// Save straight away when the page is closed or hidden (phone screen off, tab switched).
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && pushTimer && C.sync.token){ clearTimeout(pushTimer); pushTimer = null; push(); } });
window.addEventListener('tab-changed', () => render());
window.addEventListener('hashchange', () => render());
let resizeT; window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(()=>{ if (C.sub==='binder') render(); }, 200); });

/* ------------------------------------------------------------------ init */
async function init(){
  loadLocal(); indexPrices();
  try {
    const r = await fetch('data/cards.json?v=' + Date.now());
    if (!r.ok) throw new Error();
    indexCards(await r.json());
  } catch(e){
    C.loadError = '<div class="note">The card list for the collection isn\'t there yet. It is created by the daily update: go to your repo\'s <b>Actions</b> tab → <b>Daily price update</b> → <b>Run workflow</b>, wait for the green tick, then reload this page.</div>';
    render(); return;
  }
  fetch('data/collection_history.json?v=' + Date.now()).then(r=>r.ok?r.json():null).then(h=>{ C.hist = h; render(); }).catch(()=>{});
  if (C.sync.token){
    try { await pull(); } catch(e){ setStatus('err', e.message + ' Using the copy on this device.'); }
  } else {
    if (!Object.keys(C.coll.cards).length && !C.coll.decks.length){
      // Another device synced to GitHub? Start from that public copy.
      try { const r = C.sync.owner && await fetch(`https://raw.githubusercontent.com/${C.sync.owner}/${C.sync.repo}/HEAD/${REPO_PATH}?v=${Date.now()}`); if (r && r.ok){ C.coll = Object.assign({version:1,cards:{},decks:[]}, await r.json()); C.dirty = false; saveLocal(); } } catch(e){}
    }
    setStatus('local');
  }
  C.deck = C.deck || (C.coll.decks[0]||{}).id || null;
  C.ready = true; render();
}
if (P() && P().items && P().items.length) init();
else window.addEventListener('prices-loaded', init, {once:true});
})();
