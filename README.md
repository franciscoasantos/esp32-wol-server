# ESP32 Wake-on-LAN Server

Um servidor de túnel WebSocket/HTTP que permite comunicação segura com dispositivos ESP (ESP32/ESP8266) através de uma interface web autenticada, com funcionalidade de controle Wake-on-LAN integrada.

## 📋 Descrição

Este sistema funciona como um servidor intermediário (tunnel) que:

- Recebe conexões WebSocket de dispositivos ESP na porta 9001
- Disponibiliza uma interface HTTP na porta 9000 com autenticação JWT
- Permite enviar comandos Wake-on-LAN para dispositivos na rede local através do ESP
- Fornece interface web moderna para controle remoto de dispositivos
- Protege o acesso através de login com usuário e senha

## 🚀 Funcionalidades

- **Autenticação JWT**: Login seguro com tokens que expiram em 2 horas
- **Túnel WebSocket**: Comunicação bidirecional em tempo real com dispositivos ESP
- **Wake-on-LAN**: Interface web para enviar comando WoL via ESP32
- **Interface Web Moderna**: Design responsivo com glassmorphism e feedback visual
- **Proteção de Rotas**: Todas as rotas protegidas por autenticação
- **Cookies HttpOnly**: Armazenamento seguro do token de autenticação
- **Autenticação HMAC**: Proteção contra conexões não autorizadas do ESP

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

3. Configure as variáveis de ambiente:
```bash
cp .env.example .env
```

4. Edite o arquivo `.env` com suas configurações:
```env
# JWT Secret (IMPORTANTE: gere uma chave segura única)
JWT_SECRET=sua_chave_secreta_aqui

# HMAC Secret (deve ser igual ao SECRET no config.h do ESP32)
HMAC_SECRET=sua_chave_hmac_aqui

# Credenciais de login
LOGIN_USER=seu_usuario
LOGIN_PASS=sua_senha_forte

# Portas (padrão: 9001 e 9000)
TUNNEL_PORT=9001
HTTP_PORT=9000
```

## 🔐 Gerando uma JWT Secret Segura

Para gerar uma chave JWT segura, você pode usar:

**Node.js:**
```javascript
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**PowerShell:**
```powershell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

## ▶️ Executando o Servidor

```bash
npm start
# ou
node src/server.js
```

O servidor iniciará em:
- **Túnel WebSocket**: `ws://localhost:9001` (para conexão do ESP)
- **Interface HTTP**: `http://localhost:9000` (para acesso web)

## 🔌 Configurando o Dispositivo ESP

O dispositivo ESP deve:

1. **Conectar-se** ao servidor via WebSocket na porta configurada em `TUNNEL_PORT` (padrão: 9001)
   - URL: `ws://seu-servidor:9001/`

2. **Autenticar-se** imediatamente após conectar enviando um JSON com HMAC:
```json
{
  "token": "esp32-1234567890",
  "hmac": "abc123..."
}
```
   - O token deve estar no formato `esp32-{timestamp}`
   - O HMAC é calculado usando SHA256 sobre o token com a chave `HMAC_SECRET`
   - O servidor valida o HMAC e rejeita conexões inválidas
   - Timestamp deve ter no máximo 5 minutos de diferença

3. **Aguardar comandos Wake-on-LAN** no formato JSON:
```json
{
  "mac": "A8:A1:59:98:61:0E"
}
```

4. **Responder** com confirmação:
```json
{
  "status": "ok",
  "mac": "A8:A1:59:98:61:0E"
}
```

### Exemplo de código ESP32 (C + ESP-IDF):

