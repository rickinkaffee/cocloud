const fs = require('node:fs');
const sea = require('node:sea');
fs.writeFileSync(process.env.WORKBENCH_EXTRACT_TO, new Uint8Array(sea.getRawAsset('binMain.mjs')), { flag: 'wx', mode: 0o600 });
process.exit(0);
