// DuoLive · Robô da Oferta Relâmpago NATIVA (a ⚡ que os espectadores veem AO VIVO)
//
// Cria / lista / encerra a ⚡ pela API do Console de LIVE, ASSINADA de DENTRO da
// página (page.evaluate fetch — o JS do TikTok assina sozinho, provado 2026-08-11).
// Roda pra TODAS as lojas ao mesmo tempo (uma aba por loja, cada uma com a sua
// sessão). Lê o preço conjunto+exceção do painel (/descontos por loja), casa
// variação↔SKU pelo nome e monta a oferta.
//
// AGENDADOR (--rodadas): cada oferta dura ~10 min; QUANDO UMA ACABA, ele
// re-dispara só ela (o seu "duplicar", automático). Só dispara com a live no ar.
//
// ENSAIO por padrão (não cria). Pra valer:  set DUOLIVE_OFERTA_REAL=1
// Uso:  npm run oferta-relampago -- --rodadas            (as 4 lojas)
//       npm run oferta-relampago -- monaco --rodadas     (uma loja)
//       npm run oferta-relampago -- --teste              (ensaio 1 produto)

const { abreNavegador } = require('./navegador.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const REAL = process.env.DUOLIVE_OFERTA_REAL === '1';
const TESTE = process.argv.includes('--teste');
const RODADAS = process.argv.includes('--rodadas');
const FORCA = process.argv.includes('--forca-sem-live');       // só testes: ignora a trava de "live no ar"
const DUR = +(process.env.DUOLIVE_OFERTA_DUR || 600);          // duração de cada oferta (s) — 600 = 10 min
const STAGGER_S = +(process.env.DUOLIVE_OFERTA_INTERVALO || 60); // segundos entre um disparo e o próximo
const CHECK_S = +(process.env.DUOLIVE_OFERTA_CHECK || 45);     // de quanto em quanto confere se alguma acabou
const LOJAS = TESTE ? ['monaco'] : (ARGS.length ? ARGS : ['monaco', 'fast', 'mania', 'bellini']);

const slug = (s) => String(s).normalize('NFD').replace(/[^\x00-\x7F]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const brl = (n) => (+n || 0).toFixed(2).replace('.', ',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hora = () => new Date().toLocaleTimeString('pt-BR');

// ---------- conector: config de preços (conjunto + exceção) + trava de live ----------
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
async function configDoPainel(loja) {
  const base = enderecoConector().replace(/\/+$/, '');
  const d = await pega(base + '/descontos?loja=' + encodeURIComponent(loja));
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
async function liveNoAr(loja) {
  if (FORCA) return true;
  const base = enderecoConector().replace(/\/+$/, '');
  const c = await pega(base + '/conta?loja=' + encodeURIComponent(loja));
  return !!(c && c.aoVivo);
}
// interruptor do painel: o ADM liga/desliga a automação por loja (o robô respeita)
async function autoLigada(loja) {
  if (FORCA) return true;
  const base = enderecoConector().replace(/\/+$/, '');
  const r = await pega(base + '/oferta-auto?loja=' + encodeURIComponent(loja));
  return !!(r && r.ligado);
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
async function skusDe(page, produtoId) {
  const r = await api(page, '/api/v1/live_promotion/flash_sale/get_params?product_ids=' + produtoId, 'GET', null);
  const pp = r.json && r.json.data && r.json.data.product_params && r.json.data.product_params[0];
  return ((pp && pp.live_flash_sale_sku_params) || []).map((s) => ({ sku_id: s.sku_id, nome: s.sku_name, estoque: s.open_stock }));
}
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
async function criar(page, authorId, prod, tag) {
  const skus = await skusDe(page, prod.produto_id);
  if (!skus.length) { console.log('  ⚠️  ' + tag + (prod.nome || prod.produto_id) + ': sem SKUs (a live está no ar?)'); return null; }
  const m = montaCorpo(authorId, prod, skus);
  if (!m) { console.log('  ⚠️  ' + tag + (prod.nome || prod.produto_id) + ': nenhum preço aplicável (falta o conjunto?)'); return null; }
  const precos = m.rel.map((r) => r.promotion_benefit.benefit_value.display_price);
  if (!REAL) { console.log('  🧪 ' + tag + (prod.nome || prod.produto_id) + ' → ' + m.rel.length + ' variações (' + precos.join(' / ') + ') — ENSAIO, não enviei'); return { ensaio: true }; }
  const r = await api(page, '/api/v1/live_promotion/flash_sale/create', 'POST', m.corpo);
  if (r.json && r.json.code === 0) { const pid = r.json.data && r.json.data.product_to_promotion_id_map && r.json.data.product_to_promotion_id_map[prod.produto_id]; console.log('  ⚡ ' + tag + (prod.nome || prod.produto_id) + ' → CRIADA (' + pid + ')'); return { promotion_id: pid }; }
  console.log('  ❌ ' + tag + (prod.nome || prod.produto_id) + ': falhou — ' + (r.json ? r.json.message : (r.erro || r.texto)));
  return null;
}
async function listarAtivas(page) {
  const r = await api(page, '/api/v1/live_promotion/flash_sale/product_list', 'POST', { promotion_type: 3, need_sku_info: false, room_id: '', page_info: { page_no: 1, page_size: 50 }, promotion_product_condition: {} });
  return (r.json && r.json.data && r.json.data.promotion_product_list) || [];
}
async function encerrar(page, promotionId, produtoId) {
  const r = await api(page, '/api/v1/live_promotion/flash_sale/update_status', 'POST', { update_promotion_status_cells: [{ promotion_id: promotionId, parent_promotion_id: '0', current_promotion_status: 2, target_promotion_status: 6, product_id: produtoId }], room_id: '', promotion_type: 3, device_type_code: 2 });
  return !!(r.json && r.json.code === 0);
}

// confere quais produtos estão SEM oferta ativa e dispara (duplica) só esses
async function reporOfertas(conta) {
  let ativos = [];
  try { ativos = (await listarAtivas(conta.page)).map((x) => String((x.base && x.base.product_id) || x.product_id || '')); } catch (e) {}
  const pendentes = conta.produtos.filter((p) => !ativos.includes(String(p.produto_id)));
  if (!pendentes.length) return;
  const tag = '🏪' + conta.loja + ' · ';
  console.log('\n  ▶️  ' + hora() + ' · ' + conta.loja + ' — ' + pendentes.length + ' oferta(s) pra entrar/renovar');
  for (let i = 0; i < pendentes.length; i++) {
    await criar(conta.page, conta.authorId, pendentes[i], tag);
    if (i < pendentes.length - 1) await sleep(STAGGER_S * 1000); // espaça os disparos
  }
}

// agendador multi-loja: cada oferta dura DUR; quando UMA acaba, re-dispara só ela
async function agendador(contas) {
  console.log('  🔁 AGENDADOR ligado — ' + contas.length + ' loja(s) · cada oferta dura ~' + Math.round(DUR / 60) + ' min · quando uma acaba ele duplica sozinho (confere a cada ' + CHECK_S + 's)');
  console.log('  (cada loja só dispara com a SUA live no ar; Ctrl+C para parar)\n');
  for (;;) {
    for (const c of contas) {
      let ligada = true; try { ligada = await autoLigada(c.loja); } catch (e) {}
      if (!ligada) continue;                          // o painel desligou a automação desta loja
      let vivo = true; try { vivo = await liveNoAr(c.loja); } catch (e) {}
      if (!vivo) continue;                            // a live desta loja não está no ar
      try { await reporOfertas(c); } catch (e) { console.log('  (' + c.loja + ' erro: ' + String(e.message).slice(0, 60) + ')'); }
    }
    await sleep(CHECK_S * 1000);
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

async function abreConta(browser, loja) {
  const sess = path.join(__dirname, 'sessao-console-' + loja + '.json');
  if (!fs.existsSync(sess)) { console.log('  ' + loja + ': sem sessao-console-' + loja + '.json — pulo'); return null; }
  const produtos = TESTE ? [{ produto_id: '1732315379028756473', nome: 'Jogo de Banheiro Mandacaru', conjunto: 27.99, excecoes: { cru: 24.99 } }] : await configDoPainel(loja);
  if (!produtos.length) { console.log('  ' + loja + ': sem preços cadastrados nas "Ofertas fixas" — pulo'); return null; }
  const ctx = await browser.newContext({ storageState: sess, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  const pAuthor = pegaAuthorId(page);
  await page.goto('https://shop.tiktok.com/streamer/live/product/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  if (/login|passport/i.test(page.url())) { console.log('  ' + loja + ': SESSÃO EXPIROU — puxe fresca do LiveDash. Pulo.'); await ctx.close(); return null; }
  await page.waitForTimeout(8000);
  const authorId = await pAuthor;
  console.log('  ✅ ' + loja + ': ' + produtos.length + ' produto(s)' + (authorId ? ' · author ' + authorId : ' · ⚠️ sem author_id'));
  return { loja, page, authorId, produtos };
}

async function principal() {
  console.log('\n  DuoLive · Robô da Oferta Relâmpago NATIVA');
  console.log('  ' + (REAL ? '⚡ MODO REAL — CRIA as ofertas de verdade' : '🧪 MODO ENSAIO — só mostra, não cria') + ' · lojas: ' + LOJAS.join(', '));
  console.log('  (abre uma janela do navegador — o TikTok bloqueia o modo invisível)\n');

  const browser = await abreNavegador(false);
  const contas = [];
  for (const loja of LOJAS) { const c = await abreConta(browser, loja); if (c) contas.push(c); }
  if (!contas.length) { console.log('\n  Nenhuma loja pronta (sem sessão ou sem config). Nada a fazer.'); await browser.close(); process.exit(0); }
  console.log('');

  if (RODADAS) {
    process.on('SIGINT', async () => { console.log('\n  encerrando o agendador...'); try { await browser.close(); } catch (e) {} process.exit(0); });
    await agendador(contas);
  } else {
    for (const c of contas) { await reporOfertas(c); }
    console.log('\n  pronto.' + (REAL ? '  (as ofertas expiram sozinhas em ~' + Math.round(DUR / 60) + ' min)' : ''));
    await browser.close();
  }
}

if (require.main === module) principal().catch((e) => { console.log('ERRO', e.message); process.exit(1); });
module.exports = { montaCorpo, skusDe, criar, listarAtivas, encerrar, reporOfertas };
