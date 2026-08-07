// DuoLive · Conversa com o Supabase (banco na nuvem, guarda vendas/usuários/ofertas)
//
// A URL e a chave SECRETA vêm de:
//   1º variáveis SUPABASE_URL / SUPABASE_KEY (é assim no Render)
//   2º arquivo chave-supabase.txt (linha 1 = URL, linha 2 = chave), fora do git
//
// Só o servidor (conector) usa isto, com a chave secreta. O navegador nunca
// fala direto com o Supabase — passa pelo conector.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function config() {
  let url = process.env.SUPABASE_URL || '';
  let key = process.env.SUPABASE_KEY || '';
  if (!url || !key) {
    try {
      const linhas = fs.readFileSync(path.join(__dirname, 'chave-supabase.txt'), 'utf8')
        .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      url = url || linhas[0] || '';
      key = key || linhas[1] || '';
    } catch (e) {}
  }
  return { url: url.replace(/\/+$/, ''), key: key };
}
function ativo() { const c = config(); return !!(c.url && c.key && /^https?:\/\//.test(c.url)); }

async function req(metodo, caminho, corpo, extra) {
  const c = config();
  if (!ativo()) throw new Error('Supabase não configurado (URL/chave).');
  const headers = Object.assign({ apikey: c.key, Authorization: 'Bearer ' + c.key, 'content-type': 'application/json' }, extra || {});
  const r = await fetch(c.url + '/rest/v1/' + caminho, { method: metodo, headers: headers, body: corpo ? JSON.stringify(corpo) : undefined });
  const txt = await r.text();
  let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
  if (!r.ok) throw new Error('supabase ' + r.status + ': ' + String(txt).slice(0, 180));
  return j;
}

// atalhos (PostgREST)
const seleciona = (tabela, query) => req('GET', tabela + (query ? '?' + query : ''));
const insere = (tabela, dados) => req('POST', tabela, dados, { Prefer: 'return=representation' });
const atualiza = (tabela, filtro, dados) => req('PATCH', tabela + '?' + filtro, dados, { Prefer: 'return=representation' });
// grava sem duplicar quando a chave (onConflict) já existe
const upsert = (tabela, dados, onConflict) => req('POST', tabela + (onConflict ? '?on_conflict=' + onConflict : ''), dados, { Prefer: 'resolution=merge-duplicates,return=representation' });

// ---------- senha (scrypt com sal; guardado como "sal:hash" em hex) ----------
function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(senha || ''), sal, 32);
  return sal.toString('hex') + ':' + h.toString('hex');
}
function conferaSenha(senha, guardado) {
  try {
    const [salHex, hHex] = String(guardado || '').split(':');
    if (!salHex || !hHex) return false;
    const h = crypto.scryptSync(String(senha || ''), Buffer.from(salHex, 'hex'), 32);
    const alvo = Buffer.from(hHex, 'hex');
    return h.length === alvo.length && crypto.timingSafeEqual(h, alvo);
  } catch (e) { return false; }
}

module.exports = { config, ativo, req, seleciona, insere, atualiza, upsert, hashSenha, conferaSenha };
