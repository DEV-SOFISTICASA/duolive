// DuoLive · Postador — POSTAGEM EM MASSA (várias contas)
//
// Pega UM vídeo e publica em VÁRIAS contas, variando a legenda por conta e
// espaçando os horários (pra não parecer robô postando tudo de uma vez).
//
// 🧠 Se você NÃO der legenda, a IA olha o vídeo e escreve legenda + hashtags
// sozinha (e o app varia por conta, como sempre). --loja dá o tom ("loja de
// decoração"); --dica dá contexto extra ("promoção de vasos").
//
// Por padrão é ENSAIO. Para publicar de verdade: POSTAR_REAL=1.
//
// Jeito fácil (arquivo de trabalho):
//   npm run postar-massa -- --job postar-exemplo.json
// Jeito rápido (sem arquivo):
//   npm run postar-massa -- --video "C:\videos\promo.mp4" --legenda "Chegou novidade" --contas monaco,bellini
// Deixando a IA escrever (é só não dar a legenda):
//   npm run postar-massa -- --video "C:\videos\promo.mp4" --contas monaco,bellini --loja "loja de decoração"
// Só espiar a legenda da IA e as variações por conta (não abre navegador):
//   npm run postar-massa -- --video "C:\videos\promo.mp4" --contas monaco,bellini --so-legenda
//
// Se não disser as contas, usa TODAS as que já têm login (sessao-postar-*.json).

const fs = require('fs');
const path = require('path');
const { abrePerfil } = require('../navegador.js');
const C = require('./contas-postar.js');
const { postaVideo, PASTA_LOGS } = require('./postador-nucleo.js');
const { variaLegenda } = require('./postador-variacao.js');
const { legendaDoVideo } = require('./legenda-ia.js');

function arg(nome) { const i = process.argv.indexOf(nome); return i >= 0 ? process.argv[i + 1] : ''; }
function espera(ms) { return new Promise((r) => setTimeout(r, ms)); }

