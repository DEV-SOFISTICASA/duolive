// MultiPost · Login em MASSA — loga várias contas em sequência, guiado
//
// Abre uma janela por conta (perfil fixo, modo discreto). Você loga a conta do
// jeito que funcionar (e-mail/senha, Google, QR...), o app percebe sozinho e
// já parte pra próxima. As que já têm login são puladas.
//
// De onde vêm os nomes das contas:
//   • do arquivo conector/contas-postar.txt (um apelido por linha, # = comentário)
//   • ou na linha de comando:  npm run login-massa -- --contas ana,lore,vend3
//
// Enquanto uma janela estiver aberta, no terminal você pode digitar:
//   p [Enter]  -> PULAR essa conta (deixa pra depois)
//   s [Enter]  -> SAIR do assistente
//
// Cada conta espera até 15 min pelo login.

const { abrePerfil } = require('../navegador.js');
const C = require('./contas-postar.js');

function arg(nome) { const i = process.argv.indexOf(nome); return i >= 0 ? process.argv[i + 1] : ''; }
const LIMITE_MIN = 15;

// lista de contas: --contas tem prioridade; senão o contas-postar.txt
function contasAlvo() {
  const cli = arg('--contas');
  if (cli) return cli.split(',').map((s) => s.trim()).filter(Boolean);
  return C.contasListadas();
}

async function taLogado(ctx) {
  try {
    const cookies = await ctx.cookies('https://www.tiktok.com');
    return cookies.some((c) => c.name === 'sessionid' && c.value);
  } catch (e) { return false; }
}

// controle pelo teclado: 'p' pula a conta atual, 's' sai de tudo
let pedido = '';
try {
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { const t = String(d).trim().toLowerCase(); if (t) pedido = t[0]; });
} catch (e) {}

// loga UMA conta; devolve 'ok' | 'pulou' | 'sair'
async function logaUma(conta, i, total) {
  console.log('');
  console.log('  ┌─ Conta ' + (i + 1) + '/' + total + ':  ' + conta + '  ─────────────');
  console.log('  │  Na janela que abriu, FAÇA O LOGIN dessa conta no TikTok.');
  console.log('  │  Quando entrar, eu percebo e vou pra próxima sozinho.');
  console.log('  │  (no teclado: "p" + Enter pula esta conta; "s" + Enter sai)');
  console.log('  └────────────────────────────────────────────────');

  const ctx = await abrePerfil(C.pastaPerfil(conta), false);
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://www.tiktok.com/login').catch(() => {});

  pedido = '';
  const fim = Date.now() + LIMITE_MIN * 60000;
  let resultado = 'pulou';
  while (Date.now() < fim) {
    if (pedido === 's') { resultado = 'sair'; break; }
    if (pedido === 'p') { resultado = 'pulou'; break; }
    if (await taLogado(ctx)) { resultado = 'ok'; break; }
    if (!ctx.pages().length) { resultado = 'pulou'; break; } // fechou a janela
    await new Promise((r) => setTimeout(r, 2000));
  }
  await ctx.close().catch(() => {});
  if (resultado === 'ok') console.log('  ✅ ' + conta + ' logada e guardada.');
  else if (resultado === 'pulou') console.log('  ⏭  ' + conta + ' pulada (dá pra logar depois).');
  return resultado;
}

(async () => {
  const alvo = contasAlvo();
  if (!alvo.length) {
    console.log('\n  Não achei os nomes das contas. Faça uma das opções:');
    console.log('   • liste os apelidos em conector/contas-postar.txt (um por linha), ou');
    console.log('   • rode:  npm run login-massa -- --contas ana,lore,vend3\n');
    process.exit(1);
  }

  const faltam = alvo.filter((c) => !C.temLogin(c));
  const jaTem = alvo.filter((c) => C.temLogin(c));
  console.log('');
  console.log('  MultiPost · login em massa');
  console.log('  Contas na lista: ' + alvo.length + '   Já logadas: ' + jaTem.length + '   A logar: ' + faltam.length);
  if (jaTem.length) console.log('  (já tenho login de: ' + jaTem.join(', ') + ')');

  const feitas = [];
  for (let i = 0; i < faltam.length; i++) {
    const r = await logaUma(faltam[i], i, faltam.length);
    if (r === 'ok') feitas.push(faltam[i]);
    if (r === 'sair') { console.log('\n  Saindo a seu pedido.'); break; }
  }

  const logadasAgora = C.contasComLogin();
  console.log('');
  console.log('  ───────── resumo ─────────');
  console.log('  Logadas nesta rodada: ' + feitas.length + (feitas.length ? ' (' + feitas.join(', ') + ')' : ''));
  console.log('  Total de contas com login agora: ' + logadasAgora.length);
  const pendentes = alvo.filter((c) => !C.temLogin(c));
  if (pendentes.length) console.log('  Ainda faltam: ' + pendentes.join(', ') + '   (rode de novo quando quiser)');
  console.log('');
  process.exit(0);
})();
