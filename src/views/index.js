const fs = require('fs');
const path = require('path');

const loginPage = fs.readFileSync(path.join(__dirname, 'login.html'), 'utf-8');
const controlPage = fs.readFileSync(path.join(__dirname, 'control.html'), 'utf-8');

module.exports = {
  loginPage,
  controlPage
};