// soma `add` minutos a "HH:MM" e devolve { hh, mm } (mesmo dia; passou de 23:59 dá volta)
function horaMais(base, add) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(base || '').trim());
  if (!m) return null;
  let total = (+m[1]) * 60 + (+m[2]) + (add || 0);
  total = ((total % 1440) + 1440) % 1440;
  return { hh: Math.floor(total / 60), mm: total % 60 };
}

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
  if (arg('--loja')) job.loja = arg('--loja');
  if (arg('--dica')) job.dica = arg('--dica');
  if (process.argv.includes('--so-legenda')) job.soLegenda = true;
  // 📅 --agendar HH:MM = horário da 1ª postagem; cada conta seguinte soma o intervalo
  if (arg('--agendar')) job.agendar = arg('--agendar');
  if (arg('--intervalo')) job.intervalo = Number(arg('--intervalo')) || 0;

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
  console.log('  Modo:       ' + (job.soLegenda ? 'SÓ LEGENDA (não abre navegador)' : real ? 'PUBLICAR DE VERDADE' : 'ENSAIO (não publica)'));
  if (job.agendar) console.log('  Quando:     📅 PROGRAMAR a partir de ' + job.agendar + ', de ' + (job.intervalo || 15) + ' em ' + (job.intervalo || 15) + ' min');
  console.log('');

  // 🧠 CÉREBRO: sem legenda no trabalho? A IA olha o vídeo e escreve uma.
  const jaTemLegenda = String(job.legenda || '').trim() ||
    (Array.isArray(job.legendas) && job.legendas.some((x) => String(x || '').trim()));
  if (!jaTemLegenda) {
    console.log('  🧠 Sem legenda no trabalho — a IA vai olhar o vídeo e escrever...');
    try {
      const r = await legendaDoVideo(job.video, { loja: job.loja, dica: job.dica });
      job.legenda = r.legenda;
      // as hashtags da IA entram JUNTO com as suas do trabalho (se tiver)
      job.hashtags = (Array.isArray(job.hashtags) ? job.hashtags : []).concat(r.hashtags || []);
      console.log('  🧠 Legenda (' + r.modelo + '): ' + r.legenda);
      console.log('     Hashtags: ' + (r.hashtags || []).join(' '));
    } catch (e) {
      console.log('\n  Não consegui criar a legenda com a IA: ' + e.message);
      console.log('  (Dá pra postar mesmo assim dizendo a legenda você mesmo: --legenda "seu texto")\n');
      // sair "na marra" logo depois de falar com a IA crasha o Node no Windows;
      // então marca o erro, agenda uma saída de segurança e deixa fechar sozinho
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 2000).unref();
      return;
    }
    console.log('');
  }

  // --so-legenda: mostra como fica em cada conta e para por aqui (sem navegador)
  if (job.soLegenda) {
    console.log('  Como fica em cada conta:');
    job.contas.forEach((conta, i) => {
      const { legenda } = variaLegenda({
        legenda: job.legenda, legendas: job.legendas, hashtags: job.hashtags, conta, i,
      });
      console.log('  [' + conta + ']  ' + legenda);
    });
    console.log('');
    setTimeout(() => process.exit(0), 2000).unref();
    return;
  }

  // avisa quem não tem login (não trava o resto)
  const semLogin = job.contas.filter((c) => !C.temLogin(c));
  if (semLogin.length) {
    console.log('  ⚠ Sem login (vou pular): ' + semLogin.join(', '));
    console.log('    (para logar:  npm run login-postar -- --conta ' + semLogin[0] + ')');
    console.log('');
  }

  const fila = job.contas.filter((c) => C.temLogin(c));
  if (!fila.length) {
    console.log('  Nenhuma das contas pedidas tem login ainda — então paro por aqui.');
    console.log('  (para logar:  npm run login-postar -- --conta ' + job.contas[0] + ')');
    console.log('');
    process.exit(1);
  }

  // pequena rede de segurança quando é DE VERDADE em várias contas
  if (real && fila.length > 1) {
    console.log('  Vou PUBLICAR DE VERDADE em ' + fila.length + ' contas. Ctrl+C para cancelar...');
    for (let s = 5; s > 0; s--) { process.stdout.write('  ' + s + '... '); await espera(1000); }
    console.log('\n');
  }

  const relatorio = [];

  for (let i = 0; i < fila.length; i++) {
    const conta = fila[i];
    const { legenda } = variaLegenda({
      legenda: job.legenda, legendas: job.legendas, hashtags: job.hashtags, conta, i,
    });
    // 📅 agendando? cada conta pega um horário: base + i × intervalo (padrão 15 min)
    const agendar = job.agendar ? horaMais(job.agendar, i * (job.intervalo || 15)) : null;
    console.log('  (' + (i + 1) + '/' + fila.length + ') ' + conta + (agendar ? '  📅 ' + String(agendar.hh).padStart(2, '0') + ':' + String(agendar.mm).padStart(2, '0') : ''));
    console.log('        legenda: ' + legenda);

    // perfil FIXO da conta = login próprio e bem separado (uma não contamina a outra)
    const context = await abrePerfil(C.pastaPerfil(conta), false);
    let res;
    try {
      res = await postaVideo({ context, video: job.video, legenda, real, conta, agendar });
      console.log('        ' + (res.ensaio ? 'ensaio ok ✅' : res.agendado ? ('agendado ' + res.horaAgendada + ' ✅') : res.publicado ? 'publicado ✅' : 'feito (confira no app) ⚠'));
    } catch (e) {
      res = { ok: false, erro: e.message };
      console.log('        ERRO: ' + e.message);
    } finally {
      await context.close().catch(() => {});
    }
    relatorio.push({ conta, legenda, ...res });

    // espaça para a próxima conta. AGENDANDO não precisa esperar no tempo real
    // (o espaçamento já está nos horários agendados); publicando AGORA, espaça de verdade.
    if (i < fila.length - 1) {
      let ms = 1500;
      if (real && !job.agendar) {
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
  // deixa o Node terminar sozinho (a IA e o navegador ainda fecham conexões);
  // se algo ficar preso, o timer abaixo força a saída em 2 segundos.
  setTimeout(() => process.exit(0), 2000).unref();
})();
