// DuoLive · Conector de alertas do streamer
//
// Capta os eventos da sua live no TikTok (mensagens, seguidores, presentes,
// entradas, espectadores) e alimenta o dock de alertas dentro do OBS.
//
// Como usar:
//   1. npm install            (só na primeira vez)
//   2. npm start -- @seuusuario
//   3. No OBS: Docks -> Docks personalizados do navegador -> URL http://127.0.0.1:9797
//
// Modo de teste (sem estar ao vivo):  DUOLIVE_TESTE=1 npm start
//
// Compras e Shopee: as plataformas nao liberam eventos de compra para fora —
// acompanhe os pedidos pelos docks Shopee Creator / TikTok Seller Center (ver guia).

const http = require('http');
const fs = require('fs');
const path = require('path');

// PORT e' o padrao da nuvem (Render/Railway); DUOLIVE_PORTA e' o local
const PORTA = +(process.env.PORT || process.env.DUOLIVE_PORTA || 9797);
const NA_NUVEM = !!process.env.PORT; // Render define PORT
const TESTE = process.env.DUOLIVE_TESTE === '1';
// usuario do TikTok: por argumento (local) ou por variavel de ambiente (nuvem).
// e' 'let' porque o seletor de lojas no painel troca a conta em tempo real.
let usuario = (process.argv[2] || process.env.DUOLIVE_TIKTOK_USER || '').replace(/^@/, '');

// ---------- servidor: multichat + vendas anotadas + WebSocket ----------
let vendasAnotadas = [];        // manuais (o multichat manda a lista)
let vendasAuto = [];            // automaticas (o robo de vendas por cookies)
const vendasAutoIds = new Set(); // evita contar o mesmo pedido duas vezes

// estado AO VIVO da conta ativa (vem da conexao do chat do TikTok)
let liveEstado = { espectadores: 0, likes: 0, inicio: 0 };
// numeros oficiais do console de lives (Compass) por loja, lidos por cookies como no LiveDash
const compassPorLoja = {}; // { loja: { gmv, orders, views, ts } }
let lojaAtual = '';        // qual loja o painel esta mostrando
// ofertas relampago NO AR (varias ao mesmo tempo), transmitidas para todos os aparelhos
let ofertas = [];
// produtos lidos das lojas pelo robo de produtos (cookies): { tiktok: [...], shopee: [...] }
const produtosPorPlat = { tiktok: [], shopee: [] };
const produtosTs = { tiktok: 0, shopee: 0 };

function limpaOfertas() { // tira do ar as que ja venceram
  const agora = Date.now();
  const antes = ofertas.length;
  ofertas = ofertas.filter((o) => o && o.fim > agora);
  return antes !== ofertas.length;
}

// ---------- registro das lives da Shopee (fica salvo no seu PC) ----------
const ARQ_SHOPEE = path.join(__dirname, 'historico-shopee.json');
let shopeeLives = [];
try { shopeeLives = JSON.parse(fs.readFileSync(ARQ_SHOPEE, 'utf8')); } catch (e) {}
let salvaAgendado = null;
function salvaShopee() {
  if (salvaAgendado) return;
  salvaAgendado = setTimeout(() => {
    salvaAgendado = null;
    fs.writeFile(ARQ_SHOPEE, JSON.stringify(shopeeLives), () => {});
  }, 3000);
}
function liveShopeeAtual() {
  const agora = Date.now();
  let l = shopeeLives[shopeeLives.length - 1];
  // mais de 2h sem nada = live nova
  if (!l || agora - l.fim > 2 * 3600 * 1000) {
    l = { inicio: agora, fim: agora, mensagens: 0 };
    shopeeLives.push(l);
    if (shopeeLives.length > 200) shopeeLives.shift();
  }
  l.fim = agora;
  salvaShopee();
  return l;
}

