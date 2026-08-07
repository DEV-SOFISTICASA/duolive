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

const { abreNavegador } = require('./navegador.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const L = require('./lojas.js');
const ATIVIDADE = require('./atividade-live.js');

const LOJA = L.lojaPedida();

// Para onde mandar as vendas: 1º a variável DUOLIVE_CONECTOR; 2º o arquivo
// conector.txt (1ª linha = URL do Render; 2ª linha = o token, opcional); 3º o local.
function leConectorTxt() {
  try {
    const linhas = fs.readFileSync(path.join(__dirname, 'conector.txt'), 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    return linhas;
  } catch (e) { return []; }
}
function enderecoConector() {
  if (process.env.DUOLIVE_CONECTOR) return process.env.DUOLIVE_CONECTOR;
  const l = leConectorTxt();
  if (l[0] && /^https?:\/\//.test(l[0])) return l[0];
  return 'http://127.0.0.1:' + (process.env.DUOLIVE_PORTA || 9797);
}
// o crachá para mandar dados ao conector na nuvem (o mesmo DUOLIVE_TOKEN do Render).
// Vem da variável DUOLIVE_TOKEN ou da 2ª linha do conector.txt. Sem token (uso
// local), fica vazio e nada muda.
function tokenConector() {
  if (process.env.DUOLIVE_TOKEN) return process.env.DUOLIVE_TOKEN.trim();
  const l = leConectorTxt();
  return (l[1] || '').trim();
}
const CONECTOR = enderecoConector().replace(/\/+$/, '');
const TOKEN = tokenConector();
const ARQ_DESCOBERTA = path.join(__dirname, 'descoberta-vendas.json');
const RITMO = Math.max(2, +(process.env.DUOLIVE_RITMO || 3)) * 1000;
const INICIO = Date.now();
// conta pedidos feitos até 20 min antes de ligar (ou de se recuperar de uma
// falha). Janela generosa DE PROPÓSITO: se o robô ficar um tempo sem ler, ao
// voltar ele reencontra na lista as vendas desse período e dispara as que ainda
// não avisou (a dedup por número do pedido impede repetir). É a rede que evita
// perder venda num tropeço.
const TOLERANCIA = +(process.env.DUOLIVE_TOLERANCIA_MIN || 20) * 60000;
const RE_LOGIN = /login|passport|signin|account\/register/i;

// as duas contas da loja; cada uma tem sua sessão e suas páginas de pedidos.
// A loja pode mudar no meio da live (você troca no painel), então as contas
// são montadas de novo a cada troca — daí ser uma função.
function contasDaLoja(loja) {
  const lista = [];

  // 1) Gerenciador de LIVE — e' AQUI que o pedido aparece no instante em que a
  //    pessoa compra, ainda durante a transmissao. O Seller Center so' mostra
  //    depois. Tem login PROPRIO (sessao-console-*), por isso e' uma conta a
  //    parte; se voce nao conectou o console, ela simplesmente nao entra.
  const daLive = L.arquivoSessao('console', loja);
  if (fs.existsSync(daLive)) {
    lista.push({
      plataforma: 'tiktok',
      apelido: 'tiktok (gerenciador de live)',
      chave: 'console',
      sessao: daLive,
      paginas: ['https://shop.tiktok.com/streamer/live/product/dashboard'],
      // este é lido de um jeito PRÓPRIO: a chamada "user_activity_history" traz
      // as vendas da live com valor (feed da tela "Atividade"). Ver atividade-live.js.
      viaAtividade: true,
      reUrl: /user_activity_history/i,
    });
  }

  // 2) Seller Center — a lista de pedidos "oficial". Continua valendo: pega o que
  //    o console nao mostrar e serve de rede de seguranca. Pedido repetido nos
  //    dois lugares avisa uma vez so' (a conferencia e' por numero do pedido).
  lista.push(
    {
      plataforma: 'tiktok',
      apelido: 'tiktok (seller center)',
      chave: 'tiktok',
      sessao: L.arquivoSessao('tiktok', loja),
      paginas: ['https://seller-br.tiktok.com/order', 'https://seller.tiktokglobalshop.com/order'],
      reUrl: /order|trade|pack|fulfillment/i,
    },
    {
      plataforma: 'shopee',
      chave: 'shopee',
      sessao: L.arquivoSessao('shopee', loja),
      paginas: ['https://seller.shopee.com.br/portal/sale/order', 'https://creator.shopee.com.br'],
      reUrl: /order|trade|pack|sale/i,
      // a lista da Shopee busca os detalhes por ids fixos — repetir a chamada devolve sempre
      // os mesmos pedidos. Para ela o jeito certo é recarregar a página direto (~10s).
      soRecarga: true,
    },
  );
  return lista;
}
let CONTAS = contasDaLoja(LOJA);

// como a conta aparece nas mensagens (ha' DUAS do tiktok: o gerenciador de live
// e o seller center), e onde refazer o login dela
const nome = (c) => c.apelido || c.plataforma;
const ondeLogar = (c) => c.chave || c.plataforma;

const jaVistos = new Set(); // plataforma+orderId
const amostras = [];        // respostas COM pedidos (a estrutura que importa)
const amostrasOutras = [];  // outras respostas com cara de pedido
const framesWS = [];        // amostras dos frames de WebSocket (para entender o formato)
const urlsWSVistas = new Set();
function guardaFrameWS(conta, url, corpo, tamanho, pedidos) {
  // guarda no maximo 40 amostras; sempre as que TEM pedido, e ate 2 por tipo de frame
  const marca = (pedidos ? 'P:' : '') + String(url).replace(/\?.*$/, '');
  if (!pedidos && urlsWSVistas.has(marca) && framesWS.filter((f) => f.marca === marca).length >= 2) return;
  if (framesWS.length >= 40 && !pedidos) return;
  urlsWSVistas.add(marca);
  framesWS.push({ marca: marca, plataforma: conta.plataforma, url: String(url).slice(0, 160), tamanho: tamanho, pedidos: pedidos || 0, corpo: corpo });
}

// cabeçalhos para falar com o conector; leva o crachá (token) quando há um
function comToken(extra) {
  const h = Object.assign({}, extra || {});
  if (TOKEN) h['x-duolive-token'] = TOKEN;
  return h;
}

// ---------- envio para o conector ----------
function manda(plataforma, p) {
  const dados = JSON.stringify({ orderId: p.orderId, quem: p.quem, valor: p.valor, plataforma: plataforma });
  const u = new URL(CONECTOR + '/venda-auto');
  const lib = u.protocol === 'https:' ? https : http;
  const req = lib.request({
    hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST',
    headers: comToken({ 'content-type': 'application/json', 'content-length': Buffer.byteLength(dados) }),
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
    if (primeira) console.log('  ✅ ' + nome(conta) + ': achei a chamada de pedidos! Leitura rapida a cada ' + (RITMO / 1000) + 's ligada.');
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
    conta.recusas = 0;
  } catch (e) {
    const msg = String((e && e.message) || e);
    const conclusivo = msg.includes('nenhum jeito'); // calibração recusada = não adianta insistir
    conta.falhas += conclusivo ? 3 : 1;
    if (conta.falhas === 1 || conclusivo) console.log('  (' + conta.plataforma + ': leitura falhou — ' + msg.slice(0, 110) + ')');
    if (conta.falhas >= 3) {
      const morreuLogo = alvo.nasceu && Date.now() - alvo.nasceu < 30000;
      conta.alvo = null;
      conta.falhas = 0;
      // O TikTok assina a chamada com um prazo curto; quando vence, NENHUM jeito de
      // repetir e' aceito, mesmo pegando uma chamada fresca. Em vez de ficar em
      // loop (vencer -> recarregar -> recusar), depois de 2 recusas o robo passa a
      // RECARREGAR a pagina a cada ~10s — mais lento, mas nunca falha, porque e' o
      // proprio navegador logado navegando (mesma tecnica robusta da Shopee).
      if (conclusivo) {
        conta.recusas = (conta.recusas || 0) + 1;
        if (conta.recusas >= 2 && !conta.modoRecarga) {
          conta.modoRecarga = true;
          console.log('  ' + conta.plataforma + ': o site nao deixa repetir a chamada — passando a recarregar a pagina (~10s por leitura, bem mais estavel).');
        }
      }
      if (morreuLogo && !conta.modoRecarga) {
        conta.mortesRapidas++;
        if (conta.mortesRapidas >= 3) {
          conta.modoRecarga = true;
          console.log('  ' + conta.plataforma + ': a pagina nao aceita repetir a chamada — vou recarregar direto (leitura a cada ~10s).');
        }
      } else if (!conta.modoRecarga) {
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
      if (pareceLogin(conta.page.url())) {
        console.log('  ⚠️  ' + nome(conta) + ': a sessao expirou! Rode de novo:  npm run login-' + ondeLogar(conta));
        continue;
      }
      // A tabela de pedidos do TikTok só busca a lista DEPOIS de montar na tela, e
      // às vezes só quando rola a página. Como precisamos que essa chamada dispare
      // (é a que TEM os pedidos), a gente insiste: espera, rola, espera de novo —
      // até uns 20s. Sem isso, a navegação só pega as chamadas de configuração.
      conta.viuAlvo = false;
      for (let tentativa = 0; tentativa < 4; tentativa++) {
        const veio = await conta.page.waitForResponse(
          (r) => conta.reUrl.test(r.url()) && String(r.headers()['content-type'] || '').includes('json'),
          { timeout: 5000 }
        ).then(() => true).catch(() => false);
        // já achou a chamada dourada (com pedidos)? pode parar de insistir
        if (conta.alvo || conta.viuAlvo) break;
        // empurra a página: rola para baixo e volta, o que costuma disparar a busca da lista
        try { await conta.page.mouse.wheel(0, 1400); await conta.page.waitForTimeout(600); await conta.page.mouse.wheel(0, -600); } catch (e) {}
        if (!veio) await conta.page.waitForTimeout(1500);
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
    console.log('  ' + nome(conta) + ': sem login (rode npm run login-' + ondeLogar(conta) + '). Pulando.');
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

  // O Gerenciador de LIVE é lido de um jeito PRÓPRIO (feed de atividade com valor),
  // não pela lógica de "farejar a chamada de pedidos". Desvia para lá e sai.
  if (conta.viaAtividade) { await vigiarAtividade(conta); return; }

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
        conta.viuAlvo = true; // avisa o carregar() que a chamada de pedidos chegou
        const ricos = achados.filter((p) => p.valor || p.quem || p.criado).length;
        await guardaAlvo(conta, resp.request(), ricos * 1000 + achados.length);
      }
      processa(conta, achados, resp.url());
      conta.ultimaOk = Date.now();
    } catch (e) {}
  });

  // O Gerenciador de LIVE empurra os pedidos por WebSocket, nao por chamada HTTP.
  // Aqui a gente escuta esses frames tambem: os que forem JSON com pedido viram
  // venda na hora; de todos guardamos uma amostra (descoberta-ws.json) para
  // entender o formato quando algo novo aparecer.
  conta.page.on('websocket', (ws) => {
    const url = ws.url();
    ws.on('framereceived', (ev) => {
      try {
        const p = ev && ev.payload;
        if (p == null) return;
        // frame binario (Buffer) = provavelmente protobuf; guarda so' o tamanho
        if (typeof p !== 'string') { guardaFrameWS(conta, url, null, p.length); return; }
        let json; try { json = JSON.parse(p); } catch (e) { guardaFrameWS(conta, url, p.slice(0, 500), p.length); return; }
        const achados = [];
        garimpa(json, achados);
        guardaFrameWS(conta, url, achados.length ? json : (p.length > 4000 ? p.slice(0, 2000) : json), p.length, achados.length);
        if (achados.length) { console.log('  🔔 ' + nome(conta) + ': pedido via WebSocket!'); processa(conta, achados, 'ws:' + url); }
      } catch (e) {}
    });
  });

  console.log('  ' + nome(conta) + ': vigiando pedidos...' + (conta.soRecarga ? ' (recarga continua, ~10s por leitura)' : ''));
  await carregar(conta);

  // os relógios ficam guardados: ao trocar de loja eles precisam ser desligados,
  // senão sobram dois robôs lendo ao mesmo tempo.
  conta.relogios = [
    // leitura rápida: repete a chamada dourada a cada RITMO
    setInterval(() => { ler(conta).catch(() => {}); }, RITMO),
    // vigia: plano B, chamada sumida, leitura travada ou renovação preventiva
    setInterval(() => {
      const agora = Date.now();
      if (conta.recarregando) return;
      if (conta.modoRecarga) { if (agora - conta.ultimaCarga > 3000) carregar(conta).catch(() => {}); return; }
      if (!conta.alvo && agora - conta.ultimaCarga > 30000) { carregar(conta).catch(() => {}); return; }
      if (conta.alvo && agora - conta.ultimaOk > 90000) { console.log('  ' + conta.plataforma + ': sem leitura ha 90s — recarregando...'); conta.alvo = null; carregar(conta).catch(() => {}); return; }
      if (agora - conta.ultimaCarga > 10 * 60000) carregar(conta).catch(() => {});
    }, 5000),
  ];
}

// ---------- leitura das VENDAS da LIVE (feed de atividade, com valor) ----------
async function abrirLive(conta) {
  if (conta.recarregando) return;
  conta.recarregando = true;
  try {
    await conta.page.goto('https://shop.tiktok.com/streamer/live/product/dashboard', { waitUntil: 'domcontentloaded', timeout: 45000 });
    // espera a página buscar o feed de atividade (dá um empurrão de scroll)
    for (let i = 0; i < 6 && !conta.urlAtividade; i++) {
      await conta.page.waitForResponse((r) => /user_activity_history/i.test(r.url()), { timeout: 4000 }).catch(() => {});
      if (!conta.urlAtividade) { try { await conta.page.mouse.wheel(0, 800); } catch (e) {} await conta.page.waitForTimeout(1500); }
    }
    if (pareceLogin(conta.page.url())) console.log('  ⚠️  ' + nome(conta) + ': a sessao do console expirou! Reconecte a loja.');
  } catch (e) {}
  conta.ultimaCarga = Date.now();
  conta.recarregando = false;
  if (!conta.urlAtividade) console.log('  (' + nome(conta) + ': ainda procurando o feed de vendas da live...)');
}

async function lerAtividade(conta) {
  if (!conta.urlAtividade || conta.recarregando) return;
  try {
    const resp = await conta.page.request.fetch(conta.urlAtividade, { timeout: 15000 });
    const j = await resp.json();
    const vendas = ATIVIDADE.vendasDaAtividade(j);
    for (const v of vendas) {
      const chave = 'atv:' + v.messageId;
      if (jaVistos.has(chave)) continue;
      jaVistos.add(chave);
      // vendas antigas (fora da janela) só são marcadas como vistas, não disparam
      if (v.ts && v.ts < INICIO - TOLERANCIA) continue;
      manda('tiktok', { orderId: v.messageId, quem: v.quem, valor: v.valor });
      console.log('  🛒 ' + nome(conta) + ': ' + (v.quem || 'cliente') + ' — R$ ' + v.valor.toFixed(2).replace('.', ',') + ' · ' + v.produtoNome.slice(0, 28));
    }
    conta.ultimaOk = Date.now();
    conta.falhas = 0;
    if (!conta.jaLeu) { conta.jaLeu = true; console.log('  ✅ ' + nome(conta) + ': lendo as vendas da LIVE a cada ' + (RITMO / 1000) + 's!'); }
  } catch (e) {
    conta.falhas = (conta.falhas || 0) + 1;
    if (conta.falhas >= 3) { conta.urlAtividade = null; conta.falhas = 0; abrirLive(conta).catch(() => {}); }
  }
}

async function vigiarAtividade(conta) {
  conta.urlAtividade = null; conta.ultimaOk = 0; conta.ultimaCarga = 0; conta.recarregando = false; conta.falhas = 0; conta.jaLeu = false;
  // captura a URL exata da chamada de atividade (com os parâmetros certos)
  conta.page.on('response', (resp) => { if (/user_activity_history/i.test(resp.url())) conta.urlAtividade = resp.url(); });
  console.log('  ' + nome(conta) + ': vigiando as vendas da LIVE (feed de atividade)...');
  await abrirLive(conta);
  conta.relogios = [
    setInterval(() => { lerAtividade(conta).catch(() => {}); }, RITMO),
    setInterval(() => {
      const agora = Date.now();
      if (conta.recarregando) return;
      if (!conta.urlAtividade && agora - conta.ultimaCarga > 15000) abrirLive(conta).catch(() => {});
      else if (conta.urlAtividade && agora - conta.ultimaOk > 60000) { conta.urlAtividade = null; abrirLive(conta).catch(() => {}); }
      else if (agora - conta.ultimaCarga > 5 * 60000) abrirLive(conta).catch(() => {});
    }, 5000),
  ];
}

// desliga uma conta por completo (relógios + navegador), para trocar de loja
async function parar(conta) {
  (conta.relogios || []).forEach(clearInterval);
  conta.relogios = [];
  conta.alvo = null;
  if (conta.page) {
    try { await conta.page.context().close(); } catch (e) {}
    conta.page = null;
  }
}

// ---------- seguir a loja escolhida no painel ----------
// O painel manda a loja para o conector quando você troca no seletor 🏪.
// Aqui a gente pergunta de tempos em tempos e, se mudou, troca os logins.
function lojaDoPainel() {
  return new Promise((ok) => {
    const u = new URL(CONECTOR + '/lojas');
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, timeout: 8000, headers: comToken() }, (res) => {
      let corpo = '';
      res.on('data', (d) => { corpo += d; if (corpo.length > 1e6) req.destroy(); });
      res.on('end', () => {
        try {
          const b = JSON.parse(corpo);
          ok(L.limpaNome(b.selecionada || b.atual || ''));
        } catch (e) { ok(''); }
      });
    });
    req.on('error', () => ok(''));
    req.on('timeout', () => { req.destroy(); ok(''); });
  });
}

let lojaAtiva = LOJA;
let trocando = false;

async function trocarPara(browser, nova) {
  if (trocando || !nova || nova === lojaAtiva) return;
  trocando = true;
  try {
    console.log('\n  🏪 O painel trocou para a loja "' + nova + '" — trocando os logins...');
    for (const c of CONTAS) await parar(c);
    lojaAtiva = nova;
    CONTAS = contasDaLoja(nova);
    await Promise.all(CONTAS.map((conta) => vigiar(browser, conta)));
    console.log('  🏪 Agora vigiando os pedidos da loja "' + nova + '".\n');
  } catch (e) {
    console.log('  (nao consegui trocar de loja: ' + String(e).slice(0, 80) + ')');
  }
  trocando = false;
}

async function principal() {
  console.log('\n  DuoLive · Robô de vendas (TikTok + Shopee), leitura a cada ' + (RITMO / 1000) + 's.');
  console.log('  Conta os pedidos feitos a partir de agora (até 10 min atrás).');
  console.log('  Loja: ' + lojaAtiva + ' (troca sozinho quando você trocar no painel)');
  console.log('  Mandando as vendas para: ' + CONECTOR + '\n');

  const browser = await abreNavegador(true);

  await Promise.all(CONTAS.map((conta) => vigiar(browser, conta)));

  // segue o seletor 🏪 do painel
  setInterval(() => {
    lojaDoPainel().then((l) => trocarPara(browser, l)).catch(() => {});
  }, 5000);

  // guarda uma amostra do que foi capturado (se algo não aparecer, me mande esse arquivo)
  setInterval(() => {
    try { fs.writeFileSync(ARQ_DESCOBERTA, JSON.stringify({ comPedidos: amostras, outras: amostrasOutras }, null, 1)); } catch (e) {}
    try { fs.writeFileSync(path.join(__dirname, 'descoberta-ws.json'), JSON.stringify(framesWS, null, 1)); } catch (e) {}
  }, 10000);
}

if (require.main === module) principal();
// exporta o leitor para testes (não liga o robô quando importado)
module.exports = { parsePedido: parsePedido, garimpa: garimpa, achaValor: achaValor, CONTAS: CONTAS };
