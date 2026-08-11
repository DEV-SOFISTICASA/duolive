// DuoLive · Robô da Oferta Relâmpago NATIVA (a ⚡ que os espectadores veem AO VIVO)
//
// Cria / lista / encerra a ⚡ Oferta Relâmpago pela API do Console de LIVE,
// ASSINADA de DENTRO da página (o JS do TikTok assina sozinho — provado em
// 2026-08-11). Lê o preço (conjunto + exceção por variação) do painel
// (/descontos), casa cada variação com o SKU real e monta a oferta.
//
// ENSAIO por padrão: monta o pedido e mostra o que ENVIARIA, sem criar nada.
// Para valer de verdade:  set DUOLIVE_OFERTA_REAL=1  &&  npm run oferta-relampago -- monaco
// A ⚡ só aparece com a LIVE no ar (fora da live, o get_params volta vazio).
//
// Uso:  npm run oferta-relampago -- monaco            (ensaio, lê o config do painel)
//       npm run oferta-relampago -- monaco --teste    (ensaio com Banheiro Mandacaru fixo)

const { abreNavegador } = require('./navegador.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const LOJA = ARGS[0] || process.env.DUOLIVE_LOJA || 'monaco';
const REAL = process.env.DUOLIVE_OFERTA_REAL === '1';
const TESTE = process.argv.includes('--teste');
const ROUND_MIN = +(process.env.DUOLIVE_OFERTA_RODADA || 10);    // nova rodada a cada X min
const STAGGER_S = +(process.env.DUOLIVE_OFERTA_INTERVALO || 60); // segundos entre uma oferta e a próxima
const DUR = +(process.env.DUOLIVE_OFERTA_DUR || ROUND_MIN * 60); // duração de cada oferta (s); padrão = 1 rodada
const RODADAS = process.argv.includes('--rodadas');             // liga o agendador (senão, dispara uma vez só)
const FORCA = process.argv.includes('--forca-sem-live');        // só testes: ignora a trava de "live no ar"
const SESS = path.join(__dirname, 'sessao-console-' + LOJA + '.json');

const slug = (s) => String(s).normalize('NFD').replace(/[^\x00-\x7F]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const brl = (n) => (+n || 0).toFixed(2).replace('.', ',');

// ---------- config de preços (conjunto + exceção) vindo do painel ----------
function enderecoConector() {
  try { const t = fs.readFileSync(path.join(__dirname, 'conector.txt'), 'utf8').split('\n')[0].trim(); if (/^https?:/.test(t)) return t; } catch (e) {}
  return process.env.DUOLIVE_CONECTOR || 'https://duolive-conector-jipn.onrender.com';
}
function tokenConector() { try { const l = fs.readFileSync(path.join(__dirname, 'conector.txt'), 'utf8').split('\n').map((x) => x.trim()); return l[1] || process.env.DUOLIVE_TOKEN || ''; } catch (e) { return process.env.DUOLIVE_TOKEN || ''; } }
const TOKEN = tokenConector();
function pega(u) {
  return new Promise((ok) => {
    const url = new URL(u); const lib = url.protocol === 'https:' ? https : http;
    const opt = TOKEN ? { headers: { 'x-duolive-token': TOKEN } } : {};
    lib.get(url, opt, (r) => { let c = ''; r.on('data', (d) => { c += d; }); r.on('end', () => { try { ok(JSON.parse(c)); } catch (e) { ok(null); } }); }).on('error', () => ok(null));
  });
}
async function liveNoAr() {
  if (FORCA) return true;
  const base = enderecoConector().replace(/\/+$/, '');
  const c = await pega(base + '/conta?loja=' + encodeURIComponent(LOJA));
  return !!(c && c.aoVivo);
}
async function configDoPainel() {
  const base = enderecoConector().replace(/\/+$/, '');
  const d = await pega(base + '/descontos?loja=' + encodeURIComponent(LOJA));
  const rows = (d && d.descontos) || [];
  const porProd = {};
  rows.forEach((o) => {
    const id = String(o.produto_id);
    if (!porProd[id]) porProd[id] = { produto_id: id, nome: o.nome, conjunto: null, excecoes: {} };
    if (o.sku) { if (o.valor_desconto != null) porProd[id].excecoes[slug(o.variacao_nome || o.sku)] = +o.valor_desconto; }
    else if (o.valor_desconto != null) porProd[id].conjunto = +o.valor_desconto;
  });
  return Object.values(porProd).filter((p) => p.conjunto != null || Object.keys(p.excecoes).length);
}

// ---------- chamada assinada, feita de DENTRO da página ----------
async function api(page, caminho, metodo, corpo) {
  return page.evaluate(async ({ caminho, metodo, corpo }) => {
    const base = new URLSearchParams({ user_language: 'pt-BR', locale: 'pt-BR', aid: '253642', app_name: 'i18n_ecom_alliance', device_platform: 'web', cookie_enabled: 'true', screen_width: '1280', screen_height: '720', browser_language: 'pt-BR', browser_platform: 'Win32', browser_name: 'Mozilla', browser_version: '5.0', browser_online: 'true', timezone_name: 'America/Sao_Paulo', page_scene: '0', carrier_region: 'br' });
    const url = caminho + (caminho.includes('?') ? '&' : '?') + base.toString();
    const opt = { method: metodo, headers: { 'content-type': 'application/json' } };
    if (corpo) opt.body = JSON.stringify(corpo);
    try { const r = await fetch(url, opt); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, json: j, texto: t.slice(0, 400) }; }
    catch (e) { return { status: 0, erro: String(e.message) }; }
  }, { caminho, metodo, corpo });
}

// SKUs (variações) de um produto — nome + id + estoque
async function skusDe(page, produtoId) {
  const r = await api(page, '/api/v1/live_promotion/flash_sale/get_params?product_ids=' + produtoId, 'GET', null);
  const pp = r.json && r.json.data && r.json.data.product_params && r.json.data.product_params[0];
  return ((pp && pp.live_flash_sale_sku_params) || []).map((s) => ({ sku_id: s.sku_id, nome: s.sku_name, estoque: s.open_stock }));
}

// monta o corpo da oferta de UM produto (conjunto + exceção por variação, pula estoque 0)
function montaCorpo(authorId, prod, skus) {
  const rel = [];
  skus.forEach((s) => {
    if (!s.estoque) return;
    const preco = (prod.excecoes[slug(s.nome)] != null) ? prod.excecoes[slug(s.nome)] : prod.conjunto;
    if (preco == null) return;
    rel.push({ spu_id: prod.produto_id, sku_id: s.sku_id, promotion_benefit: { benefit_type: 1, benefit_value: { value: (+preco).toFixed(2), display_price: brl(preco) } } });
  });
  if (!rel.length) return null;
  return { corpo: { promotion: [{ promotion_base: { promotion_meta: { title: ('DuoLive ' + (prod.nome || '')).slice(0, 30), launch_mode: 1 }, promotion_type: 3, promotion_level: 2, promotion_time: { duration: DUR, preheat_duration: 10 } }, sku_promotion_relation_list: rel, spu_promotion_relation: { spu_id: prod.produto_id } }], author_id: authorId, device_type_code: 2 }, rel: rel };
}

async function criar(page, authorId, prod) {
  const skus = await skusDe(page, prod.produto_id);
  if (!skus.length) { console.log('  ⚠️  ' + (prod.nome || prod.produto_id) + ': sem SKUs (a live está no ar?)'); return null; }
  const m = montaCorpo(authorId, prod, skus);
  if (!m) { console.log('  ⚠️  ' + (prod.nome || prod.produto_id) + ': nenhum preço aplicável (falta o conjunto?)'); return null; }
  const precos = m.rel.map((r) => r.promotion_benefit.benefit_value.display_price);
  if (!REAL) { console.log('  🧪 ENSAIO · ' + (prod.nome || prod.produto_id) + ' → ' + m.rel.length + ' variações (' + precos.join(' / ') + ') — NÃO enviei'); return { ensaio: true }; }
  const r = await api(page, '/api/v1/live_promotion/flash_sale/create', 'POST', m.corpo);
  if (r.json && r.json.code === 0) {
    const pid = r.json.data && r.json.data.product_to_promotion_id_map && r.json.data.product_to_promotion_id_map[prod.produto_id];
    console.log('  ⚡ ' + (prod.nome || prod.produto_id) + ' → CRIADA (promotion_id ' + pid + ')');
    return { promotion_id: pid };
  }
  console.log('  ❌ ' + (prod.nome || prod.produto_id) + ': falhou — ' + (r.json ? r.json.message : (r.erro || r.texto)));
  return null;
}

// lista as ofertas ativas (para gerenciar/encerrar)
async function listarAtivas(page) {
  const r = await api(page, '/api/v1/live_promotion/flash_sale/product_list', 'POST', { promotion_type: 3, need_sku_info: false, room_id: '', page_info: { page_no: 1, page_size: 50 }, promotion_product_condition: {} });
  return (r.json && r.json.data && r.json.data.promotion_product_list) || [];
}

// encerra (exclui) uma oferta — target_promotion_status 6
async function encerrar(page, promotionId, produtoId) {
  const r = await api(page, '/api/v1/live_promotion/flash_sale/update_status', 'POST', { update_promotion_status_cells: [{ promotion_id: promotionId, parent_promotion_id: '0', current_promotion_status: 2, target_promotion_status: 6, product_id: produtoId }], room_id: '', promotion_type: 3, device_type_code: 2 });
  return !!(r.json && r.json.code === 0);
}

// uma rodada: cria a oferta de cada produto (pulando os que já têm oferta ativa)
async function rodada(page, authorId, produtos) {
  let ativos = [];
  try { ativos = (await listarAtivas(page)).map((x) => String((x.base && x.base.product_id) || x.product_id || '')); } catch (e) {}
  for (let i = 0; i < produtos.length; i++) {
    const p = produtos[i];
    if (ativos.includes(String(p.produto_id))) { console.log('  ⏭️  ' + (p.nome || p.produto_id) + ': já tem oferta ativa — pulo'); continue; }
    await criar(page, authorId, p);
    if (i < produtos.length - 1) await page.waitForTimeout(STAGGER_S * 1000); // 1 min entre uma oferta e a próxima
  }
}

// agendador: nova rodada a cada ROUND_MIN, só com a live no ar
async function agendador(page, authorId, produtos) {
  console.log('  🔁 AGENDADOR ligado — rodada a cada ' + ROUND_MIN + ' min · ' + STAGGER_S + 's entre ofertas · cada oferta dura ~' + Math.round(DUR / 60) + ' min');
  console.log('  (fora da live ele fica esperando; Ctrl+C para parar)\n');
  for (;;) {
    let vivo = true;
    try { vivo = await liveNoAr(); } catch (e) {}
    if (!vivo) { process.stdout.write('.'); await page.waitForTimeout(30000); continue; }
    console.log('\n  ▶️  ' + new Date().toLocaleTimeString('pt-BR') + ' — nova rodada (' + produtos.length + ' produto(s))');
    try { await rodada(page, authorId, produtos); } catch (e) { console.log('  (erro na rodada: ' + String(e.message).slice(0, 70) + ')'); }
    console.log('  ⏱️  próxima rodada em ' + ROUND_MIN + ' min.');
    await page.waitForTimeout(ROUND_MIN * 60000);
  }
}

// author_id: pegamos do próprio request que a página faz ao carregar
function pegaAuthorId(page) {
  return new Promise((ok) => {
    let feito = false;
    page.on('request', (req) => {
      if (feito) return;
      try { const b = req.postData(); if (b && /author_id/.test(b)) { const m = JSON.parse(b); if (m.author_id && String(m.author_id) !== '0') { feito = true; ok(String(m.author_id)); } } } catch (e) {}
    });
    setTimeout(() => { if (!feito) ok(''); }, 16000);
  });
}

async function principal() {
  console.log('\n  DuoLive · Robô da Oferta Relâmpago NATIVA — loja: ' + LOJA);
  console.log('  ' + (REAL ? '⚡ MODO REAL — vai CRIAR as ofertas de verdade' : '🧪 MODO ENSAIO — só mostra o que enviaria, não cria') + '\n');
  if (!fs.existsSync(SESS)) { console.log('  sem sessao-console-' + LOJA + '.json — puxe do LiveDash'); process.exit(1); }

  let produtos;
  if (TESTE) { produtos = [{ produto_id: '1732315379028756473', nome: 'Jogo de Banheiro Mandacaru', conjunto: 27.99, excecoes: { cru: 24.99 } }]; console.log('  (--teste: Banheiro Mandacaru 27,99 + Cru 24,99)'); }
  else { produtos = await configDoPainel(); }
  if (!produtos.length) { console.log('  Nenhum produto configurado nas "Ofertas fixas" do painel. Cadastre os preços e rode de novo.'); process.exit(0); }
  console.log('  ' + produtos.length + ' produto(s) no config.\n');

  const browser = await abreNavegador(false); // headed: TikTok bloqueia invisível
  const ctx = await browser.newContext({ storageState: SESS, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  const pAuthor = pegaAuthorId(page);
  await page.goto('https://shop.tiktok.com/streamer/live/product/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  if (/login|passport/i.test(page.url())) { console.log('  SESSÃO EXPIROU — puxe fresca do LiveDash'); await browser.close(); process.exit(1); }
  await page.waitForTimeout(8000);
  const authorId = await pAuthor;
  console.log(authorId ? '  author_id: ' + authorId + '\n' : '  ⚠️  não peguei o author_id (a criação real pode falhar)\n');

  if (RODADAS) {
    process.on('SIGINT', async () => { console.log('\n  encerrando o agendador...'); try { await browser.close(); } catch (e) {} process.exit(0); });
    await agendador(page, authorId, produtos);
  } else {
    for (const p of produtos) { await criar(page, authorId, p); await page.waitForTimeout(1500); }
    console.log('\n  pronto.' + (REAL ? '  (as ofertas expiram sozinhas em ~' + Math.round(DUR / 60) + ' min)' : ''));
    await browser.close();
  }
}

if (require.main === module) principal().catch((e) => { console.log('ERRO', e.message); process.exit(1); });
module.exports = { montaCorpo, skusDe, criar, listarAtivas, encerrar };
