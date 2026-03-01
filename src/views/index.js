const fs = require('fs');
const path = require('path');
const {
  renderHeader,
  renderDeviceSelector,
  renderDeviceSelectorHelpers,
  renderStatusHelpers
} = require('./partials');

function loadView(name) {
  return fs.readFileSync(path.join(__dirname, name), 'utf-8');
}

function injectCommonBlocks(template, blocks) {
  return Object.entries(blocks).reduce((html, [placeholder, content]) => {
    return html.replaceAll(placeholder, content);
  }, template);
}

const loginPage = loadView('login.html');

const controlPage = injectCommonBlocks(loadView('control.html'), {
  '<!--APP_HEADER-->': renderHeader('wol'),
  '<!--DEVICE_SELECTOR-->': renderDeviceSelector('mb-3.5'),
  '/* DEVICE_SELECTOR_HELPERS */': renderDeviceSelectorHelpers(),
  '/* STATUS_HELPERS */': renderStatusHelpers()
});

const ledPage = injectCommonBlocks(loadView('led.html'), {
  '<!--APP_HEADER-->': renderHeader('led'),
  '<!--DEVICE_SELECTOR-->': renderDeviceSelector('mb-4'),
  '/* DEVICE_SELECTOR_HELPERS */': renderDeviceSelectorHelpers(),
  '/* STATUS_HELPERS */': renderStatusHelpers()
});

const configPage = injectCommonBlocks(loadView('config.html'), {
  '<!--APP_HEADER-->': renderHeader('config'),
  '/* STATUS_HELPERS */': renderStatusHelpers()
});

const wolTargetsPage = injectCommonBlocks(loadView('wol-targets.html'), {
  '<!--APP_HEADER-->': renderHeader('wol-targets'),
  '/* STATUS_HELPERS */': renderStatusHelpers()
});

module.exports = {
  loginPage,
  controlPage,
  ledPage,
  configPage,
  wolTargetsPage
};
