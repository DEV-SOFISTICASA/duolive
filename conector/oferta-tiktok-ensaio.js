// DuoLive · Oferta/desconto do TikTok Shop — MODO ENSAIO (não publica nada)
//
// Entra no TikTok Seller Center com a sua sessão, procura a tela de criar
// promoção / flash deal, tira fotos do caminho e salva um mapa dos botões e
// campos para calibrar o modo real depois. NADA é publicado — para antes de
// qualquer botão de confirmar/salvar.
//
// Pré-requisito:  npm run login-tiktok
// Como usar:      npm run ensaio-oferta-tiktok
//
// Gera, aqui na pasta conector:
//   ensaio-tiktok-*.png        -> fotos de cada passo
//   ensaio-tiktok-mapa.json    -> botões/campos achados (me mande este)

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ARQ_SESSAO = path.join(__dirname, 'sessao-tiktok.json');
const MAPA = path.join(__dirname, 'ensaio-tiktok-mapa.json');

// telas onde o TikTok Shop costuma ter promoções / flash deals
const CANDIDATAS = [
  { nome: 'promotions',   url: 'https://seller.tiktokglobalshop.com/promotion' },
  { nome: 'flash-deals',  url: 'https://seller.tiktokglobalshop.com/promotion/flash-deal' },
  { nome: 'marketing',    url: 'https://seller.tiktokglobalshop.com/marketing' },
  { nome: 'live-center',  url: 'https://seller.tiktokglobalshop.com/account/register/live' },
];

const GATILHOS = /(flash\s?deal|rel[aâ]mpago|promo[çc][aã]o|promotion|discount|desconto|criar|create.*(deal|promo|discount)|add.*(deal|promo|discount))/i;

async function mapa(page) {
  return await page.evaluate(() => {
    function visivel(el) {
      const r = el.getBoundingClientRect();
      return r.width > 4 && r.height > 4 && r.top < (window.innerHeight + 400);
    }
    const pega = (sel) => Array.from(document.querySelectorAll(sel))
      .filter(visivel)
      .map((el) => ({
        txt: (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        tag: el.tagName.toLowerCase(),
        tipo: el.getAttribute('type') || '',
      }))
      .filter((x) => x.txt)
      .slice(0, 120);
    return { botoes: pega('button, a[role=button], [class*=btn], [class*=Button]'), campos: pega('input, textarea, select') };
  });
}

(async () => {
  if (!fs.existsSync(ARQ_SESSAO)) {
    console.log('Falta o login. Rode primeiro:  npm run login-tiktok');
    process.exit(1);
  }
  let browser;
  try { browser = await chromium.launch({ headless: true, channel: 'chrome' }); }
  catch (e) {
    try { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }
    catch (e2) { console.log('Instale o Google Chrome e tente de novo.'); process.exit(1); }
  }
  const ctx = await browser.newContext({ storageState: ARQ_SESSAO, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();

  const relatorio = [];
  let passo = 0;
  async function foto(nome) {
    passo++;
    const arq = path.join(__dirname, 'ensaio-tiktok-' + String(passo).padStart(2, '0') + '-' + nome + '.png');
    try { await page.screenshot({ path: arq, fullPage: false }); } catch (e) {}
    console.log('  📷 ' + path.basename(arq));
  }

  for (const c of CANDIDATAS) {
    try {
      console.log('\n  Abrindo ' + c.nome + ' ...');
      await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(9000);
      await foto(c.nome);

      const m = await mapa(page);
      const alvo = m.botoes.find((b) => GATILHOS.test(b.txt));
      relatorio.push({ tela: c.nome, url: c.url, achouGatilho: !!alvo, gatilho: alvo ? alvo.txt : null, botoes: m.botoes, campos: m.campos });
      console.log('    botões visíveis: ' + m.botoes.length + ' | campos: ' + m.campos.length + (alvo ? ' | ⚡ possível: "' + alvo.txt + '"' : ''));

      if (alvo) {
        try {
          await page.getByText(new RegExp(alvo.txt.slice(0, 18).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first().click({ timeout: 5000 });
          await page.waitForTimeout(6000);
          await foto(c.nome + '-apos-clique');
          const m2 = await mapa(page);
          relatorio.push({ tela: c.nome + ' (após abrir criação)', url: page.url(), botoes: m2.botoes, campos: m2.campos });
          console.log('    → abriu a criação: ' + m2.campos.length + ' campo(s). PAREI AQUI (não publico nada).');
        } catch (e) { console.log('    (não consegui abrir a criação automaticamente: ' + String(e).slice(0, 50) + ')'); }
      }
    } catch (e) { console.log('   (não abriu: ' + String(e).slice(0, 60) + ')'); }
  }

  await browser.close();
  fs.writeFileSync(MAPA, JSON.stringify(relatorio, null, 1));
  console.log('\n  Ensaio concluído — NADA foi publicado.');
  console.log('  Mapa salvo em ' + path.basename(MAPA));
  console.log('  Me mande esse arquivo + as fotos ensaio-tiktok-*.png para eu calibrar o modo real.');
  process.exit(0);
})();
