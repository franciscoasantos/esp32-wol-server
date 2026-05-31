const fs = require('fs');
const path = require('path');
const { PUBLIC_DIR } = require('../views');

const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');

const CONTENT_TYPES = {
  '.js': 'text/javascript; charset=UTF-8',
  '.mjs': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// Serve arquivos estáticos de src/public/assets sob o prefixo /assets/.
// Protege contra path traversal resolvendo o caminho dentro de ASSETS_DIR.
function handleStatic(req, res) {
  const urlPath = req.url.split('?')[0];
  const relative = decodeURIComponent(urlPath.replace(/^\/assets\//, ''));
  const filePath = path.join(ASSETS_DIR, relative);

  if (!filePath.startsWith(ASSETS_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

module.exports = { handleStatic };
