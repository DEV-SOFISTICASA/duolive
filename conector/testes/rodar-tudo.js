// DuoLive · Roda todos os testes com segurança
//
// Alguns testes precisam de um conector no ar (eles lançam ofertas e trocam de
// loja). Se rodassem contra o conector DE VERDADE, essas ofertas falsas
// apareceriam na tela de quem está transmitindo — já aconteceu.
//
// Por isso aqui a gente sobe um conector SÓ PARA OS TESTES, numa pasta
// separada e noutra porta, roda tudo e desliga no fim.
//
// Como usar:  node testes/rodar-tudo.js       (ou npm test)

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const RAIZ = path.join(__dirname, '..');
const PORTA = +(process.env.DUOLIVE_TESTE_PORTA || 9799);

const SOZINHOS = ['teste-robo.js', 'teste-sessoes.js', 'teste-cofre.js', 'teste-cookies.js', 'teste-conta-live.js'];
const COM_CONECTOR = ['teste-ofertas-loja.js', 'teste-troca-loja.js', 'teste-contas-loja.js'];

// ---------- conector isolado, numa pasta temporária ----------
function montaPastaDeTeste() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'duolive-testes-'));
  fs.mkdirSync(path.join(dir, 'conector'));
  fs.readdirSync(RAIZ).forEach((a) => {
    if (a.endsWith('.js') || a === 'minhas-lojas.txt') fs.copyFileSync(path.join(RAIZ, a), path.join(dir, 'conector', a));
  });
  // as páginas ficam ao lado da pasta conector
  fs.readdirSync(path.join(RAIZ, '..')).forEach((a) => {
    if (a.endsWith('.html')) fs.copyFileSync(path.join(RAIZ, '..', a), path.join(dir, a));
  });
  return dir;
}

function esperaSubir(tentativas) {
  return new Promise((ok, erro) => {
    let n = 0;
    const tenta = () => {
      const req = http.get({ hostname: '127.0.0.1', port: PORTA, path: '/vendas', timeout: 1000 }, () => ok());
      req.on('error', () => { if (++n >= tentativas) erro(new Error('o conector de teste nao subiu')); else setTimeout(tenta, 500); });
      req.on('timeout', () => { req.destroy(); if (++n >= tentativas) erro(new Error('timeout')); else setTimeout(tenta, 500); });
    };
    tenta();
  });
}

(async () => {
  console.log('\n  DuoLive · testes\n');

  // trava de segurança: se a porta escolhida for a de produção, para tudo
  if (PORTA === 9797) {
    console.log('  A porta 9797 e a do conector de verdade. Escolha outra.\n');
    process.exit(1);
  }

  let passaram = 0, falharam = 0;
  const roda = (arquivo, env) => {
    const r = spawnSync(process.execPath, [path.join(__dirname, arquivo)], {
      encoding: 'utf8', cwd: RAIZ, env: Object.assign({}, process.env, env || {}),
    });
    const saida = (r.stdout || '') + (r.stderr || '');
    const m = saida.match(/(\d+) testes passaram/);
    if (r.status === 0 && m) { passaram += +m[1]; console.log('  ✅ ' + arquivo.padEnd(24) + m[1] + ' testes'); }
    else { falharam++; console.log('  ❌ ' + arquivo); saida.split('\n').filter((l) => l.includes('❌')).forEach((l) => console.log('     ' + l.trim())); }
  };

  SOZINHOS.forEach((a) => roda(a));

  // agora os que precisam de um conector no ar
  const dir = montaPastaDeTeste();
  const servidor = spawn(process.execPath, ['duolive-conector.js'], {
    cwd: path.join(dir, 'conector'),
    env: Object.assign({}, process.env, { DUOLIVE_PORTA: String(PORTA), NODE_PATH: path.join(RAIZ, 'node_modules') }),
    stdio: 'ignore',
  });

  try {
    await esperaSubir(20);
    COM_CONECTOR.forEach((a) => roda(a, { DUOLIVE_TESTE_PORTA: String(PORTA) }));
  } catch (e) {
    falharam++;
    console.log('  ❌ ' + e.message);
  } finally {
    try { servidor.kill(); } catch (e) {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('');
  console.log(falharam === 0 ? ('  TUDO CERTO: ' + passaram + ' testes passaram.\n')
    : ('  ATENÇÃO: ' + falharam + ' arquivo(s) com falha (' + passaram + ' testes passaram).\n'));
  process.exit(falharam === 0 ? 0 : 1);
})();
