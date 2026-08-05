// DuoLive · Robô de vendas ao vivo (cookies) — TikTok E Shopee, RÁPIDO
//
// Vigia os pedidos das suas lojas usando as sessões guardadas pelo login e,
// quando alguém compra, manda na hora para o painel: a venda aparece no
// Multichat com o logo da plataforma — (logo) usuário: comprou · R$ valor.
//
// Como ele consegue ser rápido: em vez de recarregar a página de pedidos toda
// hora, ele abre a página UMA vez, descobre qual chamada interna ela usa para
// buscar a lista de pedidos e repete essa mesma chamada a cada 3 segundos
// (mesma técnica do robô do console). Se a página não aceitar repetir a
// chamada, ele percebe sozinho e passa a recarregar direto (plano B).
//
// Pré-requisito:  npm run login-tiktok   e/ou   npm run login-shopee   (uma vez)
// Como usar:      npm run robo-vendas    (deixe rodando durante a live)
//
// Ajustes por variável de ambiente (opcionais):
//   DUOLIVE_CONECTOR=https://seu-conector.onrender.com   (padrão: local 9797)
//   DUOLIVE_RITMO=3                                      (segundos entre leituras, mínimo 2)

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// Para onde mandar as vendas: 1º a variável DUOLIVE_CONECTOR; 2º o arquivo
// conector.txt (cole nele a URL do Render, uma linha só); 3º o conector local.
function enderecoConector() {
  if (process.env.DUOLIVE_CONECTOR) return process.env.DUOLIVE_CONECTOR;
  try {
    const txt = fs.readFileSync(path.join(__dirname, 'conector.txt'), 'utf8').trim();
    if (/^https?:\/\//.test(txt)) return txt;
  } catch (e) {}
  return 'http://127.0.0.1:' + (process.env.DUOLIVE_PORTA || 9797);
}
const CONECTOR = enderecoConector().replace(/\/+$/, '');
const ARQ_DESCOBERTA = path.join(__dirname, 'descoberta-vendas.json');
const RITMO = Math.max(2, +(process.env.DUOLIVE_RITMO || 3)) * 1000;
const INICIO = Date.now();
const TOLERANCIA = 10 * 60000; // conta pedidos feitos até 10 min antes de ligar o robô
const RE_LOGIN = /login|passport|signin|account\/register/i;

// as duas lojas; cada uma tem sua sessão e suas páginas de pedidos
const CONTAS = [
  {
    plataforma: 'tiktok',
    sessao: path.join(__dirname, 'sessao-tiktok.json'),
    paginas: ['https://seller-br.tiktok.com/order', 'https://seller.tiktokglobalshop.com/order'],
    reUrl: /order|trade|pack|fulfillment/i,
  },
  {
    plataforma: 'shopee',
    sessao: path.join(__dirname, 'sessao-shopee.json'),
    paginas: ['https://seller.shopee.com.br/portal/sale/order', 'https://creator.shopee.com.br'],
    reUrl: /order|trade|pack|sale/i,
    // a lista da Shopee busca os detalhes por ids fixos — repetir a chamada devolve sempre
    // os mesmos pedidos. Para ela o jeito certo é recarregar a página direto (~10s).
    soRecarga: true,
  },
];

const jaVistos = new Set(); // plataforma+orderId
const amostras = [];        // respostas COM pedidos (a estrutura que importa)
const amostrasOutras = [];  // outras respostas com cara de pedido

// ---------- envio para o conector ----------
function manda(plataforma, p) {
  const dados = JSON.stringify({ orderId: p.orderId, quem: p.quem, valor: p.valor, plataforma: plataforma });
  const u = new URL(CONECTOR + '/venda-auto');
  const lib = u.protocol === 'https:' ? https : http;
  const req = lib.request({
    hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dados) },
  });
  req.on('error', () => console.log('  (nao consegui falar com o conector em ' + CONECTOR + ')'));
  req.end(dados);
  console.log('  🛒 ' + plataforma + ': ' + (p.quem || 'pedido') + (p.valor ? ' — R$ ' + p.valor.toFixed(2).replace('.', ',') : '') + ' (#' + p.orderId + ')');
}

