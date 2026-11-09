import fs from 'node:fs';

const filePath = 'dist/index.d.ts';
if (fs.existsSync(filePath)) {
  let content = fs.readFileSync(filePath, 'utf8');
  content = content
    .replace(/from '\.\/adapters\.ts'/g, "from './adapters.js'")
    .replace(/from '\.\/core\.ts'/g, "from './core.js'");
  fs.writeFileSync(filePath, content);
}
