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

const { abreNavegador } = require('./navegador.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const L = require('./lojas.js');

const LOJA = L.lojaPedida();

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

// O Console de LIVE do TikTok (shop.tiktok.com/streamer) tem sessão PRÓPRIA,
// separada do Seller Center. É nele que fica a ⚡ Oferta Relâmpago da live.
// 'let' porque muda quando voce troca de loja no painel (cada loja tem os seus logins)
let TEM_CONSOLE = fs.existsSync(L.arquivoSessao('console', LOJA));
const SESSOES = {
  tiktok: TEM_CONSOLE ? L.arquivoSessao('console', LOJA) : L.arquivoSessao('tiktok', LOJA),
  shopee: L.arquivoSessao('shopee', LOJA),
};

// onde fica o campo de preço de cada loja (tentamos os endereços em ordem).
// Nas duas lojas a tela de edição vem dentro de um iframe — por isso procuramos
// o campo em todos os quadros da página.
const EDICAO = {
  // TikTok: a ⚡ Oferta Relâmpago vive no Console de LIVE (é ela que muda o
  // preço que o cliente vê AO VIVO). A edição do produto é o plano B.
  tiktok: (p) => (TEM_CONSOLE ? [
    'https://shop.tiktok.com/streamer/live/product/dashboard',
  ] : [
    'https://seller-br.tiktok.com/product/manage/edit?product_id=' + encodeURIComponent(p.prodId),
  ]),
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
// valor é uma LISTA [{indice, preco}] — um preço por variação do produto
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
    // um preço é vazio ou algo como "49,99" / "1.299,90" — nunca "28.061.00"
    function pareceDinheiro(v) {
      const s = String(v || '').trim();
      if (!s) return true; // campo vazio (ex.: "aplicar a todos") também serve
      return /^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(s) || /^\d+([.,]\d{1,2})?$/.test(s);
    }
    const campos = Array.from(document.querySelectorAll('input')).filter(visivel);
    const achados = [];
    campos.forEach((el, i) => {
      const volta = el.closest('div,section,tr,td,label');
      const perto = (volta ? volta.innerText : '').replace(/\s+/g, ' ').slice(0, 120);
      const attr = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.className].join(' ');
      const tudo = perto + ' ' + attr;
      const ehPreco = /pre[çc]o|price|valor|R\$/i.test(tudo);
      const ehRuido = /estoque|stock|quantidade|quantity|peso|weight|sku|gtin|ean|c[óo]digo|dimens|frete|busca|search|pesquis|desconto de|comiss/i.test(tudo);
      if (!ehPreco || ehRuido || !pareceDinheiro(el.value)) return;
      el.setAttribute('data-duolive-preco', String(i));
      // o campo "aplicar a todos" (placeholder Preço, vazio) é o melhor alvo:
      // muda todas as variações de uma vez, que é o que a oferta relâmpago quer
      const mestre = /^pre[çc]o$/i.test(String(el.placeholder || '').trim()) && !String(el.value || '').trim();
      achados.push({ indice: i, valor: el.value, mestre: mestre, contexto: perto.slice(0, 80) });
    });
    // mestre primeiro; depois os que já têm preço preenchido
    achados.sort((a, b) => (b.mestre ? 1 : 0) - (a.mestre ? 1 : 0));
    return achados.slice(0, 10);
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
  // NÃO bloqueamos imagens aqui: sem elas a tela de edição não monta direito.
  // Só cortamos vídeo e fontes, que não afetam o formulário.
  await ctx.route('**/*', (r) => {
    const t = r.request().resourceType();
    if (t === 'media' || t === 'font') return r.abort();
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
      await page.waitForTimeout(9000); // a página de edição demora a montar (e o iframe entra depois)
      const r = await acharCampoPreco(page);
      if (r.campos.length) { quadro = r.quadro; campos = r.campos; break; }
      await diagnostico(page, plat, oferta); // guarda o que apareceu na tela
    }
    if (!campos.length) {
      if (plat === 'tiktok' && !TEM_CONSOLE) {
        throw new Error('falta o login do Console de LIVE (onde fica a Oferta Relampago). '
          + 'Rode:  npm run login-console');
      }
      if (plat === 'tiktok') {
        throw new Error('nao achei a Oferta Relampago no Console de LIVE — veja diagnostico-oferta.json '
          + '(a sessao do console pode ter expirado: npm run login-console)');
      }
      throw new Error('nao achei o campo de preco — veja diagnostico-oferta.json e a foto ao lado');
    }

    // Guarda os preços originais ANTES de mexer. ATENÇÃO: cada variação (cor,
    // tamanho...) pode ter um preço diferente — guardamos TODOS, um por campo,
    // senão o restauro nivelaria tudo num preço só e estragaria a sua loja.
    const chave = plat + ':' + oferta.prodId;
    const variacoes = campos.filter((c) => !c.mestre && num(c.valor));
    if (!ehRestauro) {
      if (!variacoes.length && !num(oferta.de)) throw new Error('nao consegui ler o preco original — nao vou mexer');
      guardaOriginal(chave, variacoes.length
        ? variacoes.map((c) => ({ indice: c.indice, preco: num(c.valor) }))
        : [{ indice: campos[0].indice, preco: num(oferta.de) }]);
      const distintos = Array.from(new Set(variacoes.map((c) => num(c.valor))));
      if (distintos.length > 1) {
        console.log('     (esse produto tem ' + distintos.length + ' precos diferentes nas variacoes — '
          + 'guardei cada um e devolvo um por um no fim)');
      }
    }

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

    // ---- MODO REAL: escreve o(s) preço(s) e salva (dentro do quadro certo) ----
    async function escrever(indice, valor) {
      const campo = quadro.locator('input[data-duolive-preco="' + indice + '"]').first();
      await campo.click({ timeout: 15000 });
      await campo.fill('');
      await campo.type(brl(valor), { delay: 55 });
      await page.waitForTimeout(500);
    }

    if (ehRestauro) {
      // devolve CADA variação ao seu próprio preço (nunca nivela tudo)
      const guardados = originais[chave];
      const lista = Array.isArray(guardados) && guardados.length
        ? guardados
        : [{ indice: campos[0].indice, preco: novoPreco }];
      for (const g of lista) await escrever(g.indice, g.preco);
    } else if (variacoes.length) {
      // oferta: todas as variações vão para o preço promocional
      for (const v of variacoes) await escrever(v.indice, novoPreco);
    } else {
      await escrever(campos[0].indice, novoPreco);
      if (campos[0].mestre) { // "aplicar a todos" só vale depois de clicar em Aplicar
        try {
          const aplicar = quadro.getByRole('button', { name: /^aplicar(\s+a\s+todos)?$/i }).first();
          await aplicar.click({ timeout: 6000 });
          await page.waitForTimeout(2500);
        } catch (e) { /* algumas telas aplicam sozinhas */ }
      }
    }
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
    const guardados = originais[chave];
    const temGuardado = Array.isArray(guardados) && guardados.length;
    const original = temGuardado ? guardados[0].preco : num(o.de);
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

// ---------- seguir a loja escolhida no painel ----------
// Trocar de loja com preço trocado no ar é perigoso: o robô perderia de vista
// os produtos com desconto e eles ficariam baratos para sempre. Por isso,
// antes de trocar, ele DEVOLVE os preços das ofertas da loja que sai.
let lojaAtiva = LOJA;
let trocandoLoja = false;

function lojaDoPainel() {
  return new Promise((ok) => {
    const u = new URL(CONECTOR + '/lojas');
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, timeout: 8000 }, (res) => {
      let corpo = '';
      res.on('data', (d) => { corpo += d; if (corpo.length > 1e6) req.destroy(); });
      res.on('end', () => {
        try { const b = JSON.parse(corpo); ok(L.limpaNome(b.selecionada || b.atual || '')); } catch (e) { ok(''); }
      });
    });
    req.on('error', () => ok(''));
    req.on('timeout', () => { req.destroy(); ok(''); });
  });
}