// ---------- entendimento dos números ----------
// aceita "89.90", "89,90", "1.234,56", "1,234.56", "R$ 89,90" e números puros
function num(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  return +s || 0;
}
const eData = (v) => { const n = +v; return n > 1e12 ? n : n > 1e9 ? n * 1000 : 0; };
function achaChave(o, re) { for (const k of Object.keys(o)) if (re.test(k)) return o[k]; }

// entende os "objetinhos de preço" das APIs: { price_val, format_price, amount, value... }
function dinheiroDe(v) {
  if (v == null) return 0;
  if (typeof v === 'object') {
    if (Array.isArray(v)) return 0;
    return num(v.price_val != null ? v.price_val : v.format_price != null ? v.format_price
      : v.amount != null ? v.amount : v.value != null ? v.value : v.total != null ? v.total : null);
  }
  return num(v);
}
// caça o TOTAL do pedido em profundidade, do nome mais confiável para o menos
const RE_TOTAIS = [
  /^grand_?total$/i,
  /^(total_?amount|order_?amount|pay_?amount|payment_?total|paid_?amount|actual_?(paid|amount|price)|buyer_?paid|total_?pay)/i,
  /^total_?price$/i,
];
function buscaValor(o, re, prof) {
  if (!o || typeof o !== 'object' || prof > 4) return 0;
  if (!Array.isArray(o)) {
    for (const k of Object.keys(o)) if (re.test(k)) { const d = dinheiroDe(o[k]); if (d) return d; }
  }
  for (const v of (Array.isArray(o) ? o : Object.values(o))) {
    if (v && typeof v === 'object') { const d = buscaValor(v, re, prof + 1); if (d) return d; }
  }
  return 0;
}
function achaValor(o) {
  for (const re of RE_TOTAIS) { const v = buscaValor(o, re, 0); if (v) return v; }
  return 0;
}

// busca um valor em profundidade (para valor/comprador aninhados em payment_info, buyer_info...)
function fundo(o, re, prof) {
  if (!o || typeof o !== 'object' || prof > 3) return undefined;
  const direto = achaChave(o, re);
  if (direto != null && typeof direto !== 'object') return direto;
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object') {
      const achou = fundo(v, re, (prof || 0) + 1);
      if (achou != null) return achou;
    }
  }
}

// tenta entender um objeto como "um pedido"
const RE_ID_PEDIDO = /^(main_?order_?id|order_?id|order_?sn|orderno|package_?id|trade_?no)$/i;
function parsePedido(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  // cartão da Shopee: o id e o comprador ficam dentro de "card_header", o valor nos pacotes
  const cabecalho = (o.card_header && typeof o.card_header === 'object') ? o.card_header : null;
  const dono = cabecalho || o;
  const id = achaChave(dono, RE_ID_PEDIDO);
  if (id == null || typeof id === 'object') return null;
  const idTxt = String(id).trim();
  if (idTxt.length < 6) return null; // id de pedido de verdade é comprido
  const valor = achaValor(o);
  let quem = achaChave(dono, /(buyer_?username|buyer_?name|nickname|user_?name|username|buyer)/i);
  if (quem && typeof quem === 'object') quem = quem.nickname || quem.username || quem.name || '';
  if (typeof quem === 'number') quem = ''; // id numérico de comprador não é nome
  if (!quem) quem = fundo(o, /(buyer_?username|buyer_?name|nickname)/i, 0) || '';
  let criado = eData(achaChave(o, /(create_?time|created_?at|order_?time|ctime|pay_?time|paid_?time)/i));
  if (!criado) criado = eData(fundo(o, /(create_?time|created_?at|pay_?time)/i, 0));
  return { orderId: idTxt, quem: String(quem || '').slice(0, 60), valor: valor, criado: criado };
}

// varre qualquer JSON procurando pedidos (não desce para dentro de um pedido já entendido)
function garimpa(json, achados) {
  if (Array.isArray(json)) {
    json.forEach((x) => { const p = parsePedido(x); if (p) achados.push(p); else garimpa(x, achados); });
  } else if (json && typeof json === 'object') {
    const p = parsePedido(json);
    if (p) { achados.push(p); return; }
    Object.values(json).forEach((v) => garimpa(v, achados));
  }
}

// compara ids de pedido (eles crescem com o tempo nas duas plataformas)
function idMaior(a, b) { a = String(a); b = String(b); return a.length !== b.length ? a.length > b.length : a > b; }

