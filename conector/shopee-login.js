// DuoLive · Login da Shopee (faz uma vez só)
//
// Abre o SEU Chrome numa janela para você entrar na conta da Shopee.
// Quando terminar de logar, volte aqui e aperte Enter — a sessão (cookies)
// fica guardada no arquivo sessao-shopee.json, só no seu PC.
//
// Como usar:  npm run login-shopee -- --loja bellini
// (sem --loja vale para a loja "principal"; cada loja guarda a sua sessão)

const { abreNavegador } = require('./navegador.js');
const path = require('path');
const L = require('./lojas.js');

const LOJA = L.lojaPedida();
const ARQ = path.join(__dirname, 'sessao-shopee-' + LOJA + '.json');

(async () => {
  const browser = await abreNavegador(false);
  const ctx = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  // Central do Vendedor: e' a conta que ve os PEDIDOS (o que o robo de vendas le).
  // creator.shopee.com.br manda para o login de COMPRADOR, que nao serve aqui.
  await page.goto('https://seller.shopee.com.br/account/signin');

  console.log('');
  console.log('  Loja: ' + LOJA);
  console.log('  1. Na janela que abriu, FACA O LOGIN na conta da Shopee da sua loja.');
  console.log('  2. Quando estiver dentro do painel, volte aqui e aperte Enter.');
  console.log('');
  process.stdin.resume();
  await new Promise((r) => process.stdin.once('data', r));

  await ctx.storageState({ path: ARQ });
  console.log('  Sessao guardada em ' + ARQ);
  console.log('  Agora rode:  npm run robo-shopee');
  await browser.close();
  process.exit(0);
})();