const server = http.createServer((req, res) => {
  // deixa o analytics (que roda no site) buscar as vendas aqui do seu PC
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') { res.end(); return; }

  // recebe as mensagens do chat da Shopee (mandadas pelo espião que roda no navegador)
  if (req.url.startsWith('/eventos') && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 65536) req.destroy(); });
    req.on('end', () => {
      try {
        const ev = JSON.parse(corpo);
        const texto = String(ev.texto || '').slice(0, 300).trim();
        const quem = String(ev.quem || '').slice(0, 60).trim();
        if (texto) {
          emitir({ tipo: 'mensagem', quem: quem, texto: texto, plataforma: 'shopee' });
          liveShopeeAtual().mensagens++;
        }
      } catch (e) {}
      res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
    });
    return;
  }

  // venda detectada automaticamente pelo robo de vendas (cookies) — POST /venda-auto
  if (req.url.startsWith('/venda-auto') && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 65536) req.destroy(); });
    req.on('end', () => {
      try {
        const v = JSON.parse(corpo);
        const id = String(v.orderId || v.id || '').trim();
        if (id && !vendasAutoIds.has(id)) {
          vendasAutoIds.add(id);
          const plataforma = v.plataforma === 'tiktok' ? 'tiktok' : 'shopee';
          const valor = +v.valor || 0;
          const quem = String(v.quem || '').slice(0, 60).trim();
          const venda = { valor: valor, plataforma: plataforma, quem: quem, ts: Date.now(), auto: true, orderId: id };
          vendasAuto.push(venda);
          if (plataforma === 'shopee') liveShopeeAtual();
          // aparece no Multichat na hora, com quem comprou e o valor
          emitir({ tipo: 'venda', quem: quem || 'Venda', texto: 'comprou' + (valor ? ' · R$ ' + valor.toFixed(2).replace('.', ',') : ''), plataforma: plataforma });
        }
      } catch (e) {}
      res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
    });
    return;
  }

  // seletor de lojas: troca a conta do TikTok que o chat esta lendo
  if (req.url.startsWith('/conta')) {
    if (req.method === 'POST') {
      let corpo = '';
      req.on('data', (d) => { corpo += d; if (corpo.length > 4096) req.destroy(); });
      req.on('end', () => {
        try { const b = JSON.parse(corpo); if (b.loja != null) lojaAtual = String(b.loja); ligarConta(b.tiktok || b.conta || ''); } catch (e) {}
        res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
      });
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ usuario: usuario, aoVivo: aoVivo }));
    return;
  }

  // recebe os numeros oficiais do console de lives do TikTok (robo Compass por cookies)
  if (req.url.startsWith('/numeros-tiktok') && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 8192) req.destroy(); });
    req.on('end', () => {
      try {
        const b = JSON.parse(corpo);
        const loja = String(b.loja || lojaAtual || '?');
        compassPorLoja[loja] = { gmv: +b.gmv || 0, orders: +b.orders || 0, views: +b.views || 0, live: !!b.live, ts: Date.now() };
      } catch (e) {}
      res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
    });
    return;
  }

  // quais lojas estao em live agora (o robo do console marca) — o painel usa para focar sozinho
  if (req.url.startsWith('/lojas-live')) {
    const agora = Date.now();
    const lista = Object.keys(compassPorLoja).map((loja) => {
      const c = compassPorLoja[loja];
      const fresco = c.ts && (agora - c.ts < 15 * 60000);
      return { loja: loja, live: !!(fresco && c.live), gmv: c.gmv, orders: c.orders, views: c.views };
    });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(lista));
    return;
  }

  // painel AO VIVO: numeros em tempo real da conta ativa
  // (vendas separadas por app; pedidos e curtidas somados)
  if (req.url.startsWith('/ao-vivo')) {
    const todas = vendasAnotadas.concat(vendasAuto);
    const desde = liveEstado.inicio || 0;
    const daLive = todas.filter((v) => !desde || (v.ts || 0) >= desde);
    const tik = { n: 0, t: 0 }, sho = { n: 0, t: 0 };
    daLive.forEach((v) => {
      const d = v.plataforma === 'tiktok' ? tik : sho;
      d.n++; d.t += v.valor || 0;
    });
    // numeros do console (Compass) da loja atual, se recentes (<15min): sao os oficiais do TikTok
    const c = compassPorLoja[lojaAtual] || null;
    const compassFresco = !!(c && c.ts && (Date.now() - c.ts < 15 * 60000));
    const totalTiktok = compassFresco ? c.gmv : tik.t;
    const pedidosTiktok = compassFresco ? c.orders : tik.n;
    // espectadores: o do chat; se 0 e o Compass tem views, mostra as views do console
    const espectadores = liveEstado.espectadores || (compassFresco ? c.views : 0);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      usuario: usuario, aoVivo: aoVivo,
      espectadores: espectadores, likes: liveEstado.likes,
      inicio: liveEstado.inicio,
      totalTiktok: totalTiktok, totalShopee: sho.t,
      pedidosTiktok: pedidosTiktok, pedidosShopee: sho.n,
      pedidos: pedidosTiktok + sho.n,
      total: totalTiktok + sho.t,
      vendas: pedidosTiktok + sho.n, // compatibilidade com versoes antigas do painel
      fonte: compassFresco ? 'console' : 'chat',
    }));
    return;
  }

  // produtos das lojas, lidos por cookies pelo robo de produtos
  // POST { plataforma, produtos:[{id,nome,preco,sku,imagem}] }  ·  GET -> {tiktok:[],shopee:[],ts:{}}
  if (req.url.startsWith('/produtos')) {
    if (req.method === 'POST') {
      let corpo = '';
      req.on('data', (d) => { corpo += d; if (corpo.length > 4e6) req.destroy(); });
      req.on('end', () => {
        try {
          const b = JSON.parse(corpo);
          const plat = b.plataforma === 'tiktok' ? 'tiktok' : 'shopee';
          if (Array.isArray(b.produtos)) {
            produtosPorPlat[plat] = b.produtos.slice(0, 3000);
            produtosTs[plat] = Date.now();
            console.log('  📦 ' + plat + ': ' + produtosPorPlat[plat].length + ' produto(s) da loja recebidos.');
          }
        } catch (e) {}
        res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
      });
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ tiktok: produtosPorPlat.tiktok, shopee: produtosPorPlat.shopee, ts: produtosTs }));
    return;
  }

  // o robo da oferta conta como foi (aplicada / ensaio / erro / restaurada)
  if (req.url.startsWith('/oferta-estado') && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 8192) req.destroy(); });
    req.on('end', () => {
      try {
        const b = JSON.parse(corpo);
        const o = ofertas.find((x) => x.id === b.id);
        if (o) {
          o.estado = String(b.estado || '').slice(0, 20);
          o.erro = String(b.erro || '').slice(0, 120);
          emitir({ tipo: 'oferta', ofertas: ofertas, oferta: ofertas[0] || null });
        }
      } catch (e) {}
      res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
    });
    return;
  }

  // ofertas relampago ao vivo (VARIAS ao mesmo tempo), compartilhadas entre aparelhos.
  // POST aceita uma lista (novo) ou uma oferta so' (painel antigo). GET devolve a lista.
  if (req.url.startsWith('/oferta')) {
    if (req.method === 'POST') {
      let corpo = '';
      req.on('data', (d) => { corpo += d; if (corpo.length > 65536) req.destroy(); });
      req.on('end', () => {
        try {
          const b = JSON.parse(corpo);
          if (Array.isArray(b)) ofertas = b.filter((o) => o && o.nome && o.fim > Date.now());
          else if (b && b.nome) ofertas = [b];
          else ofertas = [];
          emitir({ tipo: 'oferta', ofertas: ofertas, oferta: ofertas[0] || null });
        } catch (e) {}
        res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
      });
      return;
    }
    limpaOfertas();
    res.setHeader('content-type', 'application/json');
    // /ofertas -> lista (novo)   ·   /oferta -> a primeira (compatibilidade)
    const querLista = req.url.split('?')[0] === '/ofertas';
    res.end(JSON.stringify(querLista ? ofertas : (ofertas[0] || null)));
    return;
  }

  if (req.url.startsWith('/vendas')) {
    if (req.method === 'POST') {
      let corpo = '';
      req.on('data', (d) => { corpo += d; if (corpo.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try {
          const v = JSON.parse(corpo);
          if (Array.isArray(v)) {
            vendasAnotadas = v;
            // venda da Shopee agorinha = a live da Shopee esta rolando
            const agora = Date.now();
            if (v.some((x) => x.plataforma !== 'tiktok' && agora - (x.ts || 0) < 60000)) liveShopeeAtual();
          }
        } catch (e) {}
        res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
      });
      return;
    }
    // GET: junta as manuais (do Multichat) com as automaticas (do robo)
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(vendasAnotadas.concat(vendasAuto)));
    return;
  }

  // numeros oficiais capturados pelo robo da Shopee (npm run robo-shopee)
  if (req.url.startsWith('/shopee-oficial')) {
    fs.readFile(path.join(__dirname, 'historico-shopee-oficial.json'), (e, d) => {
      res.setHeader('content-type', 'application/json');
      res.end(e ? '[]' : d);
    });
    return;
  }

  // historico das lives da Shopee para o Analytics (mensagens + vendas anotadas por live)
  if (req.url.startsWith('/shopee-lives')) {
    const folga = 30 * 60 * 1000;
    const todas = vendasAnotadas.concat(vendasAuto);
    const lives = shopeeLives.map((l) => {
      const vs = todas.filter((v) => v.plataforma !== 'tiktok' && v.ts >= l.inicio - folga && v.ts <= l.fim + folga);
      let total = 0; vs.forEach((v) => { total += v.valor || 0; });
      return { inicio: l.inicio, fim: l.fim, mensagens: l.mensagens, vendas: vs.length, total: total };
    });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(lives));
    return;
  }

  // painel completo em UMA URL: /painel mostra Analytics + Ofertas + Multichat juntos
  // (as outras entradas servem os pedacos que o painel usa, tudo do mesmo endereco)
  const ESTATICOS = {
    '/painel': 'index.html',
    '/index.html': 'index.html',
    '/analytics.html': 'analytics.html',
    '/sacolinha-controle.html': 'sacolinha-controle.html',
    '/lib/xlsx.min.js': 'lib/xlsx.min.js',
  };
  const caminho = req.url.split('?')[0];
  if (ESTATICOS[caminho]) {
    fs.readFile(path.join(__dirname, '..', ESTATICOS[caminho]), (err, corpo) => {
      if (err) { res.statusCode = 404; res.end('arquivo nao encontrado'); return; }
      res.setHeader('content-type', caminho.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
      res.end(corpo);
    });
    return;
  }

  const arq = path.join(__dirname, '..', 'multichat.html');
  fs.readFile(arq, (err, html) => {
    if (err) { res.statusCode = 500; res.end('multichat.html nao encontrado ao lado da pasta conector/'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  });
});

const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ server });
const clientes = new Set();
wss.on('connection', (ws) => {
  clientes.add(ws);
  ws.send(JSON.stringify({ tipo: 'status', conectado: aoVivo, usuario: usuario || '(teste)' }));
  ws.on('close', () => clientes.delete(ws));
});

