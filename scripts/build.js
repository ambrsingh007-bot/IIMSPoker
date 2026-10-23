const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const file of ['index.html', 'app.js', 'styles.css']) {
  fs.copyFileSync(
    path.join(root, file),
    path.join(output, file)
  );
}

fs.cpSync(
  path.join(root, 'public'),
  path.join(output, 'public'),
  { recursive: true }
);

console.log('Built IIMSpoker static site into dist/.');
