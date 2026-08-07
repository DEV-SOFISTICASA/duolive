// DuoLive · A parte do cofre que fala com o repositório privado
//
// Mantém uma cópia do repositório do cofre em conector/.cofre-nuvem (essa pasta
// é ignorada pelo git do projeto, então nada disso vaza para o repositório
// público do DuoLive).

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const C = require('./cofre.js');

function git(args, onde) {
  const r = spawnSync('git', args, { cwd: onde, encoding: 'utf8' });
  if (r.error) throw new Error('nao consegui rodar o git: ' + r.error.message);
  return { ok: r.status === 0, saida: ((r.stdout || '') + (r.stderr || '')).trim() };
}

// Devolve a pasta onde o cofre deve ficar.
// Com repositório configurado: clona (1ª vez) ou atualiza, e devolve .cofre-nuvem.
// Sem repositório: devolve a própria pasta conector (o cofre fica só no PC).
function pastaDoCofre(dir) {
  const url = C.enderecoNuvem(dir);
  if (!url) return dir;

  const pasta = C.PASTA_NUVEM(dir);
  if (!fs.existsSync(path.join(pasta, '.git'))) {
    console.log('  Conectando no seu repositório privado...');
    try { fs.rmSync(pasta, { recursive: true, force: true }); } catch (e) {}
    const r = git(['clone', url, pasta], dir);
    if (!r.ok) {
      throw new Error('nao consegui acessar o repositorio do cofre.\n  ' + r.saida
        + '\n\n  Confira o endereco em conector/cofre.txt e se voce tem acesso a ele.');
    }
  } else {
    const r = git(['pull', '--rebase'], pasta);
    // repositório novo ainda sem nenhum envio: o pull reclama, e tudo bem
    if (!r.ok && !/couldn't find remote ref|does not have any commits|no such ref/i.test(r.saida)) {
      console.log('  (aviso do git ao atualizar: ' + r.saida.split('\n')[0] + ')');
    }
  }
  return pasta;
}

// grava e envia para a nuvem
function enviar(pasta, mensagem) {
  git(['add', '-A'], pasta);
  const commit = git(['commit', '-m', mensagem], pasta);
  if (!commit.ok && !/nothing to commit|nada a submeter/i.test(commit.saida)) {
    throw new Error('nao consegui gravar a mudanca:\n  ' + commit.saida);
  }
  if (/nothing to commit|nada a submeter/i.test(commit.saida)) {
    console.log('  (o cofre na nuvem já estava igual a este)');
    return;
  }
  console.log('  Enviando para a nuvem...');
  let envio = git(['push'], pasta);
  if (!envio.ok) envio = git(['push', '-u', 'origin', 'HEAD'], pasta); // 1º envio do repositório
  if (!envio.ok) {
    throw new Error('gravei aqui, mas nao consegui enviar:\n  ' + envio.saida
      + '\n\n  (se pedir login do GitHub, uma janela do navegador deve abrir)');
  }
}

module.exports = { pastaDoCofre, enviar };
