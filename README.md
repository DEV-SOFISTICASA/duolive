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

## 📤 MultiPost — publicar vídeos em várias contas

Publica **um vídeo em várias contas do TikTok**, variando a legenda por conta e espaçando os horários. Fica na pasta `conector/multipost/`; os comandos `npm run …` continuam sendo rodados de dentro de `conector/`.

> ⚠️ **Segurança:** por padrão é **ENSAIO** (faz tudo, menos o clique de publicar). Só publica de verdade com `POSTAR_REAL=1`. É a conta de **criador** (tiktok.com) — outro login, separado do Seller Center e do Console de LIVE.

1. **Logar cada conta** (uma vez por conta):
   ```
   npm run login-postar -- --conta monaco
   npm run login-postar -- --conta bellini
   ```
   Cada login fica em `sessao-postar-<conta>.json` (ignorado pelo git).

2. **Testar em uma conta** (não publica):
   ```
   npm run postar -- --conta monaco --video "C:\videos\promo.mp4" --legenda "Chegou novidade #promo"
   ```
   Confira o print em `conector/multipost/postar-logs/`. Deu certo? Publique de verdade:
   ```
   set POSTAR_REAL=1&& npm run postar -- --conta monaco --video "C:\videos\promo.mp4" --legenda "Chegou novidade #promo"
   ```

3. **Postagem em massa** (várias contas): copie `postar-exemplo.json`, ajuste o caminho do vídeo, a legenda, as hashtags e as contas, e rode:
   ```
   npm run postar-massa -- --job postar-exemplo.json            (ensaio)
   set POSTAR_REAL=1&& npm run postar-massa -- --job postar-exemplo.json   (de verdade)
   ```
   Sem `"contas"` no arquivo, usa **todas** as que já têm login. O intervalo entre contas (`intervaloMin`/`intervaloMax`, em minutos) espaça as postagens. Relatório final em `conector/multipost/postar-logs/ultimo-massa.json`.

| Arquivo | O que é |
|---|---|
| `postar-login.js` | Login de uma conta de postagem (`npm run login-postar -- --conta X`) |
| `postar.js` | Publica em UMA conta (bom para testar) |
| `postar-massa.js` | Publica em VÁRIAS contas, com variação de legenda e horários espaçados |
| `postador-variacao.js` | Varia a legenda por conta (teste: `npm run ensaio-variacao`) |
| `postador-nucleo.js` | A parte que fala com a tela do TikTok (seletores num lugar só) |
| `legenda-ia.js` | 🧠 A IA olha o vídeo e escreve legenda + hashtags |
| `legenda-teste.js` | Testar a legenda da IA num vídeo (`npm run legenda-teste`) |

### 🧠 Legenda automática (a IA vê o vídeo)

A IA tira alguns quadros do vídeo, olha, e escreve a legenda + hashtags sozinha. Precisa de duas coisas:

1. **ffmpeg** (tira os quadros). No Windows:
   ```bash
   winget install Gyan.FFmpeg
   ```
   O MultiPost acha o ffmpeg sozinho — não precisa mexer no PATH nem reiniciar.
2. **Chave da IA**: crie em console.anthropic.com e cole em `conector/multipost/chave-ia.txt` (uma linha só). Custa poucos centavos por vídeo. O arquivo é ignorado pelo git.

Testar num vídeo (não publica nada):
```bash
npm run legenda-teste -- --video "C:\videos\SEU-VIDEO.mp4" --loja "loja de decoração"
```

> Modelo: por padrão o mais forte (`claude-opus-5`). Para baratear em muitos vídeos, use um mais leve: `set MULTIPOST_MODELO=claude-haiku-4-5` antes do comando.
