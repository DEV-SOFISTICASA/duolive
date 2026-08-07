// DuoLive · Robô do console de lives do TikTok (Compass) — TODAS as lojas, por cookies
//
// Reusa as sessoes do LiveDash (seller brasileiro, ja logadas no Supabase) e, para
// CADA loja, abre o console de lives, le os numeros da live atual (GMV, pedidos,
// views) e manda para o conector marcando a loja. O painel mostra a loja selecionada.
// Mesma tecnica do robo-servidor do LiveDash.
//
// Como usar (no PC, pasta conector):
//   set SB_KEY=chave_service_role_do_livedash
//   set DUOLIVE_CONECTOR=https://duolive-conector.onrender.com
//   npm run robo-console
//
// (SB_KEY e' a mesma chave que o LiveDash usa no GitHub — a service role.)

const { abreNavegador } = require('./navegador.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const CONECTOR = (process.env.DUOLIVE_CONECTOR || ('http://127.0.0.1:' + (process.env.DUOLIVE_PORTA || 9797))).replace(/\/+$/, '');
const COMPASS = 'https://shop.tiktok.com/streamer/compass/live-details/view';
const SB_URL = process.env.SB_URL || 'https://nqgfxpbzybobzsrevvom.supabase.co';
const SB_KEY = process.env.SB_KEY || '';
const SO_LOJA = (process.env.DUOLIVE_LOJA || '').trim(); // opcional: rodar so uma loja
const INTERVALO = Math.max(2, +(process.env.DUOLIVE_INTERVALO_MIN || 5)) * 60000; // minutos entre voltas

const STATS = [3, 2, 20, 23, 310, 325, 39, 29, 330, 72, 343, 313];
const MAP = { 3: 'gmv', 2: 'orders', 20: 'views' };

function manda(loja, gmv, orders, views, live) {
  const dados = JSON.stringify({ loja: loja, gmv: gmv, orders: orders, views: views, live: !!live });
  const u = new URL(CONECTOR + '/numeros-tiktok');
  const lib = u.protocol === 'https:' ? https : http;
  const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dados) } });
  req.on('error', () => console.log('    (nao consegui falar com o conector em ' + CONECTOR + ')'));
  req.end(dados);
  console.log('    📊 ' + loja + (live ? ' 🔴AO VIVO' : '') + ': GMV R$ ' + gmv.toFixed(2) + ' · ' + orders + ' pedidos · ' + views + ' views');
}
function ms(t) { const n = +t || 0; return n > 1e12 ? n : n * 1000; } // aceita segundos ou ms

function numeros(room) {
  const met = {};
  (room.analytics_metrics || []).forEach((m) => { if (MAP[m.stats_type]) met[MAP[m.stats_type]] = +m.raw_value; });
  return { gmv: met.gmv || 0, orders: met.orders || 0, views: met.views || 0 };
}

// ===== vigia rapida de PEDIDOS (só das lojas em live) =====
const INICIO = Date.now();
const jaVistos = new Set();
const lojasAoVivo = new Map(); // loja -> storageState (as que estao em live agora)
const descobPedidos = new Set();
// paginas de pedidos ao vivo do TikTok Shop (BR)
const PAG_PEDIDOS = [
  'https://seller-br.tiktok.com/order',
  'https://shop.tiktok.com/streamer/compass/live-details/view',
];
const eData = (v) => { const n = +v || 0; return n > 1e12 ? n : n > 1e9 ? n * 1000 : 0; };
const numPed = (v) => (v == null ? 0 : +String(v).replace(/[^\d.]/g, '') || 0);
function achaKey(o, re) { for (const k of Object.keys(o)) if (re.test(k)) return o[k]; }
function parsePedido(o) {
  if (!o || typeof o !== 'object') return null;
  const id = achaKey(o, /^(order_?id|order_?sn|orderno|package_?id|trade_?no)$/i);
  if (!id) return null;
  const valor = numPed(achaKey(o, /(total_?amount|total_?price|pay_?amount|grand_?total|amount|paid)/i));
  const criado = eData(achaKey(o, /(create_?time|created_?at|order_?time|ctime|pay_?time)/i));
  let quem = achaKey(o, /(buyer_?username|buyer_?name|user_?name|username|nickname|buyer)/i);
  if (quem && typeof quem === 'object') quem = quem.username || quem.name || quem.nickname || '';
  if (criado && criado < INICIO - 10 * 60000) return null; // so pedidos da live atual
  return { orderId: String(id), quem: String(quem || '').slice(0, 60), valor: valor };
}
function garimpa(json, achados) {
  if (Array.isArray(json)) json.forEach((x) => { const p = parsePedido(x); if (p) achados.push(p); else garimpa(x, achados); });
  else if (json && typeof json === 'object') { const p = parsePedido(json); if (p) achados.push(p); Object.values(json).forEach((v) => garimpa(v, achados)); }
}
function mandaPedido(loja, p) {
  const dados = JSON.stringify({ orderId: p.orderId, quem: p.quem, valor: p.valor, plataforma: 'tiktok', loja: loja });
  const u = new URL(CONECTOR + '/venda-auto');
  const lib = u.protocol === 'https:' ? https : http;
  const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dados) } });
  req.on('error', () => {});
  req.end(dados);
  console.log('    🛒 ' + loja + ': ' + (p.quem || 'pedido') + (p.valor ? ' — R$ ' + p.valor : '') + ' (#' + p.orderId + ')');
}
async function vigiarPedidos(browser) {
  if (!lojasAoVivo.size) return;
  for (const [loja, storageState] of lojasAoVivo) {
    const ctx = await browser.newContext({ storageState, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    const page = await ctx.newPage();
    page.on('response', async (resp) => {
      try {
        if (!/order|trade|pack|fulfillment/i.test(resp.url())) return;
        if (!String(resp.headers()['content-type'] || '').includes('json')) return;
        const json = await resp.json();
        descobPedidos.add(resp.url().slice(0, 140));
        const achados = []; garimpa(json, achados);
        achados.forEach((p) => { if (!jaVistos.has(loja + p.orderId)) { jaVistos.add(loja + p.orderId); mandaPedido(loja, p); } });
      } catch (e) {}
    });
    try { for (const u of PAG_PEDIDOS) { try { await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 }); await page.waitForTimeout(4000); } catch (e) {} } }
    catch (e) {}
    try { fs.writeFileSync(path.join(__dirname, 'descoberta-pedidos.json'), JSON.stringify(Array.from(descobPedidos), null, 1)); } catch (e) {}
    try { await ctx.close(); } catch (e) {}
  }
}

