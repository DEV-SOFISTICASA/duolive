// DuoLive · Postador — importar o login do TikTok direto do SEU Brave
//
// Pra quem já está logado no TikTok no Brave do dia a dia e não quer (ou não
// consegue) logar de novo na janela do robô. Como funciona, sem mágica:
//   1. Você FECHA o Brave (todas as janelas — senão o perfil fica trancado).
//   2. O app copia só o necessário do seu perfil (cookies + chave) pra uma
//      pasta temporária.
//   3. Abre o Brave em cima dessa cópia — é o PRÓPRIO Brave que destranca os
//      cookies (a gente não fuça banco de dados na unha).
//   4. Se achar o login do TikTok, salva em conector/sessao-postar-<conta>.json
//      (o mesmo arquivo do login normal; o .gitignore mantém fora do GitHub).
//   5. Apaga a pasta temporária. O seu Brave fica intocado.
//
// Como usar:
//   npm run importar-login -- --conta monaco
//   (se o login estiver noutro perfil do Brave, o app procura em todos)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { chromium } = require('playwright-core');
const { achaBrave } = require('../navegador.js');
const C = require('./contas-postar.js');

const CONTA = C.contaPedida();
const ARQ = C.arquivoSessao(CONTA);

// onde o Brave guarda os perfis ("User Data")
function pastaPerfis() {
  return path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'User Data');
}

// o Brave está aberto? (o perfil fica trancado enquanto ele roda)
function braveAberto() {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq brave.exe', '/FO', 'CSV', '/NH'], (err, stdout) => {
      resolve(!err && /brave\.exe/i.test(stdout || ''));
    });
  });
}

// perfis que existem (Default, Profile 1, Profile 2...) e têm cookies
function listaPerfis(base) {
  try {
    return fs.readdirSync(base).filter((d) =>
      /^(Default|Profile \d+)$/.test(d) && fs.existsSync(path.join(base, d, 'Network', 'Cookies')));
  } catch (e) { return []; }
}

// monta uma cópia mínima do perfil numa pasta temporária (cookies + chave)
function copiaPerfil(base, perfil) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'multipost-brave-'));
  fs.copyFileSync(path.join(base, 'Local State'), path.join(tmp, 'Local State'));
  const destino = path.join(tmp, 'Default', 'Network');
  fs.mkdirSync(destino, { recursive: true });
  fs.copyFileSync(path.join(base, perfil, 'Network', 'Cookies'), path.join(destino, 'Cookies'));
  return tmp;
}

// abre o Brave na cópia e pergunta: tem login do TikTok aqui?
async function experimentaPerfil(brave, tmp) {
  const ctx = await chromium.launchPersistentContext(tmp, {
    executablePath: brave,
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
  });
  try {
    const cookies = await ctx.cookies('https://www.tiktok.com');
    const logado = cookies.some((c) => c.name === 'sessionid' && c.value);
    if (!logado) return false;
    // confirma visualmente e completa a sessão (localStorage etc.)
    const page = await ctx.newPage();
    await page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await ctx.storageState({ path: ARQ });
    return true;
  } finally {
    await ctx.close().catch(() => {});
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} // a cópia tem cookies: some com ela
  }
}

(async () => {
  console.log('');
  console.log('  MultiPost · importar login do Brave');
  console.log('  Conta: ' + CONTA);
  console.log('');

  const brave = achaBrave();
  if (!brave) { console.log('  Não achei o Brave instalado neste PC.\n'); process.exit(1); }

  const base = pastaPerfis();
  if (!fs.existsSync(base)) { console.log('  Não achei a pasta de perfis do Brave (' + base + ').\n'); process.exit(1); }

  if (await braveAberto()) {
    console.log('  O Brave está ABERTO — feche todas as janelas dele e rode de novo.');
    console.log('  (enquanto ele roda, o perfil fica trancado e a cópia sai corrompida)\n');
    process.exit(1);
  }

  const perfis = listaPerfis(base);
  if (!perfis.length) { console.log('  Não achei nenhum perfil com cookies no Brave.\n'); process.exit(1); }

  for (const perfil of perfis) {
    console.log('  Procurando login do TikTok no perfil "' + perfil + '"...');
    const tmp = copiaPerfil(base, perfil);
    const deuCerto = await experimentaPerfil(brave, tmp);
    if (deuCerto) {
      console.log('');
      console.log('  Login importado ✅  (' + ARQ + ')');
      console.log('  Pode abrir seu Brave de novo. Teste sem publicar:');
      console.log('    npm run postar -- --conta ' + CONTA + ' --video "C:\\caminho\\video.mp4"');
      console.log('');
      process.exit(0);
    }
  }

  console.log('');
  console.log('  Não achei o TikTok logado em nenhum perfil do Brave. Duas possibilidades:');
  console.log('  • o login está noutro navegador (Chrome/Edge?) — me avise qual;');
  console.log('  • ou o Brave usa uma proteção nova que só ele destranca — aí o caminho');
  console.log('    é a janela do robô com "Entrar com código QR" (escaneia com o celular).');
  console.log('');
  process.exit(1);
})();
