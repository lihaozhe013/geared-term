const { stageDevelopment } = require('./conpty-assets.cjs');
const { prepareDevelopment } = require('./node-pty-assets.cjs');

stageDevelopment();
const helpers = prepareDevelopment();
if (helpers.length > 0) {
  console.log(`Prepared macOS node-pty spawn-helper permissions for ${helpers.length} binding(s).`);
}
