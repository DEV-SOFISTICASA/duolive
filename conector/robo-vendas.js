// DuoLive · Robô de vendas ao vivo (cookies) — Shopee e TikTok
//
// Fica de olho na sua pagina de pedidos durante a live e, quando um pedido
// novo aparece, manda para o Multichat (com quem comprou e o valor) e soma no
// Analytics. Usa a sessao guardada pelo login — tudo roda no seu PC.
//
// Pré-requisito:  npm run login-shopee   e/ou   npm run login-tiktok
// Como usar:      npm run robo-vendas
//                 (deixe rodando durante a live, junto com o npm start)
//
// Nao oficial: le a pagina de pedidos como voce a ve. Se a Shopee/TikTok mudar
// o site, pode precisar de ajuste. Na primeira vez ele grava uma amostra
// (descoberta-vendas.json) — me mande se algo nao aparecer.

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

// Para onde o robo manda as vendas: o conector local (padrao) ou o do Render.
// Aponte para a nuvem com:  set DUOLIVE_CONECTOR=https://duolive-xxxx.onrender.com
const CONECTOR = (process.env.DUOLIVE_CONECTOR || ('http://127.0.0.1:' + (process.env.DUOLIVE_PORTA || 9797))).replace(/\/+$/, '');
const INICIO = Date.now();
const jaVistos = new Set();
const amostras = [];

// paginas de pedidos ao vivo de cada plataforma
const CONTAS = [
  {
    plataforma: 'shopee',
    sessao: path.join(__dirname, 'sessao-shopee.json'),
    paginas: [
      'https://seller.shopee.com.br/portal/sale/order',
      'https://creator.shopee.com.br',
    ],
    urlPedidos: /order|trade|pack|sale/i,
  },
  {
    plataforma: 'tiktok',
    sessao: path.join(__dirname, 'sessao-tiktok.json'),
    paginas: [
      'https://seller.tiktokglobalshop.com/order',
      'https://seller.tiktokglobalshop.com/live/dashboard',
    ],
    urlPedidos: /order|trade|fulfillment|live/i,
  },
];

function manda(plataforma, orderId, quem, valor) {
  const dados = JSON.stringify({ orderId: orderId, quem: quem, valor: valor, plataforma: plataforma });
  const u = new URL(CONECTOR + '/venda-auto');
  const lib = u.protocol === 'https:' ? https : http;
  const req = lib.request({
    hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dados) },
  });
  req.on('error', () => console.log('  (nao consegui falar com o conector em ' + CONECTOR + ')'));
  req.end(dados);
  console.log('  🛒 ' + plataforma + ': ' + (quem || 'pedido') + (valor ? ' — R$ ' + valor : '') + ' (#' + orderId + ')');
}

const eData = (v) => { const n = +v; return n > 1e12 ? n : n > 1e9 ? n * 1000 : 0; };
const num = (v) => (v == null ? 0 : +String(v).replace(/[^\d.]/g, '') || 0);
function achaChave(o, re) { for (const k of Object.keys(o)) if (re.test(k)) return o[k]; }

// tenta entender um objeto como "um pedido"
function parsePedido(o, plataforma) {
  if (!o || typeof o !== 'object') return null;
  const id = achaChave(o, /^(order_?id|order_?sn|orderno|id|package_?id|trade_?no)$/i);
  if (!id) return null;
  const valor = num(achaChave(o, /(total_?amount|total_?price|pay_?amount|grand_?total|amount|valor|price|paid)/i));
  const criado = eData(achaChave(o, /(create_?time|created_?at|order_?time|ctime|place.*time|pay_?time)/i));
  // nome/usuario do comprador
  let quem = achaChave(o, /(buyer_?username|buyer_?name|user_?name|username|nickname|recipient|receiver_?name|buyer)/i);
  if (quem && typeof quem === 'object') quem = quem.username || quem.name || quem.nickname || '';
  // so conta pedido FEITO durante a live (a partir do momento que o robo ligou)
  if (criado && criado < INICIO - 5 * 60000) return null;
  return { orderId: String(id), quem: String(quem || '').slice(0, 60), valor: valor, plataforma: plataforma };
}

// varre qualquer JSON procurando pedidos
function garimpa(json, plataforma, achados) {
  if (Array.isArray(json)) {
    json.forEach((x) => { const p = parsePedido(x, plataforma); if (p) achados.push(p); else garimpa(x, plataforma, achados); });
  } else if (json && typeof json === 'object') {
    const p = parsePedido(json, plataforma);
    if (p) achados.push(p);
    Object.values(json).forEach((v) => garimpa(v, plataforma, achados));
  }
}

async function vigiar(conta) {
  if (!fs.existsSync(conta.sessao)) {
    console.log('  ' + conta.plataforma + ': sem login (rode npm run login-' + conta.plataforma + '). Pulando.');
    return;
  }
  let browser;
  try { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
  catch (e) { try { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }
    catch (e2) { console.log('  Instale o Google Chrome. ' + conta.plataforma + ' pulado.'); return; } }
  const ctx = await browser.newContext({ storageState: conta.sessao, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();

  page.on('response', async (resp) => {
    try {
      if (!conta.urlPedidos.test(resp.url())) return;
      if (!String(resp.headers()['content-type'] || '').includes('json')) return;
      const json = await resp.json();
      if (amostras.length < 30) amostras.push({ plataforma: conta.plataforma, url: resp.url().slice(0, 200), corpo: json });
      const achados = [];
      garimpa(json, conta.plataforma, achados);
      achados.forEach((p) => {
        if (jaVistos.has(p.plataforma + p.orderId)) return;
        jaVistos.add(p.plataforma + p.orderId);
        manda(p.plataforma, p.orderId, p.quem, p.valor);
      });
    } catch (e) {}
  });

  console.log('  ' + conta.plataforma + ': vigiando pedidos...');
  // abre as paginas e recarrega de tempos em tempos para pegar pedidos novos
  let i = 0;
  async function ciclo() {
    const url = conta.paginas[i % conta.paginas.length]; i++;
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 }); }
    catch (e) {}
    setTimeout(ciclo, 25000); // a cada 25s recarrega/alterna a pagina de pedidos
  }
  ciclo();
}

(async () => {
  console.log('\n  DuoLive · Robô de vendas ligado. Conta os pedidos feitos a partir de agora.');
  console.log('  Mandando as vendas para: ' + CONECTOR);
  console.log('  (deixe rodando durante a live)\n');
  for (const c of CONTAS) await vigiar(c);
  // salva a amostra de vez em quando (ajuda a calibrar se algo nao aparecer)
  setInterval(() => {
    try { fs.writeFileSync(path.join(__dirname, 'descoberta-vendas.json'), JSON.stringify(amostras, null, 1)); } catch (e) {}
  }, 60000);
})();
