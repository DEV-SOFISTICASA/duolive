// MultiPost · Painel (telinha pra postar sem digitar comando)
//
// Sobe um site local pequeno onde você ARRASTA os vídeos, marca as contas e
// clica em Postar — e acompanha o progresso na tela. Por baixo, usa o mesmo
// motor já testado (postar-massa.js), então herda a IA da legenda, a variação
// por conta, o espaçamento e o modo ENSAIO/REAL.
//
// Como usar:
//   npm run painel
//   (abre sozinho no navegador; se não abrir, entre em http://127.0.0.1:9898)
//
// Nada é publicado sem você mandar: o painel tem um botão de ENSAIO (padrão,
// não publica) e um de PUBLICAR DE VERDADE (que pede confirmação).

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const C = require('./contas-postar.js');

const PORTA = +(process.env.MULTIPOST_PORTA || 9898);
const PASTA_VIDEOS = path.join(__dirname, 'videos');
const HTML = path.join(__dirname, 'painel-multipost.html');
const EXTS = /\.(mp4|mov|webm|avi|mkv|m4v)$/i;

try { fs.mkdirSync(PASTA_VIDEOS, { recursive: true }); } catch (e) {}

// ---- estado do "trabalho" em andamento (pra mostrar o progresso na tela) ----
let job = { rodando: false, linhas: [], filho: null, comecou: 0, real: false };
function loga(linha) {
  job.linhas.push(String(linha));
  if (job.linhas.length > 500) job.linhas = job.linhas.slice(-500); // não cresce sem fim
}

// tem chave da IA? (só pra avisar no painel; não bloqueia)
function temChaveIA() {
  try {
    const t = fs.readFileSync(path.join(__dirname, 'chave-ia.txt'), 'utf8');
    return /AQ\.[0-9A-Za-z_.-]{10,}|AIza[0-9A-Za-z_-]{10,}/.test(t);
  } catch (e) { return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY); }
}

function listaVideos() {
  let arqs = [];
  try { arqs = fs.readdirSync(PASTA_VIDEOS); } catch (e) {}
  return arqs.filter((a) => EXTS.test(a)).map((a) => {
    let kb = 0; try { kb = Math.round(fs.statSync(path.join(PASTA_VIDEOS, a)).size / 1024); } catch (e) {}
    return { nome: a, kb };
  });
}

function estado() {
  const comLogin = new Set(C.contasComLogin());
  // mostra as contas com login + as listadas à mão (contas-postar.txt), sem repetir
  const nomes = Array.from(new Set([...comLogin, ...C.contasListadas()]));
  const contas = nomes.sort().map((n) => ({ nome: n, logado: comLogin.has(n) }));
  return { contas, videos: listaVideos(), temChave: temChaveIA(), rodando: job.rodando };
}

// soma `add` minutos a "HH:MM" e devolve "HH:MM" (mesmo dia; passou de 23:59 dá volta)
function horaMais(base, add) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(base || '').trim());
  if (!m) return '';
  let total = (+m[1]) * 60 + (+m[2]) + (add || 0);
  total = ((total % 1440) + 1440) % 1440;
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

