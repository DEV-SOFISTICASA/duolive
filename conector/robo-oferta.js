// DuoLive · Robô da oferta relâmpago — troca o preço DE VERDADE na loja
//
// Fica de olho nas ofertas lançadas no painel. Quando você lança uma oferta com
// "desconto real" ligado, ele entra na sua loja (com a sessão guardada), troca o
// preço do produto e, quando o tempo acaba (ou você encerra), DEVOLVE o preço
// original. TikTok e Shopee são tratados separadamente — cada loja tem o seu preço.
//
// Pré-requisito:  npm run login-tiktok / npm run login-shopee  +  npm run produtos
// Como usar:      npm run robo-oferta        <- MODO ENSAIO (não salva nada)
//                 set DUOLIVE_OFERTA_REAL=1  <- liga o modo real
//                 npm run robo-oferta
//
// MODO ENSAIO (padrão): faz todo o caminho até o campo de preço e conta o que
// achou, mas NÃO salva. Serve para conferir que está tudo certo antes de mexer
// nos preços de verdade. Rode o ensaio uma vez antes da primeira live.
//
// Segurança: o preço original é guardado em precos-originais.json ANTES de
// qualquer mudança. Se algo der errado no meio da live, rode:
//   npm run robo-oferta -- --restaurar-tudo

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
const REAL = process.env.DUOLIVE_OFERTA_REAL === '1';
const RESTAURAR_TUDO = process.argv.includes('--restaurar-tudo');
const ARQ_ORIGINAIS = path.join(__dirname, 'precos-originais.json');
const ARQ_ENSAIO = path.join(__dirname, 'ensaio-oferta-relatorio.json');
const RITMO = 4000;

const SESSOES = {
  tiktok: path.join(__dirname, 'sessao-tiktok.json'),
  shopee: path.join(__dirname, 'sessao-shopee.json'),
};

// onde fica o campo de preço de cada loja (tentamos os endereços em ordem).
// Nas duas lojas a tela de edição vem dentro de um iframe — por isso procuramos
// o campo em todos os quadros da página.
const EDICAO = {
  tiktok: (p) => [
    'https://seller-br.tiktok.com/product/manage/edit?product_id=' + encodeURIComponent(p.prodId),
    'https://seller-br.tiktok.com/product/edit?product_id=' + encodeURIComponent(p.prodId),
  ],
  shopee: (p) => [
    'https://seller.shopee.com.br/portal/product/' + encodeURIComponent(p.prodId),
    'https://seller.shopee.com.br/portal/product/' + encodeURIComponent(p.prodId) + '/edit',
  ],
};

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

// ---------- memória dos preços originais (sobrevive a reinício) ----------
let originais = {};
try { originais = JSON.parse(fs.readFileSync(ARQ_ORIGINAIS, 'utf8')) || {}; } catch (e) {}
function guardaOriginal(chave, valor) {
  if (originais[chave] != null) return;      // já guardado: não sobrescreve
  originais[chave] = valor;
  try { fs.writeFileSync(ARQ_ORIGINAIS, JSON.stringify(originais, null, 1)); } catch (e) {}
}
function esqueceOriginal(chave) {
  delete originais[chave];
  try { fs.writeFileSync(ARQ_ORIGINAIS, JSON.stringify(originais, null, 1)); } catch (e) {}
}

