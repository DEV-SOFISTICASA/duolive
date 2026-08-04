// DuoLive · Robô do console de lives do TikTok (Compass) — por cookies, igual ao LiveDash
//
// Abre o console de lives do TikTok com a sua sessao, captura a chamada assinada
// que a propria pagina faz e le os numeros da LIVE ATUAL (GMV, pedidos, views).
// Manda para o conector, que mostra no painel AO VIVO. Roda em loop durante a live.
//
// Pré-requisito:  npm run login-tiktok   (guarda sessao-tiktok.json)
// Como usar:      npm run robo-console
//   Para mandar para a nuvem:  set DUOLIVE_CONECTOR=https://duolive-xxxx.onrender.com
//
// Observacao honesta: o Compass e' o mesmo painel que o LiveDash le. Os numeros
// da live em andamento podem ter alguns minutos de atraso (é o proprio TikTok que
// atualiza assim), mas vem os pedidos e o GMV de verdade — o que o chat nao da.

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const CONECTOR = (process.env.DUOLIVE_CONECTOR || ('http://127.0.0.1:' + (process.env.DUOLIVE_PORTA || 9797))).replace(/\/+$/, '');
const ARQ_SESSAO = path.join(__dirname, 'sessao-tiktok.json');
const COMPASS = 'https://shop.tiktok.com/streamer/compass/live-details/view';
const STATS = [3, 2, 20, 23, 310, 325, 39, 29, 330, 72, 343, 313];
const MAP = { 3: 'gmv', 2: 'orders', 20: 'views' }; // o que a gente usa ao vivo

function manda(gmv, orders, views) {
  const dados = JSON.stringify({ gmv: gmv, orders: orders, views: views });
  const u = new URL(CONECTOR + '/numeros-tiktok');
  const lib = u.protocol === 'https:' ? https : http;
  const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dados) } });
  req.on('error', () => console.log('  (nao consegui falar com o conector em ' + CONECTOR + ')'));
  req.end(dados);
  console.log('  📊 console: GMV R$ ' + gmv.toFixed(2) + ' · ' + orders + ' pedidos · ' + views + ' views -> ' + CONECTOR);
}

function numeros(room) {
  const met = {};
  (room.analytics_metrics || []).forEach((m) => { if (MAP[m.stats_type]) met[MAP[m.stats_type]] = +m.raw_value; });
  return { gmv: met.gmv || 0, orders: met.orders || 0, views: met.views || 0 };
}

(async () => {
  if (!fs.existsSync(ARQ_SESSAO)) {
    console.log('Falta o login do TikTok. Rode primeiro:  npm run login-tiktok');
    process.exit(1);
  }
  let browser;
  try { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
  catch (e) { try { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }
    catch (e2) { console.log('Instale o Google Chrome e tente de novo.'); process.exit(1); } }
  const ctx = await browser.newContext({ storageState: ARQ_SESSAO, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();

  let signedUrl = null;
  page.on('request', (req) => {
    // a pagina do Compass dispara sozinha a chamada de detalhe das lives — pegamos a URL assinada
    if (req.url().includes('detail_performance/l')) signedUrl = req.url();
  });

  console.log('\n  DuoLive · Robô do console de lives (Compass) ligado.');
  console.log('  Mandando para: ' + CONECTOR + '\n');

  async function abrir() {
    signedUrl = null;
    try {
      await page.goto(COMPASS, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(8000);
    } catch (e) { console.log('  (nao abriu o Compass: ' + String(e).slice(0, 60) + ')'); }
    if (!signedUrl) console.log('  (ainda nao captei a chamada do Compass — a sessao pode ter expirado; refaca npm run login-tiktok)');
  }

  async function coletar() {
    if (!signedUrl) { await abrir(); return; }
    try {
      const end = Date.now();
      const start = end - 2 * 86400 * 1000; // ultimas 48h: a live de agora esta aqui
      const body = JSON.stringify({
        time_selector: { time_range_period: 6, start_timestamp: String(start), end_timestamp: String(end), timezone: 'America/Sao_Paulo' },
        stats_types: STATS, page_number: 1, page_size: 20, sort_key: 0, sort_order: 1,
      });
      const resp = await page.request.post(signedUrl, { data: body, headers: { 'content-type': 'application/json' } });
      const j = await resp.json();
      if (j.code !== 0) { console.log('  console respondeu code ' + j.code + ' (' + (j.message || '') + '). Reabrindo...'); signedUrl = null; return; }
      const rooms = (j.data && j.data.room_level_detail_data) || [];
      if (!rooms.length) { console.log('  console: nenhuma live recente ainda.'); return; }
      // a live mais recente = a de agora (a lista ja vem ordenada por tempo desc)
      const n = numeros(rooms[0]);
      manda(n.gmv, n.orders, n.views);
    } catch (e) { console.log('  erro ao ler o console: ' + String(e).slice(0, 70)); signedUrl = null; }
  }

  await abrir();
  await coletar();
  setInterval(coletar, 60000); // atualiza a cada 60s durante a live
})();