let aoVivo = false;
function emitir(ev) {
  ev.ts = Date.now();
  if (ev.tipo !== 'status' && ev.tipo !== 'contadores' && !ev.plataforma) ev.plataforma = 'tiktok';
  const msg = JSON.stringify(ev);
  for (const c of clientes) { try { c.send(msg); } catch (e) {} }
}

server.listen(PORTA, '0.0.0.0', () => {
  console.log('');
  console.log('  DuoLive Conector no ar!');
  if (NA_NUVEM) {
    console.log('  Rodando na nuvem, porta ' + PORTA + '. Use a URL publica do servico no painel.');
  } else {
    console.log('  Endereco: http://127.0.0.1:' + PORTA);
  }
  console.log('');
});

// ---------- modo teste: eventos falsos para ajustar o layout ----------
if (TESTE) {
  console.log('  MODO TESTE: gerando eventos falsos a cada 2s (sem conectar no TikTok).');
  const nomes = ['maria.silva', 'joao123', 'ana_compras', 'carlos.br', 'juh.oliveira'];
  const eventos = [
    (n) => ({ tipo: 'mensagem', quem: n, texto: 'tem tamanho grande?' }),
    (n) => ({ tipo: 'mensagem', quem: n, texto: 'quanto ta o frete?' }),
    (n) => ({ tipo: 'mensagem', quem: n, texto: 'onde posso comprar?', plataforma: 'shopee' }),
    (n) => ({ tipo: 'seguidor', quem: n }),
    (n) => ({ tipo: 'presente', quem: n, presente: 'Rosa', qtd: 3, diamantes: 3 }),
    (n) => ({ tipo: 'entrada', quem: n }),
    (n) => ({ tipo: 'venda', quem: n, texto: 'comprou · R$ 89,90 · Tapete Sala', plataforma: 'shopee' }),
  ];
  let v = 42, likes = 130;
  aoVivo = true;
  setInterval(() => {
    const n = nomes[Math.floor(Math.random() * nomes.length)];
    emitir(eventos[Math.floor(Math.random() * eventos.length)](n));
    v += Math.floor(Math.random() * 5) - 1; likes += Math.floor(Math.random() * 9);
    emitir({ tipo: 'contadores', espectadores: Math.max(1, v), likes: likes });
  }, 2000);
  return;
}

