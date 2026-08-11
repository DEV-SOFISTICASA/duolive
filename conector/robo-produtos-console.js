// DuoLive · Produtos do Console de LIVE -> catálogo do painel
//
// O robô de produtos "normal" (robo-produtos.js) lê do Seller Center, que a nossa
// sessão recuperada NÃO abre. Mas o CONSOLE DE LIVE (shop.tiktok.com/streamer),
// de onde vêm as vendas, expõe os produtos da live com FOTO e preço pela API
//   /api/v1/streamer_desktop/live_product/list
// Este robô abre o console de cada loja (com a sessão salva), captura essa lista e
// manda para o conector (/produtos). Aí o seletor visual de ofertas mostra as fotos.
//
// Uso:  npm run produtos-console            (as 4 lojas)
//       npm run produtos-console -- monaco  (só uma)

const { abreNavegador } = require('./navegador.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const PEDIDAS = process.argv.slice(2).filter((a) => a && !a.startsWith('-'));
const LOJAS = PEDIDAS.length ? PEDIDAS : ['monaco', 'fast', 'mania', 'bellini'];

// para onde mandar (mesmo esquema dos outros robôs: conector.txt ou variáveis)
function alvoConector() {
  let url = process.env.DUOLIVE_CONECTOR || '';
  let token = process.env.DUOLIVE_TOKEN || '';
  try {
    const linhas = fs.readFileSync(path.join(__dirname, 'conector.txt'), 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    if (!url && /^https?:\/\//.test(linhas[0] || '')) url = linhas[0];
    if (!token && linhas[1]) token = linhas[1];
  } catch (e) {}
  return { url: (url || 'https://duolive-conector-jipn.onrender.com').replace(/\/+$/, ''), token: token };
}
const { url: CONECTOR, token: TOKEN } = alvoConector();

const num = (v) => {
  let s = String(v == null ? '' : v).replace(/[^\d.,]/g, '');
  if (!s) return 0;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  return +s || 0;
};

function postProdutos(loja, conta, produtos) {
  return new Promise((ok) => {
    const dados = JSON.stringify({ loja: loja, plataforma: 'tiktok', conta: conta, produtos: produtos });
    const u = new URL(CONECTOR + '/produtos');
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dados), 'x-duolive-token': TOKEN },
    }, (res) => { let c = ''; res.on('data', (d) => { c += d; }); res.on('end', () => ok(c || 'ok')); });
    req.on('error', (e) => ok('erro: ' + e.message));
    req.setTimeout(15000, () => { req.destroy(); ok('timeout'); });
    req.end(dados);
  });
}

async function leLoja(browser, loja) {
  const sess = path.join(__dirname, 'sessao-console-' + loja + '.json');
  if (!fs.existsSync(sess)) { console.log('  ' + loja + ': sem sessao-console-' + loja + '.json (pule)'); return; }
  const ctx = await browser.newContext({ storageState: sess, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  let bruto = null;
  page.on('response', async (res) => {
    try {
      if (!/live_product\/list/.test(res.url())) return;
      const b = await res.json().catch(() => null);
      if (b && b.data && Array.isArray(b.data.products)) bruto = b.data.products;
    } catch (e) {}
  });
  try { await page.goto('https://shop.tiktok.com/streamer/live/product/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 }); }
  catch (e) { console.log('  ' + loja + ': nao abriu o console (' + String(e.message).slice(0, 40) + ')'); await ctx.close(); return; }
  if (/login|passport|signin/i.test(page.url())) { console.log('  ' + loja + ': SESSAO EXPIROU (caiu no login) — puxe fresca do LiveDash'); await ctx.close(); return; }
  for (let i = 0; i < 12 && !bruto; i++) await page.waitForTimeout(1500);
  if (!bruto) { console.log('  ' + loja + ': nao capturei a lista de produtos (a live pode estar sem produtos)'); await ctx.close(); return; }
  const conta = (bruto[0] && bruto[0].seller_info && bruto[0].seller_info.shop_name) || '';
  const produtos = bruto.map((p) => {
    const de = num(p.format_origin_price);
    const av = num(p.format_available_price);
    const base = de || av;                           // sem "de" (sem oferta) -> o preço é o disponível
    return {
      id: String(p.product_id || ''),
      nome: String(p.title || ''),
      preco: base,
      promo: (de > 0 && av > 0 && av < de) ? av : 0, // só conta como promo se houver "de" e for menor
      imagem: (p.cover && p.cover.url_list && p.cover.url_list[0]) || '',
      variacoes: 0,                                   // variações vêm da tela de detalhe (próximo passo)
      plataforma: 'tiktok',
    };
  }).filter((p) => p.id && p.nome);
  const resp = await postProdutos(loja, conta, produtos);
  console.log('  ' + loja + (conta ? ' (' + conta + ')' : '') + ': ' + produtos.length + ' produto(s) com foto -> ' + resp.slice(0, 40));
  await ctx.close();
}

(async () => {
  console.log('\n  DuoLive · Produtos do Console de LIVE -> catálogo');
  console.log('  Conector: ' + CONECTOR + (TOKEN ? ' (com token)' : '  ⚠️ SEM token — o conector vai recusar!'));
  console.log('  Lojas: ' + LOJAS.join(', ') + '\n');
  console.log('  (vai abrir uma janela do navegador — o TikTok bloqueia o modo invisível)\n');
  const browser = await abreNavegador(false); // headed
  for (const loja of LOJAS) await leLoja(browser, loja);
  await browser.close();
  console.log('\n  pronto.\n');
})().catch((e) => { console.log('ERRO', e.message); process.exit(1); });