// ---------- conversa com o conector ----------
function pega(caminho) {
  return new Promise((resolve) => {
    const u = new URL(CONECTOR + caminho);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, (res) => {
      let c = '';
      res.on('data', (d) => { c += d; });
      res.on('end', () => { try { resolve(JSON.parse(c)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}
function avisaEstado(id, estado, erro) {
  const dados = JSON.stringify({ id: id, estado: estado, erro: erro || '' });
  const u = new URL(CONECTOR + '/oferta-estado');
  const lib = u.protocol === 'https:' ? https : http;
  const req = lib.request({
    hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dados) },
  });
  req.on('error', () => {});
  req.end(dados);
}

// ---------- acha o campo de preço na página de edição ----------
// As lojas montam a tela de edição dentro de um IFRAME, então procuramos em
// TODOS os quadros da página, não só no principal. Devolve o quadro + os campos.
function procurarNoQuadro(quadro) {
  return quadro.evaluate(() => {
    function visivel(el) {
      const r = el.getBoundingClientRect();
      return r.width > 30 && r.height > 10;
    }
    const campos = Array.from(document.querySelectorAll('input')).filter(visivel);
    const achados = [];
    campos.forEach((el, i) => {
      const volta = el.closest('div,section,tr,td,label');
      const perto = (volta ? volta.innerText : '').replace(/\s+/g, ' ').slice(0, 120);
      const attr = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.className].join(' ');
      const ehPreco = /pre[çc]o|price|valor|R\$/i.test(perto + ' ' + attr);
      const ehRuido = /estoque|stock|quantidade|quantity|peso|weight|sku|c[óo]digo|dimens|frete|busca|search|pesquis/i.test(perto + ' ' + attr);
      if (ehPreco && !ehRuido) {
        el.setAttribute('data-duolive-preco', String(i));
        achados.push({ indice: i, valor: el.value, contexto: perto.slice(0, 80) });
      }
    });
    return achados.slice(0, 8);
  }).catch(() => []);
}

// quando não achamos o campo, guardamos o retrato da tela para calibrar depois
async function diagnostico(page, plat, oferta) {
  try {
    const quadros = [];
    for (const q of page.frames()) {
      const d = await q.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 8; };
        const ins = Array.from(document.querySelectorAll('input')).filter(vis).slice(0, 20).map((el) => ({
          valor: String(el.value || '').slice(0, 20),
          nome: String(el.name || el.id || '').slice(0, 30),
          ph: String(el.placeholder || '').slice(0, 30),
          perto: (el.closest('div,td,label,section') || {}).innerText ? (el.closest('div,td,label,section').innerText || '').replace(/\s+/g, ' ').slice(0, 70) : '',
        }));
        const t = (document.body.innerText || '').replace(/\s+/g, ' ');
        return { inputs: ins, temPreco: /pre[çc]o|price/i.test(t), texto: t.slice(0, 400) };
      }).catch(() => null);
      quadros.push({ url: (q.url() || '').slice(0, 140), dados: d });
    }
    const arq = path.join(__dirname, 'diagnostico-oferta.json');
    let hist = [];
    try { hist = JSON.parse(fs.readFileSync(arq, 'utf8')) || []; } catch (e) {}
    if (!Array.isArray(hist)) hist = [];
    hist.push({ quando: new Date().toISOString(), plataforma: plat, produto: oferta.nome, url: page.url(), quadros: quadros });
    fs.writeFileSync(arq, JSON.stringify(hist.slice(-10), null, 1));
    try { await page.screenshot({ path: path.join(__dirname, 'diagnostico-oferta-' + plat + '.png') }); } catch (e) {}
    console.log('     (guardei diagnostico-oferta.json + foto da tela para calibrarmos)');
  } catch (e) {}
}

async function acharCampoPreco(page) {
  // espera algum quadro mostrar a palavra "preço" (a tela monta devagar)
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    for (const quadro of page.frames()) {
      const campos = await procurarNoQuadro(quadro);
      if (campos.length) return { quadro: quadro, campos: campos };
    }
    await page.waitForTimeout(2000);
  }
  return { quadro: null, campos: [] };
}