// ---- posta os vídeos escolhidos, um por vez, nas contas escolhidas ----
// Reusa o postar-massa.js: pra cada vídeo, chama ele com as contas. O postar-massa
// cuida da legenda pela IA, da variação por conta e do espaçamento entre contas.
// Se `agendar` (HH:MM) vier, PROGRAMA cada postagem no TikTok, espaçada `intervalo`
// min: vídeo j começa em agendar + j × (nº de contas × intervalo).
function postar({ videos, contas, loja, dica, real, agendar, intervalo }) {
  if (job.rodando) return;
  intervalo = intervalo || 15;
  job = { rodando: true, linhas: [], filho: null, comecou: Date.now(), real: !!real };
  loga('== MultiPost ' + (real ? '· PUBLICANDO DE VERDADE' : '· ENSAIO (não publica)') + (agendar ? ' · 📅 PROGRAMANDO a partir de ' + agendar : '') + ' ==');
  loga('Vídeos: ' + videos.length + '   Contas: ' + contas.join(', '));
  loga('');

  const massa = path.join(__dirname, 'postar-massa.js');
  let i = 0;
  const proximo = () => {
    if (!job.rodando) { loga('\n(parado a pedido seu)'); return; }
    if (i >= videos.length) { job.rodando = false; loga('\n== fim: ' + videos.length + ' vídeo(s) processado(s) =='); return; }
    const nome = videos[i];
    const caminho = path.join(PASTA_VIDEOS, nome);
    loga('\n──────── vídeo ' + (i + 1) + '/' + videos.length + ': ' + nome + ' ────────');
    const args = [massa, '--video', caminho, '--contas', contas.join(',')];
    if (loja) args.push('--loja', loja);
    if (dica) args.push('--dica', dica);
    if (agendar) { args.push('--agendar', horaMais(agendar, i * contas.length * intervalo), '--intervalo', String(intervalo)); }
    const env = Object.assign({}, process.env);
    if (real) env.POSTAR_REAL = '1';
    const filho = spawn(process.execPath, args, { env, cwd: __dirname });
    job.filho = filho;
    filho.stdout.on('data', (d) => String(d).split(/\r?\n/).forEach((l) => { if (l.trim()) loga(l); }));
    filho.stderr.on('data', (d) => String(d).split(/\r?\n/).forEach((l) => { if (l.trim()) loga(l); }));
    filho.on('close', () => {
      job.filho = null;
      i++;
      if (!job.rodando) return;
      if (i < videos.length && real && !agendar) {
        // publicando AGORA: espaça ENTRE vídeos (2–5 min) pra não parecer robô.
        // (agendando não precisa: o espaçamento já está nos horários programados)
        const min = 2, max = 5;
        const ms = Math.round((min + Math.random() * (max - min)) * 60000);
        loga('\naguardando ' + Math.round(ms / 60000) + ' min até o próximo vídeo...');
        setTimeout(proximo, ms);
      } else {
        setTimeout(proximo, real ? 3000 : 800);
      }
    });
  };
  proximo();
}

// ---- conectar uma conta: planta os cookies colados no perfil dela ----
// Reusa o cookies-para-sessao.js (que abre o navegador, planta e valida).
function plantarCookies(conta, textoCookies) {
  return new Promise((resolve) => {
    const tmp = path.join(os.tmpdir(), 'multipost-ck-' + conta + '-' + Date.now() + '.json');
    try { fs.writeFileSync(tmp, textoCookies); }
    catch (e) { return resolve({ ok: false, mensagem: 'Não consegui salvar os cookies aqui no PC.' }); }
    const script = path.join(__dirname, 'cookies-para-sessao.js');
    const filho = spawn(process.execPath, [script, '--conta', conta, '--arquivo', tmp], { cwd: __dirname });
    let saida = '';
    filho.stdout.on('data', (d) => { saida += d; });
    filho.stderr.on('data', (d) => { saida += d; });
    filho.on('close', () => {
      try { fs.unlinkSync(tmp); } catch (e) {}
      const logado = /ATIVO no perfil/.test(saida);
      // pega a última linha útil pra mostrar no painel
      const linhas = saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const msg = logado
        ? 'Conta "' + conta + '" conectada e ativa! ✅'
        : (linhas.reverse().find((l) => /😕|pediu login|sessionid|inválid|venc/i.test(l)) || 'Não deu pra conectar — confira os cookies.');
      resolve({ ok: logado, mensagem: msg });
    });
  });
}

