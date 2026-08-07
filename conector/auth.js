// DuoLive · Senha do painel
//
// Protege o painel com uma senha, para quando ele estiver na nuvem (ou aberto
// na rede) só quem tem a senha entrar. Sem senha configurada, tudo continua
// aberto como sempre foi — então nada quebra em quem usa só no PC.
//
// De onde vem a senha: 1º a variável DUOLIVE_SENHA_PAINEL (é assim no Render);
// 2º o arquivo senha-painel.txt (uma linha, fica fora do repositório).
//
// Como o "logado" é lembrado: um cookie assinado (HMAC), SEM guardar sessão
// nenhuma no servidor. A assinatura usa como segredo a própria senha, então
// trocar a senha desloga todo mundo — que é o que se espera.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const COOKIE = 'duolive_auth';
const DIAS = 30;

function senhaConfigurada() {
  // se a variável está DEFINIDA (mesmo vazia), ela manda — inclusive para
  // desligar a senha (=''). Só quando não há variável é que lê o arquivo.
  if (process.env.DUOLIVE_SENHA_PAINEL !== undefined) return String(process.env.DUOLIVE_SENHA_PAINEL).trim();
  try {
    const t = fs.readFileSync(path.join(__dirname, 'senha-painel.txt'), 'utf8');
    const l = t.split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))[0];
    if (l) return l;
  } catch (e) {}
  return '';
}

// tem senha? se não, o painel fica aberto (comportamento antigo)
function protegido() { return !!senhaConfigurada(); }

// segredo do HMAC derivado da senha — não precisa guardar nada em disco
function segredo() {
  return crypto.createHash('sha256').update('duolive-cookie|' + senhaConfigurada()).digest();
}

// token = base64url(expira).assinatura
function criaToken(dias) {
  const expira = Date.now() + (dias || DIAS) * 86400000;
  const corpo = String(expira);
  const ass = crypto.createHmac('sha256', segredo()).update(corpo).digest('base64url');
  return Buffer.from(corpo).toString('base64url') + '.' + ass;
}

function comparaSeguro(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  try { return crypto.timingSafeEqual(x, y); } catch (e) { return false; }
}

function tokenValido(token) {
  if (!token) return false;
  const partes = String(token).split('.');
  if (partes.length !== 2) return false;
  let corpo;
  try { corpo = Buffer.from(partes[0], 'base64url').toString(); } catch (e) { return false; }
  const esperada = crypto.createHmac('sha256', segredo()).update(corpo).digest('base64url');
  if (!comparaSeguro(partes[1], esperada)) return false;
  const expira = +corpo;
  return isFinite(expira) && Date.now() < expira;
}

// a senha digitada bate com a configurada?
function senhaConfere(tentativa) {
  const real = senhaConfigurada();
  if (!real) return false;
  return comparaSeguro(String(tentativa || ''), real);
}

// lê o cookie de auth de um pedido
function cookieDoPedido(req) {
  const bruto = (req.headers && req.headers.cookie) || '';
  const m = bruto.split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : '';
}

// o pedido veio de FORA (pela internet, via túnel) ou é daqui do PC?
// O túnel (Cloudflare) sempre carimba cf-connecting-ip / cf-ray; um acesso local
// (o robô, o OBS, o navegador aqui) não tem esses cabeçalhos. Assim o que é local
// nunca é barrado — só o acesso remoto pede senha.
function veioDeFora(req) {
  const h = (req && req.headers) || {};
  return !!(h['cf-connecting-ip'] || h['cf-ray'] || h['x-forwarded-for'] || h['x-forwarded-host']);
}

// esse pedido está autenticado? (sem senha, ou vindo de dentro do PC, sempre sim)
function autenticado(req) {
  if (!protegido()) return true;
  if (!veioDeFora(req)) return true; // acesso local (robô, OBS, navegador do PC)
  return tokenValido(cookieDoPedido(req));
}

// cabeçalho Set-Cookie para logar (ou deslogar, com dias=0)
function cookieSet(dias) {
  if (dias === 0) return COOKIE + '=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax';
  const token = criaToken(dias);
  const maxAge = (dias || DIAS) * 86400;
  return COOKIE + '=' + encodeURIComponent(token) + '; Path=/; Max-Age=' + maxAge + '; HttpOnly; SameSite=Lax';
}

// token de MÁQUINA (o robô manda as vendas para a nuvem). Vem de DUOLIVE_TOKEN
// ou do conector.txt na 2ª linha. Sem token configurado, aceita sem exigir.
function tokenMaquina() {
  if (process.env.DUOLIVE_TOKEN) return String(process.env.DUOLIVE_TOKEN).trim();
  return '';
}
function maquinaOk(req) {
  const esperado = tokenMaquina();
  if (!esperado) return true; // não configurado: aceita (uso local)
  const veio = (req.headers && (req.headers['x-duolive-token'] || '')) || '';
  return comparaSeguro(veio, esperado);
}
// o pedido traz um token de máquina VÁLIDO? (o robô, mandando vendas para a nuvem).
// Diferente de maquinaOk: aqui, sem token configurado, é sempre falso — serve para
// o porteiro deixar o robô passar em QUALQUER rota (inclusive ler /lojas).
function temTokenValido(req) {
  const esperado = tokenMaquina();
  if (!esperado) return false;
  const veio = (req.headers && (req.headers['x-duolive-token'] || '')) || '';
  return comparaSeguro(veio, esperado);
}

module.exports = {
  COOKIE, protegido, senhaConfere, autenticado, cookieSet, criaToken, tokenValido,
  cookieDoPedido, tokenMaquina, maquinaOk, temTokenValido, veioDeFora,
};
