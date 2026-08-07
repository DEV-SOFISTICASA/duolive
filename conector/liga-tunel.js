// DuoLive · Liga o túnel e mostra o link para acessar de qualquer computador.
// Garante o conector no ar, sobe o cloudflared e imprime o link em destaque.
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORTA = 9797;
const CLOUD = path.join(__dirname, 'cloudflared.exe');

function noAr() {
  return new Promise((ok) => {
    const r = http.get({ hostname: '127.0.0.1', port: PORTA, path: '/ao-vivo', timeout: 2000 }, () => ok(true));
    r.on('error', () => ok(false)); r.on('timeout', () => { r.destroy(); ok(false); });
  });
}

(async () => {
  if (!fs.existsSync(CLOUD)) { console.log('  Falta o cloudflared.exe. Avise o Claude.'); process.exit(1); }
  if (!(await noAr())) {
    console.log('  O painel (conector) não está ligado. Abra antes o atalho "6 ABRIR O PAINEL".\n');
    process.exit(1);
  }
  console.log('\n  Ligando o acesso pela internet... (aguarde uns segundos)\n');
  const cf = spawn(CLOUD, ['tunnel', '--url', 'http://localhost:' + PORTA, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let achou = false;
  const olho = (buf) => {
    const s = buf.toString();
    const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !achou) {
      achou = true;
      console.log('  ==================================================');
      console.log('    SEU LINK (abre de qualquer computador/celular):');
      console.log('    ' + m[0] + '/painel');
      console.log('');
      console.log('    Senha: a que você escolheu');
      console.log('  ==================================================');
      console.log('\n  NÃO feche esta janela enquanto quiser usar o link.\n');
    }
  };
  cf.stdout.on('data', olho);
  cf.stderr.on('data', olho);
  cf.on('exit', (c) => { console.log('\n  O túnel foi desligado (código ' + c + ').'); process.exit(0); });
})();
