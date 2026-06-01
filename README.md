# EspNest — ESP32 Wake-on-LAN & LED Server

Servidor WebSocket/HTTP para controle remoto de múltiplos ESP32 autenticados, com interface web (SPA) protegida por login, suporte a Wake-on-LAN, controle de fita LED RGB/RGBW, efeitos rodando no firmware e cenas salvas.

## 📋 Descrição

Este sistema funciona como um servidor intermediário (tunnel) que:

- Recebe conexões WebSocket de múltiplos ESP32 na porta 9001
- Identifica cada ESP32 pelo MAC address autenticado
- Disponibiliza interface HTTP (SPA) na porta 9000 com autenticação JWT
- Permite enviar comandos WoL, LED e efeitos para um ou vários ESP32 ao mesmo tempo
- Mantém cadastro de clientes ESP32, cadastro separado de alvos WoL (MAC) e cenas de cor
- Acompanha em tempo real (SSE) o status de conexão, a cor atual e o efeito ativo de cada ESP

## 🚀 Funcionalidades

- **Autenticação JWT**: Login seguro com token válido por **7 dias**
- **Túnel WebSocket**: Comunicação em tempo real com múltiplos ESP32
- **Autenticação HMAC + MAC**: ESP envia `token`, `hmac` e `mac` no handshake
- **Configuração remota do ESP**: ESP pode solicitar `ledCount`, `ledPin` e `ledType` via `get_config`
- **Wake-on-LAN em lote**: Disparo para um ou vários ESPs selecionados
- **Controle LED RGB/RGBW**: Aplicação de cor única por fita (R/G/B) e canal branco opcional (`w`) para SK6812
- **Efeitos no firmware**: `breathing`, `rainbow` e `fade` — o servidor envia **um único comando** e a animação roda no ESP (sem fluxo contínuo de requisições). O servidor rastreia o efeito ativo por dispositivo
- **Cenas**: salvar/aplicar/excluir presets de cor associados a dispositivos (`/api/scenes`)
- **Atualizações em tempo real (SSE)**: eventos `status` (conexão), `state` (cor ao vivo) e `effect` (efeito ativo)
- **Descoberta de ESP não cadastrado**: Lista com MAC + IP na tela de dispositivos
- **Interface SPA**: navegação sem reload, seletor global de dispositivos persistente, tema escuro/claro
- **Logs de debug WS**: mensagens enviadas/recebidas no túnel para diagnóstico
- **Resiliência de comunicação**: timeout/offline do ESP retorna erro por dispositivo sem derrubar o processo Node.js

## 📦 Pré-requisitos

- Node.js (versão 14 ou superior)
- npm ou yarn

## 🔧 Instalação

1. Clone o repositório:
```bash
git clone <url-do-repositorio>
cd esp32-wol-server
```

2. Instale as dependências:
```bash
npm install
```

3. Configure variáveis de ambiente:
```bash
cp .env.example .env
```

4. Edite `.env`:
```env
JWT_SECRET=sua_chave_secreta_aqui
HMAC_SECRET=sua_chave_hmac_aqui
LOGIN_USER=seu_usuario
LOGIN_PASS=sua_senha_forte
TUNNEL_PORT=9001
HTTP_PORT=9000
```

## ▶️ Executando o Servidor

```bash
npm start
# ou
node src/server.js
```

Para desenvolvimento com auto-reload (nodemon):

```bash
npm run dev
```

> O modo `dev` observa `src/` mas **ignora `src/data/*`** — assim as gravações de estado (cor atual, cenas) não disparam reinício do servidor.

Serviços:
- WebSocket tunnel: `ws://localhost:9001`
- HTTP interface: `http://localhost:9000`

## 🔌 Protocolo ESP32 (atual)

### 1) Autenticação ao conectar

Logo após conectar no WebSocket, o ESP deve enviar:

```json
{
  "token": "esp32-1234567890",
  "hmac": "abc123...",
  "mac": "7C:87:CE:28:09:68"
}
```

Regras:
- `token` no formato `esp32-{timestamp}`
- `hmac` = SHA256(token, HMAC_SECRET)
- `mac` obrigatório (identificador do cliente)
- timestamp com janela de validação de 5 minutos

### 2) Solicitar configuração após autenticação

O ESP pode solicitar sua configuração:

```json
{ "action": "get_config" }
```

Resposta de sucesso:

```json
{
  "status": "ok",
  "action": "config",
  "ledCount": 300,
  "ledPin": 13,
  "ledType": "sk6812"
}
```

Resposta de erro:

```json
{
  "status": "error",
  "action": "config",
  "error": "config_incomplete"
}
```

### 3) Comandos enviados pelo servidor para o ESP

**Wake-on-LAN**
```json
{
  "action": "wol",
  "mac": "AA:BB:CC:DD:EE:FF"
}
```

**LED (fita inteira, cor única)**
```json
{
  "action": "led",
  "r": 255,
  "g": 140,
  "b": 55
}
```

