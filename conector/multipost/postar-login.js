// DuoLive · Postador — login de uma conta (faz uma vez por conta)
//
// Abre um navegador de PERFIL FIXO (uma pasta só dessa conta) e espera você
// entrar na conta do TikTok que vai PUBLICAR vídeos. Como o login nasce e fica
// guardado nesse perfil — igual a um navegador de verdade — o TikTok o trata
// como confiável e não corta a sessão depois (o que acontecia com cookies
// copiados). Atenção: é a conta de CRIADOR (tiktok.com), NÃO o Seller Center.
//
// Pode logar do jeito que funcionar pra você: QR Code, e-mail/senha, Google...
// Assim que você entrar, o app PERCEBE SOZINHO e guarda. (Enter também encerra.)
//
// Como usar:
//   npm run login-postar -- --conta monaco
//   npm run login-postar -- --conta vend-ana
// (o login fica em conector/perfil-postar-<conta>/, fora do GitHub)

const { abrePerfil } = require('../navegador.js');
const C = require('./contas-postar.js');

const CONTA = C.contaPedida();
const PERFIL = C.pastaPerfil(CONTA);
const LIMITE_MIN = 10; // minutos esperando o login antes de desistir

// o TikTok marca "estou logado" com o cookie sessionid — é ele que a gente espia
async function taLogado(ctx) {
  try {
    const cookies = await ctx.cookies('https://www.tiktok.com');
    return cookies.some((c) => c.name === 'sessionid' && c.value);
  } catch (e) { return false; }
}

(async () => {
  const ctx = await abrePerfil(PERFIL, false); // visível: você precisa fazer o login
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://www.tiktok.com/login').catch(() => {});

  console.log('');
  console.log('  MultiPost · login de conta');
  console.log('  Conta: ' + CONTA);
  console.log('  1. Na janela que abriu, FAÇA O LOGIN na conta do TikTok (a que publica vídeos).');
  console.log('     Pode ser por QR Code, e-mail/senha ou Google — o que funcionar pra você.');
  console.log('  2. Quando você entrar, eu percebo sozinho e guardo aqui. ⏳ (até ' + LIMITE_MIN + ' min)');
  console.log('');

  // dois jeitos de terminar: eu percebo o login sozinho, OU você aperta Enter
  let porEnter = false;
  try { process.stdin.resume(); process.stdin.once('data', () => { porEnter = true; }); } catch (e) {}

  const fim = Date.now() + LIMITE_MIN * 60000;
  let logado = false;
  while (Date.now() < fim) {
    if (porEnter) { logado = await taLogado(ctx); break; } // confirma antes de dar por certo
    if (await taLogado(ctx)) { logado = true; break; }     // percebi o login sozinho
    if (!ctx.pages().length) break;                         // você fechou tudo
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!logado) {
    console.log('  Não vi o login acontecer (ainda deslogado, janela fechada, ou passou de ' + LIMITE_MIN + ' min).');
    console.log('  Tenta de novo:  npm run login-postar -- --conta ' + CONTA);
    await ctx.close().catch(() => {});
    process.exit(1);
  }

  // o perfil já guardou os cookies em disco; fechar só encerra a janela
  await ctx.close().catch(() => {});
  console.log('  Login guardado ✅  (perfil: ' + PERFIL + ')');
  console.log('  Confira se valeu:   npm run testa-login -- --conta ' + CONTA);
  console.log('  Depois, ensaie:     npm run postar -- --conta ' + CONTA + ' --video "C:\\caminho\\video.mp4"');
  process.exit(0);
})();