// decide o que fazer com os pedidos lidos numa leva.
// Regras que impedem venda falsa:
//  - id "pelado" (sem nome, valor e data — ex.: o índice da Shopee) nunca dispara, só registra;
//  - pedido COM data: só dispara se for de agora (tolerância de 10 min);
//  - pedido SEM data: só dispara se o id for MAIOR que tudo que a fonte já mostrou
//    (marca d'água — pega venda nova e ignora a paginação do histórico).
function processa(conta, achados, fonte) {
  if (!achados.length) return;
  fonte = String(fonte || '').replace(/\?.*$/, '');
  const estreia = !conta.fontesVistas.has(fonte);
  conta.fontesVistas.add(fonte);
  const novos = achados.filter((p) => !jaVistos.has(conta.plataforma + p.orderId));
  novos.forEach((p) => jaVistos.add(conta.plataforma + p.orderId));
  if (!novos.length) return;
  const marcoAntes = conta.marcoDagua.get(fonte) || '';
  let marcoDepois = marcoAntes;
  novos.forEach((p) => { if (idMaior(p.orderId, marcoDepois)) marcoDepois = p.orderId; });
  conta.marcoDagua.set(fonte, marcoDepois);
  if (novos.length > 30) { // fusível: leva gigante = retrato inicial ou leitura errada, não dispara
    console.log('  (' + conta.plataforma + ': registrei ' + novos.length + ' pedidos antigos sem avisar o painel)');
    return;
  }
  novos.forEach((p) => {
    // a Shopee manda o valor multiplicado por 100.000 (micros)
    if (conta.plataforma === 'shopee' && p.valor >= 100000 && p.valor % 1000 === 0) p.valor = p.valor / 100000;
    if (!p.valor && !p.quem && !p.criado) return;                 // id pelado: só registra
    if (p.criado) { if (p.criado < INICIO - TOLERANCIA) return; } // com data: só o que é de agora
    else if (estreia || !idMaior(p.orderId, marcoAntes)) return;  // sem data: só acima da marca d'água
    manda(conta.plataforma, p);
  });
}

// ---------- captura e repetição da chamada de pedidos (por loja) ----------
function pareceLogin(url) { return RE_LOGIN.test(String(url || '')); }

async function guardaAlvo(conta, req, pontos) {
  try {
    if (conta.modoRecarga) return;
    // fica com a chamada mais RICA (pedidos com nome/valor/data valem mais que ids pelados)
    if (conta.alvo && pontos < conta.alvo.pontos) return;
    const headers = {};
    const todos = await req.allHeaders();
    for (const k of Object.keys(todos)) {
      if (k.startsWith(':') || /^(cookie|host|content-length)$/i.test(k)) continue;
      headers[k] = todos[k];
    }
    const primeira = !conta.alvo;
    conta.alvo = {
      url: req.url(), method: req.method(), data: req.postData() || undefined,
      headersFull: headers, ct: todos['content-type'] || '', modo: null, nasceu: Date.now(), pontos: pontos,
    };
    if (primeira) console.log('  ✅ ' + conta.plataforma + ': achei a chamada de pedidos! Leitura rapida a cada ' + (RITMO / 1000) + 's ligada.');
  } catch (e) {}
}

// os 3 jeitos de repetir a chamada: 0 = cabeçalho mínimo, 1 = cabeçalhos completos,
// 2 = de dentro da própria página (o navegador põe origem/referência sozinho)
async function tentaVariante(conta, alvo, modo) {
  let j;
  if (modo === 2) {
    j = await conta.page.evaluate(async (a) => {
      const r = await fetch(a.url, { method: a.method, body: a.data, headers: a.ct ? { 'content-type': a.ct } : undefined, credentials: 'include' });
      return await r.json();
    }, { url: alvo.url, method: alvo.method, data: alvo.data, ct: alvo.ct });
  } else {
    const headers = modo === 0 ? (alvo.ct ? { 'content-type': alvo.ct } : {}) : alvo.headersFull;
    const resp = await conta.page.request.fetch(alvo.url, { method: alvo.method, headers: headers, data: alvo.data, timeout: 15000 });
    j = await resp.json();
  }
  if (j && typeof j.code === 'number' && j.code !== 0) throw new Error('code ' + j.code + ' ' + String(j.message || '').slice(0, 60));
  if (j && typeof j.error === 'number' && j.error !== 0) throw new Error('error ' + j.error);
  return j;
}

