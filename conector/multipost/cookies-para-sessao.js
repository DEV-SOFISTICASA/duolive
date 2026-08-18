// DuoLive · Postador — plantar o login do TikTok (cookies) no PERFIL FIXO
//
// Pra quando você já está logado no TikTok no seu navegador e exporta os cookies
// (com uma extensão local, tipo "Cookie-Editor"). Este script PLANTA esses
// cookies dentro do perfil fixo da conta (conector/perfil-postar-<conta>/) e
// abre o TikTok pra "assentar" — a partir daí o próprio perfil mantém e renova
// a sessão sozinho, igual a um navegador de verdade. É isso que faz o login
// durar (cookies soltos, sem perfil, o TikTok derruba depois do 1º uso).
//
// Como usar:
//   1) exporte os cookies do tiktok.com (logado) num arquivo .json
//   2) npm run importar-cookies -- --conta monaco --arquivo "C:\Users\PC4\Downloads\tiktok.json"
//
// Depois apague o arquivo exportado (ele contém sua sessão).

const fs = require('fs');
const { abrePerfil } = require('../navegador.js');
const C = require('./contas-postar.js');

function arg(nome) { const i = process.argv.indexOf(nome); return i >= 0 ? process.argv[i + 1] : ''; }

// mapeia o "sameSite" dos vários formatos pro que o Playwright entende
function sameSite(v) {
  const s = String(v || '').toLowerCase();
  if (s === 'strict') return 'Strict';
  if (s === 'none' || s === 'no_restriction') return 'None';
  return 'Lax'; // lax, unspecified, vazio...
}

// alguns apps de chat transformam "www.tiktok.com" no link markdown
// "[www.tiktok.com](https://www.tiktok.com)". Aqui a gente desfaz isso,
// preservando o ponto da frente (.www.tiktok.com continua com o ponto).
function limpaDominio(d) {
  d = String(d || '');
  const m = d.match(/\[([^\]]+)\]/);
  if (m) return (/^\./.test(d) ? '.' : '') + m[1];
  return d;
}

// normaliza UM cookie (de qualquer formato) pro jeito do Playwright
function normaliza(c) {
  const nome = c.name || c.Name;
  if (!nome) return null;
  let dominio = limpaDominio(c.domain || c.Domain || '');
  if (!dominio) return null;
  let expires = -1; // sessão
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

// espera o TikTok parar de piscar a tela de login
async function assenta(page, ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (!/\/login|\/signup/.test(page.url())) return;
    await page.waitForTimeout(500);
  }
}

(async () => {
  const conta = C.contaPedida();
  const arquivo = arg('--arquivo');
  if (!arquivo || !fs.existsSync(arquivo)) {
    console.log('\n  Cadê o arquivo de cookies? Ex.:');
    console.log('    npm run importar-cookies -- --conta ' + conta + ' --arquivo "C:\\Users\\PC4\\Downloads\\tiktok.json"\n');
    process.exit(1);
  }

  const bruto = fs.readFileSync(arquivo, 'utf8').trim();
  let cookies = [];
  try {
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

  cookies = cookies.filter((c) => c && c.name && /tiktok\.com$/i.test(c.domain.replace(/^\./, '')));
  const temSession = cookies.some((c) => c.name === 'sessionid' && c.value);
  if (!temSession) {
    console.log('\n  Achei ' + cookies.length + ' cookies do tiktok, mas nenhum "sessionid" com valor.');
    console.log('  Exporte de novo LOGADO no tiktok.com (a conta que publica).\n');
    process.exit(1);
  }

  console.log('\n  Plantando ' + cookies.length + ' cookies no perfil da conta "' + conta + '"...');
  const ctx = await abrePerfil(C.pastaPerfil(conta), false);
  let logado = false;
  try {
    await ctx.addCookies(cookies);
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await assenta(page, 12000);
    logado = !/\/login|\/signup/.test(page.url());
    await page.waitForTimeout(2500); // deixa o TikTok renovar os cookies e o perfil salvar
  } catch (e) {
    console.log('  Erro ao plantar: ' + e.message);
  } finally {
    await ctx.close().catch(() => {});
  }

  if (logado) {
    console.log('  Login plantado e ATIVO no perfil ✅');
    console.log('  Confirme:  npm run testa-login -- --conta ' + conta);
    console.log('  Apague agora o arquivo exportado (tem sua sessão): ' + arquivo + '\n');
  } else {
    console.log('  Plantei os cookies, mas o TikTok ainda pediu login. 😕');
    console.log('  Provável: a sessão exportada já tinha vencido. Exporte de novo, RECÉM logado no tiktok.com.\n');
    process.exitCode = 1;
  }
  setTimeout(() => process.exit(process.exitCode || 0), 1500).unref();
})();