```c
#include "esp_websocket_client.h"
#include "cJSON.h"
#include "mbedtls/md.h"
#include <time.h>

// Configurar WebSocket client
esp_websocket_client_config_t ws_cfg = {
    .uri = "ws://seu-servidor:9001",
};

esp_websocket_client_handle_t client = esp_websocket_client_init(&ws_cfg);

// Handler de eventos
static void websocket_event_handler(void *handler_args, esp_event_base_t base,
                                    int32_t event_id, void *event_data) {
    esp_websocket_event_data_t *data = (esp_websocket_event_data_t *)event_data;
    
    switch (event_id) {
        case WEBSOCKET_EVENT_CONNECTED:
            // Enviar autenticação HMAC
            char token[64];
            sprintf(token, "esp32-%lld", time(NULL));
            
            char hmac[65];
            make_hmac(token, hmac); // função usando mbedtls_md_hmac
            
            char auth[256];
            sprintf(auth, "{\"token\":\"%s\",\"hmac\":\"%s\"}", token, hmac);
            
            esp_websocket_client_send_text(client, auth, strlen(auth), portMAX_DELAY);
            break;
            
        case WEBSOCKET_EVENT_DATA:
            // Receber comando Wake-on-LAN
            cJSON *json = cJSON_Parse(data->data_ptr);
            const char *mac = cJSON_GetObjectItem(json, "mac")->valuestring;
            
            // Enviar pacote magic packet
            send_wol_packet(mac);
            
            // Responder ao servidor
            char response[128];
            sprintf(response, "{\"status\":\"ok\",\"mac\":\"%s\"}", mac);
            esp_websocket_client_send_text(client, response, strlen(response), portMAX_DELAY);
            
            cJSON_Delete(json);
            break;
    }
}

esp_websocket_register_events(client, WEBSOCKET_EVENT_ANY, websocket_event_handler, NULL);
esp_websocket_client_start(client);
```

## 🌐 Uso

1. **Acesse** `http://localhost:9000` no navegador
2. **Faça login** com as credenciais configuradas no `.env`
3. **Controle Wake-on-LAN**:
   - Clique no botão "🚀 Ligar Dispositivo"
   - O servidor enviará o comando para o ESP32
   - O ESP32 enviará o pacote magic packet para o MAC configurado: `A8:A1:59:98:61:0E`
   - Você verá feedback visual do status da operação
4. Se o ESP estiver offline, receberá a mensagem "ESP offline"

### API Endpoints

#### `POST /wol`
Envia comando Wake-on-LAN via ESP32.

**Request:**
```json
{
  "mac": "A8:A1:59:98:61:0E"
}
```

**Response (sucesso):**
```json
{
  "status": "ok",
  "mac": "A8:A1:59:98:61:0E"
}
```

**Response (erro):**
```json
{
  "error": "ESP offline"
}
```

## 📁 Estrutura do Projeto

```
esp32-wol-server/
├── src/
│   └── server.js      # Servidor principal
├── package.json       # Dependências do projeto
├── .env              # Variáveis de ambiente (não commitar!)
├── .env.example      # Exemplo de configuração
├── .gitignore        # Arquivos ignorados pelo git
└── README.md         # Este arquivo
```

## 🔒 Segurança

- **Nunca commite** o arquivo `.env` no git
- Use senhas fortes para `LOGIN_PASS`
- Gere uma `JWT_SECRET` única e aleatória
- **Configure a mesma `HMAC_SECRET`** no servidor (.env) e no ESP32
- A autenticação HMAC protege contra conexões não autorizadas no túnel WebSocket
- Validação de timestamp previne ataques de replay (janela de 5 minutos)
- Timeout de 10 segundos para autenticação evita conexões pendentes
- Em produção, use HTTPS/WSS para comunicação segura
- Considere implementar rate limiting para prevenir ataques de força bruta

## 📝 Dependências

- **ws**: Servidor e cliente WebSocket
- **jsonwebtoken**: Geração e validação de tokens JWT
- **cookie**: Parsing de cookies HTTP
- **dotenv**: Gerenciamento de variáveis de ambiente

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

## 🤝 Contribuindo

Contribuições são bem-vindas! Sinta-se à vontade para:
- Reportar bugs
- Sugerir novas funcionalidades
- Enviar pull requests

## 📄 Licença

Este projeto é fornecido como está, sem garantias. Use por sua conta e risco.

---

**Desenvolvido com Node.JS** 🚀