// ---- helpers HTTP ----
function json(res, obj, codigo) { res.writeHead(codigo || 200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function lerCorpo(req) {
  return new Promise((resolve) => {
    const partes = [];
    req.on('data', (c) => partes.push(c));
    req.on('end', () => resolve(Buffer.concat(partes)));
  });
}
function nomeSeguro(n) { return String(n || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\.\.+/g, '.').trim(); }

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  try {
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      fs.readFile(HTML, (err, buf) => {
        if (err) { res.writeHead(500); res.end('painel-multipost.html não encontrado'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(buf);
      });
      return;
    }
    if (req.method === 'GET' && u.pathname === '/api/estado') return json(res, estado());
    if (req.method === 'GET' && u.pathname === '/api/progresso') return json(res, { rodando: job.rodando, linhas: job.linhas });

    if (req.method === 'POST' && u.pathname === '/api/upload') {
      const nome = nomeSeguro(u.searchParams.get('nome'));
      if (!nome || !EXTS.test(nome)) return json(res, { ok: false, erro: 'nome de vídeo inválido' }, 400);
      const buf = await lerCorpo(req);
      fs.writeFileSync(path.join(PASTA_VIDEOS, nome), buf);
      return json(res, { ok: true, nome, kb: Math.round(buf.length / 1024) });
    }
    if (req.method === 'POST' && u.pathname === '/api/apagar') {
      const nome = nomeSeguro(u.searchParams.get('nome'));
      try { fs.unlinkSync(path.join(PASTA_VIDEOS, nome)); } catch (e) {}
      return json(res, { ok: true });
    }
    if (req.method === 'POST' && u.pathname === '/api/postar') {
      if (job.rodando) return json(res, { ok: false, erro: 'já tem um trabalho rodando' }, 409);
      const corpo = JSON.parse((await lerCorpo(req)).toString('utf8') || '{}');
      const videos = (corpo.videos || []).map(nomeSeguro).filter((n) => fs.existsSync(path.join(PASTA_VIDEOS, n)));
      const contas = (corpo.contas || []).map((s) => String(s).trim()).filter(Boolean);
      if (!videos.length) return json(res, { ok: false, erro: 'escolha pelo menos um vídeo' }, 400);
      if (!contas.length) return json(res, { ok: false, erro: 'escolha pelo menos uma conta' }, 400);
      // 📅 agendar: HH:MM válido liga o modo "Programar"; senão publica/ensaia agora
      const agendar = /^\d{1,2}:\d{2}$/.test(String(corpo.agendar || '').trim()) ? corpo.agendar.trim() : '';
      postar({ videos, contas, loja: corpo.loja || '', dica: corpo.dica || '', real: !!corpo.real, agendar });
      return json(res, { ok: true });
    }
    if (req.method === 'POST' && u.pathname === '/api/parar') {
      job.rodando = false;
      if (job.filho) { try { job.filho.kill(); } catch (e) {} }
      return json(res, { ok: true });
    }
    if (req.method === 'POST' && u.pathname === '/api/plantar-cookies') {
      const corpo = JSON.parse((await lerCorpo(req)).toString('utf8') || '{}');
      const conta = nomeSeguro(corpo.conta);
      const cookies = String(corpo.cookies || '').trim();
      if (!conta) return json(res, { ok: false, mensagem: 'Escreva o apelido da conta (ex.: monaco).' }, 400);
      if (!cookies) return json(res, { ok: false, mensagem: 'Cole os cookies na caixinha.' }, 400);
      const r = await plantarCookies(conta, cookies);
      return json(res, r);
    }
    res.writeHead(404); res.end('não achei');
  } catch (e) {
    json(res, { ok: false, erro: e.message }, 500);
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('\n  O painel já está aberto (porta ' + PORTA + ' em uso).');
    console.log('  Abra no navegador:  http://127.0.0.1:' + PORTA);
    console.log('  (Se quiser reiniciar, feche a outra janela do painel antes.)\n');
  } else {
    console.log('\n  Não consegui abrir o painel: ' + e.message + '\n');
  }
  process.exit(1);
});

server.listen(PORTA, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + PORTA;
  console.log('');
  console.log('  MultiPost · Painel no ar 🎬');
  console.log('  Abra no navegador:  ' + url);
  console.log('  Jogue os vídeos na tela, marque as contas e clique em Postar.');
  console.log('  (Ctrl+C aqui fecha o painel.)');
  console.log('');
  // tenta abrir o navegador sozinho (Windows)
  try { execFile('cmd', ['/c', 'start', '', url]); } catch (e) {}
});
