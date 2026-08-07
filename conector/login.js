// DuoLive · Menu de login
//
// Mostra as SUAS lojas (as de minhas-lojas.txt), você escolhe pelo número e ele
// abre o login certo. Assim o nome da loja sai sempre igual — é o que faz o
// painel e os robôs se encontrarem depois.
//
// Como usar:  node login.js tiktok    (ou shopee / console)
// Normalmente você não roda isso na mão: os atalhos da área de trabalho chamam.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const L = require('./lojas.js');

const PLATAFORMAS = {
  tiktok: { arquivo: 'tiktok-login.js', titulo: 'TikTok Shop (Seller Center)' },
  shopee: { arquivo: 'shopee-login.js', titulo: 'Shopee (Central do Vendedor)' },
  console: { arquivo: 'console-login.js', titulo: 'Console de LIVE (Oferta Relâmpago)' },
};

const plat = String(process.argv[2] || '').toLowerCase();
if (!PLATAFORMAS[plat]) {
  console.log('\n  Use assim:  node login.js tiktok   (ou shopee, ou console)\n');
  process.exit(1);
}

const lojas = L.minhasLojas();
if (!lojas.length) {
  console.log('\n  Nao achei nenhuma loja em minhas-lojas.txt.');
  console.log('  Abra esse arquivo (na pasta conector) e escreva uma loja por linha.\n');
  process.exit(1);
}

// o que cada loja já tem guardado, para você ver o que falta
const resumo = {};
L.resumoDasLojas().forEach((r) => { resumo[r.loja] = r; });

console.log('');
console.log('  LOGIN: ' + PLATAFORMAS[plat].titulo);
console.log('  ' + '-'.repeat(48));
console.log('');
lojas.forEach((loja, i) => {
  const r = resumo[loja] || {};
  const marca = r[plat] ? '  ✅ ja tem login' : '';
  console.log('   ' + (i + 1) + ') ' + loja + marca);
});
console.log('');
console.log('   0) sair');
console.log('');

const perg = readline.createInterface({ input: process.stdin, output: process.stdout });
perg.question('  Qual loja? Digite o numero: ', (resposta) => {
  perg.close();
  const n = parseInt(String(resposta).trim(), 10);
  if (!n || n < 1 || n > lojas.length) {
    console.log('\n  Nada escolhido — saindo sem mexer em nada.\n');
    process.exit(0);
  }
  const loja = lojas[n - 1];
  const r = resumo[loja] || {};
  if (r[plat]) {
    console.log('\n  (essa loja ja tinha login desta plataforma — o novo vai substituir)');
  }
  console.log('\n  >> abrindo o login da loja "' + loja + '"...\n');

  // passa a bola para o script de login, na mesma janela
  const res = spawnSync(process.execPath, [path.join(__dirname, PLATAFORMAS[plat].arquivo), '--loja', loja], {
    stdio: 'inherit',
    cwd: __dirname,
  });

  const arq = L.arquivoSessao(plat, loja);
  console.log('');
  if (fs.existsSync(arq)) console.log('  ✅ Login da loja "' + loja + '" guardado.');
  else console.log('  ⚠️  Nao vi o login ser guardado. Tente de novo, esperando a pagina carregar.');
  process.exit(res.status || 0);
});
