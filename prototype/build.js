// Bundle the browser-only concept into one HTML file for easy sharing.
const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const outputDir = path.resolve(here, '..', 'outputs');
const read = (name) => fs.readFileSync(path.join(here, name), 'utf8');
let html = read('index.html');

function replaceOnce(target, replacement) {
  if (!html.includes(target) || html.indexOf(target) !== html.lastIndexOf(target)) {
    throw new Error(`Expected one occurrence of ${target}`);
  }
  html = html.replace(target, replacement);
}

replaceOnce('<link rel="stylesheet" href="styles.css">', `<style>\n${read('styles.css')}\n</style>`);
for (const name of ['data.js', 'app.js']) {
  const source = read(name);
  if (/<\/script/i.test(source)) throw new Error(`${name} contains an unsafe script close tag`);
  replaceOnce(`<script src="${name}"></script>`, `<script>\n${source}\n</script>`);
}

fs.mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, 'Saavantus-claims-desk-prototype.html');
fs.writeFileSync(output, html, 'utf8');
console.log(`Built ${output} (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