// Devolve o preço original de TODAS as ofertas que estão com desconto agora.
// É o freio de emergência: serve para o fim da live, a troca de loja e o Ctrl+C.
async function devolverAplicadas(browser, motivo) {
  const pendentes = Array.from(aplicadas.values()).filter((o) => o.real);
  if (!pendentes.length) { aplicadas.clear(); return 0; }
  console.log('  ↩️  Devolvendo ' + pendentes.length + ' preco(s) — ' + motivo + '...');
  let devolvidos = 0;
  for (const [id, o] of Array.from(aplicadas)) {
    aplicadas.delete(id);
    if (!o.real) continue;
    const chave = (o.plat === 'tiktok' ? 'tiktok' : 'shopee') + ':' + o.prodId;
    const g = originais[chave];
    const original = (Array.isArray(g) && g.length) ? g[0].preco : num(o.de);
    if (!original) {
      console.log('     (nao sei o preco original de ' + o.nome.slice(0, 30) + ' — CONFIRA NA LOJA!)');
      continue;
    }
    try {
      await mexerNoPreco(browser, o, original, true);
      esqueceOriginal(chave);
      avisaEstado(id, 'restaurada');
      devolvidos++;
    } catch (e) {
      console.log('     ⚠️  NAO devolvi o preco de ' + o.nome.slice(0, 30) + ' — CONFIRA NA LOJA!');
      console.log('        O preco original era R$ ' + brl(original));
    }
  }
  return devolvidos;
}

