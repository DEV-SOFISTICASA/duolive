// MultiPost · Cérebro — a IA olha o vídeo e escreve legenda + hashtags
//
// Como funciona: tira alguns QUADROS do vídeo (com o ffmpeg), reduz o tamanho
// pra ficar leve, manda pro Gemini (a IA do Google) e recebe de volta uma
// legenda e hashtags que combinam com o que aparece no vídeo.
//
// Precisa de duas coisas (o app avisa direitinho se faltar):
//   • ffmpeg instalado — tira os quadros do vídeo.
//   • Chave do Gemini — GRÁTIS: aistudio.google.com/app/apikey (conta Google).
//     Cole em conector/multipost/chave-ia.txt — a chave começa com AIza.
//
// Modelo: por padrão usa o gemini-2.5-flash (rápido, e o plano grátis dá conta
// dos 100+ vídeos). Dá pra trocar pondo antes do comando, por exemplo:
//   set MULTIPOST_MODELO=gemini-2.5-pro          (mais caprichado, mais lento)
//   set MULTIPOST_MODELO=gemini-2.5-flash-lite   (mais leve ainda)
//
// Uso como biblioteca:
//   const { legendaDoVideo } = require('./legenda-ia.js');
//   const r = await legendaDoVideo('C:\\videos\\x.mp4', { loja: 'loja de decoração' });
//   // r = { legenda: '...', hashtags: ['#...', ...] }

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const MODELO = process.env.MULTIPOST_MODELO || 'gemini-2.5-flash';
const QTOS_QUADROS = Math.max(2, Math.min(12, Number(process.env.MULTIPOST_QUADROS) || 6));

// acha o ffmpeg/ffprobe mesmo que não estejam no PATH (igual ao navegador.js com o
// Brave). Procura no winget, no chocolatey e em C:\ffmpeg; se não achar, usa o nome
// puro (aí depende do PATH). Assim funciona logo após instalar, sem reabrir o terminal.
function achaExe(nome) {
  const lugares = [];
  const LA = process.env.LOCALAPPDATA, PF = process.env.ProgramFiles, PD = process.env.ProgramData;
  if (LA) {
    const base = path.join(LA, 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const d of fs.readdirSync(base)) {
        if (!/gyan\.ffmpeg/i.test(d)) continue;
        const sub = path.join(base, d);
        try { for (const b of fs.readdirSync(sub)) lugares.push(path.join(sub, b, 'bin', nome + '.exe')); } catch (e) {}
      }
    } catch (e) {}
    lugares.push(path.join(LA, 'Microsoft', 'WinGet', 'Links', nome + '.exe'));
  }
  if (PD) lugares.push(path.join(PD, 'chocolatey', 'bin', nome + '.exe'));
  lugares.push('C:\\ffmpeg\\bin\\' + nome + '.exe');
  if (PF) lugares.push(path.join(PF, 'ffmpeg', 'bin', nome + '.exe'));
  for (const p of lugares) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  return nome; // deixa o PATH resolver
}
const FFMPEG = achaExe('ffmpeg');
const FFPROBE = achaExe('ffprobe');

// a chave da IA: variável de ambiente GEMINI_API_KEY OU o arquivo
// conector/multipost/chave-ia.txt. Mesmo esquema dos outros segredos
// (chave-tiktok.txt etc.): cola uma vez e não repete no terminal.
// Chave de verdade do Google começa com "AIza" — o app acha ela no meio do
// arquivo mesmo que sobre texto de exemplo ou espaço em volta.
function chaveIA() {
  let texto = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (!/AIza/.test(texto)) {
    try { texto = fs.readFileSync(path.join(__dirname, 'chave-ia.txt'), 'utf8'); } catch (e) { texto = ''; }
  }
  const m = texto.match(/AIza[0-9A-Za-z_-]{10,}/);
  return m ? m[0] : '';
}

// roda um programa e devolve { ok, stdout, stderr }
function roda(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function temFfmpeg() {
  return (await roda(FFMPEG, ['-version'])).ok;
}

// duração do vídeo em segundos (usa ffprobe; se não der, assume 15s)
async function duracao(video) {
  const r = await roda(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', video]);
  const s = parseFloat((r.stdout || '').trim());
  return Number.isFinite(s) && s > 0 ? s : 15;
}

// tira N quadros espaçados do vídeo, já reduzidos (barateia a IA). Devolve caminhos.
async function tiraQuadros(video, n) {
  const dur = await duracao(video);
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'multipost-'));
  const arquivos = [];
  for (let i = 0; i < n; i++) {
    const t = (dur * (i + 1)) / (n + 1); // espalhados, sem grudar no começo/fim
    const saida = path.join(pasta, 'q' + String(i).padStart(2, '0') + '.jpg');
    const r = await roda(FFMPEG, ['-ss', t.toFixed(2), '-i', video, '-frames:v', '1',
      '-vf', 'scale=512:-1', '-q:v', '4', '-y', saida]);
    if (r.ok && fs.existsSync(saida)) arquivos.push(saida);
  }
  return { pasta, arquivos };
}

