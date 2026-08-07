// Testa a senha do painel: token assinado, senha certa/errada, cookie, e o
// comportamento "sem senha = aberto" (para não quebrar quem usa só no PC).
const path = require('path');
const DIR = path.join(__dirname, '..');

let ok = 0, falha = 0;
function afirma(nome, cond, detalhe) {
  if (cond) { ok++; console.log('  ✅ ' + nome); }
  else { falha++; console.log('  ❌ ' + nome + (detalhe ? ' — ' + detalhe : '')); }
}
function comSenha(senha, fn) {
  const antes = process.env.DUOLIVE_SENHA_PAINEL;
  process.env.DUOLIVE_SENHA_PAINEL = senha;
  delete require.cache[require.resolve(DIR + '/auth.js')];
  const A = require(DIR + '/auth.js');
  try { fn(A); } finally {
    if (antes === undefined) delete process.env.DUOLIVE_SENHA_PAINEL;
    else process.env.DUOLIVE_SENHA_PAINEL = antes;
    delete require.cache[require.resolve(DIR + '/auth.js')];
  }
}

// ---------- sem senha: painel aberto (comportamento antigo) ----------
comSenha('', (A) => {
  afirma('sem senha: nao esta protegido', A.protegido() === false);
  afirma('sem senha: qualquer pedido passa', A.autenticado({ headers: {} }) === true);
  afirma('sem senha: senhaConfere sempre falso', A.senhaConfere('qualquer') === false);
});

// como um pedido que vem de FORA (pela internet, via túnel) aparece
const DE_FORA = { headers: { 'x-forwarded-for': '200.1.2.3', 'cf-ray': 'abc' } };

// ---------- com senha ----------
comSenha('minha-senha-123', (A) => {
  afirma('com senha: esta protegido', A.protegido() === true);
  afirma('local (sem proxy) passa mesmo sem cookie', A.autenticado({ headers: {} }) === true);
  afirma('de FORA sem cookie NAO passa', A.autenticado(DE_FORA) === false);
  afirma('senha certa confere', A.senhaConfere('minha-senha-123') === true);
  afirma('senha errada nao confere', A.senhaConfere('outra') === false);
  afirma('senha vazia nao confere', A.senhaConfere('') === false);

  // o cookie gerado ao logar deve autenticar
  const setCookie = A.cookieSet();
  const token = decodeURIComponent(setCookie.split('=')[1].split(';')[0]);
  afirma('token novo e valido', A.tokenValido(token) === true);
  const req = { headers: { cookie: A.COOKIE + '=' + encodeURIComponent(token), 'cf-ray': 'abc' } };
  afirma('de FORA COM o cookie certo passa', A.autenticado(req) === true);

  // token adulterado nao vale
  const adulterado = token.slice(0, -3) + 'xxx';
  afirma('token adulterado nao vale', A.tokenValido(adulterado) === false);

  // token expirado nao vale
  const expirado = A.criaToken(-1);
  afirma('token expirado nao vale', A.tokenValido(expirado) === false);

  // deslogar
  const saida = A.cookieSet(0);
  afirma('cookieSet(0) zera o cookie', /Max-Age=0/.test(saida), saida);
});

// ---------- trocar a senha invalida os cookies antigos ----------
let tokenAntigo;
comSenha('senha-A', (A) => { tokenAntigo = decodeURIComponent(A.cookieSet().split('=')[1].split(';')[0]); });
comSenha('senha-B', (A) => {
  afirma('token da senha antiga nao vale com a nova', A.tokenValido(tokenAntigo) === false);
});

// ---------- token de maquina (o robo mandando venda para a nuvem) ----------
const antesTok = process.env.DUOLIVE_TOKEN;
process.env.DUOLIVE_TOKEN = 'tok-secreto';
delete require.cache[require.resolve(DIR + '/auth.js')];
let A = require(DIR + '/auth.js');
afirma('maquina: token certo passa', A.maquinaOk({ headers: { 'x-duolive-token': 'tok-secreto' } }) === true);
afirma('maquina: token errado nao passa', A.maquinaOk({ headers: { 'x-duolive-token': 'errado' } }) === false);
afirma('maquina: sem token no pedido nao passa', A.maquinaOk({ headers: {} }) === false);
// temTokenValido: usado pelo porteiro para deixar o robô passar em qualquer rota
afirma('temTokenValido: token certo => true', A.temTokenValido({ headers: { 'x-duolive-token': 'tok-secreto' } }) === true);
afirma('temTokenValido: token errado => false', A.temTokenValido({ headers: { 'x-duolive-token': 'zzz' } }) === false);
afirma('temTokenValido: sem token => false', A.temTokenValido({ headers: {} }) === false);
// veioDeFora: distingue acesso remoto (proxy) de local
afirma('veioDeFora: com x-forwarded-for => true', A.veioDeFora({ headers: { 'x-forwarded-for': '1.2.3.4' } }) === true);
afirma('veioDeFora: com cf-ray => true', A.veioDeFora({ headers: { 'cf-ray': 'abc' } }) === true);
afirma('veioDeFora: local (sem proxy) => false', A.veioDeFora({ headers: {} }) === false);
delete process.env.DUOLIVE_TOKEN;
delete require.cache[require.resolve(DIR + '/auth.js')];
A = require(DIR + '/auth.js');
afirma('maquina: sem token configurado, aceita (uso local)', A.maquinaOk({ headers: {} }) === true);
if (antesTok !== undefined) process.env.DUOLIVE_TOKEN = antesTok;

console.log('');
console.log(falha === 0 ? ('  TUDO CERTO: ' + ok + ' testes passaram.') : ('  ATENÇÃO: ' + falha + ' falha(s) em ' + (ok + falha) + '.'));
process.exit(falha === 0 ? 0 : 1);
