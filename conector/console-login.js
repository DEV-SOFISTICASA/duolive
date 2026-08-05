// DuoLive · Login do CONSOLE DE LIVE do TikTok (faz uma vez só)
//
// Este é um login DIFERENTE do login-tiktok. O Seller Center
// (seller-br.tiktok.com) e o Console de LIVE (shop.tiktok.com/streamer)
// são domínios separados e pedem sessões separadas.
//
// O Console de LIVE é onde ficam a ⚡ Oferta Relâmpago, Recompensa, Cartaz,
// Cupom e a "Lista de produtos nesta LIVE" — é ele que muda o preço que os
// clientes veem AO VIVO.
//
// Como usar:  npm run login-console
//   1. Abre uma janela do Chrome no Console de LIVE.
//   2. Faça o login (com o QR Code do app ou com a sua conta).
//   3. Quando a lista de produtos aparecer, volte aqui e aperte Enter.
//
// A sessão fica guardada em sessao-console.json, só no seu PC.

const { chromium } = require('playwright-core');
const path = require('path');

const ARQ = path.join(__dirname, 'sessao-console.json');
const ALVO = 'https://shop.tiktok.com/streamer/live/product/dashboard';

(async () => {
  let browser;
  try { browser = await chromium.launch({ headless: false, channel: 'chrome' }); }
  catch (e) {
    try { browser = await chromium.launch({ headless: false, channel: 'msedge' }); }
    catch (e2) { console.log('Instale o Google Chrome e tente de novo.'); process.exit(1); }
  }
  const ctx = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  await page.goto(ALVO).catch(() => {});

  console.log('');
  console.log('  CONSOLE DE LIVE do TikTok (onde fica a ⚡ Oferta Relâmpago)');
  console.log('');
  console.log('  1. Na janela que abriu, FACA O LOGIN na conta que faz a live.');
  console.log('  2. Espere aparecer o console com a "Lista de produtos nesta LIVE".');
  console.log('  3. Volte aqui e aperte Enter.');
  console.log('');
  process.stdin.resume();
  await new Promise((r) => process.stdin.once('data', r));

  await ctx.storageState({ path: ARQ });

  // confere se a sessao vale mesmo (o console responde de verdade?)
  let ok = false;
  try {
    const r = await page.request.get('https://shop.tiktok.com/api/v1/streamer_desktop/account_info/get', { timeout: 15000 });
    const t = await r.text();
    ok = t && t.length > 20 && !/not.?login|unauthorized/i.test(t);
  } catch (e) {}

  console.log('  Sessao guardada em ' + ARQ);
  if (ok) console.log('  ✅ O console respondeu — o login valeu!');
  else console.log('  ⚠️  O console nao respondeu ainda. Se a lista de produtos nao tinha aparecido,'
    + '\n     rode de novo e espere ela carregar antes de apertar Enter.');
  console.log('  Agora rode:  npm run robo-oferta');
  await browser.close();
  process.exit(0);
})();
