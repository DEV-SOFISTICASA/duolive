// Teste do cofre: embaralha, desembaralha, recusa senha errada e detecta adulteração.
// Não encosta nas sessões de verdade — usa dados inventados.
const C = require('C:/Users/PC2/Desktop/Claude/duolive/conector/cofre.js');

let ok = 0, falha = 0;
function afirma(nome, cond, detalhe) {
  if (cond) { ok++; console.log('  ✅ ' + nome); }
  else { falha++; console.log('  ❌ ' + nome + (detalhe ? ' — ' + detalhe : '')); }
}

// uma sessão de mentira, com a mesma cara de uma de verdade
const original = {
  sessoes: {
    'sessao-tiktok-principal.json': { cookies: [{ name: 'sessionid', value: 'abc123SEGREDO', domain: '.tiktok.com' }], origins: [] },
    'sessao-shopee-principal.json': { cookies: [{ name: 'SPC_ST', value: 'xyz789SEGREDO', domain: '.shopee.com.br' }], origins: [] },
  },
  de: 'duolive',
};
const SENHA = 'minha-senha-forte-123';

// ---------- 1. fecha e abre ----------
const cofre = C.fecha(original, SENHA);
afirma('cofre tem a marca certa', cofre.duolive === 'cofre-v1');
afirma('cofre tem sal, iv e selo', !!(cofre.sal && cofre.iv && cofre.selo && cofre.dados));

const texto = JSON.stringify(cofre);
afirma('o segredo NAO aparece no arquivo', !texto.includes('SEGREDO') && !texto.includes('sessionid'),
  'vazou algo em texto puro!');
afirma('o nome do arquivo NAO aparece', !texto.includes('sessao-tiktok'));

const aberto = C.abre(cofre, SENHA);
afirma('abriu com a senha certa', JSON.stringify(aberto) === JSON.stringify(original));
afirma('o cookie voltou igualzinho',
  aberto.sessoes['sessao-tiktok-principal.json'].cookies[0].value === 'abc123SEGREDO');

// ---------- 2. senha errada ----------
let erro = '';
try { C.abre(cofre, 'senha-errada'); } catch (e) { erro = e.message; }
afirma('senha errada e' + ' recusada', erro === 'SENHA_ERRADA', 'erro foi: ' + erro);

// ---------- 3. arquivo adulterado ----------
const mexido = JSON.parse(JSON.stringify(cofre));
const b = Buffer.from(mexido.dados, 'base64'); b[0] = b[0] ^ 0xff; mexido.dados = b.toString('base64');
erro = '';
try { C.abre(mexido, SENHA); } catch (e) { erro = e.message; }
afirma('percebe se mexeram no arquivo', erro === 'SENHA_ERRADA', 'erro foi: ' + erro);

// ---------- 4. arquivo que não é cofre ----------
erro = '';
try { C.abre({ qualquer: 'coisa' }, SENHA); } catch (e) { erro = e.message; }
afirma('recusa arquivo que nao e cofre', /nao e um cofre/.test(erro), 'erro foi: ' + erro);

// ---------- 5. cada cofre sai diferente (sal e iv novos) ----------
const outro = C.fecha(original, SENHA);
afirma('dois cofres da mesma coisa saem diferentes', outro.dados !== cofre.dados || outro.sal !== cofre.sal);
afirma('mas os dois abrem com a mesma senha',
  JSON.stringify(C.abre(outro, SENHA)) === JSON.stringify(original));

// ---------- 6. endereço da nuvem (lido do cofre.txt, ignorando comentários) ----------
const nuvem = C.enderecoNuvem('C:/Users/PC2/Desktop/Claude/duolive/conector');
afirma('acha o repositorio no cofre.txt', /^https:\/\/github\.com\/.+\.git$/.test(nuvem), 'leu: ' + nuvem);
afirma('ignora as linhas de comentario', !nuvem.startsWith('#'), 'leu: ' + nuvem);
afirma('pasta sem cofre.txt -> sem nuvem', C.enderecoNuvem(require('os').tmpdir()) === '');

console.log('');
console.log(falha === 0 ? ('  TUDO CERTO: ' + ok + ' testes passaram.') : ('  ATENÇÃO: ' + falha + ' falha(s) em ' + (ok + falha) + '.'));
process.exit(falha === 0 ? 0 : 1);
