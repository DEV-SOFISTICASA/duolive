// DuoLive · Login do TikTok Shop (faz uma vez só)
//
// Abre o SEU Chrome para você entrar na conta do TikTok Shop (Seller Center).
// Quando terminar de logar, volte aqui e aperte Enter — a sessão fica guardada
// em sessao-tiktok.json, só no seu PC.
//
// Como usar:  npm run login-tiktok -- --loja bellini
// (sem --loja vale para a loja "principal"; cada loja guarda a sua sessão)

const { abreNavegador } = require('./navegador.js');
const path = require('path');
const L = require('./lojas.js');

const LOJA = L.lojaPedida();
const ARQ = path.join(__dirname, 'sessao-tiktok-' + LOJA + '.json');

(async () => {
  const browser = await abreNavegador(false);
  const ctx = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  // Seller Center BRASILEIRO, direto no formulario de login. (O global,
  // seller.tiktokglobalshop.com, e' outra conta: quem vende no Brasil nao acha
  // a loja dele la'. E a raiz do site cai numa pagina de propaganda, sem login.)
  await page.goto('https://seller-br.tiktok.com/account/login');

  console.log('');
  console.log('  Loja: ' + LOJA);
  console.log('  1. Na janela que abriu, FACA O LOGIN na conta do TikTok Shop.');
  console.log('  2. Quando estiver dentro do Seller Center, volte aqui e aperte Enter.');
  console.log('');
  process.stdin.resume();
  await new Promise((r) => process.stdin.once('data', r));

  await ctx.storageState({ path: ARQ });
  console.log('  Sessao guardada em ' + ARQ);
  console.log('  Agora rode:  npm run ensaio-oferta-tiktok');
  await browser.close();
  process.exit(0);
})();