async function seguirLoja(browser, nova) {
  if (trocandoLoja || !nova || nova === lojaAtiva) return;
  trocandoLoja = true;
  try {
    console.log('\n  🏪 O painel trocou para a loja "' + nova + '".');
    await devolverAplicadas(browser, 'saindo da loja "' + lojaAtiva + '"');
    lojaAtiva = nova;
    TEM_CONSOLE = fs.existsSync(L.arquivoSessao('console', nova));
    SESSOES.tiktok = TEM_CONSOLE ? L.arquivoSessao('console', nova) : L.arquivoSessao('tiktok', nova);
    SESSOES.shopee = L.arquivoSessao('shopee', nova);
    console.log('  🏪 Agora usando os logins da loja "' + nova + '".\n');
  } catch (e) {
    console.log('  (erro ao trocar de loja: ' + String(e).slice(0, 80) + ')');
  }
  trocandoLoja = false;
}

// ---------- o desconto só vale com a live no ar ----------
// Quando a live termina, o preço promocional TEM que sair junto. Aqui a gente
// pergunta ao conector se a live ainda está no ar; se ela caiu e continuou
// fora do ar por um tempinho (para não reagir a uma queda de conexão), os
// preços voltam sozinhos.
const GRACA_FIM = +(process.env.DUOLIVE_GRACA_FIM || 90) * 1000;
let viLiveAberta = false;
let foraDoArDesde = 0;

function liveNoAr() { // true | false | null (não consegui saber)
  return new Promise((ok) => {
    const u = new URL(CONECTOR + '/ao-vivo');
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get({ hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname, timeout: 8000 }, (res) => {
      let corpo = '';
      res.on('data', (d) => { corpo += d; if (corpo.length > 1e6) req.destroy(); });
      res.on('end', () => { try { ok(!!JSON.parse(corpo).aoVivo); } catch (e) { ok(null); } });
    });
    req.on('error', () => ok(null));
    req.on('timeout', () => { req.destroy(); ok(null); });
  });
}

