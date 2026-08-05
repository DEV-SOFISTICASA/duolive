// DuoLive · Robô de produtos — lê o catálogo das SUAS lojas por cookies
//
// Abre a lista de produtos do TikTok Shop e da Shopee com a sessão guardada,
// lê nome, preço atual, preço promocional e SKU de cada produto, e manda tudo
// para o painel. Assim as ofertas relâmpago já saem com os produtos de verdade
// (cada loja com o SEU preço — TikTok e Shopee são separados).
//
// SÓ LEITURA: este robô não altera nada nas lojas.
//
// Pré-requisito:  npm run login-tiktok  e/ou  npm run login-shopee
// Como usar:      npm run produtos
//
// Fica rodando e atualiza sozinho a cada 10 min (DUOLIVE_PRODUTOS_MIN muda isso).
// Rode com  DUOLIVE_UMA_VEZ=1  para ler uma vez e sair.

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

function enderecoConector() {
  if (process.env.DUOLIVE_CONECTOR) return process.env.DUOLIVE_CONECTOR;
  try {
    const txt = fs.readFileSync(path.join(__dirname, 'conector.txt'), 'utf8').trim();
    if (/^https?:\/\//.test(txt)) return txt;
  } catch (e) {}
  return 'http://127.0.0.1:' + (process.env.DUOLIVE_PORTA || 9797);
}
const CONECTOR = enderecoConector().replace(/\/+$/, '');
const UMA_VEZ = process.env.DUOLIVE_UMA_VEZ === '1';
const INTERVALO = Math.max(2, +(process.env.DUOLIVE_PRODUTOS_MIN || 10)) * 60000;
const ARQ_CACHE = path.join(__dirname, 'produtos-cache.json');

// nome da loja (junta as duas contas numa só): DUOLIVE_LOJA ou o arquivo loja.txt
function nomeDaLoja() {
  if (process.env.DUOLIVE_LOJA) return process.env.DUOLIVE_LOJA.trim();
  try {
    const t = fs.readFileSync(path.join(__dirname, 'loja.txt'), 'utf8').trim();
    if (t) return t.split('\n')[0].trim();
  } catch (e) {}
  return '';
}
const LOJA = nomeDaLoja();

const CONTAS = [
  {
    plataforma: 'tiktok',
    sessao: path.join(__dirname, 'sessao-tiktok.json'),
    pagina: 'https://seller-br.tiktok.com/product',
    reUrl: /product\/local\/products\/list/i,
    reConta: /seller\/shop\/get|shop_info|seller\/info|account\/info/i,
  },
  {
    plataforma: 'shopee',
    sessao: path.join(__dirname, 'sessao-shopee.json'),
    pagina: 'https://seller.shopee.com.br/portal/product/list/all',
    reUrl: /search_product_list/i,
    reConta: /selleraccount\/shop_info|selleraccount\/user_info/i,
  },
];

// procura o NOME da loja dentro de uma resposta do painel (ex.: "Tokdecor12").
// Preferimos shop_name/seller_name; "username" e afins só se não houver nada melhor.
// Descartamos códigos internos como "user5951113507785" ou só números.
const NOME_BOM = /^(shop_?name|seller_?name|store_?name|shopname)$/i;
const NOME_TALVEZ = /^(nickname|display_?name|username|user_?name|name)$/i;
function pareceCodigo(s) {
  return /^user\d{6,}$/i.test(s) || /^\d{5,}$/.test(s) || /^[0-9a-f]{16,}$/i.test(s);
}
function achaNomeConta(json) {
  let bom = '', talvez = '';
  (function anda(o, prof) {
    if (bom || !o || typeof o !== 'object' || prof > 5) return;
    for (const [k, v] of Object.entries(o)) {
      if (bom) return;
      if (typeof v === 'string') {
        const s = v.trim();
        if (s && s.length < 60 && !pareceCodigo(s)) {
          if (NOME_BOM.test(k)) { bom = s; return; }
          if (!talvez && NOME_TALVEZ.test(k)) talvez = s;
        }
      } else if (v && typeof v === 'object') anda(v, prof + 1);
    }
  })(json, 0);
  return bom || talvez;
}

const num = (v) => {
  if (v == null) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  return +s || 0;
};
const brl = (n) => (n || 0).toFixed(2).replace('.', ',');

// ---------- leitores (a estrutura de cada loja é diferente) ----------
function leTikTok(json) {
  const lista = (json && json.data && (json.data.products || json.data.product_list)) || [];
  if (!Array.isArray(lista)) return [];
  return lista.map((p) => {
    const skus = Array.isArray(p.skus) ? p.skus : [];
    // preço do produto = o menor preço de venda entre as variações
    let normal = 0, promo = 0, skuId = '';
    skus.forEach((s) => {
      const b = (s && s.base_price) || {};
      const v = num(b.sale_price);
      const pr = num(b.promotion_price);
      if (v && (!normal || v < normal)) { normal = v; skuId = String(s.id || ''); }
      if (pr && (!promo || pr < promo)) promo = pr;
    });
    if (!normal) normal = num((p.sale_price_ranges || [])[0] && p.sale_price_ranges[0].price_range);
    const img = (p.image && (p.image.url_list || p.image.thumb_url_list) || [])[0] || '';
    return {
      plataforma: 'tiktok',
      id: String(p.product_id || ''),
      sku: skuId,
      nome: String(p.product_name || '').slice(0, 140),
      preco: normal,
      promo: promo,
      imagem: String(img).slice(0, 300),
      variacoes: skus.length,
    };
  }).filter((p) => p.id && p.nome);
}

function leShopee(json) {
  const lista = (json && json.data && json.data.products) || [];
  if (!Array.isArray(lista)) return [];
  return lista.map((p) => {
    const pd = p.price_detail || {};
    const modelos = Array.isArray(p.model_list) ? p.model_list : [];
    // preço "de" (original) e "por" (vendendo agora)
    let normal = num(pd.price_min);
    let promo = num(pd.selling_price_min);
    if (!normal && modelos.length) normal = num((modelos[0].price_detail || {}).origin_price);
    if (!promo && modelos.length) promo = num((modelos[0].price_detail || {}).promotion_price);
    if (promo && normal && promo >= normal) promo = 0; // sem desconto ativo
    return {
      plataforma: 'shopee',
      id: String(p.id || ''),
      sku: String(p.parent_sku || ''),
      modelos: modelos.map((m) => ({ id: String(m.id || ''), nome: String(m.name || ''), sku: String(m.sku || '') })).slice(0, 60),
      nome: String(p.name || '').slice(0, 140),
      preco: normal,
      promo: promo,
      imagem: p.cover_image ? ('https://down-br.img.susercontent.com/file/' + p.cover_image) : '',
      variacoes: modelos.length,
    };
  }).filter((p) => p.id && p.nome);
}

// ---------- envio para o conector ----------
function manda(plataforma, produtos, conta) {
  const dados = JSON.stringify({ plataforma: plataforma, produtos: produtos, loja: LOJA, conta: conta || '' });
  const u = new URL(CONECTOR + '/produtos');
  const lib = u.protocol === 'https:' ? https : http;
  const req = lib.request({
    hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dados) },
  });
  req.on('error', () => console.log('  (nao consegui falar com o conector em ' + CONECTOR + ')'));
  req.end(dados);
}

