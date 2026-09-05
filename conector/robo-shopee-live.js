// DuoLive · Robô da LIVE da Shopee — chat + vendas caindo no Multichat
//
// Como funciona (descoberto por engenharia reversa em 2026-08-31):
//   1) abre a Shopee JÁ LOGADA (sessao-shopee-<loja>.json, plantada por cookies)
//   2) acha a live que está no ar    (API sessionList → status:1)
//   3) em loop, PERGUNTA 3 coisas ao servidor da Shopee (polling):
//        • comentários novos  → /realtime/dashboard/livestream/comments
//        • produtos + vendas  → /realtime/dashboard/productList
//        • números gerais     → /realtime/dashboard/overview
//   4) manda tudo pro CONECTOR, nas portas que já existem:
//        • chat     → POST /eventos     (aparece em laranja no Multichat)
//        • venda    → POST /venda-auto  (dispara o alarme 🧡 COMPROU)
//        • carrinho → POST /sacolinha   ("Alguém está de olho em…")
//
// Como usar (no servidor, com a live da Shopee no ar):
//   node robo-shopee-live.js monaco
//   (plante o login antes:  node shopee-cookies.js monaco --arquivo "...")
//
// Só LÊ da Shopee — nunca escreve nada na loja.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { abreNavegador } = require('./navegador.js');
const L = require('./lojas.js');

// ---------------------------------------------------------------- config
const loja = (process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : (L.lojaPedida() || 'monaco')).toLowerCase();
const ARQ_SESSAO = L.arquivoSessao('shopee', loja);
const RITMO_MS = Math.max(3000, +(process.env.DUOLIVE_SHOPEE_RITMO || 5) * 1000); // de quanto em quanto tempo pergunta
const VISIVEL = process.env.DUOLIVE_SHOPEE_HEADLESS !== '1'; // VISÍVEL por padrão (headless costuma ser bloqueado). Pra esconder: DUOLIVE_SHOPEE_HEADLESS=1
const BASE = 'https://creator.shopee.com.br/supply/api/lm/sellercenter';

