// DuoLive · Postador — contas de postagem
//
// Uma "conta" aqui é um apelido (monaco, bellini, vend-ana...) que tem um login
// guardado em sessao-postar-<apelido>.json. É o login da conta de CRIADOR do
// TikTok (onde se publica vídeo) — separado do Seller Center e do Console de LIVE.
//
// Reaproveita lojas.js (mesma regra de nome de arquivo das outras partes do DuoLive).

const fs = require('fs');
const path = require('path');
const L = require('../lojas.js');

// caminho do login antigo (storageState) — mantido só pra não quebrar coisas
// velhas. O login de verdade agora mora numa PASTA de perfil (veja pastaPerfil).
function arquivoSessao(conta) {
  return L.arquivoSessao('postar', conta);
}

// pasta do PERFIL FIXO da conta (guarda o login como um navegador de verdade).
// Fica em conector/perfil-postar-<conta>/, uma pasta por conta.
function pastaPerfil(conta) {
  return path.join(__dirname, '..', 'perfil-postar-' + L.limpaNome(conta));
}

// tem login guardado? (o perfil já foi criado e tem cookies dentro)
function temLogin(conta) {
  try {
    const ck = path.join(pastaPerfil(conta), 'Default', 'Network', 'Cookies');
    return fs.existsSync(ck);
  } catch (e) { return false; }
}

// resolve o apelido pedido: --conta X | --loja X | DUOLIVE_LOJA | loja.txt | principal
function contaPedida(argv) {
  const args = argv || process.argv;
  const i = args.indexOf('--conta');
  if (i >= 0 && args[i + 1]) return L.limpaNome(args[i + 1]);
  return L.lojaPedida(args); // aceita --loja também, pra bater com o resto do DuoLive
}

// todas as contas que já têm login de postagem (procura as pastas
// perfil-postar-<conta>/ na pasta conector — uma acima desta)
function contasComLogin() {
  const achadas = new Set();
  let arquivos = [];
  try { arquivos = fs.readdirSync(path.join(__dirname, '..')); } catch (e) {}
  arquivos.forEach((a) => {
    const m = a.match(/^perfil-postar-(.+)$/);
    if (m && temLogin(m[1])) achadas.add(m[1]);
  });
  return Array.from(achadas).sort();
}

// lista opcional escrita à mão em contas-postar.txt (uma por linha, # = comentário).
// Serve para você já deixar planejadas contas que ainda vai logar.
function contasListadas() {
  try {
    const t = fs.readFileSync(path.join(__dirname, 'contas-postar.txt'), 'utf8');
    const nomes = t.split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')).map(L.limpaNome);
    return nomes.filter((n, i) => nomes.indexOf(n) === i);
  } catch (e) { return []; }
}

module.exports = { arquivoSessao, pastaPerfil, temLogin, contaPedida, contasComLogin, contasListadas };
