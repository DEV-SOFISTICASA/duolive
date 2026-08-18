// MultiPost · Cérebro — a IA olha o vídeo e escreve legenda + hashtags
//
// Como funciona: tira alguns QUADROS do vídeo (com o ffmpeg), reduz o tamanho
// pra ficar barato, manda pra IA (Claude) e recebe de volta uma legenda e
// hashtags que combinam com o que aparece no vídeo.
//
// Precisa de duas coisas (o app avisa direitinho se faltar):
//   • ffmpeg instalado — tira os quadros do vídeo.
//   • ANTHROPIC_API_KEY — a chave (paga) da IA.
//
// Modelo: por padrão usa o mais forte (claude-opus-5). Para baratear em 100+
// vídeos, dá pra trocar por um mais leve pondo, por exemplo:
//   set MULTIPOST_MODELO=claude-haiku-4-5
//
// Uso como biblioteca:
//   const { legendaDoVideo } = require('./legenda-ia.js');
//   const r = await legendaDoVideo('C:\\videos\\x.mp4', { loja: 'loja de decoração' });
//   // r = { legenda: '...', hashtags: ['#...', ...] }

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const MODELO = process.env.MULTIPOST_MODELO || 'claude-opus-5';
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

// a chave da IA: variável de ambiente ANTHROPIC_API_KEY OU o arquivo
// conector/multipost/chave-ia.txt (1ª linha). Mesmo esquema dos outros segredos
// (chave-tiktok.txt etc.), pra você colar a chave uma vez e não repetir no terminal.
function chaveIA() {
  let k = '';
  if (process.env.ANTHROPIC_API_KEY) k = process.env.ANTHROPIC_API_KEY.trim();
  else {
    try { k = (fs.readFileSync(path.join(__dirname, 'chave-ia.txt'), 'utf8').split('\n')[0] || '').trim(); } catch (e) {}
  }
  return /^sk-/.test(k) ? k : ''; // chave de verdade começa com sk-; ignora vazio/exemplo
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

// monta as imagens no formato que a IA entende (base64)
function imagensPraIA(arquivos) {
  return arquivos.map((f) => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(f).toString('base64') },
  }));
}

// a IA responde SEMPRE neste formato (legenda + lista de hashtags)
const ESQUEMA = {
  type: 'object',
  properties: {
    legenda: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
  required: ['legenda', 'hashtags'],
  additionalProperties: false,
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
    throw new Error('Falta a chave da IA. Crie em console.anthropic.com e cole em conector/multipost/chave-ia.txt (uma linha só) — ou ponha em ANTHROPIC_API_KEY.');
  }

  const { pasta, arquivos } = await tiraQuadros(video, QTOS_QUADROS);
  try {
    if (!arquivos.length) throw new Error('Não consegui tirar quadros do vídeo (formato estranho?). Me manda o arquivo que eu vejo.');

    const Anthropic = require('@anthropic-ai/sdk');
    const cliente = new Anthropic({ apiKey: chave });

    const loja = opts.loja || opts.estilo || 'uma loja';
    const instrucao =
      'Você escreve legendas para vídeos do TikTok de ' + loja + ', em português do Brasil. ' +
      'Olhe os quadros do vídeo e escreva UMA legenda curta e vendedora (1–2 frases, pode usar 1 emoji) ' +
      'e de 5 a 10 hashtags relevantes ao que aparece. ' +
      'Não invente preço nem promessa que não dá pra ver nas imagens. ' +
      (opts.dica ? ('Contexto extra: ' + opts.dica + '. ') : '') +
      'Responda no formato pedido.';

    const resp = await cliente.messages.create({
      model: MODELO,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [...imagensPraIA(arquivos), { type: 'text', text: instrucao }],
      }],
      output_config: { format: { type: 'json_schema', schema: ESQUEMA } },
    });

    const bloco = (resp.content || []).find((b) => b.type === 'text');
    let dados; try { dados = JSON.parse((bloco && bloco.text) || '{}'); } catch (e) { dados = {}; }
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
