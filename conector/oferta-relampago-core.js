// DuoLive · Núcleo da Oferta Relâmpago (⚡)
//
// Funções que CRIAM/RENOVAM a ⚡ nativa do TikTok usando uma PÁGINA já aberta no
// Console de LIVE. A chamada é assinada de DENTRO da página (o JS do TikTok assina
// sozinho — provado 2026-08-11). Assim, tanto o robô dedicado quanto o robô de
// VENDAS (que já fica no console durante a live) podem criar a ⚡ na MESMA sessão,
// sem abrir uma segunda aba — é isso que evita o conflito de sessão que derruba a
// live. A ⚡ só existe com a LIVE no ar (a API de SKUs só responde durante a live).

const http = require('http');
const https = require('https');
const { URL } = require('url');

const slug = (s) => String(s).normalize('NFD').replace(/[^\x00-\x7F]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const brl = (n) => (+n || 0).toFixed(2).replace('.', ',');

// chamada assinada, feita de DENTRO da página
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
function montaCorpo(authorId, prod, skus, dur) {
  const rel = [];
  skus.forEach((s) => {
    if (!s.estoque) return;
    const preco = (prod.excecoes[slug(s.nome)] != null) ? prod.excecoes[slug(s.nome)] : prod.conjunto;
    if (preco == null) return;
    rel.push({ spu_id: prod.produto_id, sku_id: s.sku_id, promotion_benefit: { benefit_type: 1, benefit_value: { value: (+preco).toFixed(2), display_price: brl(preco) } } });
  });
  if (!rel.length) return null;
  return { corpo: { promotion: [{ promotion_base: { promotion_meta: { title: ('DuoLive ' + (prod.nome || '')).slice(0, 30), launch_mode: 1 }, promotion_type: 3, promotion_level: 2, promotion_time: { duration: dur || 900, preheat_duration: 10 } }, sku_promotion_relation_list: rel, spu_promotion_relation: { spu_id: prod.produto_id } }], author_id: authorId, device_type_code: 2 }, rel: rel };
}
// cria UMA ⚡ (ensaio se opts.real for falso). opts: {real, dur, tag, log}
async function criar(page, authorId, prod, opts) {
  opts = opts || {}; const diz = opts.log || (() => {}); const tag = opts.tag || '';
  const skus = await skusDe(page, prod.produto_id);
  if (!skus.length) { diz('  ⚠️  ' + tag + (prod.nome || prod.produto_id) + ': sem SKUs (a live está no ar?)'); return null; }
  const m = montaCorpo(authorId, prod, skus, opts.dur);
  if (!m) { diz('  ⚠️  ' + tag + (prod.nome || prod.produto_id) + ': nenhum preço aplicável (falta o conjunto?)'); return null; }
  const precos = m.rel.map((r) => r.promotion_benefit.benefit_value.display_price);
  if (!opts.real) { diz('  🧪 ' + tag + (prod.nome || prod.produto_id) + ' → ' + m.rel.length + ' variações (' + precos.join(' / ') + ') — ENSAIO, não enviei'); return { ensaio: true }; }
  const r = await api(page, '/api/v1/live_promotion/flash_sale/create', 'POST', m.corpo);
  if (r.json && r.json.code === 0) { const pid = r.json.data && r.json.data.product_to_promotion_id_map && r.json.data.product_to_promotion_id_map[prod.produto_id]; diz('  ⚡ ' + tag + (prod.nome || prod.produto_id) + ' → CRIADA (' + pid + ')'); return { promotion_id: pid }; }
  diz('  ❌ ' + tag + (prod.nome || prod.produto_id) + ': falhou — code=' + (r.json && r.json.code) + ' msg="' + (r.json ? r.json.message : (r.erro || '')) + '" resp=' + String(r.texto || '').slice(0, 160));
  return null;
}
async function listarAtivas(page) {
  const r = await api(page, '/api/v1/live_promotion/flash_sale/product_list', 'POST', { promotion_type: 3, need_sku_info: false, room_id: '', page_info: { page_no: 1, page_size: 50 }, promotion_product_condition: {} });
  return (r.json && r.json.data && r.json.data.promotion_product_list) || [];
}
// confere quais produtos estão SEM ⚡ ativa e cria (duplica) só esses. Retorna quantos criou.
async function reporOfertas(page, authorId, produtos, opts) {
  opts = opts || {};
  let ativos = [];
  try { ativos = (await listarAtivas(page)).map((x) => String((x.base && x.base.product_id) || x.product_id || '')); } catch (e) {}
  const pendentes = (produtos || []).filter((p) => !ativos.includes(String(p.produto_id)));
  if (!pendentes.length) return 0;
  for (let i = 0; i < pendentes.length; i++) {
    await criar(page, authorId, pendentes[i], opts);
    if (i < pendentes.length - 1 && opts.stagger) await new Promise((r) => setTimeout(r, opts.stagger));
  }
  return pendentes.length;
}

// ---------- ofertas GLOBAIS: casa os produtos da loja AO VIVO pelo NOME ----------
// catálogo da loja logada nesta página (nome -> produto_id), via shop_product/search
async function catalogoDaLoja(page) {
  const out = [];
  for (let pg = 1; pg <= 4; pg++) {
    const r = await api(page, '/api/v1/streamer_desktop/shop_product/search?page_number=' + pg + '&page_size=50&use_streamer_products=false&is_not_for_sale_status=1', 'GET', null);
    const arr = (r.json && r.json.data && (r.json.data.streamer_products || r.json.data.products)) || [];
    arr.forEach((p) => out.push({ id: String(p.product_id), nome: String(p.title || '') }));
    if (arr.length < 50) break;
  }
  return out;
}
// catálogo COM os Seller SKUs (skus[].name) — a base do casamento EXATO entre lojas.
// O SKU é o mesmo código nas lojas-espelho; casar por ele acabou com o chute por nome
// (que já aplicou preço no produto errado — o caso do 24,99 de 2026-08-24).
async function catalogoComSkus(page) {
  const out = [];
  for (let pg = 1; pg <= 4; pg++) {
    const r = await api(page, '/api/v1/streamer_desktop/shop_product/search?page_number=' + pg + '&page_size=50&use_streamer_products=false&is_not_for_sale_status=1', 'GET', null);
    const arr = (r.json && r.json.data && (r.json.data.streamer_products || r.json.data.products)) || [];
    arr.forEach((p) => out.push({
      id: String(p.product_id),
      nome: String(p.title || ''),
      skus: Array.from(new Set((p.skus || []).map((s) => String((s && s.name) || '').trim().toUpperCase()).filter(Boolean))),
    }));
    if (arr.length < 50) break;
  }
  return out;
}
// NÚCLEO do nome: primeiras N palavras significativas (tira "de/com/para" e palavras de 1 letra).
// Assim "Kit Cozinha Desenhos 3P – Tear Boho, Tapete…" e "Kit Cozinha Desenhos 3P Bohochic…"
// casam pelo começo, mesmo com descrições diferentes no fim.
var STOP = { de: 1, da: 1, do: 1, das: 1, dos: 1, para: 1, pra: 1, com: 1, e: 1, o: 1, a: 1, em: 1, no: 1, na: 1 };
function nucleoNome(nome, n) {
  return slug(nome).split('-').filter(function (w) { return w && w.length > 1 && !STOP[w]; }).slice(0, n).join('-');
}
// acha o produto_id DESTA loja para o nome da oferta: prefixo direto, senão núcleo (4 depois 3 palavras)
function acheId(porNome, nome) {
  var k = slug(nome); if (porNome[k]) return porNome[k];
  var chaves = Object.keys(porNome);
  var hit = chaves.find(function (c) { return c.startsWith(k) || k.startsWith(c); });
  if (hit) return porNome[hit];
  for (var _i = 0, ns = [4, 3]; _i < ns.length; _i++) {
    var alvo = nucleoNome(nome, ns[_i]);
    if (alvo.split('-').length < 3) continue; // núcleo curto demais = arriscado (evita falso positivo)
    hit = chaves.find(function (c) { var cn = nucleoNome(c, ns[_i]); return cn === alvo || cn.startsWith(alvo) || alvo.startsWith(cn); });
    if (hit) return porNome[hit];
  }
  return null;
}
// cria/renova a ⚡ na loja AO VIVO desta página, casando as ofertas (lista mestre) pelo NOME
async function reporOfertasGlobal(page, authorId, ofertas, opts) {
  opts = opts || {}; const diz = opts.log || (() => {});
  let cat = []; try { cat = await catalogoDaLoja(page); } catch (e) {}
  if (!cat.length) { diz('  ⚠️  ' + (opts.tag || '') + 'não li o catálogo da loja (a live está no ar?)'); return 0; }
  const porNome = {}; cat.forEach((p) => { if (p.nome) porNome[slug(p.nome)] = p.id; });
  diz('  ⚡' + (opts.tag || '') + 'catálogo da loja: ' + cat.length + ' produtos (ex.: "' + String((cat[0] && cat[0].nome) || '').slice(0, 34) + '")');
  let ativos = [];
  try { ativos = (await listarAtivas(page)).map((x) => String((x.base && x.base.product_id) || x.product_id || '')); } catch (e) {}
  // separa ANTES: o que não casou, o que já tem ⚡ ativa (inclusive as criadas NA MÃO —
  // o robô nunca substitui uma ativa) e o que está pendente de criar.
  const pendentes = []; let naoCasou = 0, jaAtivas = 0;
  for (const of of (ofertas || [])) {
    // id_exato = casamento por SKU feito no robô (sem chute). O acheId por nome só
    // sobrevive como reserva pra chamadas antigas que não mandam id_exato.
    const id = of.id_exato || acheId(porNome, of.nome);
    if (!id) { naoCasou++; diz('  ·  ' + (opts.tag || '') + '"' + String(of.nome).slice(0, 30) + '" não existe nesta loja — pulei'); continue; }
    if (ativos.includes(String(id))) { jaAtivas++; continue; }
    pendentes.push({ produto_id: id, nome: of.nome, conjunto: of.conjunto, excecoes: of.excecoes });
  }
  diz('  ⚡' + (opts.tag || '') + 'resumo: ' + (ofertas || []).length + ' na lista · ' + jaAtivas + ' já com ⚡ ativa (inclui manuais) · ' + naoCasou + ' não casou o nome · ' + pendentes.length + ' pra criar agora');
  let criadas = 0;
  for (let i = 0; i < pendentes.length; i++) {
    await criar(page, authorId, pendentes[i], opts);
    criadas++;
    if (opts.stagger && i < pendentes.length - 1) await new Promise((r) => setTimeout(r, opts.stagger)); // não dorme depois da última
  }
  return criadas;
}

// ---------- conector (HTTP): preços cadastrados + interruptor + trava de live ----------
function pega(u, token) {
  return new Promise((ok) => {
    try {
      const url = new URL(u); const lib = url.protocol === 'https:' ? https : http;
      const opt = token ? { headers: { 'x-duolive-token': token } } : {};
      lib.get(url, opt, (r) => { let c = ''; r.on('data', (d) => { c += d; }); r.on('end', () => { try { ok(JSON.parse(c)); } catch (e) { ok(null); } }); }).on('error', () => ok(null));
    } catch (e) { ok(null); }
  });
}
// lê /descontos e devolve [{produto_id, nome, conjunto, excecoes}]
async function configDoPainel(conector, token, loja) {
  const base = String(conector || '').replace(/\/+$/, '');
  const d = await pega(base + '/descontos?loja=' + encodeURIComponent(loja), token);
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
async function autoLigada(conector, token, loja) {
  const base = String(conector || '').replace(/\/+$/, '');
  const r = await pega(base + '/oferta-auto?loja=' + encodeURIComponent(loja), token);
  return !!(r && r.ligado);
}
// TRAVA DE PREÇOS: os valores atuais conferem com o selo do ADM? Se não conferem,
// a ⚡ é BLOQUEADA (ninguém cria nada até o ADM aprovar no painel). Conector antigo
// (sem a rota) = sem trava — devolve ok pra não parar o mundo.
async function precosConferem(conector, token) {
  const base = String(conector || '').replace(/\/+$/, '');
  const r = await pega(base + '/precos-conferencia', token);
  if (!r || !r.ok) return { confere: true, divergencias: [] };
  return { confere: r.confere !== false, divergencias: r.divergencias || [] };
}
// a ESCOLHA desta LIVE (painel "Minhas ofertas"): quais produtos a vendedora que está
// NESTA loja marcou pra trabalhar agora + a fixada. Cada live tem a sua escolha, feita
// na hora. Só a escolha — o PREÇO é sempre o do ADM.
// Devolve { ofertas:[produto_ids], fixada } ou null (nada marcado / conector antigo).
async function escolhaDaLive(conector, token, loja) {
  const base = String(conector || '').replace(/\/+$/, '');
  const r = await pega(base + '/vendedora-ofertas?loja=' + encodeURIComponent(loja), token);
  if (!r || !r.ok) return null;
  const ofertas = (r.ofertas || []).map(String);
  if (!ofertas.length) return null;
  return { ofertas: ofertas, fixada: r.fixada ? String(r.fixada) : null };
}
async function liveNoAr(conector, token, loja) {
  const base = String(conector || '').replace(/\/+$/, '');
  const r = await pega(base + '/ao-vivo?loja=' + encodeURIComponent(loja), token);
  return !!(r && r.aoVivo);
}

module.exports = { api, skusDe, montaCorpo, criar, listarAtivas, reporOfertas, reporOfertasGlobal, catalogoDaLoja, catalogoComSkus, acheId, configDoPainel, autoLigada, precosConferem, escolhaDaLive, liveNoAr, slug, brl };
