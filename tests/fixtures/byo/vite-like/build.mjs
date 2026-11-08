// A stand-in for a bundler (a test fixture): writes dist/ as Vite does, with relative paths, and copies public/ as it is.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/assets', { recursive: true });
writeFileSync('dist/assets/index-a1b2c3.js', readFileSync('src/main.js'));
writeFileSync('dist/index.html', readFileSync('index.html', 'utf8').replace('./src/main.js', './assets/index-a1b2c3.js'));
cpSync('public', 'dist', { recursive: true });
console.log('built dist/');
