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
// Como usar:  npm run login-console -- --loja bellini
//   1. Abre uma janela do Chrome no Console de LIVE.
//   2. Faça o login (com o QR Code do app ou com a sua conta).
//   3. Quando a lista de produtos aparecer, volte aqui e aperte Enter.
//
// Sem --loja, vale para a loja "principal". Cada loja guarda a sua sessão
// (sessao-console-bellini.json), então uma não apaga a outra.

const { abreNavegador } = require('./navegador.js');
const fs = require('fs');
const path = require('path');
const L = require('./lojas.js');

const LOJA = L.lojaPedida();
const ARQ = path.join(__dirname, 'sessao-console-' + LOJA + '.json');
// Gerenciador de LIVE: e' AQUI que os pedidos da live aparecem em tempo real
// (o "Console de pedidos"), e tambem a Oferta Relampago.
// Cuidado ao testar: DESLOGADO este endereco redireciona para a pagina de
// propaganda americana (business.tiktokshop.com/us/...) — o que nao quer dizer
// que esteja errado. Logado, ele abre o console de verdade.
const ALVO = 'https://shop.tiktok.com/streamer/live/product/dashboard';

(async () => {
  const browser = await abreNavegador(false);
  const ctx = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  await page.goto(ALVO).catch(() => {});

  console.log('');
  console.log('  CONSOLE DE LIVE do TikTok (onde fica a ⚡ Oferta Relâmpago)');
  console.log('  Loja: ' + LOJA);
  console.log('');
  console.log('  1. Na janela que abriu, FACA O LOGIN na conta que faz a live.');
  console.log('  2. Espere aparecer o console com a "Lista de produtos nesta LIVE".');
  console.log('  3. Volte aqui e aperte Enter.');
  console.log('');
  process.stdin.resume();
  await new Promise((r) => process.stdin.once('data', r));

  await ctx.storageState({ path: ARQ });

  // Confere se o login pegou mesmo: a sessao tem que ter cookie de conta nos
  // dominios do console. (Nao dependemos de uma API especifica, que muda de
  // endereco de tempos em tempos.)
  let ok = false;
  try {
    const estado = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
    const cookies = (estado && estado.cookies) || [];
    ok = cookies.some((c) => /tiktokshop\.com|tiktok\.com/.test(c.domain || '')
      && /sessionid|sid_tt|sid_guard|passport_auth/i.test(c.name || ''));
  } catch (e) {}

  console.log('  Sessao guardada em ' + ARQ);
  if (ok) console.log('  ✅ Login do console guardado!');
  else console.log('  ⚠️  Nao vi o login nesta sessao. Se a lista de produtos nao tinha aparecido,'
    + '\n     rode de novo e espere ela carregar antes de apertar Enter.');
  console.log('  Agora rode:  npm run robo-oferta');
  await browser.close();
  process.exit(0);
})();
