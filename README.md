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

1. `conector/`: `npm install` (1ª vez) e `npm start -- @seuusuario`.
2. Abrir a página inicial do site — o Multichat acende sozinho.
3. Chat da Shopee: Tampermonkey + `shopee-chat.user.js`, com a página da live aberta.
4. Transmissão: OBS → Shopee (RTMP) e TikTok via Live Studio + Câmera Virtual (ou Aitum Multistream se as duas contas tiverem chave RTMP).