**LED RGBW (apenas para ESP com `ledType = sk6812`)**
```json
{
  "action": "led",
  "r": 255,
  "g": 140,
  "b": 55,
  "w": 80
}
```

**Efeito (animação roda no firmware do ESP)**
```json
{
  "action": "effect",
  "effect": "breathing",
  "r": 255,
  "g": 100,
  "b": 50
}
```
- `effect`: `breathing`, `rainbow`, `fade` ou `none` (para interromper)
- `r`/`g`/`b`: cor base opcional, usada por efeitos como `breathing`
- O servidor envia **apenas um comando**; a animação é gerada no próprio ESP
- Enviar uma cor sólida via `action: "led"` interrompe o efeito ativo

### 4) Resposta do ESP

Exemplo esperado:

```json
{
  "status": "ok",
  "action": "led"
}
```

Para efeito:

```json
{
  "status": "ok",
  "action": "effect",
  "effect": "breathing"
}
```

## 🌐 Uso da interface

A interface é uma SPA (single-page app) servida em todas as rotas de página; a navegação acontece no cliente, sem reload.

1. Acesse `http://localhost:9000`
2. Faça login
3. Navegue pelas telas:
   - `/` **Dashboard** — visão geral dos dispositivos, status ao vivo e o que cada LED está fazendo (cor sólida, apagado ou efeito ativo)
   - `/led` **Controle de LED** — seletor de cor, efeitos e cenas
   - `/wol` **Wake-on-LAN** — disparo de pacote mágico
   - `/devices` **Dispositivos** — cadastro de ESP32, descoberta e alvos WoL

> As rotas antigas `/config` e `/wol-targets` continuam funcionando como **aliases** de `/devices` (deep-links preservados).

### Comportamento atual das telas

- **Seletor global de dispositivos**: uma barra persistente no topo (em LED e WoL) permite escolher um ou vários ESPs **uma única vez**; a seleção é compartilhada entre as telas e salva no navegador
- **Tema**: escuro por padrão, com alternância para claro (preferência salva)
- **Dashboard**: cada card mostra status de conexão e o estado do LED — para efeito ativo, exibe o nome (Respiração/Arco-íris/Transição) com swatch animado
- **LED**: seletor de cor (anel de matiz + quadrado saturação/valor) que aplica ao vivo nos selecionados; favoritos rápidos; **efeitos** com iniciar/parar; **cenas** com preview de cor e aplicação em 1 toque
- **LED (RGBW)**: quando houver ESP SK6812 selecionado, aparece o controle do canal branco (`w`)
- **WoL**: lista de alvos pesquisável; dispara via ESPs selecionados com feedback por dispositivo
- **Dispositivos**: cadastro por MAC do ESP, apelido, `ledCount`, `ledPin` e `ledType` (`ws2812b`/`sk6812`); ESPs descobertos aparecem com botão "Registrar" (fluxo guiado); gerenciamento de alvos WoL na mesma tela

## 🔗 API Endpoints

### Autenticação
- `GET /login`
- `POST /auth`
- `GET /logout`

### Status (SSE)
- `GET /api/status` — stream de eventos Server-Sent Events:
  - `event: status` → `{ "connected": true, "connectedClients": ["7C:87:CE:28:09:68"] }`
  - `event: state` → `{ "espMac": "...", "r": 255, "g": 0, "b": 0, "w": 0 }` (cor ao vivo)
  - `event: effect` → `{ "espMac": "...", "effect": "breathing" }` (ou `"effect": null` quando interrompido)

### Clientes ESP
- `GET /api/clients` — inclui `connected`, `lastLedColor` e `activeEffect` por dispositivo
- `POST /api/clients`
- `GET /api/clients/discovered`

### Alvos WoL
- `GET /api/wol-targets`
- `POST /api/wol-targets`

### Cenas
- `GET /api/scenes`
- `POST /api/scenes`
- `DELETE /api/scenes/{id}`

### Ações
- `POST /wol`
- `POST /led`
- `POST /effect`

### Exemplos de request

**POST /wol**
```json
{
  "espMacs": ["7C:87:CE:28:09:68", "AC:67:B2:3B:D2:68"],
  "targetMac": "AA:BB:CC:DD:EE:FF"
}
```

**POST /led**
```json
{
  "espMacs": ["7C:87:CE:28:09:68"],
  "r": 0,
  "g": 204,
  "b": 0,
  "w": 64
}
```

Observações para `POST /led`:
- `w` é opcional e deve estar entre `0` e `255`
- o servidor só envia `w` para ESPs cadastrados com `ledType: "sk6812"`
- ESPs `ws2812b` recebem apenas `r`, `g` e `b`
- aplicar uma cor sólida interrompe qualquer efeito ativo no(s) dispositivo(s)

**POST /effect**
```json
{
  "espMacs": ["7C:87:CE:28:09:68"],
  "effect": "breathing",
  "r": 255,
  "g": 100,
  "b": 50
}
```
- `effect`: `breathing`, `rainbow`, `fade` ou `none` (interrompe)
- `r`/`g`/`b`: cor base opcional
- o efeito ativo é rastreado pelo servidor e propagado via SSE (`event: effect`)