// ---------- aplica / restaura o preço de um produto ----------
async function mexerNoPreco(browser, oferta, novoPreco, ehRestauro) {
  const plat = oferta.plat === 'tiktok' ? 'tiktok' : 'shopee';
  if (!fs.existsSync(SESSOES[plat])) throw new Error('sem login da ' + plat);
  if (!oferta.prodId) throw new Error('produto sem id da loja — use o botão "Buscar produtos da loja"');

  const ctx = await browser.newContext({ storageState: SESSOES[plat], locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  await ctx.route('**/*', (r) => {
    const t = r.request().resourceType();
    if (t === 'image' || t === 'media' || t === 'font') return r.abort();
    return r.continue();
  });
  const page = await ctx.newPage();
  try {
    // tenta os endereços de edição até achar o campo de preço
    let quadro = null, campos = [];
    for (const url of EDICAO[plat](oferta)) {
      let abriu = false;
      for (let i = 0; i < 3 && !abriu; i++) {
        try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); abriu = true; }
        catch (e) { await page.waitForTimeout(3000); }
      }
      if (!abriu) continue;
      if (/login|passport|signin/i.test(page.url())) throw new Error('sessao da ' + plat + ' expirou — rode npm run login-' + plat);
      await page.waitForTimeout(7000); // a página de edição demora a montar
      const r = await acharCampoPreco(page);
      if (r.campos.length) { quadro = r.quadro; campos = r.campos; break; }
      await diagnostico(page, plat, oferta); // guarda o que apareceu na tela
    }
    if (!campos.length) {
      throw new Error('nao achei o campo de preco — veja diagnostico-oferta.json e a foto ao lado');
    }

    // guarda o preço original ANTES de mexer (só na aplicação, não no restauro)
    const chave = plat + ':' + oferta.prodId;
    if (!ehRestauro) guardaOriginal(chave, num(campos[0].valor) || oferta.de);

    if (!REAL) {
      console.log('  🧪 ENSAIO ' + plat + ' · ' + oferta.nome.slice(0, 40));
      console.log('     campo de preco achado: "' + campos[0].contexto + '" = ' + campos[0].valor);
      console.log('     eu ' + (ehRestauro ? 'DEVOLVERIA' : 'TROCARIA') + ' para R$ ' + brl(novoPreco) + ' (mas o modo real esta desligado)');
      const registro = { quando: new Date().toISOString(), plataforma: plat, produto: oferta.nome, url: page.url(), campos: campos, novoPreco: novoPreco };
      let rel = [];
      try { rel = JSON.parse(fs.readFileSync(ARQ_ENSAIO, 'utf8')) || []; } catch (e) {}
      if (!Array.isArray(rel)) rel = [];
      rel.push(registro);
      try { fs.writeFileSync(ARQ_ENSAIO, JSON.stringify(rel.slice(-40), null, 1)); } catch (e) {}
      await ctx.close();
      return { ensaio: true, campos: campos.length };
    }

    // ---- MODO REAL: escreve o novo preço e salva (dentro do quadro certo) ----
    const campo = quadro.locator('input[data-duolive-preco="' + campos[0].indice + '"]').first();
    await campo.click({ timeout: 15000 });
    await campo.fill('');
    await campo.type(brl(novoPreco), { delay: 60 });
    await page.waitForTimeout(1200);

    const salvar = quadro.getByRole('button', { name: /salvar|save|publicar|confirmar|atualizar/i }).first();
    await salvar.click({ timeout: 15000 });
    await page.waitForTimeout(7000);

    const erroNaTela = await quadro.evaluate(() => {
      const t = document.body.innerText || '';
      const m = t.match(/(erro|error|falha|inv[áa]lid|n[ãa]o foi poss[íi]vel)[^\n]{0,90}/i);
      return m ? m[0] : '';
    }).catch(() => '');
    if (erroNaTela) throw new Error('a loja recusou: ' + erroNaTela.slice(0, 80));

    console.log('  ' + (ehRestauro ? '↩️' : '⚡') + ' ' + plat + ' · ' + oferta.nome.slice(0, 40)
      + ' -> R$ ' + brl(novoPreco) + (ehRestauro ? ' (preco original devolvido)' : ''));
    await ctx.close();
    return { ok: true };
  } catch (e) {
    try { await ctx.close(); } catch (e2) {}
    throw e;
  }
}

// ---------- laço principal ----------
const aplicadas = new Map(); // id da oferta -> oferta (as que estão com preço trocado)