async function conferirFimDaLive(browser) {
  const vivo = await liveNoAr();
  if (vivo === null) return;                 // conector fora do ar: não arrisca
  if (vivo) { viLiveAberta = true; foraDoArDesde = 0; return; }
  if (!viLiveAberta) return;                 // ainda nem começou: não mexe em nada
  if (!aplicadas.size) { foraDoArDesde = 0; return; }
  if (!foraDoArDesde) {
    foraDoArDesde = Date.now();
    console.log('\n  📴 A live saiu do ar. Se não voltar em ' + Math.round(GRACA_FIM / 1000) + 's, devolvo os precos.');
    return;
  }
  if (Date.now() - foraDoArDesde < GRACA_FIM) return;
  console.log('\n  📴 A live terminou.');
  await devolverAplicadas(browser, 'a live terminou');
  viLiveAberta = false;
  foraDoArDesde = 0;
}

async function restaurarTudo(browser) {
  const chaves = Object.keys(originais);
  if (!chaves.length) { console.log('  Nenhum preco pendente de restauro. Tudo certo.'); return; }
  console.log('  Devolvendo ' + chaves.length + ' preco(s) original(is)...');
  for (const chave of chaves) {
    const [plat, prodId] = chave.split(':');
    const g = originais[chave];
    const primeiro = Array.isArray(g) && g.length ? g[0].preco : num(g);
    try {
      await mexerNoPreco(browser, { plat: plat, prodId: prodId, nome: chave, de: primeiro }, primeiro, true);
      esqueceOriginal(chave);
      console.log('  ✅ ' + chave + ' devolvido.');
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

  // O TikTok recusa carregar o editor num navegador invisível (ERR_BLOCKED_BY_RESPONSE).
  // Por isso abrimos uma janela de verdade — ela pode ficar minimizada num canto.
  // Para forçar o modo invisível (só Shopee):  set DUOLIVE_OFERTA_INVISIVEL=1
  const INVISIVEL = process.env.DUOLIVE_OFERTA_INVISIVEL === '1';
  if (!INVISIVEL) console.log('  (vai abrir uma janela do navegador — pode minimizar, mas nao feche)\n');
  const browser = await abreNavegador(INVISIVEL);

  if (RESTAURAR_TUDO) { await restaurarTudo(browser); await browser.close(); process.exit(0); }

  if (Object.keys(originais).length) {
    console.log('  ⚠️  Ha ' + Object.keys(originais).length + ' preco(s) de uma live anterior sem restaurar.');
    console.log('     Para devolver todos agora:  npm run robo-oferta -- --restaurar-tudo\n');
  }

  console.log('  Loja: ' + lojaAtiva + ' (segue o seletor 🏪 do painel)\n');

  let rodando = false;
  setInterval(() => {
    if (rodando || trocandoLoja) return;
    rodando = true;
    ciclo(browser).catch(() => {}).then(() => { rodando = false; });
  }, RITMO);

  // segue a loja escolhida no painel — devolvendo os precos da anterior antes
  setInterval(() => {
    if (rodando || trocandoLoja) return;
    lojaDoPainel().then((l) => seguirLoja(browser, l)).catch(() => {});
  }, 5000);

  // o desconto so' vale com a live no ar
  setInterval(() => {
    if (rodando || trocandoLoja) return;
    conferirFimDaLive(browser).catch(() => {});
  }, 10000);

  // fechou o robo (Ctrl+C ou fechou a janela)? devolve os precos antes de sair
  let saindo = false;
  const sairDireito = async () => {
    if (saindo) return;
    saindo = true;
    if (aplicadas.size) {
      console.log('\n  Saindo — nao vou deixar preco promocional para tras.');
      try { await devolverAplicadas(browser, 'o robo foi fechado'); } catch (e) {}
    }
    try { await browser.close(); } catch (e) {}
    process.exit(0);
  };
  process.on('SIGINT', sairDireito);
  process.on('SIGTERM', sairDireito);

  console.log('  Esperando voce lancar ofertas no painel...\n');
  console.log('  (o desconto sai sozinho quando a oferta acabar, quando voce trocar');
  console.log('   de loja, quando a live terminar ou quando voce fechar o robo)\n');
}

if (require.main === module) principal();
module.exports = { acharCampoPreco: acharCampoPreco };
