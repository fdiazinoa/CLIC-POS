// AST instrumentation currently returns map:null. Inspect the printed source before
// translating a bundle source-map position to an original source line.
import fs from 'node:fs';
import path from 'node:path';
import { temporalDiagnosticsPlugin } from '../../diagnostics/viteInstrumentation';
const [file, ...positions] = process.argv.slice(2);
if (!file || !positions.length) throw new Error('Usage: tsx inspect-transformed.ts FILE LINE [LINE...]');
const source = fs.readFileSync(file, 'utf8');
const result = (temporalDiagnosticsPlugin(true).transform as Function)(source, path.resolve(file));
if (!result?.code) throw new Error('File is not instrumented');
const lines = result.code.split('\n');
for (const position of positions) {
  const line = Number(position);
  if (!Number.isInteger(line) || line < 1) throw new Error('Invalid line');
  console.log(lines.slice(Math.max(0, line - 3), line + 3).map((text, i) => `${Math.max(1, line - 2) + i}: ${text}`).join('\n'));
}
