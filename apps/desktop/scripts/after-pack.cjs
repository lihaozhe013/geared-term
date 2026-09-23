const { Arch } = require('electron-builder');
const { stagePackaged } = require('./conpty-assets.cjs');

module.exports = async (context) => {
  if (context.electronPlatformName !== 'win32' || context.arch !== Arch.x64) return;
  stagePackaged(context.appOutDir);
};
