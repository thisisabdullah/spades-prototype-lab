// Inlines the shared engine, table UI and each game's code into one
// self-contained HTML file per prototype. No bundler needed.
//
//   dist/spades-<game>.html   page body only (published as claude.ai artifacts)
//   docs/<game>/index.html    full documents for GitHub Pages
//   docs/index.html           the lab write-up, with links pointed at docs/
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, s) => {
  fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
  fs.writeFileSync(path.join(root, p), s);
};
const wrap = body => '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head>\n<body>\n' +
  body + '\n</body>\n</html>\n';

const shared = {
  SHARED_CSS: read('shared/table.css'),
  ENGINE: read('engine/spades-engine.js'),
  TABLE: read('shared/table.js')
};

for (const game of ['blitz', 'run']) {
  let html = read(`${game}/template.html`);
  const parts = Object.assign({}, shared, { GAME: read(`${game}/game.js`) });
  for (const [k, v] of Object.entries(parts)) {
    const marker = `/*{{${k}}}*/`;
    if (!html.includes(marker)) throw new Error(`${game}: missing ${marker}`);
    html = html.split(marker).join(v);
  }
  write(`dist/spades-${game}.html`, html);
  write(`docs/${game}/index.html`, wrap(html));
  console.log(`built ${game}: ${(html.length / 1024).toFixed(1)} KB`);
}

// The lab page links to the hosted artifacts; on GitHub Pages it links to
// the copies sitting next to it instead.
const labPath = path.join(root, 'dist', 'prototype-lab.html');
if (fs.existsSync(labPath)) {
  let lab = fs.readFileSync(labPath, 'utf8');
  lab = lab.split('https://claude.ai/artifact/RdycN6cV65FYwQ41i1EwPP').join('./blitz/')
           .split('https://claude.ai/artifact/KErX5A4e7ebnLZBVdyvPq4').join('./run/');
  write('docs/index.html', wrap(lab));
  console.log('built docs/index.html (lab page)');
}