// endereço + crachá do conector (mesma receita do robô do TikTok: conector.txt)
function leConectorTxt() {
  try {
    // IGNORA linhas vazias E comentários (#) — igual ao robô do TikTok. Sem isso,
    // um comentário no topo do conector.txt virava o "endereço" (bug de 2026-08-31).
    const linhas = fs.readFileSync(path.join(__dirname, 'conector.txt'), 'utf8').split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#'));
    const url = (linhas[0] && /^https?:\/\//.test(linhas[0])) ? linhas[0] : ''; // só aceita se PARECE endereço
    return { url: url, token: linhas[1] || '' };
  } catch (e) { return { url: '', token: '' }; }
}
const _c = leConectorTxt();
const CONECTOR = (process.env.DUOLIVE_CONECTOR || _c.url || 'http://127.0.0.1:9797').replace(/\/+$/, '');
const TOKEN = (process.env.DUOLIVE_TOKEN || _c.token || '').trim();

// manda um evento pro conector (POST com o crachá). Não trava se der erro.
function mandaConector(rota, corpo) {
  return new Promise((ok) => {
    try {
      const dados = JSON.stringify(corpo);
      const u = new URL(CONECTOR + rota);
      const lib = u.protocol === 'https:' ? https : http;
      const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dados) };
      if (TOKEN) headers['x-duolive-token'] = TOKEN;
      const req = lib.request({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST', headers: headers }, (r) => { r.on('data', () => {}); r.on('end', ok); });
      req.on('error', () => ok());
      req.end(dados);
    } catch (e) { ok(); }
  });
}

// pergunta uma API da Shopee DE DENTRO da página logada (os cookies vão junto).
// É o mesmo truque do robô do TikTok: fetch rodando no contexto da página.
async function apiShopee(page, caminho) {
  try {
    return await page.evaluate(async (url) => {
      const r = await fetch(url, { credentials: 'include' });
      return await r.json();
    }, BASE + caminho);
  } catch (e) { return null; }
}

// ---------------------------------------------------------------- estado
let sessionId = null;      // a live no ar
let tituloLive = '';
let ultimoComentTs = 0;    // marcador do chat (só pego o que for mais novo)
// TRAVA anti-repetição do chat: guarda a "impressão digital" (hora|pessoa|texto) dos
// comentários já enviados, pra NÃO repetir se a Shopee devolver o mesmo de novo.
const _chatVistos = new Set();
const _chatFila = [];
function jaEnvieiChat(chave) {
  if (_chatVistos.has(chave)) return true;
  _chatVistos.add(chave); _chatFila.push(chave);
  if (_chatFila.length > 800) { _chatVistos.delete(_chatFila.shift()); } // não cresce pra sempre
  return false;
}
const pedidosPorItem = {}; // itemId -> quantos pedidos já vi (pra detectar venda nova)
const receitaPorItem = {}; // itemId -> receita já vista (pra calcular o valor da venda)
const carrinhoPorItem = {}; // itemId -> atc já visto
let baseFeita = false;     // já registrei a "linha de base"? (pra não despejar histórico)

// fala UMA vez por assunto (repete a cada 30s) — pra janela nunca ficar muda
let _diz = {}, _falhas = 0;
function diz1x(chave, msg) {
  const agora = Date.now();
  if (_diz[chave] && agora - _diz[chave] < 30000) return;
  _diz[chave] = agora; console.log(msg);
}
// procura uma chave em QUALQUER nível do objeto (a Shopee aninha os números)
function achaFundo(obj, chave) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (obj[chave] != null) return obj[chave];
  for (const k in obj) { if (obj[k] && typeof obj[k] === 'object') { const r = achaFundo(obj[k], chave); if (r != null) return r; } }
  return undefined;
}
// tenta achar o "assistindo agora" (espectadores concorrentes) no overview da Shopee.
// Os nomes variam; tento os mais prováveis primeiro (ccu = concurrent users).
function achaEspectadores(d) {
  const chaves = ['ccu', 'currentViewer', 'currentViewers', 'onlineUser', 'onlineUserNum', 'onlineCnt', 'onlineNum', 'viewerCnt', 'viewerNum', 'watching', 'engagedViewer', 'liveViewer', 'realtimeViewer', 'pcu', 'viewer', 'viewers'];
  for (const c of chaves) { const v = achaFundo(d, c); if (v != null && isFinite(+v)) return Math.round(+v); }
  return null;
}
// acha a live que está no ar (status 1). Devolve true se achou.
async function achaLive(page) {
  const r = await apiShopee(page, '/realtime/sessionList?page=1&pageSize=10&name=&orderBy=&sort=');
  if (!r || r.code !== 0) {  // fetch falhou ou a Shopee recusou → sessão pode ter caído
    _falhas++;
    diz1x('falha', '  ⚠️  não consegui ler a lista de lives (' + _falhas + '×) — a sessão pode ter caído. ' + (_falhas % 3 === 0 ? 'Recarregando a página…' : ''));
    if (_falhas % 3 === 0) { try { await page.goto('https://creator.shopee.com.br', { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) {} }
    return false;
  }
  const recuperou = _falhas > 0; _falhas = 0; // voltamos de uma queda?
  const lista = (r.data && r.data.list) || [];
  const viva = lista.find((s) => s.status === 1);
  if (!viva) {
    if (sessionId) console.log('  🔴 a live da ' + loja + ' fechou.');
    diz1x('semlive', '  ⏳ ' + loja + ': vigiando… (' + lista.length + ' live(s) na lista, nenhuma AO VIVO agora)');
    sessionId = null; baseFeita = false; return false;
  }
  if (String(viva.sessionId) !== String(sessionId)) {
    sessionId = viva.sessionId; tituloLive = viva.title || '';
    ultimoComentTs = 0; baseFeita = false; _chatVistos.clear(); _chatFila.length = 0;
    Object.keys(pedidosPorItem).forEach((k) => delete pedidosPorItem[k]);
    Object.keys(carrinhoPorItem).forEach((k) => delete carrinhoPorItem[k]);
    console.log('  🧡 LIVE DA SHOPEE no ar: "' + tituloLive + '" (sessão ' + sessionId + ')');
  } else if (recuperou) {
    // MESMA live, mas voltei de uma queda → re-sincronizo: pego os números ATUAIS
    // como novo ponto de partida, SEM despejar as vendas do período offline (senão
    // vira aquela enxurrada de alarmes de uma vez — o caso do 15:24:19).
    baseFeita = false;
    console.log('  🔄 ' + loja + ': reconectei — re-sincronizando (não vou repetir as vendas que passaram enquanto eu estava fora).');
  }
  return true;
}

// lê os comentários novos e manda pro Multichat
async function leChat(page) {
  const r = await apiShopee(page, '/realtime/dashboard/livestream/comments?sessionId=' + sessionId + '&startTimestamp=' + ultimoComentTs);
  const d = (r && r.data) || {};
  const arr = d.comments || [];
  let maxTs = ultimoComentTs;
  for (const c of arr) {
    const ct = +c.timestamp || 0;
    if (ct > maxTs) maxTs = ct;
    const quem = String(c.username || 'alguém').slice(0, 60);
    const texto = String(c.content || '').slice(0, 300).trim();
    if (!texto) continue;
    // mesmo comentário (mesma hora + mesma pessoa + mesmo texto) NÃO é reenviado
    if (jaEnvieiChat(ct + '|' + quem + '|' + texto)) continue;
    await mandaConector('/eventos', { quem: quem, texto: texto, loja: loja });
    console.log('  💬 ' + quem + ': ' + texto);
  }
  if (maxTs > ultimoComentTs) ultimoComentTs = maxTs; // avança só pelo comentário mais novo DE VERDADE (não pelo relógio do servidor)
}

// lê os produtos: detecta VENDA (pedido novo) e CARRINHO (atc novo)
async function leProdutos(page) {
  const r = await apiShopee(page, '/realtime/dashboard/productList?sessionId=' + sessionId + '&productName=&productListTimeRange=0&sort=desc&page=1&pageSize=30');
  const lista = (r && r.data && (r.data.list || r.data.products)) || [];
  for (const p of lista) {
    const id = String(p.itemId || '');
    if (!id) continue;
    const nome = String(p.title || '').replace(/\s+/g, ' ').slice(0, 60).trim();
    const pedidos = +p.ordersCreated || 0;
    const receita = +p.revenue || 0;
    const atc = +p.atc || 0;

    // primeira passada: só anota a linha de base (não dispara nada retroativo)
    if (!baseFeita) { pedidosPorItem[id] = pedidos; receitaPorItem[id] = receita; carrinhoPorItem[id] = atc; continue; }

    // VENDA: o contador de pedidos DESTE produto subiu → alguém comprou agora
    const antes = pedidosPorItem[id] != null ? pedidosPorItem[id] : pedidos;
    if (pedidos > antes) {
      const novos = pedidos - antes;
      const valorTotal = Math.max(0, receita - (receitaPorItem[id] != null ? receitaPorItem[id] : receita));
      const valorUnit = valorTotal > 0 ? valorTotal / novos : (+p.minPrice || 0);
      // um evento por pedido novo, com id ÚNICO (o conector ignora repetição)
      for (let k = antes + 1; k <= pedidos; k++) {
        const orderId = 'shopee-' + sessionId + '-' + id + '-' + k;
        await mandaConector('/venda-auto', { orderId: orderId, plataforma: 'shopee', valor: +valorUnit.toFixed(2), quem: '', produto: nome, loja: loja });
      }
      console.log('  🧡 VENDA: ' + novos + '× ' + nome + ' · R$ ' + valorTotal.toFixed(2).replace('.', ','));
    }
    pedidosPorItem[id] = pedidos; receitaPorItem[id] = receita;

    // CARRINHO: o atc subiu → alguém está de olho (evento leve)
    const atcAntes = carrinhoPorItem[id] != null ? carrinhoPorItem[id] : atc;
    if (atc > atcAntes) { await mandaConector('/sacolinha', { quem: 'Alguém', produto: nome, loja: loja, carrinho: true }); }
    carrinhoPorItem[id] = atc;
  }
  baseFeita = true;
}

// lê o "overview" da live: quantos estão ASSISTINDO agora (espectadores concorrentes).
// Manda pro conector como espectadores da Shopee — o painel soma com o TikTok.
async function leOverview(page) {
  const r = await apiShopee(page, '/realtime/dashboard/overview?sessionId=' + sessionId);
  const d = (r && r.data) || null;
  if (!d) return;
  const n = achaEspectadores(d);
  if (n != null) {
    await mandaConector('/eventos', { espectadores: n, loja: loja });
    diz1x('viewers', '  👀 assistindo agora (Shopee): ' + n);
  } else {
    // não achei a chave dos espectadores — mostro as chaves pra ajustar a "mira" depois
    diz1x('overview', '  ⓘ overview da Shopee sem chave de espectadores conhecida. chaves: ' + Object.keys(d).join(', '));
  }
}

// ---------------------------------------------------------------- principal
(async () => {
  if (!fs.existsSync(ARQ_SESSAO)) {
    console.log('\n  ⚠️  Sem login da Shopee da loja "' + loja + '" (' + path.basename(ARQ_SESSAO) + ').');
    console.log('      Plante antes:  node shopee-cookies.js ' + loja + ' --arquivo "C:\\...\\shopee.json"\n');
    process.exit(1);
  }
  console.log('\n  DuoLive · Robô da LIVE da Shopee — loja: ' + loja);
  console.log('  Mandando pro conector: ' + CONECTOR + (TOKEN ? ' (com crachá)' : ' (sem crachá — uso local)'));
  console.log('  Pergunta a cada ' + (RITMO_MS / 1000) + 's. Só leitura — não mexe na loja.\n');

  const browser = await abreNavegador(!VISIVEL);
  const ctx = await browser.newContext({ storageState: ARQ_SESSAO, viewport: null });
  // ECONOMIA: o robô só precisa das CHAMADAS de API (fetch) — não precisa DESENHAR a
  // tela. Cortamos imagens, vídeos, fontes e CSS: alivia MUITO o servidor (menos
  // CPU/RAM/internet) sem afetar a leitura das vendas/chat. (o fetch é resourceType
  // 'fetch'/'xhr' e passa direto; só o peso visual é bloqueado)
  await ctx.route('**/*', (route) => {
    const tipo = route.request().resourceType();
    if (tipo === 'image' || tipo === 'media' || tipo === 'font' || tipo === 'stylesheet') return route.abort();
    return route.continue();
  });
  const page = await ctx.newPage();
  await page.goto('https://creator.shopee.com.br', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});

  // confere se o login pegou
  const acc = await apiShopee(page, '/account/info');
  if (!acc || acc.code !== 0) console.log('  ⚠️  a Shopee não aceitou o login (cookies vencidos?). Replante com shopee-cookies.js.');
  else console.log('  ✅ login da Shopee OK — vigiando as lives da ' + loja + '…');

  // o coração: pergunta em loop pra sempre
  async function rodada() {
    try {
      const viva = await achaLive(page);
      if (viva) { await leChat(page); await leProdutos(page); await leOverview(page); }
    } catch (e) { /* qualquer tropeço: tenta de novo na próxima rodada */ }
  }
  await rodada();
  setInterval(rodada, RITMO_MS);
})().catch((e) => { console.log('  Deu erro ao ligar o robô da Shopee: ' + ((e && e.message) || e)); process.exit(1); });
