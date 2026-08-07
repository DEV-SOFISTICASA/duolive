# DuoLive 🎥 — live na Shopee e no TikTok ao mesmo tempo

Painel único (página inicial): **Analytics** + **Ofertas** + **Multichat**.

| Arquivo | O que é |
|---|---|
| `index.html` | O painel completo (Analytics em cima, Ofertas embaixo, Multichat à direita) |
| `multichat.html` | Chat das duas lives com logos + contador de vendas |
| `sacolinha-controle.html` | Produtos por aba (Shopee/TikTok), ofertas relâmpago e Live anterior |
| `analytics.html` | Números da live atual e histórico (TikTok + Shopee) |
| `shopee-chat.user.js` | Leitor do chat da Shopee (instalar no Tampermonkey) |
| `conector/` | Programa local: chat do TikTok (`npm start -- @usuario`), login e robô da Shopee (`npm run login-shopee` / `npm run robo-shopee`) |

## Uso

**Painel completo em uma URL só:** com o conector ligado, abra `http://127.0.0.1:9797/painel` (ou `https://SUA-URL.onrender.com/painel` na nuvem) — Analytics, Ofertas e Multichat juntos, já conectados. A raiz (`/`) continua sendo só o Multichat, ideal para dock do OBS.

1. `conector/`: `npm install` (1ª vez) e `npm start -- @seuusuario`.
2. Vendas na hora (TikTok + Shopee): `npm run login-tiktok` e `npm run login-shopee` (1ª vez) e depois `npm run robo-vendas` durante a live — cada venda aparece no Multichat em segundos, com o logo da loja e o valor.
   - Conector na nuvem? Cole a URL do Render (ex.: `https://duolive-conector.onrender.com`) num arquivo `conector/conector.txt` — o robô passa a mandar as vendas para lá sozinho.
3. Produtos das lojas: `npm run produtos` — lê o catálogo do TikTok e da Shopee (só leitura) e o painel de Ofertas passa a listar os produtos reais, **cada loja com o seu próprio preço**.

**Várias lojas:** cada loja junta a conta do TikTok com a da Shopee. Para adicionar uma:

```
npm run login-tiktok  -- --loja bellini
npm run login-shopee  -- --loja bellini
npm run login-console -- --loja bellini    (Console de LIVE, p/ a oferta relâmpago)
npm run produtos                            (lê TODAS as lojas; use --loja bellini p/ uma só)
```

As sessões ficam separadas (`sessao-tiktok-bellini.json`), então uma loja nunca apaga a outra. No painel de Ofertas aparecem abas 🏪 para trocar de loja.
4. Oferta relâmpago de verdade:
   - **TikTok:** `npm run login-console` (1ª vez) — é o login do *Console de LIVE* (`shop.tiktok.com/streamer`), onde fica a ⚡ Oferta Relâmpago. É **outro login**, separado do `login-tiktok` do Seller Center.
   - Depois `npm run robo-oferta` (modo ensaio, não salva nada) para conferir; então `set DUOLIVE_OFERTA_REAL=1` + `npm run robo-oferta` para valer.
   - Dá para deixar **várias ofertas no ar ao mesmo tempo**. Emergência: `npm run robo-oferta -- --restaurar-tudo`.
5. **Usar em outro computador (logins na nuvem):** os arquivos `sessao-*.json` são o seu login — nunca vão para a nuvem como estão. O cofre junta todos num arquivo só, embaralhado com uma senha sua:
   - Crie um repositório **privado** no GitHub e cole o endereço em `conector/cofre.txt` (veja `cofre.exemplo.txt`).
   - Neste PC: `npm run subir-sessoes` (pede uma senha e envia).
   - No outro PC: `npm run baixar-sessoes` (pede a senha e devolve os logins).
   - Sem a senha ninguém abre o cofre — nem quem tiver o arquivo. Guarde-a bem: não há como recuperá-la.
6. Abrir a página inicial do site — o Multichat acende sozinho.
7. Chat da Shopee: Tampermonkey + `shopee-chat.user.js`, com a página da live aberta.
8. Transmissão: OBS → Shopee (RTMP) e TikTok via Live Studio + Câmera Virtual (ou Aitum Multistream se as duas contas tiverem chave RTMP).

> **Navegador:** os robôs usam o Chrome, o Edge **ou o Brave** — o primeiro que acharem instalado (`conector/navegador.js`).

> **Chave do chat do TikTok:** a leitura do chat passa pelo [Euler Stream](https://www.eulerstream.com). Coloque a sua chave (grátis) em `conector/chave-tiktok.txt`, uma linha só — ou na variável `DUOLIVE_SIGN_KEY`. **Uma chave serve para todas as lojas:** ela identifica a sua conta no serviço, não o @ assistido. O arquivo é ignorado pelo git.
