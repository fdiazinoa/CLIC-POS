import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { TestContext } from 'node:test';

/** Execute the installed Android plugin's actual Java parser, not a JS imitation. */
export function androidSQLiteStatements(sql: string, t: TestContext): string[] {
  const upstream = readFileSync(join(process.cwd(),'node_modules/@capacitor-community/sqlite/android/src/main/java/com/getcapacitor/community/database/sqlite/SQLite/UtilsSQLite.java'),'utf8');
  const methods = ['public String[] getStatementsArray(', 'private String[] dealWithTriggers(', 'private List<String> concatRemoveEnd(', 'private List<String> trimArray('].map(signature => {
    const start = upstream.indexOf(signature);
    assert.ok(start >= 0,`Android parser method missing: ${signature}`);
    let end = upstream.indexOf('{',start), depth = 1;
    while (depth > 0 && ++end < upstream.length) { if (upstream[end] === '{') depth++; else if (upstream[end] === '}') depth--; }
    assert.equal(depth,0,'Android parser extraction must include the complete method');
    return upstream.slice(start,end + 1);
  }).join('\n');
  const folder = mkdtempSync(join(tmpdir(),'clic-android-sql-parser-'));
  t.after(() => rmSync(folder,{recursive:true,force:true}));
  writeFileSync(join(folder,'AndroidSQLiteParser.java'),`import java.util.*; import java.nio.file.*; import java.nio.charset.StandardCharsets;
    public class AndroidSQLiteParser { ${methods}
      public static void main(String[] args) throws Exception {
        String[] statements = new AndroidSQLiteParser().getStatementsArray(Files.readString(Path.of(args[0])));
        for (String statement: statements) System.out.println(Base64.getEncoder().encodeToString(statement.getBytes(StandardCharsets.UTF_8)));
      }
    }`);
  writeFileSync(join(folder,'schema.sql'),sql);
  const compiled = spawnSync('javac',[join(folder,'AndroidSQLiteParser.java')],{encoding:'utf8'});
  assert.equal(compiled.status,0,`JDK is required for the native parser regression: ${compiled.error || compiled.stderr}`);
  const result = spawnSync('java',['-cp',folder,'AndroidSQLiteParser',join(folder,'schema.sql')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  return result.stdout.trim().split('\n').map(line => Buffer.from(line,'base64').toString('utf8'));
}
