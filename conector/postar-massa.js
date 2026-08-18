// DuoLive · Postador — POSTAGEM EM MASSA (várias contas)
//
// Pega UM vídeo e publica em VÁRIAS contas, variando a legenda por conta e
// espaçando os horários (pra não parecer robô postando tudo de uma vez).
//
// Por padrão é ENSAIO. Para publicar de verdade: POSTAR_REAL=1.
//
// Jeito fácil (arquivo de trabalho):
//   npm run postar-massa -- --job postar-exemplo.json
// Jeito rápido (sem arquivo):
//   npm run postar-massa -- --video "C:\videos\promo.mp4" --legenda "Chegou novidade" --contas monaco,bellini
//
// Se não disser as contas, usa TODAS as que já têm login (sessao-postar-*.json).

const fs = require('fs');
const path = require('path');
const { abreNavegador } = require('./navegador.js');
const C = require('./contas-postar.js');
const { postaVideo, PASTA_LOGS } = require('./postador-nucleo.js');
const { variaLegenda } = require('./postador-variacao.js');

function arg(nome) { const i = process.argv.indexOf(nome); return i >= 0 ? process.argv[i + 1] : ''; }
function espera(ms) { return new Promise((r) => setTimeout(r, ms)); }

// junta o que veio do arquivo de trabalho com o que veio na linha de comando
function montaTrabalho() {
  let job = {};
  const jobArq = arg('--job');
  if (jobArq) {
    const caminho = path.isAbsolute(jobArq) ? jobArq : path.join(__dirname, jobArq);
    if (!fs.existsSync(caminho)) { console.log('\n  Não achei o arquivo de trabalho: ' + caminho + '\n'); process.exit(1); }
    try { job = JSON.parse(fs.readFileSync(caminho, 'utf8')); }
    catch (e) { console.log('\n  O arquivo de trabalho tem um erro de digitação (JSON inválido): ' + e.message + '\n'); process.exit(1); }
  }
  if (arg('--video')) job.video = arg('--video');
  if (arg('--legenda')) job.legenda = arg('--legenda');
  if (arg('--contas')) job.contas = arg('--contas').split(',').map((s) => s.trim()).filter(Boolean);

  // contas: as pedidas, ou todas as que têm login
  const pedidas = Array.isArray(job.contas) && job.contas.length ? job.contas : C.contasComLogin();
  job.contas = pedidas.map((s) => String(s).trim()).filter(Boolean);

  job.intervaloMin = Number(job.intervaloMin) || 8;   // minutos
  job.intervaloMax = Number(job.intervaloMax) || Math.max(job.intervaloMin, 20);
  return job;
}

(async () => {
  const job = montaTrabalho();
  const real = process.env.POSTAR_REAL === '1';

  if (!job.video) { console.log('\n  Faltou o vídeo (--video ou "video" no arquivo de trabalho).\n'); process.exit(1); }
  if (!fs.existsSync(job.video)) { console.log('\n  Vídeo não encontrado: ' + job.video + '\n'); process.exit(1); }
  if (!job.contas.length) {
    console.log('\n  Nenhuma conta com login. Faça primeiro:  npm run login-postar -- --conta monaco\n');
    process.exit(1);
  }

  console.log('');
  console.log('  MultiPost · postagem em massa no TikTok');
  console.log('  Vídeo:      ' + job.video);
  console.log('  Contas:     ' + job.contas.join(', ') + '  (' + job.contas.length + ')');
  console.log('  Intervalo:  ' + job.intervaloMin + '–' + job.intervaloMax + ' min entre contas');
  console.log('  Modo:       ' + (real ? 'PUBLICAR DE VERDADE' : 'ENSAIO (não publica)'));
  console.log('');

  // avisa quem não tem login (não trava o resto)
  const semLogin = job.contas.filter((c) => !C.temLogin(c));
  if (semLogin.length) {
    console.log('  ⚠ Sem login (vou pular): ' + semLogin.join(', '));
    console.log('    (para logar:  npm run login-postar -- --conta ' + semLogin[0] + ')');
    console.log('');
  }

  // pequena rede de segurança quando é DE VERDADE em várias contas
  if (real && job.contas.length > 1) {
    console.log('  Vou PUBLICAR DE VERDADE em ' + job.contas.length + ' contas. Ctrl+C para cancelar...');
    for (let s = 5; s > 0; s--) { process.stdout.write('  ' + s + '... '); await espera(1000); }
    console.log('\n');
  }

  const relatorio = [];
  const fila = job.contas.filter((c) => C.temLogin(c));

  for (let i = 0; i < fila.length; i++) {
    const conta = fila[i];
    const { legenda } = variaLegenda({
      legenda: job.legenda, legendas: job.legendas, hashtags: job.hashtags, conta, i,
    });
    console.log('  (' + (i + 1) + '/' + fila.length + ') ' + conta);
    console.log('        legenda: ' + legenda);

    // navegador novo por conta = sessões bem separadas (uma não contamina a outra)
    const browser = await abreNavegador(false);
    let res;
    try {
      res = await postaVideo({ browser, sessaoArq: C.arquivoSessao(conta), video: job.video, legenda, real, conta });
      console.log('        ' + (res.ensaio ? 'ensaio ok ✅' : res.publicado ? 'publicado ✅' : 'feito (confira no app) ⚠'));
    } catch (e) {
      res = { ok: false, erro: e.message };
      console.log('        ERRO: ' + e.message);
    } finally {
      await browser.close().catch(() => {});
    }
    relatorio.push({ conta, legenda, ...res });

    // espaça para a próxima conta (curtinho no ensaio; de verdade no modo real)
    if (i < fila.length - 1) {
      let ms = 1500;
      if (real) {
        const min = job.intervaloMin, max = job.intervaloMax;
        ms = Math.round((min + Math.random() * Math.max(0, max - min)) * 60000);
        console.log('        aguardando ' + Math.round(ms / 60000) + ' min até a próxima conta...');
      }
      await espera(ms);
    }
    console.log('');
  }

  // salva o relatório e imprime o resumo
  try {
    fs.mkdirSync(PASTA_LOGS, { recursive: true });
    fs.writeFileSync(path.join(PASTA_LOGS, 'ultimo-massa.json'), JSON.stringify(relatorio, null, 2));
  } catch (e) {}

  const ok = relatorio.filter((r) => r.ok).length;
  const erro = relatorio.filter((r) => !r.ok).length;
  console.log('  ───────── resumo ─────────');
  console.log('  ok: ' + ok + '   erro: ' + erro + '   (de ' + relatorio.length + ')');
  if (erro) relatorio.filter((r) => !r.ok).forEach((r) => console.log('   ✗ ' + r.conta + ': ' + r.erro));
  console.log('  relatório salvo em ' + path.join(PASTA_LOGS, 'ultimo-massa.json'));
  console.log('');
  process.exit(0);
})();
