// Сборка браузерной версии API и копирование sql.js в assets/vendor.
// Нужна только после изменения кода в src/routes или src/database (готовые файлы уже лежат в архиве).
'use strict';
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const sh = (f) => path.join(root, 'src/static', f);

require('esbuild').build({
  entryPoints: [sh('browser-esm.js')],
  bundle: true, format: 'esm', platform: 'browser', minify: true, target: 'es2020',
  outfile: path.join(root, 'assets/js/static-api.js'),
  alias: { express: sh('express-shim.js') },
  plugins: [{
    name: 'shims',
    setup(b) {
      b.onResolve({ filter: /(^|\/)config$/ }, () => ({ path: sh('config-shim.js') }));
      b.onResolve({ filter: /services\/sync$/ }, () => ({ path: sh('sync-shim.js') }));
    },
  }],
  banner: { js: '// Собрано scripts/build-static.js из src/routes/api.js — не редактировать вручную.' },
}).then(() => {
  const dist = path.dirname(require.resolve('sql.js/dist/sql-wasm.js'));
  fs.mkdirSync(path.join(root, 'assets/vendor'), { recursive: true });
  for (const f of ['sql-wasm.js', 'sql-wasm.wasm']) fs.copyFileSync(path.join(dist, f), path.join(root, 'assets/vendor', f));
  console.log('OK: assets/js/static-api.js, assets/vendor/sql-wasm.*');
}).catch((e) => { console.error(e); process.exit(1); });
