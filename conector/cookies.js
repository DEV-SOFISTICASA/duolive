// DuoLive · Entende o que você colou da aba Network do Chrome
//
// Aceita três formatos, porque cada um copia de um jeito:
//   1. "Copy as cURL" do Chrome — no Windows sai com aspas duplas e ^ no fim
//      das linhas; no Linux/Mac sai com aspas simples e \. Os dois valem.
//   2. só a linha do cabeçalho:  cookie: sessionid=abc; tt_ticket=xyz
//   3. o JSON exportado pela extensão Cookie-Editor
//
// A saída é o mesmo formato de sessão que o Playwright já usa (storageState),
// então os robôs que existem hoje passam a funcionar sem mudar nada.

// domínio dos cookies quando não dá para descobrir pela URL colada
const DOMINIO_PADRAO = {
  tiktok: '.tiktok.com',
  console: '.tiktokshop.com',
  shopee: '.shopee.com.br',
};

// O Chrome no Windows tem DOIS "Copy as cURL": o (bash), com aspas normais, e o
// (cmd), que escapa TUDO com ^ — as aspas viram ^" e as de dentro viram ^\^".
// Sem desfazer isso primeiro, nenhum -H "..." casa e parece que nao ha cookie.
function tiraEscapeDoCmd(s) {
  return String(s)
    .replace(/\^\\\^"/g, '\\"')  // aspas DENTRO do valor
    .replace(/\^"/g, '"')        // aspas que abrem e fecham
    .replace(/\^\^/g, '^');      // ^ literal
}

// junta as linhas quebradas por \ (bash) ou ^ (prompt do Windows)
function juntaLinhas(txt) {
  return tiraEscapeDoCmd(String(txt || '')
    .replace(/\r/g, '')
    .replace(/[\\^]\s*\n\s*/g, ' ')
    .replace(/\n/g, ' '));
}

// tira as aspas de um pedaço, aceitando ' ou "
function semAspas(s) {
  let t = String(s || '').trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1, -1);
  return t;
}

// pega todos os -H "nome: valor" de um comando cURL
function cabecalhosDoCurl(linha) {
  const h = {};
  const re = /-H\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  let m;
  while ((m = re.exec(linha))) {
    const bruto = semAspas(m[1]);
    const i = bruto.indexOf(':');
    if (i < 1) continue;
    const nome = bruto.slice(0, i).trim().toLowerCase();
    const valor = bruto.slice(i + 1).trim();
    if (nome && valor) h[nome] = valor;
  }
  return h;
}

// a URL do comando (o primeiro pedaço entre aspas que comece com http)
function urlDoCurl(linha) {
  const re = /("https?:\/\/[^"]+"|'https?:\/\/[^']+'|https?:\/\/[^\s"']+)/;
  const m = linha.match(re);
  return m ? semAspas(m[1]) : '';
}

// o corpo enviado (--data-raw, --data, -d, --data-binary)
function corpoDoCurl(linha) {
  const re = /--data(?:-raw|-binary|-ascii)?\s+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/;
  const m = linha.match(re);
  return m ? semAspas(m[1]) : '';
}

// "a=1; b=2" -> [{name:'a',value:'1'}, ...]
function partePares(s) {
  return String(s || '').split(';').map((p) => {
    const t = p.trim();
    const i = t.indexOf('=');
    if (i < 1) return null;
    const name = t.slice(0, i).trim();
    const value = t.slice(i + 1).trim();
    return name ? { name: name, value: value } : null;
  }).filter(Boolean);
}

// entende qualquer um dos três formatos e devolve o que deu para aproveitar
function entende(texto, plataforma) {
  const cru = String(texto || '').trim();
  if (!cru) throw new Error('Nao colei nada aqui.');

  // ---- formato 3: JSON do Cookie-Editor ----
  if (cru.startsWith('[') || cru.startsWith('{')) {
    let j;
    try { j = JSON.parse(cru); } catch (e) { throw new Error('Parece JSON mas nao consegui ler. Copie de novo.'); }
    const lista = Array.isArray(j) ? j : (Array.isArray(j.cookies) ? j.cookies : null);
    if (!lista) throw new Error('Esse JSON nao tem uma lista de cookies.');
    // o Cookie-Editor traz campos ricos (expirationDate, hostOnly, sameSite,
    // secure, httpOnly...). Guardamos o que ele der em vez de inventar — assim a
    // sessao fica igualzinha a do navegador, com a validade certa de cada cookie.
    const cookies = lista
      .filter((c) => c && c.name)
      .map((c) => {
        const o = { name: String(c.name), value: String(c.value == null ? '' : c.value), domain: c.domain ? String(c.domain) : '' };
        if (c.path) o.path = String(c.path);
        if (typeof c.secure === 'boolean') o.secure = c.secure;
        if (typeof c.httpOnly === 'boolean') o.httpOnly = c.httpOnly;
        if (c.sameSite) o.sameSite = c.sameSite;
        // Cookie-Editor usa 'expirationDate' (segundos); o Playwright usa 'expires'
        if (typeof c.expirationDate === 'number') o.expires = Math.round(c.expirationDate);
        else if (typeof c.expires === 'number') o.expires = c.expires;
        return o;
      });
    if (!cookies.length) throw new Error('O JSON veio sem nenhum cookie.');
    return { cookies: cookies, url: '', metodo: 'GET', cabecalhos: {}, corpo: '', origem: 'cookie-editor' };
  }

  // ---- formatos 1 e 2: cURL ou linha de cookie ----
  const linha = juntaLinhas(cru);
  const cabecalhos = cabecalhosDoCurl(linha);
  const url = urlDoCurl(linha);
  const corpo = corpoDoCurl(linha);

  // o cookie pode vir do -H "cookie: ..." ou da linha colada direto
  let bruto = cabecalhos.cookie || '';
  if (!bruto) {
    const m = linha.match(/(?:^|\s)cookie\s*:\s*(.+)$/i);
    if (m) bruto = m[1].trim();
    else if (/=/.test(linha) && !/^curl\b/i.test(linha.trim())) bruto = linha; // colou só "a=1; b=2"
  }
  const cookies = partePares(bruto);
  if (!cookies.length) {
    // Diz O QUE foi lido, senao a gente fica adivinhando: se os cabeçalhos
    // apareceram mas nenhum é cookie, o problema está no Chrome; se nem os
    // cabeçalhos apareceram, o problema é o formato do que foi colado.
    const nomes = Object.keys(cabecalhos);
    const lidos = nomes.length ? (' Li estes cabecalhos: ' + nomes.slice(0, 12).join(', ')
      + (nomes.length > 12 ? '...' : '') + '.') : ' Nao consegui ler cabecalho nenhum.';

    if (url) {
      const telemetria = /slardar|\/monitor|\/log|beacon|report|analytics|\/mon\b|webid|\/track/i.test(url)
        || /slardar|monitor_web|log_report/i.test(linha);
      if (telemetria) {
        throw new Error('Essa linha e de telemetria do site (ela nao carrega cookie nenhum). Clique no botao'
          + ' "Doc" no DevTools e copie a PRIMEIRA linha da lista.' + lidos);
      }
      if (nomes.length) {
        // Entendi o comando e li os cabeçalhos, mas o Chrome nao mandou o cookie.
        throw new Error('Entendi o comando e li ' + nomes.length + ' cabecalhos, mas o Chrome NAO incluiu o cookie'
          + ' nessa copia.' + lidos
          + ' Caminho mais garantido: instale a extensao Cookie-Editor, abra a pagina da loja,'
          + ' clique nela, Export > JSON, e cole aqui.');
      }
      throw new Error('Achei a URL mas nao consegui ler os cabecalhos — o formato da copia pode ser outro.'
        + ' Tente o Cookie-Editor (Export > JSON) e cole aqui.');
    }
    throw new Error('Nao achei nenhum cookie no que voce colou.' + lidos
      + ' Confira se copiou "Copy as cURL" da requisicao certa.');
  }

  // cabeçalhos que não fazem sentido repetir numa outra máquina
  const limpos = {};
  Object.keys(cabecalhos).forEach((k) => {
    if (/^(cookie|host|content-length|connection|:.*)$/i.test(k)) return;
    limpos[k] = cabecalhos[k];
  });

  return {
    cookies: cookies,
    url: url,
    metodo: corpo ? 'POST' : 'GET',
    cabecalhos: limpos,
    corpo: corpo,
    origem: url ? 'curl' : 'cookie',
  };
}

// ---------- confere se você copiou a requisição da loja certa ----------
// Sem isso, copiar a linha errada (um anúncio, um CDN, outra aba) "conectaria"
// uma sessão que não vale nada — e você só descobriria quando o robô falhasse.
const DONO = {
  tiktok: /(^|\.)tiktok\.com$/i,
  console: /(^|\.)(tiktok\.com|tiktokshop\.com)$/i,
  shopee: /(^|\.)shopee\.com(\.br)?$/i,
};
// cookies que só existem quando você está de fato logado
const DE_LOGIN = {
  tiktok: /^(sessionid|sessionid_ss|sid_tt|sid_guard|tt_ticket|passport_auth|store_idc)$/i,
  console: /^(sessionid|sessionid_ss|sid_tt|sid_guard|tt_ticket|passport_auth|store_idc)$/i,
  shopee: /^(SPC_ST|SPC_EC|SPC_U|SPC_SC_SESSION|SPC_R_T_ID|SPC_SI)$/i,
};
const NOME_BONITO = { tiktok: 'TikTok Seller', console: 'Console de LIVE', shopee: 'Shopee' };

function confere(lido, plataforma) {
  // 1) a requisição é mesmo da plataforma escolhida?
  if (lido.url) {
    let host = '';
    try { host = new URL(lido.url).hostname; } catch (e) {}
    const dono = DONO[plataforma];
    if (host && dono && !dono.test(host)) {
      const certo = Object.keys(DONO).find((p) => DONO[p].test(host));
      throw new Error('Essa requisicao e de "' + host + '", que nao e a ' + (NOME_BONITO[plataforma] || plataforma) + '.'
        + (certo ? ' Parece ser da ' + NOME_BONITO[certo] + ' — escolha essa plataforma aqui em cima.'
                 : ' Copie uma requisicao da pagina da loja.'));
    }
  }
  // 2) tem cookie de sessão de verdade?
  const re = DE_LOGIN[plataforma];
  if (re && !lido.cookies.some((c) => re.test(c.name))) {
    throw new Error('Achei ' + lido.cookies.length + ' cookie(s), mas nenhum e' + ' de login da '
      + (NOME_BONITO[plataforma] || plataforma) + '. Confira se voce esta logado nessa conta e copie'
      + ' uma requisicao da propria pagina da loja (aba Fetch/XHR).');
  }
  return true;
}

// vira uma sessão no formato que o Playwright (e os robôs de hoje) entendem
function paraSessao(entendido, plataforma) {
  let dominio = DOMINIO_PADRAO[plataforma] || '';
  if (entendido.url) {
    try {
      const h = new URL(entendido.url).hostname;             // ex.: shop.tiktok.com
      const partes = h.split('.');
      // .tiktok.com  ·  .shopee.com.br  (mantém 3 pedaços quando termina em .br)
      dominio = '.' + (h.endsWith('.br') ? partes.slice(-3) : partes.slice(-2)).join('.');
    } catch (e) {}
  }
  // sameSite do Playwright só aceita 'Strict' | 'Lax' | 'None'
  const arruma = (s) => {
    const t = String(s || '').toLowerCase();
    if (t === 'strict') return 'Strict';
    if (t === 'none' || t === 'no_restriction') return 'None';
    return 'Lax';
  };
  const cookies = entendido.cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain || dominio,
    // respeita o que veio do Cookie-Editor; só completa o que faltar
    path: c.path || '/',
    expires: typeof c.expires === 'number' ? c.expires : -1,
    httpOnly: typeof c.httpOnly === 'boolean' ? c.httpOnly : false,
    secure: typeof c.secure === 'boolean' ? c.secure : true,
    sameSite: arruma(c.sameSite),
  }));
  return { cookies: cookies, origins: [] };
}

module.exports = { entende, confere, paraSessao, DOMINIO_PADRAO, juntaLinhas, partePares };
