import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shadersDir = join(__dirname, '..', 'src', 'shaders');

const entries = await readdir(shadersDir, { withFileTypes: true });
const glslFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.glsl')).map((e) => e.name);

if (glslFiles.length === 0) {
  console.log('No GLSL files found in src/shaders');
  process.exit(0);
}

function detectStage(file) {
  return /vs/i.test(file) || /vert/i.test(file) ? 'vert' : 'frag';
}

async function runValidator(file) {
  const stage = detectStage(file);
  return new Promise((resolve, reject) => {
    const proc = spawn('glslangValidator', ['-S', stage, file], { cwd: shadersDir, stdio: 'inherit' });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => (code === 0 ? resolve(null) : reject(new Error(`${file} failed (${code})`))));
  });
}

try {
  for (const file of glslFiles) {
    await runValidator(file);
  }
  console.log('glslangValidator: all shaders OK');
} catch (err) {
  console.error('glslangValidator error:', err instanceof Error ? err.message : err);
  process.exit(1);
}
