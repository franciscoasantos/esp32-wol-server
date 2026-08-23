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

- **Autenticação JWT**: Login seguro com sessão de **30 dias e renovação deslizante** — enquanto o app for aberto, o login não expira
- **Instalável (PWA)**: manifest + service worker mínimo; dá para instalar na tela inicial do celular (exige HTTPS fora de `localhost`)
- **Túnel WebSocket**: Comunicação em tempo real com múltiplos ESP32
- **Autenticação HMAC + MAC**: ESP envia `token`, `hmac` e `mac` no handshake
- **Configuração remota do ESP**: ESP pode solicitar `ledCount`, `ledPin` e `ledType` via `get_config`
- **Wake-on-LAN em lote**: Disparo para um ou vários ESPs selecionados
- **Controle LED RGB/RGBW**: Aplicação de cor única por fita (R/G/B) e canal branco opcional (`w`) para SK6812
- **Gradientes e segmentos**: a fita deixa de ser uma cor só. Gradiente por até 8 stops (o ESP interpola) e até 8 trechos com cores próprias
- **Transições suaves**: `fadeMs` opcional no comando de cor — o firmware interpola até a cor nova em vez de saltar. Cenas aplicam com 600 ms; o seletor ao vivo omite o campo
- **Correção de gamma (2.2)**: o firmware compensa a resposta logarítmica do olho, então o `breathing` varia de forma perceptualmente linear em vez de parecer um piscar
- **Efeitos no firmware**: `breathing`, `rainbow`, `fade`, `fire`, `comet`, `twinkle`, `wave` e `wipe` — o servidor envia **um único comando** e a animação roda no ESP (sem fluxo contínuo de requisições). O servidor rastreia o efeito ativo por dispositivo
- **Cenas**: um estado por dispositivo — um pode ficar em gradiente e outro em efeito na mesma cena. "Salvar atual" fotografa o que os ESPs estão mostrando; renomear e reordenar inclusos
- **Modo ausente**: acende e apaga em intervalos sorteados dentro de uma janela, com cada fita no seu próprio ritmo
- **Rotinas agendadas**: horário fixo ou nascer/pôr do sol (com deslocamento), disparando cor, gradiente, efeito, despertador ou apagar
- **Despertador nascer-do-sol**: rampa de vermelho profundo até branco quente ao longo de N minutos
- **Ritual de Wake-on-LAN**: manda o pacote mágico e usa a fita como barra de progresso enquanto sonda o alvo — verde quando ele acorda, vermelho no timeout, e a fita volta ao que estava
- **LED como notificação**: `POST /api/notify` pisca uma cor e restaura o estado anterior
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

# Opcional: coordenadas para rotinas de nascer/pôr do sol.
# Sem elas, só gatilhos de horário fixo funcionam (e o log avisa no boot).
LATITUDE=-23.5505
LONGITUDE=-46.6333
```

## ▶️ Executando o Servidor

```bash
npm start
# ou
node src/server.js
```

Auto-teste da sessão (sem framework):

```bash
node src/auth/jwt.test.js
```

Para desenvolvimento com auto-reload (nodemon):

```bash
npm run dev
```

> A última cor de cada ESP é mantida em memória e gravada em `src/data/clients.json` com debounce de 1 s (com flush na saída do processo). Antes o arquivo inteiro era reescrito a cada comando — ~7 vezes por segundo durante um arraste no seletor de cor.

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
  "ledType": "sk6812",
  "lastPattern": { "type": "gradient", "stops": [] }
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
  "b": 55,
  "fadeMs": 600
}
```
- `fadeMs` é opcional (0-60000). Ausente ou `0` aplica na hora

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
- `effect`: um dos nomes da tabela abaixo, ou `none` (para interromper)
- `r`/`g`/`b`: cor base opcional
- `speed` e `intensity`: opcionais, `0-100`. Ausentes, cada efeito usa o próprio padrão
- O servidor envia **apenas um comando**; a animação é gerada no próprio ESP
- Enviar uma cor sólida via `action: "led"` interrompe o efeito ativo

| Efeito | Descrição | Usa a cor base | Intensidade controla |
|---|---|---|---|
| `breathing` | Pulsa o brilho suavemente | sim | profundidade do pulso |
| `rainbow` | Espectro percorrendo a fita | não | — |
| `fade` | Fita inteira trocando de matiz | não | — |
| `fire` | Chama subindo, paleta própria | não | altura da chama |
| `comet` | Cabeça com cauda deslizando | sim | tamanho da cauda |
| `twinkle` | Pontos piscando ao acaso | sim | densidade de estrelas |
| `wave` | Duas senoides somadas | sim | número de cristas |
| `wipe` | Preenche a fita e recomeça | sim | suavidade da borda |

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
   - `/routines` **Rotinas** — agendamento por horário ou posição do sol, e modo ausente
   - `/devices` **Dispositivos** — cadastro de ESP32, descoberta e alvos WoL