async function lerLoja(browser, conta) {
  if (!fs.existsSync(conta.sessao)) {
    console.log('  ' + conta.plataforma + ': sem login (rode npm run login-' + conta.plataforma + '). Pulando.');
    return null;
  }
  const ctx = await browser.newContext({ storageState: conta.sessao, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await ctx.route('**/*', (r) => {
    const t = r.request().resourceType();
    if (t === 'image' || t === 'media' || t === 'font') return r.abort();
    return r.continue();
  });
  const page = await ctx.newPage();
  const porId = new Map();
  let chamada = null;   // a chamada da lista, para pedirmos as próximas páginas
  let nomeConta = '';   // o nome da conta nessa plataforma (ex.: Tokdecor12)
  page.on('response', async (resp) => {
    try {
      const ct = String(resp.headers()['content-type'] || '');
      if (!ct.includes('json')) return;
      if (!nomeConta && conta.reConta && conta.reConta.test(resp.url())) {
        const j = await resp.json();
        nomeConta = achaNomeConta(j) || '';
        return;
      }
      if (!conta.reUrl.test(resp.url())) return;
      const json = await resp.json();
      const lidos = conta.plataforma === 'tiktok' ? leTikTok(json) : leShopee(json);
      if (lidos.length && !chamada) chamada = resp.url();
      lidos.forEach((p) => porId.set(p.id, p));
    } catch (e) {}
  });

  // abre a lista (a Shopee às vezes derruba a 1ª conexão — por isso tentamos 3x)
  let abriu = false;
  for (let i = 0; i < 3 && !abriu; i++) {
    try { await page.goto(conta.pagina, { waitUntil: 'domcontentloaded', timeout: 45000 }); abriu = true; }
    catch (e) { await page.waitForTimeout(2500); }
  }
  if (!abriu) { console.log('  ' + conta.plataforma + ': nao consegui abrir a lista de produtos.'); await ctx.close(); return null; }
  if (/login|passport|signin/i.test(page.url())) {
    console.log('  ⚠️  ' + conta.plataforma + ': a sessao expirou! Rode:  npm run login-' + conta.plataforma);
    await ctx.close(); return null;
  }
  await page.waitForTimeout(9000);

  // rola a página (algumas listas carregam mais ao rolar)
  for (let i = 0; i < 5; i++) {
    const antes = porId.size;
    try { await page.mouse.wheel(0, 2600); } catch (e) {}
    await page.waitForTimeout(2200);
    if (porId.size === antes && i >= 2) break;
  }

  // pede as PRÓXIMAS PÁGINAS repetindo a mesma chamada com página maior
  // (é assim que pegamos o catálogo inteiro, não só a primeira página)
  if (chamada) {
    const trocaPagina = (url, n, tamanho) => url
      .replace(/([?&](?:page_number|page_no|page|current_page)=)\d+/i, '$1' + n)
      .replace(/([?&](?:page_size|size|limit|count)=)\d+/i, '$1' + tamanho);
    const temPag = /[?&](page_number|page_no|page|current_page)=\d+/i.test(chamada);
    for (let n = 2; n <= 25; n++) {
      const antes = porId.size;
      const alvo = temPag ? trocaPagina(chamada, n, 100) : trocaPagina(chamada, n, 100 * n);
      try {
        const r = await page.request.fetch(alvo, { timeout: 20000 });
        const j = await r.json();
        const lidos = conta.plataforma === 'tiktok' ? leTikTok(j) : leShopee(j);
        lidos.forEach((p) => porId.set(p.id, p));
      } catch (e) { break; }
      if (porId.size === antes) break; // não veio produto novo: acabou o catálogo
      await page.waitForTimeout(700);
      if (!temPag) break; // sem paginação na URL, uma passada maior já basta
    }
  }

  const produtos = Array.from(porId.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  await ctx.close();
  return { produtos: produtos, conta: nomeConta };
}

async function volta(browser) {
  const cache = {};
  for (const conta of CONTAS) {
    const r = await lerLoja(browser, conta);
    if (!r) continue;
    const { produtos, conta: nomeConta } = r;
    if (!produtos.length) { console.log('  ' + conta.plataforma + ': nenhum produto lido (a pagina pode ter mudado).'); continue; }
    manda(conta.plataforma, produtos, nomeConta);
    cache[conta.plataforma] = produtos;
    const ex = produtos[0];
    console.log('  ✅ ' + conta.plataforma + (nomeConta ? ' (' + nomeConta + ')' : '') + ': ' + produtos.length
      + ' produto(s). Ex.: ' + ex.nome.slice(0, 40)
      + ' — R$ ' + brl(ex.preco) + (ex.promo ? (' (hoje por R$ ' + brl(ex.promo) + ')') : ''));
  }
  try { fs.writeFileSync(ARQ_CACHE, JSON.stringify(cache, null, 1)); } catch (e) {}
}

async function principal() {
  console.log('\n  DuoLive · Robô de produtos (só leitura). Lendo o catálogo das suas lojas...');
  console.log('  Mandando para: ' + CONECTOR + '\n');
  let browser;
  try { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
  catch (e) { try { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }
    catch (e2) { console.log('  Instale o Google Chrome e tente de novo.'); process.exit(1); } }

  await volta(browser);
  if (UMA_VEZ) { await browser.close(); console.log('\n  Pronto.'); process.exit(0); }
  console.log('\n  Vou reler a cada ' + Math.round(INTERVALO / 60000) + ' min. (Ctrl+C para parar.)\n');
  setInterval(() => { volta(browser).catch(() => {}); }, INTERVALO);
}

if (require.main === module) principal();
module.exports = { leTikTok: leTikTok, leShopee: leShopee };
