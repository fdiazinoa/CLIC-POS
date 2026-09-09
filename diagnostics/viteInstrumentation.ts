import ts from 'typescript';
import type { Plugin } from 'vite';
// Build-only transformation: functional source stays unchanged. All wrappers preserve return/throw/this.
export function temporalDiagnosticsPlugin(enabled:boolean):Plugin {
  return {name:'pos-temporal-diagnostics',enforce:'pre',transform(code,id){
    if(!enabled || id.includes('node_modules') || id.includes('/diagnostics/') || !/\.[tj]sx?$/.test(id))return;
    const ui=/\/(App\.tsx|components\/.*\.tsx)$/.test(id);
    const service=/\/services\/(sync|db)\//.test(id) || /\/(services|utils)\/.*(heartbeat|lifecycle)/i.test(id);
    const nativeCalls=/\/(utils|services)\//.test(id);
    if(!ui && !service && !nativeCalls)return;
    const source=ts.createSourceFile(id,code,ts.ScriptTarget.Latest,true,id.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    const f=ts.factory, setters=new Set<string>();
    function scan(n:ts.Node){if(ts.isVariableDeclaration(n)&&ts.isArrayBindingPattern(n.name)&&n.initializer&&ts.isCallExpression(n.initializer)&&/useState$/.test(n.initializer.expression.getText(source))){const s=n.name.elements[1];if(s&&ts.isBindingElement(s)&&ts.isIdentifier(s.name))setters.add(s.name.text);}ts.forEachChild(n,scan);}scan(source);
    let count=0;
    const transform:ts.TransformerFactory<ts.SourceFile>=context=>root=>{
      const visit:ts.Visitor=node=>{
        const original=node;
        const updated=ts.visitEachChild(node,visit,context);
        if(ts.isCallExpression(original)&&ts.isPropertyAccessExpression(original.expression)&&/^(printEscPos|printEscpos|printRaw|printHtml|discoverPrinters|verifyFingerprintAsync|launch)$/.test(original.expression.name.text)) {
          count++; return f.createCallExpression(f.createIdentifier('__posDiagRun'),undefined,[f.createStringLiteral('native-interface:'+original.expression.name.text),f.createArrowFunction(undefined,undefined,[],undefined,f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),updated as ts.CallExpression),f.createStringLiteral('native-interface')]);
        }
        if(ts.isCallExpression(original)&&ts.isIdentifier(original.expression)&&setters.has(original.expression.text)){
          count++;const call=updated as ts.CallExpression;
          return f.createCallExpression(f.createIdentifier('__posDiagSet'),undefined,[f.createStringLiteral(id.split('/').pop()+':'+original.expression.text),call.expression,...call.arguments]);
        }
        if(!(ts.isArrowFunction(original)||ts.isFunctionExpression(original)||ts.isFunctionDeclaration(original)||ts.isMethodDeclaration(original)))return updated;
        const fn=original as ts.FunctionLikeDeclaration;if(!fn.body)return updated;
        let label=(original as any).name?.getText(source)||'',p=original.parent;
        if(!label && ts.isVariableDeclaration(p))label=p.name.getText(source);
        if(!label && ts.isCallExpression(p) && ts.isVariableDeclaration(p.parent))label=p.parent.name.getText(source);
        if(ts.isJsxExpression(p)&&ts.isJsxAttribute(p.parent))label=p.parent.name.getText(source);
        const handler=ui && /^(handle|on[A-Z]|addToCart|updateQuantity|changeQuantity|processBarcode|openCheckout|confirmPayment|finalize|releaseActive|saveActive)/.test(label);
        const method=service && ts.isMethodDeclaration(original) && !!original.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword);
        const callback=service&&ts.isArrowFunction(original)&&!!original.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)&&ts.isVariableDeclaration(p);
        const lifecycle=service && /heartbeat|outbox|inbox|runErp|bootstrap/i.test(label);
        if(!handler&&!method&&!callback&&!lifecycle)return updated;
        count++;const u=updated as any,async=original.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword);
        const body=f.createBlock([f.createReturnStatement(f.createCallExpression(f.createIdentifier('__posDiagRun'),undefined,[f.createStringLiteral(id.split('/').pop()+':'+label),f.createArrowFunction(async?[f.createModifier(ts.SyntaxKind.AsyncKeyword)]:undefined,undefined,[],undefined,f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),u.body),f.createStringLiteral(handler?'action':'background')]))],true);
        if(ts.isArrowFunction(u))return f.updateArrowFunction(u,u.modifiers,u.typeParameters,u.parameters,u.type,u.equalsGreaterThanToken,body);
        if(ts.isFunctionExpression(u))return f.updateFunctionExpression(u,u.modifiers,u.asteriskToken,u.name,u.typeParameters,u.parameters,u.type,body);
        if(ts.isFunctionDeclaration(u))return f.updateFunctionDeclaration(u,u.modifiers,u.asteriskToken,u.name,u.typeParameters,u.parameters,u.type,body);
        return f.updateMethodDeclaration(u,u.modifiers,u.asteriskToken,u.name,u.questionToken,u.typeParameters,u.parameters,u.type,body);
      };
      return ts.visitNode(root,visit) as ts.SourceFile;
    };
    const result=ts.transform(source,[transform]);const output=ts.createPrinter().printFile(result.transformed[0]);result.dispose();
    if(!count)return;
    return {code:`import {diagRun as __posDiagRun,diagSet as __posDiagSet} from '/diagnostics/runtime';\n`+output,map:null};
  }, generateBundle(_options,bundle){
    if(!enabled)return;
    const runtime=Object.values(bundle).find((c:any)=>c.type==='chunk'&&Object.keys(c.modules).some(k=>k.endsWith('/diagnostics/runtime.ts'))) as any;
    if(!runtime)this.error('Diagnostic runtime chunk missing');
    const seen=new Set<string>();
    const inspect=(c:any)=>{if(!c||c.type!=='chunk'||seen.has(c.fileName))return;seen.add(c.fileName);
      if(Object.keys(c.modules).some(k=>k.includes('/react-dom/')))this.error('React renderer loads before diagnostic hook');
      for(const name of c.imports)inspect(bundle[name]);
    };inspect(runtime);
  }};
}

