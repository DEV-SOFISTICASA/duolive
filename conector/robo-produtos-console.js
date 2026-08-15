// DuoLive · Produtos do Console de LIVE -> catálogo do painel
//
// O robô de produtos "normal" (robo-produtos.js) lê do Seller Center, que a nossa
// sessão recuperada NÃO abre. Mas o CONSOLE DE LIVE (shop.tiktok.com/streamer),
// de onde vêm as vendas, expõe o CATÁLOGO COMPLETO da loja com FOTO, preço e
// variações (cores) pela API  /api/v1/streamer_desktop/shop_product/search
// Este robô abre o console de cada loja (com a sessão salva), lê o catálogo inteiro,
// TIRA os vasos (a live não usa) e manda para o conector (/produtos). Aí o seletor
// visual de ofertas mostra tudo com as fotos.
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
  try { await page.goto('https://shop.tiktok.com/streamer/live/product/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 }); }
  catch (e) { console.log('  ' + loja + ': nao abriu o console (' + String(e.message).slice(0, 40) + ')'); await ctx.close(); return; }
  if (/login|passport|signin/i.test(page.url())) { console.log('  ' + loja + ': SESSAO EXPIROU (caiu no login) — puxe fresca do LiveDash'); await ctx.close(); return; }
  await page.waitForTimeout(6000);
  // catálogo COMPLETO da loja (não só os produtos da live), via shop_product/search paginado
  const todos = await page.evaluate(async () => {
    const base = 'user_language=pt-BR&locale=pt-BR&aid=253642&app_name=i18n_ecom_alliance&device_platform=web';
    let all = [], pg = 1;
    while (pg <= 8) {
      const res = await fetch('/api/v1/streamer_desktop/shop_product/search?page_number=' + pg + '&page_size=50&use_streamer_products=false&is_not_for_sale_status=1&' + base);
      const j = await res.json().catch(() => null);
      const arr = (j && j.data && (j.data.streamer_products || j.data.products)) || [];
      all = all.concat(arr);
      if (arr.length < 50) break;
      pg++;
    }
    return all;
  });
  if (!todos.length) { console.log('  ' + loja + ': nao li o catalogo (a sessao abriu? a loja tem produtos?)'); await ctx.close(); return; }
  // a live não usa VASO nem SABONETE — tira todos
  const EXCLUI = /vaso|sabonete/i;
  const arr = todos.filter((p) => !EXCLUI.test(p.title || ''));
  const seller = (todos.find((p) => p.seller_info && p.seller_info.shop_name) || {}).seller_info;
  const conta = (seller && seller.shop_name) || '';
  const imgDe = (v) => { if (!v) return ''; if (typeof v.img === 'string') return v.img; if (v.img && v.img.url_list) return v.img.url_list[0] || ''; if (typeof v.image === 'string') return v.image; if (v.image && v.image.url_list) return v.image.url_list[0] || ''; if (v.thumb_url_list) return v.thumb_url_list[0] || ''; return ''; };
  const variacoesDe = (p) => { const sa = p.sales_attributes || p.sale_props || p.product_attributes || []; let out = []; for (const attr of sa) { const vals = attr.values || attr.sale_prop_values || attr.attribute_values || []; for (const v of vals) { const nome = v.name || v.value_name || v.attribute_value || ''; if (nome) out.push({ nome: nome, foto: imgDe(v) }); } if (out.length) break; } if (!out.length) { const nomes = [...new Set((p.skus || []).flatMap((s) => s.property_value_names || []))]; nomes.forEach((n) => out.push({ nome: n, foto: '' })); } return out; };
  const cover = (p) => (p.cover && ((p.cover.thumb_url_list && p.cover.thumb_url_list[0]) || (p.cover.url_list && p.cover.url_list[0]))) || '';
  const precoNum = (p) => { let v = p.min_sale_price != null ? p.min_sale_price : p.max_sale_price; if (typeof v === 'string') { let s = v.replace(/[^\d.,]/g, ''); if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g, ''); s = s.replace(',', '.'); v = parseFloat(s) || 0; } v = Number(v) || 0; if (v > 10000) v = v / 100; return +v.toFixed(2); };
  const produtos = arr.map((p) => ({ id: String(p.product_id || ''), nome: p.title || '', preco: precoNum(p), imagem: cover(p), variacoes: variacoesDe(p), plataforma: 'tiktok' })).filter((p) => p.id && p.nome);
  const resp = await postProdutos(loja, conta, produtos);
  const tirados = todos.length - arr.length;
  console.log('  ' + loja + (conta ? ' (' + conta + ')' : '') + ': ' + todos.length + ' no catalogo · ' + produtos.length + ' enviados (tirei ' + tirados + ' vaso/sabonete) -> ' + String(resp).slice(0, 40));
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
