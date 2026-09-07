// Reproduce the ERP's versioned pure POS Z oracle; no business effects or credentials.
import { build, version } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const destination=process.argv[2];
if(!destination)throw Error('Usage: node scripts/build-recovery-oracle.mjs <output-directory>');
const directory=resolve(destination);await mkdir(directory,{recursive:true});
const output=join(directory,'pos-native-z.mjs');
const result=await build({entryPoints:['services/recovery/NativeZReport.ts'],outfile:output,bundle:true,platform:'node',format:'esm',target:'node20',metafile:true,legalComments:'none'});
const digest=v=>createHash('sha256').update(v).digest('hex');
const inputs=await Promise.all(Object.keys(result.metafile.inputs).sort().map(async path=>({path,sha256:digest(await readFile(path))})));
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
// A commit label is valid only when every bundled source matches that commit.
execFileSync('git',['diff','--exit-code','HEAD','--',...inputs.map(i=>i.path)],{stdio:'pipe'});
const manifest={version:1,profile:'pos.native-z.oracle.v1',sourceCommit,esbuildVersion:version,entryPoint:'services/recovery/NativeZReport.ts',exportName:'buildNativeZReportContent',bundleSha256:digest(await readFile(output)),inputs};
await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output,bundleSha256:manifest.bundleSha256,sourceCommit,sourceFiles:inputs.length}));
