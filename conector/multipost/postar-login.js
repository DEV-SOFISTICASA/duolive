// DuoLive · Postador — login de uma conta (faz uma vez por conta)
//
// Abre o navegador para você entrar na conta do TikTok que vai PUBLICAR vídeos.
// Atenção: é a conta de CRIADOR (tiktok.com), NÃO é o Seller Center nem o Console
// de LIVE. O robô usa uma "sala limpa" separada do seu navegador do dia a dia —
// por isso pede login mesmo que você já esteja logado no seu Brave/Chrome.
//
// Assim que você terminar o login, o app PERCEBE SOZINHO e guarda a sessão.
// (Apertar Enter no terminal também funciona, como antes.)
//
// Como usar:
//   npm run login-postar -- --conta monaco
//   npm run login-postar -- --conta vend-ana
// (cada conta guarda o seu login em conector/sessao-postar-<conta>.json,
//  que o .gitignore mantém fora do GitHub)

const { abreNavegador } = require('../navegador.js');
const C = require('./contas-postar.js');

const CONTA = C.contaPedida();
const ARQ = C.arquivoSessao(CONTA);
const LIMITE_MIN = 10; // minutos esperando o login antes de desistir

// o TikTok marca "estou logado" com o cookie sessionid — é ele que a gente espia
async function taLogado(ctx) {
  try {
    const cookies = await ctx.cookies('https://www.tiktok.com');
    return cookies.some((c) => c.name === 'sessionid' && c.value);
  } catch (e) { return false; }
}

(async () => {
  const browser = await abreNavegador(false); // visível: você precisa fazer o login
  const ctx = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const page = await ctx.newPage();
  await page.goto('https://www.tiktok.com/login');

  console.log('');
  console.log('  MultiPost · login de conta');
  console.log('  Conta: ' + CONTA);
  console.log('  1. Na janela que abriu, FAÇA O LOGIN na conta do TikTok (a que publica vídeos).');
  console.log('  2. Quando você entrar, eu percebo sozinho e guardo aqui. ⏳ (até ' + LIMITE_MIN + ' min)');
  console.log('');

  // dois jeitos de terminar: eu percebo o login sozinho, OU você aperta Enter
  let porEnter = false;
  try { process.stdin.resume(); process.stdin.once('data', () => { porEnter = true; }); } catch (e) {}

  const fim = Date.now() + LIMITE_MIN * 60000;
  let logado = false;
  while (Date.now() < fim) {
    if (porEnter) { logado = true; break; }             // você confirmou no terminal
    if (await taLogado(ctx)) { logado = true; break; }  // percebi o login sozinho
    if (page.isClosed()) break;                          // você fechou a janela
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!logado) {
    console.log('  Não vi o login acontecer (janela fechada ou passou de ' + LIMITE_MIN + ' min). Nada foi guardado.');
    console.log('  Tenta de novo:  npm run login-postar -- --conta ' + CONTA);
    await browser.close().catch(() => {});
    process.exit(1);
  }

  await ctx.storageState({ path: ARQ });
  console.log('  Login guardado ✅  (' + ARQ + ')');
  console.log('  Teste sem publicar:  npm run postar -- --conta ' + CONTA + ' --video "C:\\caminho\\video.mp4"');
  await browser.close();
  process.exit(0);
})();
