# ESP32 Wake-on-LAN Server

Servidor WebSocket/HTTP para controle remoto de múltiplos ESP32 autenticados, com interface web protegida por login, suporte a Wake-on-LAN e controle de fita LED RGB.

## 📋 Descrição

Este sistema funciona como um servidor intermediário (tunnel) que:

- Recebe conexões WebSocket de múltiplos ESP32 na porta 9001
- Identifica cada ESP32 pelo MAC address autenticado
- Disponibiliza interface HTTP na porta 9000 com autenticação JWT
- Permite enviar comandos WoL e LED para um ou vários ESP32 ao mesmo tempo
- Mantém cadastro de clientes ESP32 e cadastro separado de alvos WoL (MAC)

## 🚀 Funcionalidades

- **Autenticação JWT**: Login seguro com token válido por **7 dias**
- **Túnel WebSocket**: Comunicação em tempo real com múltiplos ESP32
- **Autenticação HMAC + MAC**: ESP envia `token`, `hmac` e `mac` no handshake
- **Configuração remota do ESP**: ESP pode solicitar `ledCount` e `ledPin` via `get_config`
- **Wake-on-LAN em lote**: Disparo para um ou vários ESPs selecionados
- **Controle LED RGB**: Aplicação de cor única por fita (R/G/B)
- **Descoberta de ESP não cadastrado**: Lista com MAC + IP na tela de configuração
- **Cadastro dedicado de MAC WoL**: Página separada para gerenciar alvos WoL
- **Logs de debug WS**: mensagens enviadas/recebidas no túnel para diagnóstico

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
  "ledPin": 13
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

### 4) Resposta do ESP

Exemplo esperado:

```json
{
  "status": "ok",
  "action": "led"
}
```

## 🌐 Uso da interface

1. Acesse `http://localhost:9000`
2. Faça login
3. Use as páginas:
   - `/` Wake-on-LAN
   - `/led` Controle LED
   - `/config` Cadastro de ESP32
   - `/wol-targets` Cadastro de MACs WoL

### Comportamento atual das telas

- **WOL e LED**: seleção de dispositivos via modal (um ou vários)
- **WOL**: seleciona alvo WoL a partir de cadastro dedicado (`/wol-targets`)
- **LED**: seletor de cor aplica automaticamente ao clicar/arrastar no picker
- **Configuração ESP**: cadastro por MAC do ESP, apelido, `ledCount` e `ledPin`

## 🔗 API Endpoints

### Autenticação
- `GET /login`
- `POST /auth`
- `GET /logout`

### Status
- `GET /api/status` (SSE)

### Clientes ESP
- `GET /api/clients`
- `POST /api/clients`
- `GET /api/clients/discovered`

### Alvos WoL
- `GET /api/wol-targets`
- `POST /api/wol-targets`

### Ações
- `POST /wol`
- `POST /led`

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
  "b": 0
}
```

**Response de ações (resumo por dispositivo)**
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

## 📁 Estrutura do Projeto

```text
esp32-wol-server/
├── src/
│   ├── server.js
│   ├── config.js
│   ├── auth/
│   │   ├── jwt.js
│   │   └── hmac.js
│   ├── routes/
│   │   ├── auth.js
│   │   └── api.js
│   ├── websocket/
│   │   └── espTunnel.js
│   ├── data/
│   │   ├── clientsStore.js
│   │   ├── clients.json
│   │   ├── wolTargetsStore.js
│   │   └── wolTargets.json
│   ├── utils/
│   │   ├── logger.js
│   │   └── sse.js
│   └── views/
│       ├── login.html
│       ├── control.html
│       ├── led.html
│       ├── config.html
│       ├── wol-targets.html
│       └── index.js
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
