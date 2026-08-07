// Prova de que os robôs acham a sessão que o login realmente grava.
// Cria sessões FALSAS (vazias, sem cookie nenhum) com os nomes novos,
// pergunta a cada robô qual arquivo ele usaria, e apaga tudo no final.
const fs = require('fs');
const path = require('path');
const DIR = 'C:/Users/PC2/Desktop/Claude/duolive/conector';
const L = require(DIR + '/lojas.js');

const FALSAS = ['sessao-tiktok-principal.json', 'sessao-shopee-principal.json', 'sessao-console-principal.json'];
const vazia = JSON.stringify({ cookies: [], origins: [] });

let ok = 0, falha = 0;
function afirma(nome, cond, detalhe) {
  if (cond) { ok++; console.log('  ✅ ' + nome); }
  else { falha++; console.log('  ❌ ' + nome + (detalhe ? ' — ' + detalhe : '')); }
}

// limpa restos de execuções anteriores
FALSAS.forEach((f) => { try { fs.unlinkSync(path.join(DIR, f)); } catch (e) {} });

console.log('\n  ANTES do login (nenhuma sessão existe):');
delete require.cache[require.resolve(DIR + '/robo-vendas.js')];
let contas = require(DIR + '/robo-vendas.js').CONTAS;
afirma('robo-vendas sabe que não há login', contas.every((c) => !fs.existsSync(c.sessao)));

// agora simula o que o "npm run login-*" grava
console.log('\n  DEPOIS do login (arquivos com o nome novo, "-principal"):');
FALSAS.forEach((f) => fs.writeFileSync(path.join(DIR, f), vazia));

Object.keys(require.cache).forEach((k) => { if (k.includes('conector')) delete require.cache[k]; });
contas = require(DIR + '/robo-vendas.js').CONTAS;
contas.forEach((c) => {
  const achou = fs.existsSync(c.sessao);
  afirma('robo-vendas acha a sessão da ' + c.plataforma, achou, 'procurou em ' + path.basename(c.sessao));
});

const resumo = L.resumoDasLojas();
afirma('lojas.js lista a loja "principal"', resumo.length === 1 && resumo[0].loja === 'principal', JSON.stringify(resumo));
afirma('lojas.js vê os 3 logins', resumo[0] && resumo[0].tiktok && resumo[0].shopee && resumo[0].console, JSON.stringify(resumo[0]));

['shopee', 'tiktok'].forEach((p) => {
  const arq = L.arquivoSessao(p, 'principal');
  afirma('localizador acha ' + p, fs.existsSync(arq), path.basename(arq));
});

// compatibilidade: o nome ANTIGO (sem sufixo) tem que continuar valendo
console.log('\n  Compatibilidade com sessões antigas (sem "-principal"):');
FALSAS.forEach((f) => fs.unlinkSync(path.join(DIR, f)));
fs.writeFileSync(path.join(DIR, 'sessao-tiktok.json'), vazia);
Object.keys(require.cache).forEach((k) => { if (k.includes('conector')) delete require.cache[k]; });
contas = require(DIR + '/robo-vendas.js').CONTAS;
const tik = contas.find((c) => c.plataforma === 'tiktok');
afirma('robo-vendas ainda acha a sessão antiga', fs.existsSync(tik.sessao), path.basename(tik.sessao));

// faxina: não deixa lixo para trás
try { fs.unlinkSync(path.join(DIR, 'sessao-tiktok.json')); } catch (e) {}
FALSAS.forEach((f) => { try { fs.unlinkSync(path.join(DIR, f)); } catch (e) {} });
const sobrou = fs.readdirSync(DIR).filter((a) => /^sessao-/.test(a));
afirma('faxina: nenhuma sessão de teste ficou para trás', sobrou.length === 0, sobrou.join(', '));

console.log('');
console.log(falha === 0 ? ('  TUDO CERTO: ' + ok + ' testes passaram.') : ('  ATENÇÃO: ' + falha + ' falha(s) em ' + (ok + falha) + '.'));
process.exit(falha === 0 ? 0 : 1);
