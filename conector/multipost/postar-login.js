// DuoLive · Postador — login de uma conta (faz uma vez por conta)
//
// Abre o navegador para você entrar na conta do TikTok que vai PUBLICAR vídeos.
// Atenção: é a conta de CRIADOR (tiktok.com), NÃO é o Seller Center nem o Console
// de LIVE. Quando terminar de logar, volte ao terminal e aperte Enter.
//
// Como usar:
//   npm run login-postar -- --conta monaco
//   npm run login-postar -- --conta vend-ana
// (cada conta guarda o seu próprio login em sessao-postar-<conta>.json)

const { abreNavegador } = require('../navegador.js');
const C = require('./contas-postar.js');

const CONTA = C.contaPedida();
const ARQ = C.arquivoSessao(CONTA);

(async () => {
  const browser = await abreNavegador(false); // visível: você precisa fazer o login
  const ctx = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  await page.goto('https://www.tiktok.com/login');

  console.log('');
  console.log('  MultiPost · login de conta');
  console.log('  Conta: ' + CONTA);
  console.log('  1. Na janela que abriu, FAÇA O LOGIN na conta do TikTok (a que publica vídeos).');
  console.log('  2. Confira que entrou (seu perfil aparece no topo).');
  console.log('  3. Volte aqui e aperte Enter.');
  console.log('');
  process.stdin.resume();
  await new Promise((r) => process.stdin.once('data', r));

  await ctx.storageState({ path: ARQ });
  console.log('  Login guardado em ' + ARQ);
  console.log('  Teste sem publicar:  npm run postar -- --conta ' + CONTA + ' --video "C:\\caminho\\video.mp4" --legenda "teste"');
  await browser.close();
  process.exit(0);
})();
