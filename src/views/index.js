const fs = require('fs');
const path = require('path');

const loginPage = fs.readFileSync(path.join(__dirname, 'login.html'), 'utf-8');
const controlPage = fs.readFileSync(path.join(__dirname, 'control.html'), 'utf-8');
const ledPage = fs.readFileSync(path.join(__dirname, 'led.html'), 'utf-8');
const configPage = fs.readFileSync(path.join(__dirname, 'config.html'), 'utf-8');
const wolTargetsPage = fs.readFileSync(path.join(__dirname, 'wol-targets.html'), 'utf-8');

module.exports = {
  loginPage,
  controlPage,
  ledPage,
  configPage,
  wolTargetsPage
};
