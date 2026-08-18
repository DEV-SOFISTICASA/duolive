// DuoLive · Navegador dos robôs (uso comum de todos os robôs e logins)
//
// Abre um navegador que já exista no seu PC: Google Chrome, Microsoft Edge
// ou Brave — o primeiro que encontrar. O Playwright só conhece Chrome e Edge
// pelo "canal"; o Brave a gente acha pelo caminho do brave.exe.
//
// Uso:  const { abreNavegador } = require('./navegador.js');
//       const browser = await abreNavegador(true);    // true = invisível

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

// onde o Brave costuma ficar instalado
function achaBrave() {
  const lugares = [];
  if (process.env.ProgramFiles) lugares.push(path.join(process.env.ProgramFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
  if (process.env['ProgramFiles(x86)']) lugares.push(path.join(process.env['ProgramFiles(x86)'], 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
  if (process.env.LOCALAPPDATA) lugares.push(path.join(process.env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
  lugares.push('/usr/bin/brave-browser', '/usr/bin/brave', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
  for (const p of lugares) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  return '';
}

// tenta Chrome, depois Edge, depois Brave. Se não tiver nenhum, explica e encerra.
// Diz na tela qual abriu — quando algo dá errado, essa é a primeira pergunta.
async function abreNavegador(invisivel) {
  // Na NUVEM (Render/Docker) não existe Chrome/Edge/Brave instalado: usamos o
  // Chromium que já vem junto do Playwright, com as flags que todo contêiner
  // exige (sem sandbox, sem depender de /dev/shm). Liga com DUOLIVE_CHROMIUM_NUVEM=1.
  if (process.env.DUOLIVE_CHROMIUM_NUVEM === '1' || process.env.DUOLIVE_NUVEM === '1') {
    // O TikTok RECUSA navegador invisível (headless). Na nuvem a gente roda HEADED
    // (de verdade) sob um Xvfb (tela virtual) — o Dockerfile chama o robô via
    // `xvfb-run`, que cria o DISPLAY. Com DISPLAY presente, abrimos headed; sem ele
    // (ex.: teste local do contêiner), cai no headless como último recurso.
    const temTela = !!process.env.DISPLAY;
    const b = await chromium.launch({
      headless: temTela ? false : (invisivel !== false),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run',
        '--disable-blink-features=AutomationControlled', '--start-maximized', '--window-size=1280,720'],
    });
    console.log('  (Chromium do Playwright — nuvem' + (temTela ? ', HEADED sob Xvfb ✅' : ', headless ⚠️ o TikTok pode bloquear') + ')');
    return b;
  }
  try {
    const b = await chromium.launch({ headless: invisivel, channel: 'chrome' });
    console.log('  (usando o Google Chrome)');
    return b;
  } catch (e) {}
  try {
    const b = await chromium.launch({ headless: invisivel, channel: 'msedge' });
    console.log('  (usando o Microsoft Edge)');
    return b;
  } catch (e) {}
  const brave = achaBrave();
  if (brave) {
    try {
      const b = await chromium.launch({ headless: invisivel, executablePath: brave });
      console.log('  (usando o Brave)');
      return b;
    } catch (e) {}
  }
  console.log('  Nao achei nenhum navegador. Instale o Google Chrome, o Edge ou o Brave e tente de novo.');
  process.exit(1);
}

// -------------------------------------------------------------- PERFIL FIXO
// Para o TikTok, o robô precisa de um navegador que GUARDE o login (perfil fixo,
// uma pasta por conta) e que não grite "sou um robô". Sem isso, o TikTok recusa
// o QR e invalida a sessão logo depois (foi o que aconteceu com os cookies
// importados). Aqui a gente abre um Chrome/Edge/Brave de verdade apontando pra
// essa pasta, desligando os sinais de automação mais óbvios.

// esconde os rastros de automação que o TikTok procura no navegador
async function aplicaDiscricao(ctx) {
  try {
    await ctx.addInitScript(() => {
      // navigator.webdriver = true é a "plaquinha de robô"; some com ela
      try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch (e) {}
      // um punhado de sinais que sites usam pra detectar navegador automatizado
      try { window.chrome = window.chrome || { runtime: {} }; } catch (e) {}
      try {
        const orig = navigator.permissions && navigator.permissions.query;
        if (orig) navigator.permissions.query = (p) =>
          p && p.name === 'notifications' ? Promise.resolve({ state: Notification.permission }) : orig(p);
      } catch (e) {}
    });
  } catch (e) {}
}

// abre um navegador com PERFIL FIXO (a pasta userDataDir guarda o login, igual a
// um navegador de verdade). Devolve um "context" pronto pra uso (browser embutido).
// Tenta Chrome, Edge e Brave, nessa ordem.
async function abrePerfil(userDataDir, invisivel) {
  const base = {
    headless: !!invisivel,
    viewport: null,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    // tira a barra "controlado por software de teste" e a flag de automação
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run',
      '--no-default-browser-check', '--start-maximized', '--disable-features=Translate'],
  };
  const tentativas = [
    { channel: 'chrome', nome: 'Google Chrome' },
    { channel: 'msedge', nome: 'Microsoft Edge' },
  ];
  const brave = achaBrave();
  if (brave) tentativas.push({ executablePath: brave, nome: 'Brave' });

  for (const t of tentativas) {
    try {
      const opts = Object.assign({}, base);
      if (t.channel) opts.channel = t.channel;
      if (t.executablePath) opts.executablePath = t.executablePath;
      const ctx = await chromium.launchPersistentContext(userDataDir, opts);
      await aplicaDiscricao(ctx);
      console.log('  (usando o ' + t.nome + ' — perfil salvo, modo discreto)');
      return ctx;
    } catch (e) {}
  }
  console.log('  Nao achei Chrome/Edge/Brave pra abrir o perfil. Instale um deles e tente de novo.');
  process.exit(1);
}

module.exports = { abreNavegador: abreNavegador, achaBrave: achaBrave, abrePerfil: abrePerfil };