async function ler(conta) { // uma repetição da chamada dourada
  if (!conta.alvo || conta.modoRecarga || conta.recarregando) return;
  const alvo = conta.alvo;
  try {
    let j = null;
    if (alvo.modo == null) {
      // calibrando: testa os jeitos de repetir até o site aceitar (começa pelo último que funcionou)
      const ordem = conta.modoBom != null ? [conta.modoBom, 0, 1, 2].filter((m, i, a) => a.indexOf(m) === i) : [0, 1, 2];
      for (const m of ordem) {
        try {
          const cand = await tentaVariante(conta, alvo, m);
          const acha = []; garimpa(cand, acha);
          if (acha.length) { alvo.modo = m; j = cand; break; }
          if (!conta.jaDiagnosticou) console.log('  (' + conta.plataforma + ': jeito ' + m + ' respondeu ok mas sem pedidos)');
        } catch (e2) {
          if (!conta.jaDiagnosticou) console.log('  (' + conta.plataforma + ': jeito ' + m + ' falhou — ' + String((e2 && e2.message) || e2).slice(0, 90) + ')');
        }
      }
      conta.jaDiagnosticou = true;
      if (j == null) throw new Error('nenhum jeito de repetir a chamada foi aceito');
      if (conta.modoBom !== alvo.modo) console.log('  ' + conta.plataforma + ': leitura rapida calibrada (jeito ' + alvo.modo + ').');
      conta.modoBom = alvo.modo;
    } else {
      j = await tentaVariante(conta, alvo, alvo.modo);
    }
    const achados = [];
    garimpa(j, achados);
    processa(conta, achados, alvo.url);
    conta.ultimaOk = Date.now();
    conta.falhas = 0;
    conta.mortesRapidas = 0;
  } catch (e) {
    const msg = String((e && e.message) || e);
    const conclusivo = msg.includes('nenhum jeito'); // calibração recusada = não adianta insistir
    conta.falhas += conclusivo ? 3 : 1;
    if (conta.falhas === 1 || conclusivo) console.log('  (' + conta.plataforma + ': leitura falhou — ' + msg.slice(0, 110) + ')');
    if (conta.falhas >= 3) {
      const morreuLogo = alvo.nasceu && Date.now() - alvo.nasceu < 30000;
      conta.alvo = null;
      conta.falhas = 0;
      if (morreuLogo) {
        conta.mortesRapidas++;
        if (conta.mortesRapidas >= 3) {
          conta.modoRecarga = true;
          console.log('  ' + conta.plataforma + ': a pagina nao aceita repetir a chamada — vou recarregar direto (leitura a cada ~10s).');
        }
      } else {
        console.log('  ' + conta.plataforma + ': a chamada de pedidos venceu — recarregando para renovar...');
      }
      carregar(conta).catch(() => {});
    }
  }
}

async function carregar(conta) { // abre (ou reabre) a página de pedidos e captura a chamada
  if (conta.recarregando) return;
  conta.recarregando = true;
  const lista = conta.paginaBoa ? [conta.paginaBoa].concat(conta.paginas.filter((u) => u !== conta.paginaBoa)) : conta.paginas;
  for (const u of lista) {
    try {
      await conta.page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 });
      // espera a própria página buscar a lista de pedidos (em vez de um tempo fixo)
      await conta.page.waitForResponse(
        (r) => conta.reUrl.test(r.url()) && String(r.headers()['content-type'] || '').includes('json'),
        { timeout: 12000 }
      ).catch(() => {});
      await conta.page.waitForTimeout(2000); // folga para as chamadas irmãs chegarem
      if (pareceLogin(conta.page.url())) {
        console.log('  ⚠️  ' + conta.plataforma + ': a sessao expirou! Rode de novo:  npm run login-' + conta.plataforma);
        continue;
      }
      conta.paginaBoa = u;
      break;
    } catch (e) {}
  }
  conta.ultimaCarga = Date.now();
  conta.recarregando = false;
  if (!conta.alvo && !conta.modoRecarga) console.log('  (' + conta.plataforma + ': ainda procurando a chamada de pedidos...)');
}

