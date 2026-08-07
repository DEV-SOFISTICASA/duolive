// DuoLive · Oferta relâmpago da Shopee — MODO ENSAIO (não publica nada)
//
// O que faz: entra no Seller Centre com a sua sessão guardada, procura a tela de
// criar oferta relâmpago / promoção, tira fotos do caminho e salva um "mapa" da
// página (botões e campos) para calibrar o modo real depois. NADA é publicado —
// o robô para antes de qualquer botão de confirmar/salvar.
//
// Pré-requisito:  npm run login-shopee   (guarda sessao-shopee.json)
// Como usar:      npm run ensaio-oferta
//
// Ele gera, aqui na pasta conector:
//   ensaio-oferta-*.png        -> fotos de cada passo
//   ensaio-oferta-mapa.json    -> botões/links/campos achados (me mande este)

const { abreNavegador } = require('./navegador.js');
const fs = require('fs');
const path = require('path');
const L = require('./lojas.js');

const ARQ_SESSAO = L.arquivoSessao('shopee', L.lojaPedida());
const MAPA = path.join(__dirname, 'ensaio-oferta-mapa.json');

// telas onde a Shopee costuma ter oferta relâmpago / promoções ao vivo
const CANDIDATAS = [
  { nome: 'seller-marketing', url: 'https://seller.shopee.com.br/portal/marketing' },
  { nome: 'flash-sale',       url: 'https://seller.shopee.com.br/portal/marketing/mass/flashsale' },
  { nome: 'creator-live',     url: 'https://creator.shopee.com.br' },
  { nome: 'creator-promo',    url: 'https://creator.shopee.com.br/insight/live/list' },
];

// palavras que indicam "criar oferta relâmpago" na tela
const GATILHOS = /(rel[aâ]mpago|flash\s?sale|promo[çc][aã]o|desconto|criar oferta|nova oferta|add\s?discount|create.*(sale|promo))/i;

function textoLimpo(s) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80); }

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
    return { botoes: pega('button, a[role=button], [class*=btn]'), campos: pega('input, textarea, select') };
  });
}

(async () => {
  if (!fs.existsSync(ARQ_SESSAO)) {
    console.log('Falta o login. Rode primeiro:  npm run login-shopee');
    process.exit(1);
  }
  const browser = await abreNavegador(true);
  const ctx = await browser.newContext({ storageState: ARQ_SESSAO, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();

  const relatorio = [];
  let passo = 0;
  async function foto(nome) {
    passo++;
    const arq = path.join(__dirname, 'ensaio-oferta-' + String(passo).padStart(2, '0') + '-' + nome + '.png');
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
      // procura na tela um botão que pareça "criar oferta relâmpago"
      const alvo = m.botoes.find((b) => GATILHOS.test(b.txt));
      relatorio.push({ tela: c.nome, url: c.url, achouGatilho: !!alvo, gatilho: alvo ? alvo.txt : null, botoes: m.botoes, campos: m.campos });
      console.log('    botões visíveis: ' + m.botoes.length + ' | campos: ' + m.campos.length + (alvo ? ' | ⚡ possível: "' + alvo.txt + '"' : ''));

      if (alvo) {
        // tenta CLICAR no que parece abrir a criação — mas SEM confirmar nada depois
        try {
          await page.getByText(new RegExp(alvo.txt.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first().click({ timeout: 5000 });
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
  console.log('  Me mande esse arquivo + as fotos ensaio-oferta-*.png para eu calibrar o modo real.');
  process.exit(0);
})();