> As rotas antigas `/config` e `/wol-targets` continuam funcionando como **aliases** de `/devices` (deep-links preservados).

### Comportamento atual das telas

- **Seletor global de dispositivos**: uma barra persistente no topo (em LED e WoL) permite escolher um ou vários ESPs **uma única vez**; a seleção é compartilhada entre as telas e salva no navegador
- **Tema**: escuro por padrão, com alternância para claro (preferência salva)
- **Dashboard**: cada card mostra status de conexão e o estado do LED — para efeito ativo, exibe o nome (Respiração/Arco-íris/Transição) com swatch animado
- **LED**: seletor de cor (anel de matiz + quadrado saturação/valor) que aplica ao vivo nos selecionados; favoritos rápidos; **efeitos** com iniciar/parar e sliders de velocidade e intensidade (o rótulo da intensidade muda conforme o efeito); **cenas** com preview de cor e aplicação em 1 toque
- **LED (RGBW)**: quando houver ESP SK6812 selecionado, aparece o controle do canal branco (`w`)
- **WoL**: lista de alvos pesquisável; dispara via ESPs selecionados com feedback por dispositivo
- **Dispositivos**: cadastro por MAC do ESP, apelido, `ledCount`, `ledPin` e `ledType` (`ws2812b`/`sk6812`); ESPs descobertos aparecem com botão "Registrar" (fluxo guiado); gerenciamento de alvos WoL na mesma tela

## 🔗 API Endpoints

### Autenticação
- `GET /login`
- `POST /auth`
- `GET /logout`

O cookie `token` é `HttpOnly; Path=/; Max-Age=30d; SameSite=Lax`, e ganha `Secure` automaticamente quando a requisição chega com `X-Forwarded-Proto: https` (proxy reverso). Requisições autenticadas na segunda metade da vida do token recebem um cookie novo — a sessão desliza.

### PWA
- `GET /manifest.json` — público
- `GET /sw.js` — público, servido na raiz para ter escopo `/`

> O service worker **não faz cache** de propósito: sem rede não há ESP32 para controlar. Ele existe só para satisfazer o critério de instalação do navegador. Instalar exige contexto seguro — `localhost` ou HTTPS via proxy reverso.
> Ícone: `src/public/assets/icon.svg`. Para instalar em iPhone, adicione um PNG 180×180 em `assets/apple-touch-icon.png` (iOS ignora ícones SVG do manifest).

### Status (SSE)
- `GET /api/status` — stream de eventos Server-Sent Events:
  - `event: status` → `{ "connected": true, "connectedClients": ["7C:87:CE:28:09:68"] }`
  - `event: state` → `{ "espMac": "...", "r": 255, "g": 0, "b": 0, "w": 0, "pattern": {...} }` (cor ao vivo; `pattern` acompanha para a prévia mostrar gradiente/segmentos)
  - `event: effect` → `{ "espMac": "...", "effect": "breathing" }` (ou `"effect": null` quando interrompido). Emitido só em mudança real — toda cor sólida interrompe efeito, e um arraste no seletor viraria ~7 eventos/s

### Clientes ESP
- `GET /api/clients` — inclui `connected`, `lastLedColor`, `lastPattern` e `activeEffect` por dispositivo
- `POST /api/clients`
- `GET /api/clients/discovered`

### Alvos WoL
- `GET /api/wol-targets`
- `POST /api/wol-targets`

### Rotinas
- `GET /api/schedules` — inclui `todayMinutes` (horário resolvido de hoje) e `ranToday`
- `POST /api/schedules` — cria ou atualiza (mande `id` para atualizar)
- `POST /api/schedules/{id}/run` — dispara na hora, ignorando o gatilho
- `DELETE /api/schedules/{id}`
- `POST /api/notify`

### Cenas
- `GET /api/scenes` — inclui `preview` (cor representativa) por cena
- `POST /api/scenes` — cria ou atualiza (mande `id` para atualizar)
- `POST /api/scenes/capture` — fotografa o estado atual dos dispositivos e salva
- `POST /api/scenes/{id}/apply` — aplica a cena
- `POST /api/scenes/{id}/rename`
- `POST /api/scenes/reorder` — recebe `{ "ids": [...] }`
- `DELETE /api/scenes/{id}`