**POST /api/scenes**
```json
{
  "name": "Aconchego",
  "color": { "r": 255, "g": 120, "b": 40 },
  "espMacs": ["7C:87:CE:28:09:68"]
}
```

**Response de ações (`/wol`, `/led`, `/effect` — resumo por dispositivo)**
```json
{
  "status": "ok",
  "action": "led",
  "okCount": 1,
  "failCount": 0,
  "results": [
    { "espMac": "7C:87:CE:28:09:68", "ok": true, "response": { "status": "ok" } }
  ]
}
```

**Response de `GET /api/clients`**
```json
{
  "clients": [
    {
      "espMac": "7C:87:CE:28:09:68",
      "nickname": "Sala",
      "ledCount": 90,
      "ledPin": 13,
      "ledType": "ws2812b",
      "lastLedColor": { "r": 255, "g": 77, "b": 148 },
      "connected": true,
      "activeEffect": "breathing"
    }
  ]
}
```
- `activeEffect` é `null` quando o LED está em cor sólida ou apagado

## 📁 Estrutura do Projeto

```text
esp32-wol-server/
├── src/
│   ├── server.js                 # HTTP server + roteamento; serve o shell SPA e os assets
│   ├── config.js
│   ├── auth/
│   │   ├── jwt.js
│   │   └── hmac.js
│   ├── routes/
│   │   ├── auth.js
│   │   └── api.js                # endpoints REST/SSE + comandos (wol/led/effect) + cenas
│   ├── websocket/
│   │   └── espTunnel.js
│   ├── data/
│   │   ├── clientsStore.js
│   │   ├── clients.json
│   │   ├── wolTargetsStore.js
│   │   ├── wolTargets.json
│   │   ├── scenesStore.js
│   │   └── scenes.json
│   ├── utils/
│   │   ├── logger.js
│   │   ├── sse.js                # eventos status/state/effect
│   │   └── static.js             # serve /assets/* de src/public
│   ├── views/
│   │   └── index.js              # carrega o shell (public/index.html) e o login
│   └── public/                   # frontend SPA (vanilla JS, ESM, sem build)
│       ├── index.html            # shell do app
│       ├── login.html
│       └── assets/js/
│           ├── main.js           # bootstrap: chrome, SSE, roteador
│           ├── api.js            # wrapper fetch dos endpoints
│           ├── store.js          # estado central + ponte SSE
│           ├── router.js         # roteador por pathname
│           ├── ui.js             # toasts, modais, tema, ícones
│           ├── components/       # deviceSelector, colorControl, sceneCard, resultToast
│           └── views/            # dashboard, led, wol, devices
├── package.json
└── README.md
```

## 🔒 Segurança

- Nunca commite `.env`
- Use `LOGIN_PASS` forte
- Gere `JWT_SECRET` aleatório
- Use o mesmo `HMAC_SECRET` no servidor e no firmware ESP
- Em produção, prefira HTTPS/WSS

## 🐛 Troubleshooting

### ESP aparece como offline
- Verifique se o ESP está conectado via WebSocket na porta `TUNNEL_PORT`
- Confirme que não há firewall bloqueando a porta
- Verifique os logs do servidor - pode estar rejeitando por HMAC inválido
- Teste a conexão WebSocket manualmente com ferramentas como `wscat`

### Timeout no comando para ESP
- `ESP timeout` agora é tratado como falha de comunicação por dispositivo
- a API retorna `ok: false` no item correspondente de `results`
- o servidor continua executando normalmente (sem encerrar o processo)

### ESP não consegue se autenticar
- Confirme que `HMAC_SECRET` é igual no servidor (.env) e no ESP32
- Verifique se o relógio do ESP32 está sincronizado (use NTP)
- Timestamp do ESP não pode ter mais de 5 minutos de diferença
- Verifique logs do servidor: "Invalid HMAC" ou "Invalid timestamp"
- Certifique-se de que o ESP está enviando o JSON de autenticação logo após conectar

### Comando Wake-on-LAN não funciona
- Verifique se o dispositivo alvo suporta Wake-on-LAN
- Confirme que o MAC address está correto: `A8:A1:59:98:61:0E`
- Verifique se o ESP32 e o dispositivo alvo estão na mesma rede local
- Alguns switches/roteadores podem bloquear pacotes WoL

### Erro de autenticação (HTTP)
- Verifique as credenciais de login no arquivo `.env`
- Limpe os cookies do navegador
- Verifique se a `JWT_SECRET` está configurada corretamente

### Porta já em uso
- Altere as portas no arquivo `.env`
- Verifique se não há outro processo usando as portas 9000 ou 9001
- No Windows: `netstat -ano | findstr :9000`
- No Linux/Mac: `lsof -i :9000`

## 📝 Dependências

- `ws`
- `jsonwebtoken`
- `cookie`
- `dotenv`

---

**Desenvolvido com Node.js** 🚀