// ---------- conexao real com a live do TikTok (troca de conta em tempo real) ----------
const ttlive = require('tiktok-live-connector');
const { TikTokLiveConnection, WebcastEvent } = ttlive;
// A leitura do chat do TikTok passa por um servico que "assina" o pedido (Euler
// Stream). Pegue a chave gratis em https://www.eulerstream.com e informe em
// DUOLIVE_SIGN_KEY.
const SIGN_KEY = process.env.DUOLIVE_SIGN_KEY || '';
if (SIGN_KEY) console.log('  (usando sua chave de assinatura do TikTok)');
else console.log('  (sem chave de assinatura — se der erro de "sign", pegue uma gratis em eulerstream.com)');
const opcoes = {};
if (SIGN_KEY) opcoes.signApiKey = SIGN_KEY;

let conexao = null;
let geracao = 0; // muda a cada troca de conta; timers antigos de reconexao sao ignorados

function nomeDe(d) {
  return (d && ((d.user && (d.user.uniqueId || d.user.nickname)) || d.uniqueId || d.nickname)) || '';
}

function criarConexao() {
  conexao = new TikTokLiveConnection(usuario, opcoes);
  conexao.on(WebcastEvent.CHAT, (d) => emitir({ tipo: 'mensagem', quem: nomeDe(d), texto: (d && (d.content || d.comment)) || '' }));
  conexao.on(WebcastEvent.MEMBER, (d) => emitir({ tipo: 'entrada', quem: nomeDe(d) }));
  conexao.on(WebcastEvent.FOLLOW, (d) => emitir({ tipo: 'seguidor', quem: nomeDe(d) }));
  conexao.on(WebcastEvent.SHARE, (d) => emitir({ tipo: 'share', quem: nomeDe(d) }));
  conexao.on(WebcastEvent.SOCIAL, (d) => {
    const t = String((d && d.displayType) || '');
    if (t.includes('follow')) emitir({ tipo: 'seguidor', quem: nomeDe(d) });
    else if (t.includes('share')) emitir({ tipo: 'share', quem: nomeDe(d) });
  });
  conexao.on(WebcastEvent.GIFT, (d) => {
    if (d.giftType === 1 && !d.repeatEnd) return;
    const nome = (d.giftDetails && d.giftDetails.giftName) || d.giftName || (d.gift && d.gift.name) || 'presente';
    emitir({ tipo: 'presente', quem: nomeDe(d), presente: nome, qtd: d.repeatCount || 1 });
  });
  conexao.on(WebcastEvent.ROOM_USER, (d) => {
    // na v2 o numero de espectadores vem em 'total' (ou 'totalUser'); 'viewerCount' era da v1
    const bruto = d && (d.viewerCount != null ? d.viewerCount : (d.total != null ? d.total : d.totalUser));
    const v = parseInt(bruto, 10);
    if (!isNaN(v)) { liveEstado.espectadores = v; emitir({ tipo: 'contadores', espectadores: v }); }
  });
  conexao.on(WebcastEvent.LIKE, (d) => {
    // na v2 o total de curtidas vem em 'total'; 'totalLikeCount' era da v1
    const bruto = d && (d.totalLikeCount != null ? d.totalLikeCount : d.total);
    const t = parseInt(bruto, 10);
    if (!isNaN(t)) { liveEstado.likes = t; emitir({ tipo: 'contadores', likes: t }); }
  });
  conexao.on(WebcastEvent.STREAM_END, () => {
    const g = geracao; aoVivo = false; liveEstado.inicio = 0;
    console.log('  A live de @' + usuario + ' terminou. Aguardando a proxima...');
    emitir({ tipo: 'status', conectado: false, usuario: usuario });
    setTimeout(() => { if (g === geracao) conectar(); }, 60000);
  });
  conexao.on('disconnected', () => {
    if (!aoVivo) return;
    const g = geracao; aoVivo = false;
    console.log('  Conexao caiu. Reconectando...');
    emitir({ tipo: 'status', conectado: false, usuario: usuario });
    setTimeout(() => { if (g === geracao) conectar(); }, 10000);
  });
  conexao.on('error', () => { /* nao derruba o conector */ });
}