// monta as imagens no formato que o Gemini entende (base64 "embutido")
function imagensPraIA(arquivos) {
  return arquivos.map((f) => ({
    inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(f).toString('base64') },
  }));
}

// a IA responde SEMPRE neste formato (legenda + lista de hashtags).
// Os tipos em MAIÚSCULO são o jeito do Gemini ("OBJECT", "STRING", "ARRAY").
const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    legenda: { type: 'STRING' },
    hashtags: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['legenda', 'hashtags'],
};

// principal: caminho do vídeo -> { legenda, hashtags }
//   opts.loja  nome/estilo da loja (ex.: 'loja de decoração') — dá o tom da legenda
//   opts.dica  contexto extra opcional (ex.: 'promoção de vasos')
async function legendaDoVideo(video, opts) {
  opts = opts || {};
  if (!video || !fs.existsSync(video)) throw new Error('Vídeo não encontrado: ' + video);
  if (!(await temFfmpeg())) {
    throw new Error('Preciso do ffmpeg pra ler o vídeo. No Windows:  winget install Gyan.FFmpeg  (ou me peça que eu instalo). Depois feche e reabra o terminal.');
  }
  const chave = chaveIA();
  if (!chave) {
    throw new Error('Falta a chave da IA (é grátis). Pega em aistudio.google.com/app/apikey — entra com sua conta do Google e clica em "Create API key" — e cola em conector/multipost/chave-ia.txt. A chave começa com AIza.');
  }

  const { pasta, arquivos } = await tiraQuadros(video, QTOS_QUADROS);
  try {
    if (!arquivos.length) throw new Error('Não consegui tirar quadros do vídeo (formato estranho?). Me manda o arquivo que eu vejo.');

    const { GoogleGenAI } = require('@google/genai');
    const ia = new GoogleGenAI({ apiKey: chave });

    const loja = opts.loja || opts.estilo || 'uma loja';
    const instrucao =
      'Você escreve legendas para vídeos do TikTok de ' + loja + ', em português do Brasil. ' +
      'Olhe os quadros do vídeo e escreva UMA legenda curta e vendedora (1–2 frases, pode usar 1 emoji) ' +
      'e de 5 a 10 hashtags relevantes ao que aparece. ' +
      'Não invente preço nem promessa que não dá pra ver nas imagens. ' +
      (opts.dica ? ('Contexto extra: ' + opts.dica + '. ') : '') +
      'Responda no formato pedido.';

    const config = { responseMimeType: 'application/json', responseSchema: ESQUEMA };
    // o flash fica "pensando" antes de responder; pra legenda não precisa —
    // desligar deixa mais rápido e gasta menos do limite grátis. (No pro não
    // dá pra desligar, então só mexe quando o modelo é da família flash.)
    if (/flash/i.test(MODELO)) config.thinkingConfig = { thinkingBudget: 0 };

    let resp;
    try {
      resp = await ia.models.generateContent({
        model: MODELO,
        contents: [{ role: 'user', parts: [...imagensPraIA(arquivos), { text: instrucao }] }],
        config,
      });
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/API[ _]?KEY|API key|PERMISSION_DENIED/i.test(msg)) {
        throw new Error('O Google não aceitou a chave da IA. Confere se copiou ela inteira (começa com AIza) em conector/multipost/chave-ia.txt.');
      }
      if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
        throw new Error('O limite grátis do Gemini deu uma pausa (muitos pedidos seguidos). Espera 1 minuto e tenta de novo.');
      }
      throw new Error('A IA do Google não respondeu: ' + msg);
    }

    // no SDK novo resp.text é um atalho pro texto da resposta (JSON puro,
    // porque pedimos application/json); se vier enfeitado, pega só o miolo {...}
    const texto = typeof resp.text === 'function' ? resp.text() : (resp.text || '');
    let dados;
    try { dados = JSON.parse(texto); }
    catch (e) {
      const miolo = texto.match(/\{[\s\S]*\}/);
      try { dados = miolo ? JSON.parse(miolo[0]) : {}; } catch (e2) { dados = {}; }
    }
    return {
      legenda: String(dados.legenda || '').trim(),
      hashtags: Array.isArray(dados.hashtags) ? dados.hashtags.map(String) : [],
      modelo: MODELO,
    };
  } finally {
    try { fs.rmSync(pasta, { recursive: true, force: true }); } catch (e) {}
  }
}

module.exports = { legendaDoVideo, temFfmpeg };
