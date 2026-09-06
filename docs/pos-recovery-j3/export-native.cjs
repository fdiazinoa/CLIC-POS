// Read-only source inventory; emits JSON to stdout. No application loading.
const ts=require('typescript');const fs=require('node:fs');const crypto=require('node:crypto');
const source=fs.readFileSync('types.ts','utf8');
const file=ts.createSourceFile('types.ts',source,ts.ScriptTarget.Latest,true);
const defs=new Map(file.statements.filter(s=>ts.isInterfaceDeclaration(s)||ts.isTypeAliasDeclaration(s)||ts.isEnumDeclaration(s)).map(s=>[s.name.text,s]));
const roots=['Transaction','CartItem','PaymentEntry','CashMovement','Collection','CollectionAllocation','WalletTransaction','Wallet','ZReport','CurrencyConfig','PaymentMethodDefinition','TaxDefinition','TerminalConfig','BusinessConfig'];
const seen=new Set();const values=new Map();const external=new Set();
const variables=new Map();for(const s of file.statements)if(ts.isVariableStatement(s))for(const d of s.declarationList.declarations)if(ts.isIdentifier(d.name))variables.set(d.name.text,s);
function visit(name){if(!defs.has(name)){external.add(name);return;}if(seen.has(name))return;seen.add(name);const node=defs.get(name);function walk(n){if(ts.isTypeQueryNode(n)&&ts.isIdentifier(n.exprName)){const v=variables.get(n.exprName.text);if(v)values.set(n.exprName.text,v.getText(file));else external.add('typeof '+n.exprName.text);}if(ts.isTypeReferenceNode(n)&&ts.isIdentifier(n.typeName))visit(n.typeName.text);if(ts.isExpressionWithTypeArguments(n)&&ts.isIdentifier(n.expression))visit(n.expression.text);ts.forEachChild(n,walk);}walk(node);}
roots.forEach(visit);
console.log(JSON.stringify({sourceFile:'types.ts',sourceSha256:crypto.createHash('sha256').update(source).digest('hex'),roots,valueDeclarations:Object.fromEntries(values),externalReferences:[...external].sort(),notice:'Full reachable source declarations, not a runtime JSON validator. any/unknown/index signatures remain unresolved.',declarations:[...seen].sort().map(name=>{const n=defs.get(name);return {name,line:file.getLineAndCharacterOfPosition(n.getStart(file)).line+1,text:n.getText(file),openShape:/\b(any|unknown)\b|\[key:/.test(n.getText(file))};})},null,2));
