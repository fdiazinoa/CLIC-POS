import assert from 'node:assert/strict';
import test from 'node:test';
import { ESLint } from 'eslint';

const lint = new ESLint();
for (const extension of ['js', 'mjs', 'cjs', 'ts', 'tsx']) {
  test(`lint analyzes ${extension} and rejects real correctness/syntax defects`, async () => {
    const [invalid] = await lint.lintText('const broken = null ?? 42;\n', { filePath: `tests/canary.${extension}` });
    assert.ok(invalid.messages.some(message => message.ruleId === 'no-constant-binary-expression' && message.severity === 2));
    const [syntax] = await lint.lintText('const = ;', { filePath: `tests/canary.${extension}` });
    assert.ok(syntax.fatalErrorCount > 0);
    const [correct] = await lint.lintText('console.log(42);', { filePath: `tests/canary.${extension}` });
    assert.equal(correct.errorCount, 0);
  });
}

test('lint analyzes real production and native source; only generated/dependency outputs are ignored', async () => {
  for (const source of ['App.tsx', 'utils/printer.ts', 'server/index.ts', 'native-stubs/electron/main.js']) {
    assert.equal(await lint.isPathIgnored(source), false, source);
  }
  for (const output of ['dist/assets/app.js', 'android/app/src/main/assets/public/app.js', 'node_modules/pkg/index.js']) {
    assert.equal(await lint.isPathIgnored(output), true, output);
  }
});
