// DuoLive · Vigia que mantém o site no ar (conector + túnel)
//
// Fica rodando e, se o conector ou o túnel caírem, religa sozinho. É o que faz
// o site "ficar 24h" enquanto ESTE PC estiver ligado. Colocado na pasta de
// inicialização do Windows, sobe sozinho quando você liga o computador.
//
// (O robô de vendas NÃO entra aqui: ele só precisa rodar durante as lives —
// ligue pelo atalho "7 ROBO DE VENDAS" quando for transmitir.)

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const NODE = process.execPath;
const PORTA = 9797;
const CLOUD = path.join(DIR, 'cloudflared.exe');
const ARQ_LINK = path.join(DIR, 'link-atual.txt');

function conectorNoAr() {
  return new Promise((ok) => {
    const r = http.get({ hostname: '127.0.0.1', port: PORTA, path: '/ao-vivo', timeout: 3000 }, () => ok(true));
    r.on('error', () => ok(false)); r.on('timeout', () => { r.destroy(); ok(false); });
  });
}

let procConector = null, procTunel = null, linkAtual = '';

function ligaConector() {
  console.log('  [' + hora() + '] ligando o conector...');
  procConector = spawn(NODE, ['duolive-conector.js'], { cwd: DIR, stdio: 'ignore' });
  procConector.on('exit', () => { procConector = null; });
}

function ligaTunel() {
  console.log('  [' + hora() + '] ligando o túnel...');
  linkAtual = '';
  procTunel = spawn(CLOUD, ['tunnel', '--url', 'http://localhost:' + PORTA, '--no-autoupdate'], { cwd: DIR });
  const olho = (buf) => {
    const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && m[0] !== linkAtual) {
      linkAtual = m[0];
      try { fs.writeFileSync(ARQ_LINK, linkAtual + '/painel\n'); } catch (e) {}
      console.log('\n  ==================================================');
      console.log('    LINK ATUAL: ' + linkAtual + '/painel');
      console.log('  ==================================================\n');
    }
  };
  procTunel.stdout.on('data', olho);
  procTunel.stderr.on('data', olho);
  procTunel.on('exit', () => { procTunel = null; linkAtual = ''; });
}

function hora() { return new Date().toLocaleTimeString('pt-BR'); }

// vigia: a cada 15s confere se está tudo no ar; religa o que caiu
async function ronda() {
  if (!(await conectorNoAr()) && !procConector) ligaConector();
  if (!procTunel) ligaTunel();
}

console.log('\n  DuoLive · Vigia do site ligado. Mantém o conector e o túnel no ar.');
console.log('  Deixe esta janela aberta (pode minimizar). Ctrl+C para parar.\n');
ronda();
setInterval(ronda, 15000);
