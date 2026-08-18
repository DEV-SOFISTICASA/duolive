// DuoLive · Postador — transformar cookies EXPORTADOS num login guardado
//
// Pra quando você exporta os cookies do TikTok do seu próprio navegador (com uma
// extensão local, tipo "Cookie-Editor" ou "Get cookies.txt LOCALLY") e quer que
// o robô use esse login. Este conversor lê o arquivo exportado e salva no mesmo
// formato do login normal: conector/sessao-postar-<conta>.json (fora do GitHub).
//
// Aceita os dois formatos comuns:
//   • JSON  (Cookie-Editor / EditThisCookie): uma lista de cookies
//   • cookies.txt (formato "Netscape"): uma linha por cookie, separada por TAB
//
// Como usar:
//   npm run importar-cookies -- --conta monaco --arquivo "C:\Users\PC4\Downloads\tiktok-cookies.json"
//
// Depois, apague o arquivo exportado (ele contém sua sessão). O sessao-postar-*
// já fica de fora do GitHub pelo .gitignore.

const fs = require('fs');
const path = require('path');
const C = require('./contas-postar.js');

function arg(nome) { const i = process.argv.indexOf(nome); return i >= 0 ? process.argv[i + 1] : ''; }

// mapeia o "sameSite" dos vários formatos pro que o Playwright entende
function sameSite(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'strict') return 'Strict';
  if (s === 'none' || s === 'no_restriction') return 'None';
  return 'Lax'; // lax, unspecified, vazio...
}

// normaliza UM cookie (de qualquer formato) pro jeito do Playwright
function normaliza(c) {
  const nome = c.name || c.Name;
  if (!nome) return null;
  let dominio = c.domain || c.Domain || '';
  if (!dominio) return null;
  // expiração: em segundos (epoch). Sessão -> -1.
  let expires = -1;
  const exp = c.expirationDate || c.expires || c.expiry || c.Expires;
  if (exp && Number(exp) > 0) expires = Math.floor(Number(exp));
  return {
    name: nome,
    value: c.value != null ? String(c.value) : String(c.Value || ''),
    domain: dominio,
    path: c.path || c.Path || '/',
    expires,
    httpOnly: !!(c.httpOnly || c.HttpOnly),
    secure: !!(c.secure || c.Secure),
    sameSite: sameSite(c.sameSite || c.SameSite),
  };
}

// lê o formato "Netscape" (cookies.txt): domínio TAB flag TAB path TAB secure TAB expiry TAB nome TAB valor
function leNetscape(texto) {
  const saida = [];
  texto.split(/\r?\n/).forEach((linha) => {
    if (!linha || linha.startsWith('#')) {
      // algumas linhas vêm como "#HttpOnly_.tiktok.com\t..." — trata isso
      if (!/^#HttpOnly_/i.test(linha)) return;
      linha = linha.replace(/^#HttpOnly_/i, '');
    }
    const p = linha.split('\t');
    if (p.length < 7) return;
    saida.push(normaliza({
      domain: p[0], path: p[2], secure: p[3].toUpperCase() === 'TRUE',
      expires: p[4], name: p[5], value: p.slice(6).join('\t'),
      httpOnly: /^#HttpOnly_/i.test(linha),
    }));
  });
  return saida;
}

(async () => {
  const conta = C.contaPedida();
  const arquivo = arg('--arquivo');
  if (!arquivo || !fs.existsSync(arquivo)) {
    console.log('\n  Cadê o arquivo de cookies? Ex.:');
    console.log('    npm run importar-cookies -- --conta ' + conta + ' --arquivo "C:\\Users\\PC4\\Downloads\\tiktok-cookies.json"\n');
    process.exit(1);
  }

  const bruto = fs.readFileSync(arquivo, 'utf8').trim();
  let cookies = [];
  try {
    // tenta JSON primeiro; se não for, cai pro formato Netscape (cookies.txt)
    if (bruto.startsWith('[') || bruto.startsWith('{')) {
      const j = JSON.parse(bruto);
      const lista = Array.isArray(j) ? j : (j.cookies || []);
      cookies = lista.map(normaliza);
    } else {
      cookies = leNetscape(bruto);
    }
  } catch (e) {
    console.log('\n  Não entendi o arquivo de cookies (' + e.message + ').');
    console.log('  Ele precisa ser o JSON do Cookie-Editor ou um cookies.txt (Netscape).\n');
    process.exit(1);
  }

  // só o que interessa: cookies do tiktok, sem vazios
  cookies = cookies.filter((c) => c && c.name && /tiktok\.com$/i.test(c.domain.replace(/^\./, '')));
  const temSession = cookies.some((c) => c.name === 'sessionid' && c.value);

  if (!temSession) {
    console.log('\n  Achei ' + cookies.length + ' cookies do tiktok, mas nenhum "sessionid" com valor.');
    console.log('  Isso quer dizer que a exportação foi feita DESLOGADO ou de outro site.');
    console.log('  Entre no tiktok.com (conta que publica), confirme que está logado, e exporte de novo.\n');
    process.exit(1);
  }

  const ARQ = C.arquivoSessao(conta);
  fs.writeFileSync(ARQ, JSON.stringify({ cookies, origins: [] }, null, 2));
  console.log('\n  Login importado ✅  (' + cookies.length + ' cookies do tiktok em ' + path.basename(ARQ) + ')');
  console.log('  Agora pode APAGAR o arquivo exportado (ele tem sua sessão): ' + arquivo);
  console.log('  Teste sem publicar:');
  console.log('    npm run postar -- --conta ' + conta + ' --video "C:\\caminho\\video.mp4"\n');
  process.exit(0);
})();