async function ciclo(browser) {
  const lista = await pega('/ofertas');
  if (!Array.isArray(lista)) return;
  const noAr = new Set(lista.map((o) => o.id));

  // 1) ofertas novas com desconto real -> aplica
  for (const o of lista) {
    if (!o.real || aplicadas.has(o.id)) continue;
    const preco = num(o.por);
    if (!preco) { avisaEstado(o.id, 'erro', 'sem preço "por"'); aplicadas.set(o.id, o); continue; }
    aplicadas.set(o.id, o); // marca antes de tentar (não repete em caso de erro)
    try {
      const r = await mexerNoPreco(browser, o, preco, false);
      avisaEstado(o.id, r.ensaio ? 'ensaio' : 'aplicada');
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 90);
      console.log('  ⚠️  ' + o.nome.slice(0, 35) + ': ' + msg);
      avisaEstado(o.id, 'erro', msg);
    }
  }

  // 2) ofertas que sairam do ar -> devolve o preço original
  for (const [id, o] of Array.from(aplicadas)) {
    if (noAr.has(id)) continue;
    aplicadas.delete(id);
    if (!o.real) continue;
    const chave = (o.plat === 'tiktok' ? 'tiktok' : 'shopee') + ':' + o.prodId;
    const original = originais[chave] != null ? originais[chave] : num(o.de);
    if (!original) { console.log('  (nao sei o preco original de ' + o.nome.slice(0, 30) + ' — deixei como esta)'); continue; }
    try {
      await mexerNoPreco(browser, o, original, true);
      esqueceOriginal(chave);
      avisaEstado(id, 'restaurada');
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 90);
      console.log('  ⚠️  NAO consegui devolver o preco de ' + o.nome.slice(0, 30) + ': ' + msg);
      console.log('     >>> CONFIRA NA LOJA! O preco original era R$ ' + brl(original));
      avisaEstado(id, 'erro', 'nao devolvi o preco: ' + msg);
    }
  }
}

async function restaurarTudo(browser) {
  const chaves = Object.keys(originais);
  if (!chaves.length) { console.log('  Nenhum preco pendente de restauro. Tudo certo.'); return; }
  console.log('  Devolvendo ' + chaves.length + ' preco(s) original(is)...');
  for (const chave of chaves) {
    const [plat, prodId] = chave.split(':');
    try {
      await mexerNoPreco(browser, { plat: plat, prodId: prodId, nome: chave, de: originais[chave] }, originais[chave], true);
      esqueceOriginal(chave);
    } catch (e) { console.log('  ⚠️  ' + chave + ': ' + String(e.message || e).slice(0, 70)); }
  }
}

async function principal() {
  console.log('\n  DuoLive · Robô da oferta relâmpago');
  if (REAL) {
    console.log('  ⚡ MODO REAL LIGADO — os precos serao trocados de verdade na loja.');
    console.log('     O preco original de cada produto fica guardado em precos-originais.json');
    console.log('     e volta sozinho quando a oferta terminar.');
  } else {
    console.log('  🧪 MODO ENSAIO — nada sera salvo nas lojas.');
    console.log('     Ele so confere se consegue chegar no campo de preco e conta o que achou.');
    console.log('     Para valer de verdade:  set DUOLIVE_OFERTA_REAL=1  e rode de novo.');
  }
  console.log('  Conector: ' + CONECTOR + '\n');

  let browser;
  try { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
  catch (e) { try { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }
    catch (e2) { console.log('  Instale o Google Chrome e tente de novo.'); process.exit(1); } }

  if (RESTAURAR_TUDO) { await restaurarTudo(browser); await browser.close(); process.exit(0); }

  if (Object.keys(originais).length) {
    console.log('  ⚠️  Ha ' + Object.keys(originais).length + ' preco(s) de uma live anterior sem restaurar.');
    console.log('     Para devolver todos agora:  npm run robo-oferta -- --restaurar-tudo\n');
  }

  let rodando = false;
  setInterval(() => {
    if (rodando) return;
    rodando = true;
    ciclo(browser).catch(() => {}).then(() => { rodando = false; });
  }, RITMO);
  console.log('  Esperando voce lancar ofertas no painel...\n');
}

if (require.main === module) principal();
module.exports = { acharCampoPreco: acharCampoPreco };
