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

const fs = require('fs');
const { abreNavegador } = require('../navegador.js');
const C = require('./contas-postar.js');

const CONTA = C.contaPedida();
const ARQ = C.arquivoSessao(CONTA);
const ESCONDIDO = process.argv.includes('--escondido');

(async () => {
  console.log('');
  console.log('  MultiPost · testar login');
  console.log('  Conta: ' + CONTA);

  if (!fs.existsSync(ARQ)) {
    console.log('  Não há login guardado para essa conta (' + ARQ + ').');
    console.log('  Faça um:  npm run login-postar -- --conta ' + CONTA + '   (ou importe cookies)\n');
    process.exit(1);
  }

  const browser = await abreNavegador(ESCONDIDO);
  const ctx = await browser.newContext({
    storageState: ARQ, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  let logado = false;
  try {
    await page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(4000); // dá tempo de redirecionar pra /login se a sessão for inválida
    const url = page.url();
    // logado = ficou no studio; deslogado = jogou pra tela de login
    logado = !/\/login|\/signup/.test(url) && /tiktok\.com/.test(url);
    console.log('  Endereço final: ' + url);
  } catch (e) {
    console.log('  Não consegui abrir o TikTok: ' + e.message);
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
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
