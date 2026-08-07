// DuoLive · Conector de alertas do streamer
//
// Capta os eventos da sua live no TikTok (mensagens, seguidores, presentes,
// entradas, espectadores) e alimenta o dock de alertas dentro do OBS.
//
// Como usar:
//   1. npm install            (só na primeira vez)
//   2. npm start -- @seuusuario
//   3. No OBS: Docks -> Docks personalizados do navegador -> URL http://127.0.0.1:9797
//
// Modo de teste (sem estar ao vivo):  DUOLIVE_TESTE=1 npm start
//
// Compras e Shopee: as plataformas nao liberam eventos de compra para fora —
// acompanhe os pedidos pelos docks Shopee Creator / TikTok Seller Center (ver guia).

const http = require('http');
const fs = require('fs');
const path = require('path');
const L = require('./lojas.js');
const COOKIES = require('./cookies.js');
const AUTH = require('./auth.js');
const SB = require('./supabase.js');
const CONTAS = require('./contas.js');
const OFERTAS = require('./ofertas.js');

// PORT e' o padrao da nuvem (Render/Railway); DUOLIVE_PORTA e' o local
const PORTA = +(process.env.PORT || process.env.DUOLIVE_PORTA || 9797);
const NA_NUVEM = !!process.env.PORT; // Render define PORT
const TESTE = process.env.DUOLIVE_TESTE === '1';
// usuario do TikTok: por argumento (local) ou por variavel de ambiente (nuvem).
// e' 'let' porque o seletor de lojas no painel troca a conta em tempo real.
let usuario = (process.argv[2] || process.env.DUOLIVE_TIKTOK_USER || '').replace(/^@/, '');

// ---------- servidor: multichat + vendas anotadas + WebSocket ----------
let vendasAnotadas = [];        // manuais (o multichat manda a lista)
let vendasAuto = [];            // automaticas (o robo de vendas por cookies)
const vendasAutoIds = new Set(); // evita contar o mesmo pedido duas vezes
// sistema de vendedoras: quem esta' vendendo agora e quando a live atual comecou.
// O grafico do historico agrupa as vendas POR LIVE (horario = inicio da live).
let siglaAtiva = '';            // sigla da vendedora logada que esta' na live
let siglaAtivaTs = 0;           // quando foi marcada (expira sozinha)
let liveAtualInicio = 0;        // horario que a live atual comecou
let ultimaVendaTs = 0;          // ultima venda vista (para detectar quando comeca outra live)

// estado AO VIVO da conta ativa (vem da conexao do chat do TikTok)
let liveEstado = { espectadores: 0, likes: 0, inicio: 0 };
// numeros oficiais do console de lives (Compass) por loja, lidos por cookies como no LiveDash
const compassPorLoja = {}; // { loja: { gmv, orders, views, ts } }
let lojaAtual = '';        // qual loja o painel esta mostrando

// horario da LIVE atual (o grafico usa isto): a 1a venda, ou a volta depois de
// +40 min parado, abre uma live nova. Se o chat estiver conectado, usa o inicio dele.
function inicioDaLiveAtual() {
  const agora = Date.now();
  if (!liveAtualInicio || (ultimaVendaTs && agora - ultimaVendaTs > 40 * 60000)) {
    liveAtualInicio = liveEstado.inicio || agora;
  }
  ultimaVendaTs = agora;
  return liveAtualInicio;
}
// grava a venda no historico (Supabase). Nao trava o fluxo se der erro/estiver off.
function gravaVendaHistorico(v) {
  if (!SB.ativo()) return;
  const sigla = (siglaAtiva && (Date.now() - siglaAtivaTs < 12 * 3600000)) ? siglaAtiva : null;
  const ts = new Date(inicioDaLiveAtual()).toISOString();
  const linha = {
    order_id: String(v.orderId || v.id || ('m' + Date.now() + Math.round(Math.random() * 1e6))),
    sigla: sigla, quem: v.quem || null, produto: v.produto || null,
    valor: (+v.valor || 0) || null, plataforma: v.plataforma || 'tiktok',
    loja: lojaAtual || null, ts: ts,
  };
  SB.upsert('vendas', [linha], 'order_id').catch(() => {}); // upsert = nao conta 2x
}
// ofertas relampago NO AR (varias ao mesmo tempo), transmitidas para todos os aparelhos
let ofertas = [];
// VARIAS lojas; cada loja junta as DUAS contas (TikTok + Shopee) com os produtos
// de cada uma:  lojas['bellini'] = { nome, contas:{tiktok,shopee}, produtos:{tiktok:[],shopee:[]}, ts:{} }
const lojas = {};
// O nome da loja passa SEMPRE pela mesma limpeza (a de lojas.js, que tambem
// batiza os arquivos de login). Sem isso, "Petit Store" digitado no painel e
// "petit-store" gravado pelo login virariam duas lojas diferentes na lista.
function achaLoja(nome) {
  const n = L.limpaNome(nome);
  if (!lojas[n]) lojas[n] = { nome: n, contas: { tiktok: '', shopee: '' }, produtos: { tiktok: [], shopee: [] }, ts: {} };
  return lojas[n];
}
// qual loja o painel esta mostrando (lojaAtual) — cai na primeira se nao escolheram.
// Nao cria loja nenhuma aqui: senao aparece uma loja vazia na lista.
const LOJA_VAZIA = { nome: '', contas: { tiktok: '', shopee: '' }, produtos: { tiktok: [], shopee: [] }, ts: {} };
function lojaDoPainel() {
  if (lojas[lojaAtual]) return lojas[lojaAtual];
  const nomes = Object.keys(lojas);
  return nomes.length ? lojas[nomes[0]] : LOJA_VAZIA;
}

function limpaOfertas() { // tira do ar as que ja venceram
  const agora = Date.now();
  const antes = ofertas.length;
  ofertas = ofertas.filter((o) => o && o.fim > agora);
  return antes !== ofertas.length;
}

// ---------- registro das lives da Shopee (fica salvo no seu PC) ----------
const ARQ_SHOPEE = path.join(__dirname, 'historico-shopee.json');
let shopeeLives = [];
try { shopeeLives = JSON.parse(fs.readFileSync(ARQ_SHOPEE, 'utf8')); } catch (e) {}
let salvaAgendado = null;
function salvaShopee() {
  if (salvaAgendado) return;
  salvaAgendado = setTimeout(() => {
    salvaAgendado = null;
    fs.writeFile(ARQ_SHOPEE, JSON.stringify(shopeeLives), () => {});
  }, 3000);
}
function liveShopeeAtual() {
  const agora = Date.now();
  let l = shopeeLives[shopeeLives.length - 1];
  // mais de 2h sem nada = live nova
  if (!l || agora - l.fim > 2 * 3600 * 1000) {
    l = { inicio: agora, fim: agora, mensagens: 0 };
    shopeeLives.push(l);
    if (shopeeLives.length > 200) shopeeLives.shift();
  }
  l.fim = agora;
  salvaShopee();
  return l;
}