async function vigiar(browser, conta) {
  if (!fs.existsSync(conta.sessao)) {
    console.log('  ' + conta.plataforma + ': sem login (rode npm run login-' + conta.plataforma + '). Pulando.');
    return;
  }
  const ctx = await browser.newContext({ storageState: conta.sessao, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  // recarga leve: sem imagens, fontes e vídeos o navegador invisível fica bem mais rápido
  await ctx.route('**/*', (rota) => {
    const t = rota.request().resourceType();
    if (t === 'image' || t === 'media' || t === 'font') return rota.abort();
    return rota.continue();
  });
  conta.page = await ctx.newPage();
  conta.alvo = null; conta.falhas = 0; conta.mortesRapidas = 0; conta.modoRecarga = !!conta.soRecarga;
  conta.recarregando = false; conta.paginaBoa = null; conta.ultimaOk = 0; conta.ultimaCarga = 0;
  conta.fontesVistas = new Set(); conta.marcoDagua = new Map(); conta.modoBom = null; conta.jaDiagnosticou = false;

  // farejador: toda resposta com cara de pedidos é lida; a que tiver pedidos vira a chamada dourada
  conta.page.on('response', async (resp) => {
    try {
      if (!conta.reUrl.test(resp.url())) return;
      if (!String(resp.headers()['content-type'] || '').includes('json')) return;
      const json = await resp.json();
      const achados = [];
      garimpa(json, achados);
      // guarda amostras (com prioridade para respostas que TÊM pedidos — servem de gabarito)
      const pool = achados.length ? amostras : amostrasOutras;
      if ((achados.length && pool.length < 12) || (!achados.length && pool.length < 10)) {
        const txt = JSON.stringify(json);
        pool.push({ plataforma: conta.plataforma, pedidos: achados.length, url: resp.url().slice(0, 200), corpo: txt.length <= 40000 ? json : '(resposta grande) ' + txt.slice(0, 6000) });
      }
      if (achados.length) { // essa chamada sabe listar pedidos — a mais rica vira a dourada
        const ricos = achados.filter((p) => p.valor || p.quem || p.criado).length;
        await guardaAlvo(conta, resp.request(), ricos * 1000 + achados.length);
      }
      processa(conta, achados, resp.url());
      conta.ultimaOk = Date.now();
    } catch (e) {}
  });

  console.log('  ' + conta.plataforma + ': vigiando pedidos...' + (conta.soRecarga ? ' (recarga continua, ~10s por leitura)' : ''));
  await carregar(conta);

  // leitura rápida: repete a chamada dourada a cada RITMO
  setInterval(() => { ler(conta).catch(() => {}); }, RITMO);

  // vigia: plano B, chamada sumida, leitura travada ou renovação preventiva
  setInterval(() => {
    const agora = Date.now();
    if (conta.recarregando) return;
    if (conta.modoRecarga) { if (agora - conta.ultimaCarga > 3000) carregar(conta).catch(() => {}); return; }
    if (!conta.alvo && agora - conta.ultimaCarga > 30000) { carregar(conta).catch(() => {}); return; }
    if (conta.alvo && agora - conta.ultimaOk > 90000) { console.log('  ' + conta.plataforma + ': sem leitura ha 90s — recarregando...'); conta.alvo = null; carregar(conta).catch(() => {}); return; }
    if (agora - conta.ultimaCarga > 10 * 60000) carregar(conta).catch(() => {});
  }, 5000);
}

async function principal() {
  console.log('\n  DuoLive · Robô de vendas (TikTok + Shopee), leitura a cada ' + (RITMO / 1000) + 's.');
  console.log('  Conta os pedidos feitos a partir de agora (até 10 min atrás).');
  console.log('  Mandando as vendas para: ' + CONECTOR + '\n');

  let browser;
  try { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
  catch (e) { try { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }
    catch (e2) { console.log('  Instale o Google Chrome e tente de novo.'); process.exit(1); } }

  await Promise.all(CONTAS.map((conta) => vigiar(browser, conta)));

  // guarda uma amostra do que foi capturado (se algo não aparecer, me mande esse arquivo)
  setInterval(() => {
    try { fs.writeFileSync(ARQ_DESCOBERTA, JSON.stringify({ comPedidos: amostras, outras: amostrasOutras }, null, 1)); } catch (e) {}
  }, 60000);
}

if (require.main === module) principal();
// exporta o leitor para testes (não liga o robô quando importado)
module.exports = { parsePedido: parsePedido, garimpa: garimpa, achaValor: achaValor };
