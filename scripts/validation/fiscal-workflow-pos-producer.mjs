// Called only by isolated ERP PostgreSQL integration runner; never accesses ADB or operational storage.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
if(!process.env.CLIC_FISCAL_PRODUCER_TSX){
 const result=spawnSync(process.execPath,['--import',resolve(root,'node_modules/tsx/dist/loader.mjs'),fileURLToPath(import.meta.url),...process.argv.slice(2)],{cwd:root,env:{...process.env,CLIC_FISCAL_PRODUCER_TSX:'1',CLIC_FISCAL_PRODUCER_EXPORT:'1'},encoding:'utf8'});
 if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);process.exit(result.status??1);
}
const arg=name=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error(`Missing ${name}`);return resolve(process.argv[i+1]);};
const optional=name=>process.argv.includes(name)?arg(name):undefined;
const output=arg('--output'),statePath=optional('--state'),statusPath=optional('--status');
const {produceFiscalWorkflowSale,consumeFiscalWorkflowStatus}=await import('../../tests/fiscalWorkflowProducerFixture.ts');
let result;
if(statusPath){if(!statePath)throw Error('--status requires the original --state fixture');result=await consumeFiscalWorkflowStatus(statePath,JSON.parse(readFileSync(statusPath,'utf8')),output+'.print');}
else {const seed=JSON.parse(readFileSync(arg('--input'),'utf8'));if(seed.schemaVersion!==1||seed.source!=='ERP_PG_WORKFLOW_PERMIT_SEED_V1')throw Error('Isolated producer seed required');result=await produceFiscalWorkflowSale({...seed,statePath});}
writeFileSync(output,JSON.stringify(result,null,2)+'\n',{mode:0o600});