// Rotas que o ROBÔ usa (mandam dados de máquina). Não têm cookie de navegador;
// quando há senha na nuvem, elas se protegem pelo token (DUOLIVE_TOKEN).
const ROTAS_MAQUINA = ['/venda-auto', '/numeros-tiktok', '/eventos', '/produtos', '/oferta-estado'];
// Rotas liberadas sem login (a própria tela de senha e o que ela precisa).
const ROTAS_LIVRES = ['/login', '/entrar', '/favicon.ico'];

function paginaLogin() {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>DuoLive · Entrar</title>
<style>:root{--bg:#0d0d10;--card:#16161b;--line:#26262e;--text:#ececf1;--accent:#ff5c35;--ok:#4ade80}
*{box-sizing:border-box;margin:0}body{background:var(--bg);color:var(--text);font:14px -apple-system,"Segoe UI",Roboto,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
form{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px;width:340px;max-width:92vw}
h1{font-size:20px;margin-bottom:4px}p{color:#a3a3ad;font-size:12.5px;margin-bottom:8px}
label{display:block;font-size:11px;color:#737373;margin:12px 0 5px;text-transform:uppercase;letter-spacing:.4px}
select,input{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:9px;color:var(--text);padding:11px 13px;font-size:14px;outline:none}
select:focus,input:focus{border-color:var(--accent)}
button{width:100%;margin-top:16px;padding:11px;border:0;border-radius:9px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer}
.erro{color:#f87171;font-size:12.5px;margin-top:10px}.aviso{color:var(--ok);font-size:12px;margin-top:8px}</style></head><body>
<form id="f"><h1>🎥 DuoLive</h1><p>Escolha seu nome e entre.</p>
<label>Nome</label><select id="quem"><option>carregando...</option></select>
<label id="lbl">Senha</label>
<input type="password" id="senha" placeholder="Senha" autocomplete="current-password">
<button type="submit">Entrar</button>
<div class="aviso" id="aviso"></div><div class="erro" id="erro"></div></form>
<script>
var pessoas=[];
fetch('/usuarios-login').then(function(r){return r.json();}).then(function(l){
  pessoas=l||[];var s=document.getElementById('quem');s.innerHTML='';
  pessoas.forEach(function(u){var o=document.createElement('option');o.value=u.sigla;o.textContent=u.rotulo;s.appendChild(o);});
  aviso();
}).catch(function(){document.getElementById('erro').textContent='Não consegui carregar os nomes.';});
function achou(){var v=document.getElementById('quem').value;return pessoas.filter(function(u){return u.sigla===v;})[0];}
function aviso(){var u=achou(),a=document.getElementById('aviso'),l=document.getElementById('lbl'),s=document.getElementById('senha');
  if(u&&u.primeiroAcesso){a.textContent='Primeiro acesso — a senha que digitar será a sua a partir de agora.';l.textContent='Crie sua senha';s.placeholder='Nova senha';}
  else{a.textContent='';l.textContent='Senha';s.placeholder='Senha';}}
document.getElementById('quem').onchange=aviso;
document.getElementById('f').onsubmit=function(e){e.preventDefault();document.getElementById('erro').textContent='';
  fetch('/entrar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sigla:document.getElementById('quem').value,senha:document.getElementById('senha').value})})
  .then(function(r){return r.json();}).then(function(v){if(v&&v.ok){location.href='/painel';}else{document.getElementById('erro').textContent=(v&&v.erro)||'Não consegui entrar.';}})
  .catch(function(){document.getElementById('erro').textContent='Erro de conexão.';});};
</script></body></html>`;
}

const server = http.createServer((req, res) => {
  // deixa o analytics (que roda no site) buscar as vendas aqui do seu PC
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-duolive-token');
  if (req.method === 'OPTIONS') { res.end(); return; }

  const caminhoLimpo = req.url.split('?')[0];

  // saúde: o Render bate aqui para saber se o serviço está no ar. Sempre 200, sem senha.
  if (caminhoLimpo === '/saude') { res.setHeader('content-type', 'text/plain'); res.end('ok'); return; }

  // ---- porteiro: com o sistema de contas (Supabase) cada pessoa entra na sua.
  //      Acesso LOCAL (robô, OBS) e o robô com token passam livres. ----
  const usaContas = SB.ativo();
  if (usaContas || AUTH.protegido()) {
    // menu de nomes para a tela de login (livre)
    if (caminhoLimpo === '/usuarios-login') {
      res.setHeader('content-type', 'application/json');
      if (!usaContas) { res.end('[]'); return; }
      CONTAS.listaParaLogin()
        .then((l) => res.end(JSON.stringify(l.map((u) => ({ sigla: u.sigla, rotulo: u.rotulo, primeiroAcesso: u.primeiroAcesso })))))
        .catch(() => { res.statusCode = 500; res.end('[]'); });
      return;
    }
    // login: {sigla, senha} (novo, por conta). Sem contas, cai na senha única antiga.
    if (caminhoLimpo === '/entrar' && req.method === 'POST') {
      let corpo = '';
      req.on('data', (d) => { corpo += d; if (corpo.length > 4096) req.destroy(); });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (usaContas) {
          let b = {}; try { b = JSON.parse(corpo); } catch (e) {}
          CONTAS.entrar(b.sigla, b.senha).then((r) => {
            if (r.ok) {
              res.setHeader('Set-Cookie', AUTH.COOKIE + '=' + encodeURIComponent(CONTAS.criaToken(r.usuario)) + '; Path=/; Max-Age=' + (30 * 86400) + '; HttpOnly; SameSite=Lax');
              res.end(JSON.stringify({ ok: true, primeiroAcesso: !!r.primeiroAcesso }));
            } else { res.statusCode = 200; res.end(JSON.stringify({ ok: false, erro: r.erro })); }
          }).catch(() => { res.statusCode = 500; res.end('{"ok":false,"erro":"erro no servidor"}'); });
        } else {
          const senha = decodeURIComponent(String((corpo.match(/senha=([^&]*)/) || [])[1] || '').replace(/\+/g, ' '));
          if (AUTH.senhaConfere(senha)) { res.setHeader('Set-Cookie', AUTH.cookieSet()); res.statusCode = 302; res.setHeader('Location', '/painel'); res.end(); }
          else { res.statusCode = 401; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(paginaLogin()); }
        }
      });
      return;
    }
    if (caminhoLimpo === '/login') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(paginaLogin()); return; }
    if (caminhoLimpo === '/sair') {
      res.setHeader('Set-Cookie', AUTH.COOKIE + '=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
      res.statusCode = 302; res.setHeader('Location', '/login'); res.end(); return;
    }

    // quem está logado (sessão de conta); guarda no req para as rotas saberem o papel
    req.usuario = usaContas ? CONTAS.leToken(AUTH.cookieDoPedido(req)) : null;
    const livre = ['/login', '/usuarios-login', '/entrar', '/sair', '/favicon.ico'].includes(caminhoLimpo);
    const local = !AUTH.veioDeFora(req);           // acesso do próprio PC (robô, OBS)
    const eRobo = AUTH.temTokenValido(req);         // robô mandando dados para a nuvem
    const logado = usaContas ? !!req.usuario : AUTH.autenticado(req);
    if (!livre && !local && !eRobo && !logado) {
      const querPagina = (req.headers.accept || '').includes('text/html');
      if (querPagina) { res.statusCode = 302; res.setHeader('Location', '/login'); res.end(); }
      else { res.statusCode = 401; res.setHeader('content-type', 'application/json'); res.end('{"erro":"nao autenticado"}'); }
      return;
    }
  }

  // quem esta' logado (o painel mostra o nome + botao Sair). De quebra, marca a
  // sigla da vendedora como "ativa na live" — as vendas do robo saem no nome dela.
  if (req.url.split('?')[0] === '/eu') {
    res.setHeader('content-type', 'application/json');
    const u = req.usuario || null;
    if (!u) { res.end('{}'); return; }
    if (u.papel === 'vendedora' && u.sigla) { siglaAtiva = u.sigla; siglaAtivaTs = Date.now(); }
    // busca o nome ATUAL no banco: o cracha (cookie) pode ter um nome antigo, ex.
    // depois de renomear a vendedora. Assim o painel mostra o nome certo sem relogar.
    if (SB.ativo() && u.sigla) {
      SB.seleciona('usuarios', 'sigla=eq.' + encodeURIComponent(u.sigla) + '&select=nome,papel&limit=1')
        .then((r) => { const a = r && r[0]; res.end(JSON.stringify({ sigla: u.sigla, nome: (a && a.nome) || u.nome, papel: (a && a.papel) || u.papel })); })
        .catch(() => res.end(JSON.stringify({ sigla: u.sigla, nome: u.nome, papel: u.papel })));
      return;
    }
    res.end(JSON.stringify({ sigla: u.sigla, nome: u.nome, papel: u.papel }));
    return;
  }

  // historico de vendas (Supabase) para a pagina /historico. Vendedora ve so' as
  // dela; ADM (ou acesso local do PC) ve todas. O navegador agrupa por live.
  if (req.url.split('?')[0] === '/vendas-historico') {
    res.setHeader('content-type', 'application/json');
    if (!SB.ativo()) { res.end('{"ok":false,"erro":"supabase off"}'); return; }
    const qs = new URLSearchParams((req.url.split('?')[1] || ''));
    const dias = Math.min(90, Math.max(1, +qs.get('dias') || 7));
    const corte = new Date(Date.now() - dias * 86400000).toISOString();
    const u = req.usuario || null;
    const ehAdm = !AUTH.veioDeFora(req) || CONTAS.ehAdm(u);
    let filtro = 'ts=gte.' + corte + '&select=sigla,quem,produto,valor,plataforma,loja,ts&order=ts.desc&limit=5000';
    if (u && u.papel === 'vendedora' && u.sigla) filtro += '&sigla=eq.' + encodeURIComponent(u.sigla);
    Promise.all([
      SB.seleciona('vendas', filtro),
      SB.seleciona('usuarios', 'select=sigla,nome,cor'),
    ]).then((r) => {
      const cores = {}; (r[1] || []).forEach((x) => { cores[x.sigla] = { nome: x.nome, cor: x.cor }; });
      res.end(JSON.stringify({ ok: true, ehAdm: ehAdm, minhaSigla: u ? u.sigla : null, papel: u ? u.papel : null, vendas: r[0] || [], cores: cores }));
    }).catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ ok: false, erro: String(e.message || e) })); });
    return;
  }

  // ---------- Lojas fixas (Monaco/Fast/Mania/Bellini + @). Iguais p/ todos; só o ADM edita ----------
  if (req.url.split('?')[0] === '/lojas-fixas' && req.method === 'GET') {
    res.setHeader('content-type', 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    const ehAdm = !AUTH.veioDeFora(req) || CONTAS.ehAdm(req.usuario);
    const PADRAO = [
      { nome: 'Monaco', tiktok: 'tokdecor12', shopee: null, ordem: 1 },
      { nome: 'Fast', tiktok: 'fasthome46', shopee: null, ordem: 2 },
      { nome: 'Mania', tiktok: 'maniadicasa24', shopee: null, ordem: 3 },
      { nome: 'Bellini', tiktok: 'bellacasa56', shopee: null, ordem: 4 },
    ];
    if (!SB.ativo()) { res.end(JSON.stringify({ ok: true, ehAdm: ehAdm, lojas: PADRAO })); return; }
    SB.seleciona('lojas', 'select=nome,tiktok,shopee,ordem&order=ordem,nome')
      .then((l) => res.end(JSON.stringify({ ok: true, ehAdm: ehAdm, lojas: (l && l.length) ? l : PADRAO })))
      .catch(() => res.end(JSON.stringify({ ok: true, ehAdm: ehAdm, lojas: PADRAO }))); // tabela ainda não criada
    return;
  }
  if ((req.url.startsWith('/lojas-fixas-remover') || req.url.split('?')[0] === '/lojas-fixas') && req.method === 'POST') {
    const ehAdm = !AUTH.veioDeFora(req) || CONTAS.ehAdm(req.usuario);
    if (!ehAdm) { res.statusCode = 403; res.setHeader('content-type', 'application/json'); res.end('{"ok":false,"erro":"So o ADM edita as lojas."}'); return; }
    if (!SB.ativo()) { res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end('{"ok":false,"erro":"Supabase off."}'); return; }
    const remover = req.url.startsWith('/lojas-fixas-remover');
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 8192) req.destroy(); });
    req.on('end', () => {
      let b; try { b = JSON.parse(corpo); } catch (e) { b = null; }
      res.setHeader('content-type', 'application/json');
      const nome = b && String(b.nome || '').trim();
      if (!nome) { res.statusCode = 400; res.end('{"ok":false,"erro":"faltou o nome da loja"}'); return; }
      const acao = remover
        ? SB.req('DELETE', 'lojas?nome=eq.' + encodeURIComponent(nome))
        : SB.upsert('lojas', [{ nome: nome, tiktok: (b.tiktok || '').trim() || null, shopee: (b.shopee || '').trim() || null }], 'nome');
      acao.then(() => res.end('{"ok":true}')).catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ ok: false, erro: String(e.message || e) })); });
    });
    return;
  }

  // recebe as mensagens do chat da Shopee (mandadas pelo espião que roda no navegador)
  if (req.url.startsWith('/eventos') && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 65536) req.destroy(); });
    req.on('end', () => {
      try {
        const ev = JSON.parse(corpo);
        const texto = String(ev.texto || '').slice(0, 300).trim();
        const quem = String(ev.quem || '').slice(0, 60).trim();
        if (texto) {
          emitir({ tipo: 'mensagem', quem: quem, texto: texto, plataforma: 'shopee' });
          liveShopeeAtual().mensagens++;
        }
      } catch (e) {}
      res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
    });
    return;
  }

  // venda detectada automaticamente pelo robo de vendas (cookies) — POST /venda-auto
  if (req.url.startsWith('/venda-auto') && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 65536) req.destroy(); });
    req.on('end', () => {
      try {
        const v = JSON.parse(corpo);
        const id = String(v.orderId || v.id || '').trim();
        if (id && !vendasAutoIds.has(id)) {
          vendasAutoIds.add(id);
          const plataforma = v.plataforma === 'tiktok' ? 'tiktok' : 'shopee';
          const valor = +v.valor || 0;
          const quem = String(v.quem || '').slice(0, 60).trim();
          const venda = { valor: valor, plataforma: plataforma, quem: quem, ts: Date.now(), auto: true, orderId: id, produto: v.produto || '' };
          vendasAuto.push(venda);
          gravaVendaHistorico(venda); // salva no historico (Supabase), com a sigla e o inicio da live
          if (plataforma === 'shopee') liveShopeeAtual();
          // aparece no Multichat na hora, com quem comprou e o valor
          emitir({ tipo: 'venda', quem: quem || 'Venda', texto: 'comprou' + (valor ? ' · R$ ' + valor.toFixed(2).replace('.', ',') : ''), plataforma: plataforma });
        }
      } catch (e) {}
      res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
    });
    return;
  }

  // seletor de lojas: troca a conta do TikTok que o chat esta lendo
  if (req.url.startsWith('/conta')) {
    if (req.method === 'POST') {
      let corpo = '';
      req.on('data', (d) => { corpo += d; if (corpo.length > 4096) req.destroy(); });
      req.on('end', () => {
        try { const b = JSON.parse(corpo); if (b.loja != null) lojaAtual = b.loja ? L.limpaNome(b.loja) : ''; ligarConta(b.tiktok || b.conta || ''); } catch (e) {}
        res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
      });
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ usuario: usuario, aoVivo: aoVivo }));
    return;
  }

  // recebe os numeros oficiais do console de lives do TikTok (robo Compass por cookies)
  if (req.url.startsWith('/numeros-tiktok') && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 8192) req.destroy(); });
    req.on('end', () => {
      try {
        const b = JSON.parse(corpo);
        const loja = String(b.loja || lojaAtual || '?');
        compassPorLoja[loja] = { gmv: +b.gmv || 0, orders: +b.orders || 0, views: +b.views || 0, live: !!b.live, ts: Date.now() };
      } catch (e) {}
      res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
    });
    return;
  }

  // quais lojas estao em live agora (o robo do console marca) — o painel usa para focar sozinho
  if (req.url.split('?')[0] === '/lojas-live') {
    const agora = Date.now();
    const lista = Object.keys(compassPorLoja).map((loja) => {
      const c = compassPorLoja[loja];
      const fresco = c.ts && (agora - c.ts < 15 * 60000);
      return { loja: loja, live: !!(fresco && c.live), gmv: c.gmv, orders: c.orders, views: c.views };
    });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(lista));
    return;
  }

  // painel AO VIVO: numeros em tempo real da conta ativa
  // (vendas separadas por app; pedidos e curtidas somados)
  if (req.url.startsWith('/ao-vivo')) {
    const todas = vendasAnotadas.concat(vendasAuto);
    const desde = liveEstado.inicio || 0;
    const daLive = todas.filter((v) => !desde || (v.ts || 0) >= desde);
    const tik = { n: 0, t: 0 }, sho = { n: 0, t: 0 };
    daLive.forEach((v) => {
      const d = v.plataforma === 'tiktok' ? tik : sho;
      d.n++; d.t += v.valor || 0;
    });
    // numeros do console (Compass) da loja atual, se recentes (<15min): sao os oficiais do TikTok
    const c = compassPorLoja[lojaAtual] || null;
    const compassFresco = !!(c && c.ts && (Date.now() - c.ts < 15 * 60000));
    const totalTiktok = compassFresco ? c.gmv : tik.t;
    const pedidosTiktok = compassFresco ? c.orders : tik.n;
    // espectadores: o do chat; se 0 e o Compass tem views, mostra as views do console
    const espectadores = liveEstado.espectadores || (compassFresco ? c.views : 0);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      usuario: usuario, aoVivo: aoVivo,
      espectadores: espectadores, likes: liveEstado.likes,
      inicio: liveEstado.inicio,
      totalTiktok: totalTiktok, totalShopee: sho.t,
      pedidosTiktok: pedidosTiktok, pedidosShopee: sho.n,
      pedidos: pedidosTiktok + sho.n,
      total: totalTiktok + sho.t,
      vendas: pedidosTiktok + sho.n, // compatibilidade com versoes antigas do painel
      fonte: compassFresco ? 'console' : 'chat',
    }));
    return;
  }

  // produtos das lojas, lidos por cookies pelo robo de produtos
  // POST { plataforma, produtos:[{id,nome,preco,sku,imagem}] }  ·  GET -> {tiktok:[],shopee:[],ts:{}}
  if (req.url.startsWith('/produtos')) {
    if (req.method === 'POST') {
      let corpo = '';
      req.on('data', (d) => { corpo += d; if (corpo.length > 4e6) req.destroy(); });
      req.on('end', () => {
        try {
          const b = JSON.parse(corpo);
          const plat = b.plataforma === 'tiktok' ? 'tiktok' : 'shopee';
          // as duas contas pertencem a MESMA loja (ex.: Bellini no TikTok e na Shopee)
          const loja = achaLoja(b.loja);
          if (b.conta) loja.contas[plat] = String(b.conta).slice(0, 60);
          if (Array.isArray(b.produtos)) {
            loja.produtos[plat] = b.produtos.slice(0, 3000);
            loja.ts[plat] = Date.now();
            console.log('  📦 ' + loja.nome + ' · ' + plat + (b.conta ? ' (' + b.conta + ')' : '')
              + ': ' + loja.produtos[plat].length + ' produto(s).');
          }
        } catch (e) {}
        res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
      });
      return;
    }
    // GET /produtos            -> os da loja que o painel esta mostrando
    // GET /produtos?loja=xxx   -> os de uma loja especifica
    const qs = new URLSearchParams((req.url.split('?')[1] || ''));
    const l = qs.get('loja') ? achaLoja(qs.get('loja')) : lojaDoPainel();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ tiktok: l.produtos.tiktok, shopee: l.produtos.shopee, ts: l.ts, loja: l }));
    return;
  }

  // TODAS as lojas: cada uma com as duas contas (TikTok + Shopee) vinculadas.
  // A lista junta duas coisas: as lojas que ja tiveram os produtos lidos e as
  // que tem LOGIN guardado neste PC — assim, assim que voce faz o login de uma
  // loja ela ja aparece no seletor 🏪, sem precisar digitar o nome de novo.
  // caminho EXATO: senao esta rota engoliria /lojas-conectadas e /lojas-live
  if (req.url.split('?')[0] === '/lojas') {
    const mapa = {};
    Object.values(lojas).forEach((l) => {
      mapa[l.nome] = {
        nome: l.nome, contas: l.contas,
        produtos: { tiktok: l.produtos.tiktok.length, shopee: l.produtos.shopee.length },
        login: { tiktok: false, shopee: false, console: false },
      };
    });
    let comLogin = [];
    try { comLogin = L.resumoDasLojas(); } catch (e) {}
    comLogin.forEach((r) => {
      if (!mapa[r.loja]) {
        mapa[r.loja] = {
          nome: r.loja, contas: { tiktok: '', shopee: '' },
          produtos: { tiktok: 0, shopee: 0 }, login: {},
        };
      }
      mapa[r.loja].login = { tiktok: r.tiktok, shopee: r.shopee, console: r.console };
    });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      // 'selecionada' e' o que voce escolheu no seletor 🏪, mesmo que essa loja
      // ainda nao tenha produtos carregados. E' por ela que os robos se guiam.
      selecionada: lojaAtual,
      atual: lojaDoPainel().nome,
      lojas: Object.values(mapa),
    }));
    return;
  }

  // ---------- conectar loja por cookies (a pagina /conectar) ----------
  // Voce ja esta logado nas lojas no SEU Chrome. Em vez de abrir outro navegador
  // e pedir senha, voce copia a requisicao (Copy as cURL) e cola la'. Daqui sai
  // uma sessao no mesmo formato de sempre, entao os robos nao mudam em nada.

  // as lojas do arquivo minhas-lojas.txt (para o seletor da pagina)
  if (req.url.startsWith('/minhas-lojas')) {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ lojas: L.minhasLojas() }));
    return;
  }

  // o que ja esta conectado, e ha quanto tempo
  if (req.url.startsWith('/lojas-conectadas')) {
    const saida = L.minhasLojas().map((loja) => {
      const item = { loja: loja };
      ['tiktok', 'shopee', 'console'].forEach((p) => {
        const arq = L.arquivoSessao(p, loja);
        try {
          const st = fs.statSync(arq);
          item[p] = { ts: st.mtimeMs };
        } catch (e) { item[p] = null; }
      });
      return item;
    });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ lojas: saida }));
    return;
  }

  if (req.url.startsWith('/conectar-loja') && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 2e6) req.destroy(); });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      try {
        const b = JSON.parse(corpo);
        const plat = ['tiktok', 'shopee', 'console'].includes(b.plataforma) ? b.plataforma : 'tiktok';
        const loja = L.limpaNome(b.loja);
        const lido = COOKIES.entende(b.texto, plat);
        COOKIES.confere(lido, plat); // copiou a requisicao da loja certa?
        const sessao = COOKIES.paraSessao(lido, plat);

        const arq = path.join(__dirname, 'sessao-' + plat + '-' + loja + '.json');
        fs.writeFileSync(arq, JSON.stringify(sessao));

        // guarda tambem a chamada capturada (URL, cabecalhos, corpo). Ainda nao e'
        // usada pelos robos, mas e' o que vai permitir ler os pedidos sem navegador.
        if (lido.url) {
          try {
            fs.writeFileSync(path.join(__dirname, 'chamada-' + plat + '-' + loja + '.json'),
              JSON.stringify({ url: lido.url, metodo: lido.metodo, cabecalhos: lido.cabecalhos, corpo: lido.corpo, ts: Date.now() }, null, 1));
          } catch (e) {}
        }
        console.log('  🔌 ' + loja + ' · ' + plat + ': ' + sessao.cookies.length + ' cookie(s) conectados (' + lido.origem + ').');
        res.end(JSON.stringify({ ok: true, loja: loja, plataforma: plat, cookies: sessao.cookies.length }));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, erro: String((e && e.message) || e).slice(0, 200) }));
      }
    });
    return;
  }

  // apagar uma loja da lista (o 🗑 do seletor no painel).
  // So' tira daqui da memoria: os arquivos de login continuam no disco, entao
  // ninguem perde acesso a loja por engano — para sumir de vez, apague o
  // sessao-*-<loja>.json (ou use o proprio painel de novo depois do login).
  if (req.url.startsWith('/apagar-loja') && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 4096) req.destroy(); });
    req.on('end', () => {
      let apagada = '';
      try {
        const b = JSON.parse(corpo);
        const n = L.limpaNome(b.loja);
        if (lojas[n]) { delete lojas[n]; apagada = n; }
        if (lojaAtual === n) lojaAtual = '';
        ofertas = ofertas.filter((o) => String(o.loja || '') !== n);
        if (apagada) console.log('  🗑  loja "' + apagada + '" tirada da lista.');
      } catch (e) {}
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, apagada: apagada }));
    });
    return;
  }

  // a loja que o painel esta mostrando (as duas contas vistas como uma coisa so')
  if (req.url.startsWith('/minha-loja')) {
    if (req.method === 'POST') {
      let corpo = '';
      req.on('data', (d) => { corpo += d; if (corpo.length > 4096) req.destroy(); });
      req.on('end', () => {
        try {
          const b = JSON.parse(corpo);
          const l = achaLoja(b.loja || lojaDoPainel().nome);
          // o nome passa pela mesma limpeza da chave, senao a loja apareceria
          // duas vezes na lista (uma do painel, outra do login)
          if (b.nome != null) l.nome = L.limpaNome(b.nome);
          if (b.tiktok != null) l.contas.tiktok = String(b.tiktok).slice(0, 60);
          if (b.shopee != null) l.contas.shopee = String(b.shopee).slice(0, 60);
          if (b.selecionar) lojaAtual = l.nome;
        } catch (e) {}
        res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
      });
      return;
    }
    const qs2 = new URLSearchParams((req.url.split('?')[1] || ''));
    const l = qs2.get('loja') ? achaLoja(qs2.get('loja')) : lojaDoPainel();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      nome: l.nome, contas: l.contas,
      produtos: { tiktok: l.produtos.tiktok.length, shopee: l.produtos.shopee.length },
      todas: Object.keys(lojas),
    }));
    return;
  }

  // ---------- Descontos fixos (conjunto + exceção), salvos no Supabase ----------
  // O ADM configura no painel e FICA salvo até mudar. Conjunto (sku vazio) vale para
  // todas as estampas; exceção (com sku) sobrepõe UMA estampa. Vendedora só enxerga.
  if (req.url.startsWith('/descontos') && req.method === 'GET') {
    const qs = new URLSearchParams((req.url.split('?')[1] || ''));
    const loja = qs.get('loja') || lojaAtual || '';
    const ehAdm = !AUTH.veioDeFora(req) || CONTAS.ehAdm(req.usuario);
    res.setHeader('content-type', 'application/json');
    OFERTAS.listar(loja)
      .then((l) => res.end(JSON.stringify({ ok: true, loja: loja, ehAdm: ehAdm, descontos: l })))
      .catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ ok: false, erro: String(e.message || e) })); });
    return;
  }
  if ((req.url.startsWith('/desconto-salvar') || req.url.startsWith('/desconto-remover')) && req.method === 'POST') {
    const ehAdm = !AUTH.veioDeFora(req) || CONTAS.ehAdm(req.usuario);
    if (!ehAdm) { res.statusCode = 403; res.setHeader('content-type', 'application/json'); res.end('{"ok":false,"erro":"So o ADM edita os descontos."}'); return; }
    const remover = req.url.startsWith('/desconto-remover');
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 65536) req.destroy(); });
    req.on('end', () => {
      let b; try { b = JSON.parse(corpo); } catch (e) { b = null; }
      res.setHeader('content-type', 'application/json');
      if (!b || !b.loja || !b.produto_id) { res.statusCode = 400; res.end('{"ok":false,"erro":"faltou loja/produto"}'); return; }
      const acao = remover ? OFERTAS.remover(b) : OFERTAS.salvar(b);
      acao.then(() => res.end('{"ok":true}'))
        .catch((e) => { res.statusCode = 500; res.end(JSON.stringify({ ok: false, erro: String(e.message || e) })); });
    });
    return;
  }

  // o robo da oferta conta como foi (aplicada / ensaio / erro / restaurada)
  if (req.url.startsWith('/oferta-estado') && req.method === 'POST') {
    let corpo = '';
    req.on('data', (d) => { corpo += d; if (corpo.length > 8192) req.destroy(); });
    req.on('end', () => {
      try {
        const b = JSON.parse(corpo);
        const o = ofertas.find((x) => x.id === b.id);
        if (o) {
          o.estado = String(b.estado || '').slice(0, 20);
          o.erro = String(b.erro || '').slice(0, 120);
          emitir({ tipo: 'oferta', ofertas: ofertas, oferta: ofertas[0] || null });
        }
      } catch (e) {}
      res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
    });
    return;
  }

  // ofertas relampago ao vivo (VARIAS ao mesmo tempo), compartilhadas entre aparelhos.
  // POST aceita uma lista (novo) ou uma oferta so' (painel antigo). GET devolve a lista.
  if (req.url.startsWith('/oferta')) {
    if (req.method === 'POST') {
      let corpo = '';
      req.on('data', (d) => { corpo += d; if (corpo.length > 65536) req.destroy(); });
      req.on('end', () => {
        try {
          const b = JSON.parse(corpo);
          // Cada oferta pertence a UMA loja (o produto e o preco sao de la').
          // O painel so' conhece as ofertas da loja que ele esta' mostrando, entao
          // trocamos apenas as dessa loja e preservamos as das outras — senao a
          // loja A apagaria as ofertas da loja B ao mandar a lista dela.
          const dono = String(lojaAtual || '');
          const deOutrasLojas = ofertas.filter((o) => String(o.loja || '') !== dono);
          let novas = [];
          if (Array.isArray(b)) novas = b.filter((o) => o && o.nome && o.fim > Date.now());
          else if (b && b.nome) novas = [b];
          novas.forEach((o) => { o.loja = dono; });
          ofertas = deOutrasLojas.concat(novas);
          emitir({ tipo: 'oferta', ofertas: novas, oferta: novas[0] || null, loja: dono });
        } catch (e) {}
        res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
      });
      return;
    }
    limpaOfertas();
    res.setHeader('content-type', 'application/json');
    // so' as ofertas da loja pedida (?loja=) ou da que o painel esta' mostrando.
    // Sem loja nenhuma escolhida, devolve tudo (uma loja so' funciona como antes).
    const qs3 = new URLSearchParams((req.url.split('?')[1] || ''));
    const pedida = qs3.has('loja') ? qs3.get('loja') : lojaAtual;
    const minhas = pedida ? ofertas.filter((o) => String(o.loja || '') === String(pedida)) : ofertas;
    // /ofertas -> lista (novo)   ·   /oferta -> a primeira (compatibilidade)
    const querLista = req.url.split('?')[0] === '/ofertas';
    res.end(JSON.stringify(querLista ? minhas : (minhas[0] || null)));
    return;
  }

  if (req.url.startsWith('/vendas')) {
    if (req.method === 'POST') {
      let corpo = '';
      req.on('data', (d) => { corpo += d; if (corpo.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try {
          const v = JSON.parse(corpo);
          if (Array.isArray(v)) {
            vendasAnotadas = v;
            // venda da Shopee agorinha = a live da Shopee esta rolando
            const agora = Date.now();
            if (v.some((x) => x.plataforma !== 'tiktok' && agora - (x.ts || 0) < 60000)) liveShopeeAtual();
          }
        } catch (e) {}
        res.setHeader('content-type', 'application/json'); res.end('{"ok":true}');
      });
      return;
    }
    // GET: junta as manuais (do Multichat) com as automaticas (do robo)
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(vendasAnotadas.concat(vendasAuto)));
    return;
  }

  // numeros oficiais capturados pelo robo da Shopee (npm run robo-shopee)
  if (req.url.startsWith('/shopee-oficial')) {
    fs.readFile(path.join(__dirname, 'historico-shopee-oficial.json'), (e, d) => {
      res.setHeader('content-type', 'application/json');
      res.end(e ? '[]' : d);
    });
    return;
  }

  // historico das lives da Shopee para o Analytics (mensagens + vendas anotadas por live)
  if (req.url.startsWith('/shopee-lives')) {
    const folga = 30 * 60 * 1000;
    const todas = vendasAnotadas.concat(vendasAuto);
    const lives = shopeeLives.map((l) => {
      const vs = todas.filter((v) => v.plataforma !== 'tiktok' && v.ts >= l.inicio - folga && v.ts <= l.fim + folga);
      let total = 0; vs.forEach((v) => { total += v.valor || 0; });
      return { inicio: l.inicio, fim: l.fim, mensagens: l.mensagens, vendas: vs.length, total: total };
    });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(lives));
    return;
  }

  // painel completo em UMA URL: /painel mostra Analytics + Ofertas + Multichat juntos
  // (as outras entradas servem os pedacos que o painel usa, tudo do mesmo endereco)
  const ESTATICOS = {
    '/painel': 'index.html',
    '/index.html': 'index.html',
    '/analytics.html': 'analytics.html',
    '/sacolinha-controle.html': 'sacolinha-controle.html',
    '/historico': 'historico.html',
    '/historico.html': 'historico.html',
    '/conectar': 'conectar.html',
    '/conectar.html': 'conectar.html',
    '/lib/xlsx.min.js': 'lib/xlsx.min.js',
  };
  const caminho = req.url.split('?')[0];
  if (ESTATICOS[caminho]) {
    fs.readFile(path.join(__dirname, '..', ESTATICOS[caminho]), (err, corpo) => {
      if (err) { res.statusCode = 404; res.end('arquivo nao encontrado'); return; }
      res.setHeader('content-type', caminho.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache'); // pega sempre a versao nova apos um deploy
      res.end(corpo);
    });
    return;
  }

  const arq = path.join(__dirname, '..', 'multichat.html');
  fs.readFile(arq, (err, html) => {
    if (err) { res.statusCode = 500; res.end('multichat.html nao encontrado ao lado da pasta conector/'); return; }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache'); // pega sempre a versao nova apos um deploy
    res.end(html);
  });
});

const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ server });
const clientes = new Set();
wss.on('connection', (ws) => {
  clientes.add(ws);
  ws.send(JSON.stringify({ tipo: 'status', conectado: aoVivo, usuario: usuario || '(teste)' }));
  ws.on('close', () => clientes.delete(ws));
});

let aoVivo = false;
function emitir(ev) {
  ev.ts = Date.now();
  if (ev.tipo !== 'status' && ev.tipo !== 'contadores' && !ev.plataforma) ev.plataforma = 'tiktok';
  const msg = JSON.stringify(ev);
  for (const c of clientes) { try { c.send(msg); } catch (e) {} }
}

server.listen(PORTA, '0.0.0.0', () => {
  console.log('');
  console.log('  DuoLive Conector no ar!');
  if (NA_NUVEM) {
    console.log('  Rodando na nuvem, porta ' + PORTA + '. Use a URL publica do servico no painel.');
  } else {
    console.log('  Endereco: http://127.0.0.1:' + PORTA);
  }
  console.log('');
});

// ---------- modo teste: eventos falsos para ajustar o layout ----------
if (TESTE) {
  console.log('  MODO TESTE: gerando eventos falsos a cada 2s (sem conectar no TikTok).');
  const nomes = ['maria.silva', 'joao123', 'ana_compras', 'carlos.br', 'juh.oliveira'];
  const eventos = [
    (n) => ({ tipo: 'mensagem', quem: n, texto: 'tem tamanho grande?' }),
    (n) => ({ tipo: 'mensagem', quem: n, texto: 'quanto ta o frete?' }),
    (n) => ({ tipo: 'mensagem', quem: n, texto: 'onde posso comprar?', plataforma: 'shopee' }),
    (n) => ({ tipo: 'seguidor', quem: n }),
    (n) => ({ tipo: 'presente', quem: n, presente: 'Rosa', qtd: 3, diamantes: 3 }),
    (n) => ({ tipo: 'entrada', quem: n }),
    (n) => ({ tipo: 'venda', quem: n, texto: 'comprou · R$ 89,90 · Tapete Sala', plataforma: 'shopee' }),
  ];
  let v = 42, likes = 130;
  aoVivo = true;
  setInterval(() => {
    const n = nomes[Math.floor(Math.random() * nomes.length)];
    emitir(eventos[Math.floor(Math.random() * eventos.length)](n));
    v += Math.floor(Math.random() * 5) - 1; likes += Math.floor(Math.random() * 9);
    emitir({ tipo: 'contadores', espectadores: Math.max(1, v), likes: likes });
  }, 2000);
  return;
}

// ---------- conexao real com a live do TikTok (troca de conta em tempo real) ----------
const ttlive = require('tiktok-live-connector');
const { TikTokLiveConnection, WebcastEvent } = ttlive;
// A leitura do chat do TikTok passa por um servico que "assina" o pedido (Euler
// Stream). Pegue a chave gratis em https://www.eulerstream.com.
// De onde ela vem: 1o a variavel DUOLIVE_SIGN_KEY; 2o o arquivo chave-tiktok.txt
// (uma linha so'), que fica de fora do repositorio pelo .gitignore.
function chaveDoTiktok() {
  if (process.env.DUOLIVE_SIGN_KEY) return process.env.DUOLIVE_SIGN_KEY.trim();
  try {
    const t = fs.readFileSync(path.join(__dirname, 'chave-tiktok.txt'), 'utf8');
    const linha = t.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))[0];
    if (linha) return linha;
  } catch (e) {}
  return '';
}
const SIGN_KEY = chaveDoTiktok();
// mostra so' o comecinho: confirma que leu a chave certa sem expor ela no log
if (SIGN_KEY) console.log('  (chave de assinatura do TikTok carregada: ' + SIGN_KEY.slice(0, 10) + '...)');
else console.log('  (sem chave de assinatura — se der erro de "sign", pegue uma gratis em eulerstream.com)');
const opcoes = {};
if (SIGN_KEY) opcoes.signApiKey = SIGN_KEY;

let conexao = null;
let geracao = 0; // muda a cada troca de conta; timers antigos de reconexao sao ignorados

function nomeDe(d) {
  return (d && ((d.user && (d.user.uniqueId || d.user.nickname)) || d.uniqueId || d.nickname)) || '';
}

function criarConexao() {
  conexao = new TikTokLiveConnection(usuario, opcoes);
  conexao.on(WebcastEvent.CHAT, (d) => emitir({ tipo: 'mensagem', quem: nomeDe(d), texto: (d && (d.content || d.comment)) || '' }));
  conexao.on(WebcastEvent.MEMBER, (d) => emitir({ tipo: 'entrada', quem: nomeDe(d) }));
  conexao.on(WebcastEvent.FOLLOW, (d) => emitir({ tipo: 'seguidor', quem: nomeDe(d) }));
  conexao.on(WebcastEvent.SHARE, (d) => emitir({ tipo: 'share', quem: nomeDe(d) }));
  conexao.on(WebcastEvent.SOCIAL, (d) => {
    const t = String((d && d.displayType) || '');
    if (t.includes('follow')) emitir({ tipo: 'seguidor', quem: nomeDe(d) });
    else if (t.includes('share')) emitir({ tipo: 'share', quem: nomeDe(d) });
  });
  conexao.on(WebcastEvent.GIFT, (d) => {
    if (d.giftType === 1 && !d.repeatEnd) return;
    const nome = (d.giftDetails && d.giftDetails.giftName) || d.giftName || (d.gift && d.gift.name) || 'presente';
    emitir({ tipo: 'presente', quem: nomeDe(d), presente: nome, qtd: d.repeatCount || 1 });
  });
  conexao.on(WebcastEvent.ROOM_USER, (d) => {
    // na v2 o numero de espectadores vem em 'total' (ou 'totalUser'); 'viewerCount' era da v1
    const bruto = d && (d.viewerCount != null ? d.viewerCount : (d.total != null ? d.total : d.totalUser));
    const v = parseInt(bruto, 10);
    if (!isNaN(v)) { liveEstado.espectadores = v; emitir({ tipo: 'contadores', espectadores: v }); }
  });
  conexao.on(WebcastEvent.LIKE, (d) => {
    // na v2 o total de curtidas vem em 'total'; 'totalLikeCount' era da v1
    const bruto = d && (d.totalLikeCount != null ? d.totalLikeCount : d.total);
    const t = parseInt(bruto, 10);
    if (!isNaN(t)) { liveEstado.likes = t; emitir({ tipo: 'contadores', likes: t }); }
  });
  conexao.on(WebcastEvent.STREAM_END, () => {
    const g = geracao; aoVivo = false; liveEstado.inicio = 0;
    console.log('  A live de @' + usuario + ' terminou. Aguardando a proxima...');
    emitir({ tipo: 'status', conectado: false, usuario: usuario });
    setTimeout(() => { if (g === geracao) conectar(); }, 60000);
  });
  conexao.on('disconnected', () => {
    if (!aoVivo) return;
    const g = geracao; aoVivo = false;
    console.log('  Conexao caiu. Reconectando...');
    emitir({ tipo: 'status', conectado: false, usuario: usuario });
    setTimeout(() => { if (g === geracao) conectar(); }, 10000);
  });
  conexao.on('error', () => { /* nao derruba o conector */ });
}

function conectar() {
  if (!usuario || !conexao) return;
  const g = geracao;
  conexao.connect().then((estado) => {
    if (g !== geracao) return; // trocaram de conta enquanto conectava
    aoVivo = true;
    if (!liveEstado.inicio) liveEstado.inicio = Date.now(); // marca o comeco da live
    console.log('  Conectado na live de @' + usuario + (estado && estado.roomId ? ' (sala ' + estado.roomId + ')' : ''));
    emitir({ tipo: 'status', conectado: true, usuario: usuario, inicio: liveEstado.inicio });
  }).catch((err) => {
    if (g !== geracao) return;
    aoVivo = false;
    const txt = String((err && (err.message || err.name)) || err);
    emitir({ tipo: 'status', conectado: false, usuario: usuario });
    if (/sign|euler|rate.?limit|429|401|403/i.test(txt)) {
      if (/rate.?limit|429/i.test(txt)) console.log('  ATENCAO: limite da chave de assinatura (Euler Stream). Espere e tente de novo.');
      else console.log('  ATENCAO: assinatura recusada. Confira a DUOLIVE_SIGN_KEY (eulerstream.com). Detalhe: ' + txt.slice(0, 90));
      setTimeout(() => { if (g === geracao) conectar(); }, 60000);
    } else {
      console.log('  Sem live no ar para @' + usuario + ' (' + txt.slice(0, 80) + '). Tento de novo em 30s...');
      setTimeout(() => { if (g === geracao) conectar(); }, 30000);
    }
  });
}

// troca a conta ativa do TikTok (chamado pelo seletor de lojas no painel)
function ligarConta(novo) {
  novo = String(novo || '').replace(/^@/, '').trim();
  geracao++; // invalida timers/pendencias da conta anterior
  aoVivo = false;
  liveEstado = { espectadores: 0, likes: 0, inicio: 0 }; // zera os contadores ao trocar de loja
  if (conexao) { try { conexao.disconnect(); } catch (e) {} conexao = null; }
  usuario = novo;
  if (!usuario) { emitir({ tipo: 'status', conectado: false, usuario: '' }); return; }
  console.log('  >> trocando para a live de @' + usuario);
  emitir({ tipo: 'status', conectado: false, usuario: usuario });
  criarConexao();
  conectar();
}

if (usuario) { criarConexao(); conectar(); }
else console.log('  Nenhuma conta ainda. Escolha uma loja no painel (ou use: npm start -- @conta).');

module.exports = { ligarConta: ligarConta, contaAtual: () => usuario };
