// DuoLive · Robo da Shopee (mesma receita do robo do LiveDash para o TikTok)
//
// Usa a sessao guardada pelo login (sessao-shopee.json) para abrir o painel
// da Shopee como se fosse voce e capturar os numeros que a propria pagina
// busca. Tudo roda e fica no seu PC.
//
// Como usar:  npm run robo-shopee
//
// Ele grava dois arquivos aqui na pasta conector:
//  - descoberta-shopee.json        -> amostra das respostas capturadas (p/ ajustar o leitor)
//  - historico-shopee-oficial.json -> as lives que ele conseguiu entender

const { abreNavegador } = require('./navegador.js');
const fs = require('fs');
const path = require('path');
const L = require('./lojas.js');

const ARQ_SESSAO = L.arquivoSessao('shopee', L.lojaPedida());
const ARQ_DESCOBERTA = path.join(__dirname, 'descoberta-shopee.json');
const ARQ_OFICIAL = path.join(__dirname, 'historico-shopee-oficial.json');

// paginas do painel da Shopee onde os numeros de live costumam aparecer
const PAGINAS = [
  'https://creator.shopee.com.br',
  'https://creator.shopee.com.br/insight/live/list',
  'https://creator.shopee.com.br/dashboard/live',
];

function eData(v) { // aceita segundos ou milissegundos
  const n = +v;
  if (!n) return null;
  const ms = n > 1e12 ? n : n > 1e9 ? n * 1000 : null;
  if (!ms) return null;
  const d = new Date(ms);
  return d.getFullYear() >= 2020 && d.getFullYear() <= 2100 ? d : null;
}
function acha(obj, regex) {
  for (const k of Object.keys(obj)) if (regex.test(k)) return obj[k];
  return undefined;
}

// tenta entender um objeto como "uma live"
function parseLive(o) {
  if (!o || typeof o !== 'object') return null;
  const titulo = acha(o, /^(title|name|session_?name|room_?title|live_?title)$/i);
  const inicio = eData(acha(o, /(start|begin|create).*(time|at|ts)|^start_?time$/i));
  if (!titulo && !inicio) return null;
  const fim = eData(acha(o, /(end|finish|stop).*(time|at|ts)/i));
  const num = (v) => (v == null ? 0 : +String(v).replace(/[^\d.]/g, '') || 0);
  const live = {
    title: String(titulo || '(sem titulo)').slice(0, 120),
    started_at: inicio ? inicio.toISOString() : null,
    finished_at: fim ? fim.toISOString() : null,
    duration_min: inicio && fim ? Math.max(1, Math.round((fim - inicio) / 60000)) : 0,
    views: num(acha(o, /(uv|unique.*view|viewer|watch.*(count|num|uv)|^views?$|audience)/i)),
    likes: num(acha(o, /like/i)),
    orders: num(acha(o, /(order|pedido).*(count|num|cnt)?/i)),
    gmv: num(acha(o, /(gmv|amount|revenue|sales.?(amount|value)|valor)/i)),
    comments: num(acha(o, /(comment|coment|msg|message).*(count|num|cnt)?/i)),
  };
  // precisa ter pelo menos data + algum numero para valer
  if (!live.started_at) return null;
  if (!(live.views || live.orders || live.gmv || live.likes)) return null;
  return live;
}

// procura listas de lives dentro de qualquer resposta JSON
function garimpa(json, achadas) {
  if (Array.isArray(json)) {
    json.forEach((x) => {
      const l = parseLive(x);
      if (l) achadas.push(l);
      else garimpa(x, achadas);
    });
  } else if (json && typeof json === 'object') {
    Object.values(json).forEach((v) => garimpa(v, achadas));
  }
}

(async () => {
  if (!fs.existsSync(ARQ_SESSAO)) {
    console.log('Falta o login. Rode primeiro:  npm run login-shopee');
    process.exit(1);
  }
  const browser = await abreNavegador(true);
  const ctx = await browser.newContext({ storageState: ARQ_SESSAO, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();

  const capturas = [];
  page.on('response', async (resp) => {
    try {
      const url = resp.url();
      if (!/live|session|stream|insight|dashboard/i.test(url)) return;
      const ct = String(resp.headers()['content-type'] || '');
      if (!ct.includes('json')) return;
      const json = await resp.json();
      capturas.push({ url: url.slice(0, 300), corpo: json });
    } catch (e) {}
  });

  for (const u of PAGINAS) {
    try {
      console.log('  Abrindo', u, '...');
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(12000);
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(4000);
    } catch (e) { console.log('   (nao abriu: ' + String(e).slice(0, 60) + ')'); }
  }
  await browser.close();

  // guarda uma amostra do que foi capturado (ajuda a melhorar o leitor depois)
  const amostra = capturas.slice(0, 40).map((c) => ({ url: c.url, corpo: JSON.parse(JSON.stringify(c.corpo, null, 0).slice(0, 20000) || 'null') }));
  fs.writeFileSync(ARQ_DESCOBERTA, JSON.stringify(amostra, null, 1));

  const achadas = [];
  capturas.forEach((c) => garimpa(c.corpo, achadas));
  // remove repetidas (mesmo inicio)
  const mapa = new Map();
  achadas.forEach((l) => mapa.set(l.started_at + '|' + l.title, l));
  const lives = Array.from(mapa.values()).sort((a, b) => new Date(b.started_at) - new Date(a.started_at));

  fs.writeFileSync(ARQ_OFICIAL, JSON.stringify(lives, null, 1));
  console.log('');
  console.log('  Capturas de rede: ' + capturas.length + '  ->  lives entendidas: ' + lives.length);
  if (lives.length) {
    console.log('  Ultima live: ' + lives[0].title + ' | views ' + lives[0].views + ' | pedidos ' + lives[0].orders + ' | R$ ' + lives[0].gmv);
    console.log('  Salvo em historico-shopee-oficial.json (o Analytics passa a mostrar).');
  } else {
    console.log('  Nao consegui entender as lives ainda — normal na primeira vez.');
    console.log('  Me mande o arquivo descoberta-shopee.json que eu ajusto o leitor.');
  }
  process.exit(0);
})();