function conectar() {
  if (!usuario || !conexao) return;
  const g = geracao;
  conexao.connect().then((estado) => {
    if (g !== geracao) return; // trocaram de conta enquanto conectava
    aoVivo = true;
    if (!liveEstado.inicio) liveEstado.inicio = Date.now(); // marca o comeco da live
    console.log('  Conectado na live de @' + usuario + (estado && estado.roomId ? ' (sala ' + estado.roomId + ')' : ''));
    emitir({ tipo: 'status', conectado: true, usuario: usuario, inicio: liveEstado.inicio });
  }).catch((err) => {
    if (g !== geracao) return;
    aoVivo = false;
    const txt = String((err && (err.message || err.name)) || err);
    emitir({ tipo: 'status', conectado: false, usuario: usuario });
    if (/sign|euler|rate.?limit|429|401|403/i.test(txt)) {
      if (/rate.?limit|429/i.test(txt)) console.log('  ATENCAO: limite da chave de assinatura (Euler Stream). Espere e tente de novo.');
      else console.log('  ATENCAO: assinatura recusada. Confira a DUOLIVE_SIGN_KEY (eulerstream.com). Detalhe: ' + txt.slice(0, 90));
      setTimeout(() => { if (g === geracao) conectar(); }, 60000);
    } else {
      console.log('  Sem live no ar para @' + usuario + ' (' + txt.slice(0, 80) + '). Tento de novo em 30s...');
      setTimeout(() => { if (g === geracao) conectar(); }, 30000);
    }
  });
}

// troca a conta ativa do TikTok (chamado pelo seletor de lojas no painel)
function ligarConta(novo) {
  novo = String(novo || '').replace(/^@/, '').trim();
  geracao++; // invalida timers/pendencias da conta anterior
  aoVivo = false;
  liveEstado = { espectadores: 0, likes: 0, inicio: 0 }; // zera os contadores ao trocar de loja
  if (conexao) { try { conexao.disconnect(); } catch (e) {} conexao = null; }
  usuario = novo;
  if (!usuario) { emitir({ tipo: 'status', conectado: false, usuario: '' }); return; }
  console.log('  >> trocando para a live de @' + usuario);
  emitir({ tipo: 'status', conectado: false, usuario: usuario });
  criarConexao();
  conectar();
}

if (usuario) { criarConexao(); conectar(); }
else console.log('  Nenhuma conta ainda. Escolha uma loja no painel (ou use: npm start -- @conta).');

module.exports = { ligarConta: ligarConta, contaAtual: () => usuario };
