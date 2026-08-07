// DuoLive · Contas de acesso (ADM + vendedoras), guardadas no Supabase
//
// Login pelo NOME (a sigla é o identificador). Primeiro acesso: a senha que a
// pessoa digitar vira a senha dela. O ADM já vem com senha. A sessão é um
// cookie assinado que carrega a sigla e o papel (adm/vendedora).

const crypto = require('crypto');
const SB = require('./supabase.js');

// segredo estável do servidor para assinar os cookies (deriva da chave secreta,
// que não muda no Render — assim os logins não caem a cada reinício)
function segredo() {
  const base = process.env.DUOLIVE_SEGREDO || SB.config().key || 'duolive';
  return crypto.createHash('sha256').update('duolive-sessao|' + base).digest();
}

// lista para o menu de login (sem senha). Nome repetido ganha a sigla no rótulo.
async function listaParaLogin() {
  const us = await SB.seleciona('usuarios', 'select=nome,sigla,turno,papel,senha_hash&order=papel.desc,turno,nome');
  const quantos = {};
  us.forEach((u) => { quantos[u.nome] = (quantos[u.nome] || 0) + 1; });
  return us.map((u) => ({
    sigla: u.sigla, nome: u.nome,
    rotulo: quantos[u.nome] > 1 ? (u.nome + ' (' + u.sigla + ')') : u.nome,
    turno: u.turno, papel: u.papel, primeiroAcesso: !u.senha_hash,
  }));
}

// login pela sigla. 1º acesso: define a senha agora.
async function entrar(sigla, senha) {
  if (!sigla || !senha) return { erro: 'Escolha o nome e digite a senha.' };
  const achados = await SB.seleciona('usuarios', 'sigla=eq.' + encodeURIComponent(sigla) + '&select=id,nome,sigla,papel,senha_hash&limit=1');
  const u = achados && achados[0];
  if (!u) return { erro: 'Usuário não encontrado.' };
  if (!u.senha_hash) {
    if (String(senha).length < 3) return { erro: 'Crie uma senha com pelo menos 3 caracteres.' };
    await SB.atualiza('usuarios', 'id=eq.' + u.id, { senha_hash: SB.hashSenha(senha) });
    return { ok: true, primeiroAcesso: true, usuario: { sigla: u.sigla, nome: u.nome, papel: u.papel } };
  }
  if (!SB.conferaSenha(senha, u.senha_hash)) return { erro: 'Senha incorreta.' };
  return { ok: true, usuario: { sigla: u.sigla, nome: u.nome, papel: u.papel } };
}

// ---------- cookie de sessão: {sigla, papel, nome, exp}.assinatura ----------
function criaToken(usuario, dias) {
  const corpo = JSON.stringify({ s: usuario.sigla, p: usuario.papel, n: usuario.nome, exp: Date.now() + (dias || 30) * 86400000 });
  const b = Buffer.from(corpo).toString('base64url');
  const ass = crypto.createHmac('sha256', segredo()).update(b).digest('base64url');
  return b + '.' + ass;
}
function leToken(token) {
  if (!token) return null;
  const partes = String(token).split('.');
  if (partes.length !== 2) return null;
  const esperada = crypto.createHmac('sha256', segredo()).update(partes[0]).digest('base64url');
  try {
    if (partes[1].length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(partes[1]), Buffer.from(esperada))) return null;
  } catch (e) { return null; }
  let j; try { j = JSON.parse(Buffer.from(partes[0], 'base64url').toString()); } catch (e) { return null; }
  if (!j || !j.exp || Date.now() > j.exp) return null;
  return { sigla: j.s, papel: j.p, nome: j.n };
}
const ehAdm = (u) => !!(u && u.papel === 'adm');

module.exports = { listaParaLogin, entrar, criaToken, leToken, ehAdm, segredo };
