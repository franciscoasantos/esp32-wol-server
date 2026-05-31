const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function loadPublic(name) {
  return fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf-8');
}

// SPA shell servido em todas as rotas de página protegidas; o roteador no
// cliente decide qual view renderizar a partir de location.pathname.
const appShell = loadPublic('index.html');
const loginPage = loadPublic('login.html');

module.exports = {
  PUBLIC_DIR,
  appShell,
  loginPage
};
