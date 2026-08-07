// DuoLive · Cadastra os usuários iniciais no Supabase (roda uma vez)
//   ADM (senha 01061705) + as 6 vendedoras (senha no primeiro acesso).
// Rodar de novo não duplica: usa a sigla/nome como chave.
const SB = require('./supabase.js');

const ADM_SENHA = '01061705';
const PESSOAS = [
  { nome: 'ADM',        sigla: 'ADM',  papel: 'adm',       turno: null,     cor: '#ffffff', senha: ADM_SENHA },
  { nome: 'Alessandra', sigla: 'AL',   papel: 'vendedora', turno: 'manha',  cor: '#ef4444' },
  { nome: 'Giovana',    sigla: 'GC',   papel: 'vendedora', turno: 'manha',  cor: '#f59e0b' },
  { nome: 'Adriana',    sigla: 'KA',   papel: 'vendedora', turno: 'manha',  cor: '#eab308' },
  { nome: 'Taci',       sigla: 'TS',   papel: 'vendedora', turno: 'tarde',  cor: '#22c55e' },
  { nome: 'Giovana',    sigla: 'JK',   papel: 'vendedora', turno: 'tarde',  cor: '#3b82f6' },
  { nome: 'Lorena',     sigla: 'LORE', papel: 'vendedora', turno: 'tarde',  cor: '#a855f7' },
];

(async () => {
  if (!SB.ativo()) { console.log('  Supabase não configurado (chave-supabase.txt).'); process.exit(1); }
  console.log('\n  Cadastrando usuários no Supabase...\n');

  // quem já existe (pela sigla) para não duplicar
  const jaTem = await SB.seleciona('usuarios', 'select=sigla');
  const siglasExistentes = new Set((jaTem || []).map((u) => u.sigla));

  const novos = PESSOAS.filter((p) => !siglasExistentes.has(p.sigla)).map((p) => ({
    nome: p.nome, sigla: p.sigla, papel: p.papel, turno: p.turno, cor: p.cor,
    senha_hash: p.senha ? SB.hashSenha(p.senha) : null,  // ADM já com senha; vendedoras null (1º acesso)
  }));

  if (!novos.length) { console.log('  Todos os usuários já estavam cadastrados. Nada a fazer.'); }
  else {
    const inseridos = await SB.insere('usuarios', novos);
    inseridos.forEach((u) => console.log('  ✅ ' + u.nome.padEnd(12) + ' (' + u.sigla + ')  ' + u.papel + (u.senha_hash ? '  [senha definida]' : '  [1º acesso]')));
  }

  console.log('\n  --- usuários no banco agora ---');
  const todos = await SB.seleciona('usuarios', 'select=nome,sigla,papel,turno,cor,senha_hash&order=id');
  todos.forEach((u) => console.log('   ' + (u.papel === 'adm' ? '👑' : '🛍️') + ' ' + u.nome.padEnd(12) + (u.sigla || '').padEnd(6) + (u.turno || '-').padEnd(7) + (u.senha_hash ? 'tem senha' : 'primeiro acesso')));
  console.log('');
  process.exit(0);
})().catch((e) => { console.log('  Deu erro: ' + e.message + '\n'); process.exit(1); });
