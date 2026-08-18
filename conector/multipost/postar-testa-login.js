// DuoLive · Postador — testar se o login de uma conta ainda vale (não posta nada)
//
// Abre o TikTok Studio com a sessão guardada e vê se você continua logado.
// Serve pra conferir um login importado (por cookies, por exemplo) antes de
// depender dele numa postagem em massa.
//
//   npm run testa-login -- --conta monaco
//
// Por padrão abre a janela (o TikTok desconfia de navegador escondido). Para
// rodar sem janela: --escondido

const { abrePerfil } = require('../navegador.js');
const C = require('./contas-postar.js');

const CONTA = C.contaPedida();
const ESCONDIDO = process.argv.includes('--escondido');

(async () => {
  console.log('');
  console.log('  MultiPost · testar login');
  console.log('  Conta: ' + CONTA);

  if (!C.temLogin(CONTA)) {
    console.log('  Não há login guardado para essa conta.');
    console.log('  Faça um:  npm run login-postar -- --conta ' + CONTA + '\n');
    process.exit(1);
  }

  const ctx = await abrePerfil(C.pastaPerfil(CONTA), ESCONDIDO);
  const page = ctx.pages()[0] || await ctx.newPage();
  let logado = false;
  try {
    await page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000); // dá tempo de o Studio assentar (ele pisca o login e volta)
    const url = page.url();
    // logado = ficou no studio; deslogado = jogou pra tela de login
    logado = !/\/login|\/signup/.test(url) && /tiktok\.com/.test(url);
    console.log('  Endereço final: ' + url);
  } catch (e) {
    console.log('  Não consegui abrir o TikTok: ' + e.message);
  } finally {
    await ctx.close().catch(() => {});
  }

  if (logado) {
    console.log('  Login VÁLIDO ✅ — a conta ' + CONTA + ' está pronta pra postar.');
    console.log('  Próximo (ensaio, não publica):  npm run postar -- --conta ' + CONTA + ' --video "C:\\caminho\\video.mp4"\n');
  } else {
    console.log('  Login parece EXPIRADO ❌ — o TikTok não reconheceu a sessão.');
    console.log('  Reimporte os cookies (logado no tiktok.com) ou use o QR:  npm run login-postar -- --conta ' + CONTA + '\n');
    process.exitCode = 1;
  }
  setTimeout(() => process.exit(process.exitCode || 0), 1500).unref();
})();