async function lerLojas() {
  if (!SB_KEY) { console.log('Falta a SB_KEY (chave service-role do LiveDash). Rode:  set SB_KEY=sua_chave'); return []; }
  const filtro = SO_LOJA ? ('&loja=eq.' + encodeURIComponent(SO_LOJA)) : '';
  const r = await fetch(SB_URL + '/rest/v1/tts_sessions?select=loja,storage_state&ativo=eq.true' + filtro,
    { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY } });
  if (r.status >= 300) { console.log('Erro ao ler as lojas do LiveDash: ' + r.status); return []; }
  const rows = await r.json();
  return rows.map((x) => ({ loja: x.loja, storageState: x.storage_state })).filter((x) => x.storageState);
}

async function coletarLoja(browser, loja, storageState, descoberta) {
  const ctx = await browser.newContext({ storageState, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  let signedUrl = null;
  page.on('request', (req) => {
    const u = req.url();
    if (/detail_performance\/l|room_level_detail|live[-_]?detail|performance.*list/i.test(u)) signedUrl = u;
    if (/compass|performance|live.?detail|streamer|analytic/i.test(u)) descoberta.add(u.slice(0, 140));
  });
  try {
    await page.goto(COMPASS, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(7000);
    await page.mouse.wheel(0, 1400); await page.waitForTimeout(4000);
    if (!signedUrl) { console.log('    ' + loja + ': nao captei a chamada do console (sessao pode ter expirado no LiveDash).'); await ctx.close(); return; }
    const end = Date.now(), start = end - 2 * 86400 * 1000;
    const body = JSON.stringify({
      time_selector: { time_range_period: 6, start_timestamp: String(start), end_timestamp: String(end), timezone: 'America/Sao_Paulo' },
      stats_types: STATS, page_number: 1, page_size: 20, sort_key: 0, sort_order: 1,
    });
    const resp = await page.request.post(signedUrl, { data: body, headers: { 'content-type': 'application/json' } });
    const j = await resp.json();
    if (j.code !== 0) { console.log('    ' + loja + ': console code ' + j.code + ' (' + (j.message || '') + ')'); await ctx.close(); return; }
    const rooms = (j.data && j.data.room_level_detail_data) || [];
    if (!rooms.length) { console.log('    ' + loja + ': sem live recente.'); await ctx.close(); return; }
    const n = numeros(rooms[0]);
    // "esta ao vivo?" a live mais recente ainda nao terminou (sem fim, ou fim ha < 12 min)
    const fim = ms(rooms[0].room_finish_timestamp);
    const criado = ms(rooms[0].room_create_timestamp);
    const agora = Date.now();
    const live = criado > 0 && (fim === 0 || (agora - fim) < 12 * 60000) && (agora - criado) < 12 * 3600000;
    manda(loja, n.gmv, n.orders, n.views, live);
    // registra/atualiza as lojas em live para a vigia rapida de pedidos
    if (live) lojasAoVivo.set(loja, storageState); else lojasAoVivo.delete(loja);
  } catch (e) { console.log('    ' + loja + ': erro ' + String(e).slice(0, 60)); }
  try { await ctx.close(); } catch (e) {}
}

(async () => {
  console.log('\n  DuoLive · Robô do console de lives (Compass) — TODAS as lojas');
  console.log('  Mandando para: ' + CONECTOR + '\n');
  const browser = await abreNavegador(true);

  async function volta() {
    const lojas = await lerLojas();
    if (!lojas.length) { console.log('  Nenhuma loja para coletar (confira SB_KEY).'); return; }
    console.log('  Coletando ' + lojas.length + ' loja(s)...');
    const descoberta = new Set();
    for (const l of lojas) { await coletarLoja(browser, l.loja, l.storageState, descoberta); }
    try { fs.writeFileSync(path.join(__dirname, 'descoberta-console.json'), JSON.stringify(Array.from(descoberta), null, 1)); } catch (e) {}
    console.log('  Volta concluida. Proxima em ' + Math.round(INTERVALO / 60000) + ' min.\n');
  }

  await volta();
  setInterval(volta, INTERVALO);
  // vigia rapida dos PEDIDOS das lojas em live (a cada 20s) — pedidos aparecem quase na hora
  setInterval(() => { vigiarPedidos(browser).catch(() => {}); }, 20000);
})();