### Modo ausente
- `GET /api/away` — configuração + estado corrente (`windowActive`, o que está aceso)
- `POST /api/away`

### Ações
- `POST /wol`
- `POST /led`
- `POST /effect`
- `POST /gradient`
- `POST /segments`
- `POST /sunrise`
- `POST /wol/ritual`

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
  "w": 64,
  "fadeMs": 600
}
```

Observações para `POST /led`:
- `fadeMs` é opcional, inteiro entre `0` e `60000`; ausente ou `0` aplica a cor na hora
- a transição roda no firmware, então um único comando basta — o servidor não envia frames
- `w` é opcional e deve estar entre `0` e `255`
- o servidor só envia `w` para ESPs cadastrados com `ledType: "sk6812"`
- ESPs `ws2812b` recebem apenas `r`, `g` e `b`
- aplicar uma cor sólida interrompe qualquer efeito ativo no(s) dispositivo(s)

**POST /effect**
```json
{
  "espMacs": ["7C:87:CE:28:09:68"],
  "effect": "fire",
  "r": 255,
  "g": 100,
  "b": 50,
  "speed": 70,
  "intensity": 80
}
```
- `effect`: qualquer um dos oito efeitos, ou `none` (interrompe)
- `r`/`g`/`b`: cor base opcional
- `speed`/`intensity`: inteiros opcionais entre `0` e `100`
- o efeito ativo é rastreado pelo servidor e propagado via SSE (`event: effect`)

**POST /gradient**
```json
{
  "espMacs": ["AC:67:B2:3B:D2:68"],
  "stops": [
    { "pos": 0,   "r": 255, "g": 80, "b": 0 },
    { "pos": 128, "r": 255, "g": 0,  "b": 128 },
    { "pos": 255, "r": 0,   "g": 40, "b": 255 }
  ],
  "fadeMs": 800
}
```
- `stops`: 2 a 8 itens, `pos` de `0` a `255` em ordem crescente, `w` opcional por stop
- o ESP interpola entre os stops, então o payload não cresce com o tamanho da fita
- interrompe qualquer efeito ativo, como uma cor sólida

**POST /segments**
```json
{
  "espMacs": ["AC:67:B2:3B:D2:68"],
  "segments": [
    { "from": 0,   "to": 199, "r": 255, "g": 0, "b": 0 },
    { "from": 200, "to": 588, "r": 0,   "g": 0, "b": 255 }
  ]
}
```
- `segments`: 1 a 8 trechos, índices inclusivos; `to` precisa caber no `ledCount` do ESP
- pixel fora de todos os trechos fica apagado

**POST /api/schedules**
```json
{
  "name": "Bom dia",
  "espMacs": ["AC:67:B2:3B:D2:68"],
  "trigger": { "type": "time", "at": "06:40", "days": [1, 2, 3, 4, 5] },
  "action": { "type": "sunrise", "durationMin": 20 }
}
```
- `trigger.type`: `time` (com `at` em `HH:MM`), `sunrise` ou `sunset` (com `offsetMin` de -720 a 720)
- `trigger.days`: 0 = domingo. Vazio ou ausente = todos os dias
- `action.type`: `color`, `gradient`, `effect`, `sunrise` (rampa) ou `off`
- o agendador roda no servidor com tick de 30 s e janela de tolerância de 2 min; cada rotina dispara no máximo uma vez por dia

> O dia do último disparo fica **em memória**. Reiniciar o servidor pode redisparar uma rotina cujo horário caiu na janela de tolerância.

**POST /sunrise**
```json
{ "espMacs": ["AC:67:B2:3B:D2:68"], "durationMin": 20 }
```
- `{ "stop": true }` interrompe a rampa em andamento
- o servidor manda um comando a cada 5 s com `fadeMs` cobrindo o intervalo, e o firmware interpola entre eles — 12 comandos por minuto bastam para parecer contínuo
- depende da correção de gamma: numa rampa linear em PWM os primeiros minutos seriam invisíveis

**POST /wol/ritual**
```json
{
  "espMacs": ["AC:67:B2:3B:D2:68"],
  "targetMac": "A8:A1:59:98:61:0E",
  "host": "192.168.1.50",
  "timeoutMs": 90000
}
```
- sem `host` só manda o pacote mágico; com `host`, sonda TCP nas portas 3389/445/22/139 a cada segundo
- responde na hora com o resultado do WoL; a animação e a sondagem seguem em background
- TCP em vez de ICMP porque o Node não abre socket raw sem privilégio, e uma recusa explícita (`ECONNREFUSED`) também prova que a máquina está de pé

**POST /api/notify**
```json
{ "espMacs": ["AC:67:B2:3B:D2:68"], "color": { "r": 0, "g": 255, "b": 0 }, "times": 3 }
```
- `restore: false` deixa a fita apagada em vez de devolver ao estado anterior

**POST /api/scenes**
```json
{
  "name": "Cinema",
  "devices": [
    { "espMac": "AC:67:B2:3B:D2:68", "mode": "gradient",
      "stops": [{ "pos": 0, "r": 255, "g": 80, "b": 0 }, { "pos": 255, "r": 0, "g": 40, "b": 255 }] },
    { "espMac": "7C:87:CE:28:09:68", "mode": "effect", "effect": "fire", "intensity": 70 }
  ]
}
```
- `mode`: `solid`, `gradient`, `segments`, `effect` ou `off`
- aplicar é trabalho do servidor (`/apply`), porque cada dispositivo pode estar num modo diferente
- cenas no formato antigo (`{ color, espMacs }`) são convertidas na leitura; a gravação só acontece quando a cena for editada

**POST /api/scenes/capture**
```json
{ "name": "Cinema", "espMacs": ["AC:67:B2:3B:D2:68", "7C:87:CE:28:09:68"] }
```
- monta os `devices` a partir do que cada ESP está mostrando agora — efeito (com cor base, velocidade e intensidade), gradiente, segmentos ou cor

**POST /api/away**
```json
{
  "enabled": true,
  "espMacs": ["AC:67:B2:3B:D2:68"],
  "startMinutes": 1080,
  "endMinutes": 1410,
  "minOnMin": 12, "maxOnMin": 45,
  "minOffMin": 8, "maxOffMin": 30,
  "color": { "r": 255, "g": 170, "b": 90 }
}
```
- horários em minutos desde a meia-noite; a janela pode cruzar a meia-noite
- cada dispositivo sorteia a própria duração, senão as fitas piscariam em sincronia e denunciariam a automação
- avaliado no mesmo tick de 30 s do agendador; ao sair da janela, apaga uma vez e para

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
│   │   ├── jwt.js                # sessão: token, cookie e renovação deslizante
│   │   ├── jwt.test.js
│   │   └── hmac.js
│   ├── routes/
│   │   ├── auth.js
│   │   └── api.js                # endpoints REST/SSE + comandos + cenas + rotinas
│   ├── services/                 # regras que não dependem de HTTP
│   │   ├── ledService.js         # comandos de LED (usado pelas rotas E pela automação)
│   │   ├── scheduler.js          # tick de 30s das rotinas
│   │   ├── sunrise.js            # rampa do despertador
│   │   ├── notify.js             # pulso + restauração
│   │   ├── sceneService.js       # aplicar e capturar cenas
│   │   ├── awayMode.js           # presença simulada
│   │   └── wakeRitual.js         # WoL + sondagem + barra de progresso
│   ├── websocket/
│   │   └── espTunnel.js
│   ├── data/
│   │   ├── clientsStore.js
│   │   ├── clients.json
│   │   ├── wolTargetsStore.js
│   │   ├── wolTargets.json
│   │   ├── scenesStore.js        # cenas com estado por dispositivo (migra o formato antigo)
│   │   ├── scenes.json
│   │   ├── schedulesStore.js
│   │   ├── schedules.json
│   │   ├── awayStore.js
│   │   └── away.json
│   ├── utils/
│   │   ├── logger.js
│   │   ├── solar.js              # nascer/pôr do sol (NOAA, sem dependência)
│   │   ├── sse.js                # eventos status/state/effect
│   │   └── static.js             # serve /assets/* de src/public
│   ├── views/
│   │   └── index.js              # carrega o shell (public/index.html) e o login
│   └── public/                   # frontend SPA (vanilla JS, ESM, sem build)
│       ├── index.html            # shell do app
│       ├── login.html
│       └── assets/
│           ├── manifest.json     # PWA
│           ├── sw.js             # service worker mínimo (sem cache)
│           ├── icon.svg
│           └── js/
│               ├── main.js       # bootstrap: chrome, SSE, roteador
│               ├── api.js        # wrapper fetch dos endpoints
│               ├── store.js      # estado central + ponte SSE
│               ├── router.js     # roteador por pathname
│               ├── ui.js         # toasts, modais, tema, ícones
│               ├── components/   # deviceSelector, colorControl, gradientEditor, sceneCard, resultToast
│               └── views/        # dashboard, led, wol, routines, devices
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
