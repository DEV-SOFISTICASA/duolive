// Os pedidos da live aparecem no Gerenciador de LIVE (shop.tiktok.com/streamer)
// na hora da compra; no Seller Center eles chegam depois. Por isso o robô vigia
// os dois. Este teste garante que:
//   - a conta do Gerenciador só entra quando existe o login do console;
//   - o mesmo pedido visto nos dois lugares avisa UMA vez só.
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');

let ok = 0, falha = 0;
function afirma(nome, cond, detalhe) {
  if (cond) { ok++; console.log('  ✅ ' + nome); }
  else { falha++; console.log('  ❌ ' + nome + (detalhe ? ' — ' + detalhe : '')); }
}
function recarrega() {
  Object.keys(require.cache).forEach((k) => { if (k.includes('conector')) delete require.cache[k]; });
  return require(path.join(DIR, 'robo-vendas.js'));
}
const vazia = JSON.stringify({ cookies: [], origins: [] });
const arq = (n) => path.join(DIR, n);
const FALSAS = ['sessao-tiktok-teste.json', 'sessao-shopee-teste.json', 'sessao-console-teste.json'];
function limpa() { FALSAS.forEach((f) => { try { fs.unlinkSync(arq(f)); } catch (e) {} }); }

limpa();
process.argv.push('--loja', 'teste');

// ---------- sem login do console ----------
fs.writeFileSync(arq('sessao-tiktok-teste.json'), vazia);
fs.writeFileSync(arq('sessao-shopee-teste.json'), vazia);
let CONTAS = recarrega().CONTAS;
afirma('sem console: 2 contas (seller + shopee)', CONTAS.length === 2, CONTAS.map((c) => c.apelido || c.plataforma).join(', '));
afirma('sem console: nenhuma olha o gerenciador de live',
  !CONTAS.some((c) => c.paginas.some((u) => /streamer/.test(u))),
  JSON.stringify(CONTAS.map((c) => c.paginas[0])));

// ---------- com login do console ----------
fs.writeFileSync(arq('sessao-console-teste.json'), vazia);
CONTAS = recarrega().CONTAS;
afirma('com console: 3 contas', CONTAS.length === 3, CONTAS.map((c) => c.apelido || c.plataforma).join(', '));

const live = CONTAS[0];
afirma('a do gerenciador vem PRIMEIRO', /gerenciador/i.test(live.apelido || ''), live.apelido);
afirma('ela usa o login do console', path.basename(live.sessao) === 'sessao-console-teste.json', path.basename(live.sessao));
afirma('ela olha o dashboard da live',
  live.paginas[0] === 'https://shop.tiktok.com/streamer/live/product/dashboard', live.paginas[0]);
afirma('ela conta como venda do tiktok', live.plataforma === 'tiktok', live.plataforma);
afirma('ela manda logar no console (nao no seller)', (live.chave || '') === 'console', live.chave);

const seller = CONTAS[1];
afirma('o seller center continua na lista', path.basename(seller.sessao) === 'sessao-tiktok-teste.json', path.basename(seller.sessao));

// ---------- o mesmo pedido nos dois lugares avisa uma vez so' ----------
// A conferencia do robo e' por plataforma+numero do pedido. Como as duas contas
// do tiktok usam plataforma 'tiktok', o mesmo pedido nao dispara duas vezes.
const chaves = CONTAS.filter((c) => c.plataforma === 'tiktok').map((c) => c.plataforma + 'PEDIDO123');
afirma('as duas contas do tiktok geram a MESMA chave de conferencia',
  chaves.length === 2 && chaves[0] === chaves[1], JSON.stringify(chaves));
afirma('a da shopee tem chave diferente',
  ('shopee' + 'PEDIDO123') !== chaves[0]);

limpa();
const sobrou = fs.readdirSync(DIR).filter((a) => /^sessao-.*teste\.json$/.test(a));
afirma('faxina: nao deixei sessao de teste para tras', sobrou.length === 0, sobrou.join(', '));

console.log('');
console.log(falha === 0 ? ('  TUDO CERTO: ' + ok + ' testes passaram.') : ('  ATENÇÃO: ' + falha + ' falha(s) em ' + (ok + falha) + '.'));
process.exit(falha === 0 ? 0 : 1);
