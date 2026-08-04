// DuoLive · Login da Shopee (faz uma vez só)
//
// Abre o SEU Chrome numa janela para você entrar na conta da Shopee.
// Quando terminar de logar, volte aqui e aperte Enter — a sessão (cookies)
// fica guardada no arquivo sessao-shopee.json, só no seu PC.
//
// Como usar:  npm run login-shopee

const { chromium } = require('playwright-core');
const path = require('path');

const ARQ = path.join(__dirname, 'sessao-shopee.json');

(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: false, channel: 'chrome' });
  } catch (e) {
    try { browser = await chromium.launch({ headless: false, channel: 'msedge' }); }
    catch (e2) {
      console.log('Nao achei o Chrome nem o Edge instalados. Instale o Google Chrome e tente de novo.');
      process.exit(1);
    }
  }
  const ctx = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  await page.goto('https://creator.shopee.com.br');

  console.log('');
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
