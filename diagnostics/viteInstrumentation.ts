import ts from 'typescript';
import type { Plugin } from 'vite';
// Build-only transformation: functional source stays unchanged. All wrappers preserve return/throw/this.
export function temporalDiagnosticsPlugin(enabled:boolean):Plugin {
  return {name:'pos-temporal-diagnostics',enforce:'pre',transform(code,id){
    if(!enabled || id.includes('node_modules') || id.includes('/diagnostics/') || !/\.[tj]sx?$/.test(id))return;
    const ui=/\/(App|ModernLoginScreen|POSInterface|TableMap)\.tsx$/.test(id);
    const service=/\/(SyncManager|CapacitorSQLiteAdapter)\.ts$/.test(id);
    const targetedFile=/\/(globalBarcodeCapture|useIsMobile|masterIdentity)\.ts$/.test(id);
    const nativeCalls=false;
    if(!ui && !service && !nativeCalls && !targetedFile)return;
    const source=ts.createSourceFile(id,code,ts.ScriptTarget.Latest,true,id.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    const f=ts.factory, setters=new Set<string>();
    function scan(n:ts.Node){if(ts.isVariableDeclaration(n)&&ts.isArrayBindingPattern(n.name)&&n.initializer&&ts.isCallExpression(n.initializer)&&/useState$/.test(n.initializer.expression.getText(source))){const s=n.name.elements[1];if(s&&ts.isBindingElement(s)&&ts.isIdentifier(s.name))setters.add(s.name.text);}ts.forEachChild(n,scan);}scan(source);
    let count=0;
    const transform:ts.TransformerFactory<ts.SourceFile>=context=>root=>{
      const visit:ts.Visitor=node=>{
        const original=node;
        const updated=ts.visitEachChild(node,visit,context);
        if(ts.isCallExpression(original)&&!original.questionDotToken&&!(ts.isIdentifier(original.expression)&&setters.has(original.expression.text))&&!original.expression.getText(source).includes('super')) {
          let owner:ts.Node|undefined=original.parent;
          while(owner&&!ts.isFunctionLike(owner))owner=owner.parent;
          const p=owner?.parent;const label=(owner as any)?.name?.getText(source)||(p&&ts.isVariableDeclaration(p)?p.name.getText(source):(p&&ts.isCallExpression(p)&&ts.isVariableDeclaration(p.parent)?p.parent.name.getText(source):''));
          let nestedAwait=false;const check=(n:ts.Node)=>{if(ts.isAwaitExpression(n)||ts.isYieldExpression(n))nestedAwait=true;ts.forEachChild(n,check);};check(original);
          if(!nestedAwait && /^(readStoredDocuments|getCollection|fromStoredDocuments|handleConfigUpdated|addToCart|initialize)$/.test(label)) {
            count++;return f.createCallExpression(f.createIdentifier('__posDiagSync'),undefined,[f.createStringLiteral(id.split('/').pop()+':'+original.expression.getText(source).slice(0,100)+':'+(source.getLineAndCharacterOfPosition(original.getStart(source)).line+1)),f.createArrowFunction(undefined,undefined,[],undefined,f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),updated as ts.Expression)]);
          }
        }
        if(ts.isCallExpression(original)&&id.endsWith('/globalBarcodeCapture.ts')) {
          let owner:ts.Node|undefined=original.parent;
          while(owner && !(ts.isFunctionDeclaration(owner)&&owner.name?.text==='focusSalesScannerInput'))owner=owner.parent;
          if(owner && /(?:focus|getClientRects|querySelector|querySelectorAll)$/.test(original.expression.getText(source))) {
            count++;return f.createCallExpression(f.createIdentifier('__posDiagTarget'),undefined,[f.createStringLiteral('scanner:'+original.expression.getText(source)),f.createArrowFunction(undefined,undefined,[],undefined,f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),updated as ts.Expression),f.createIdentifier('undefined'),f.createTrue()]);
          }
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
        const target=/^(ProductGridCard|resolveActiveTariffPrice|productTariffPriceById|focusSalesScannerInput|restoreScannerFocus|checkIsMobile|buildWarehouseTokens|warehouseMatchesIdentifier|resolveWarehouseId)$/.test(label);
        if(target){
          count++;const u=updated as any;
          let metadata:ts.Expression=f.createIdentifier('undefined');
          const refs:ts.ObjectLiteralElementLike[]=[];
          let key:ts.Expression=f.createStringLiteral(label);
          if(label==='ProductGridCard' && fn.parameters[0] && ts.isObjectBindingPattern(fn.parameters[0].name)) {
            for(const e of fn.parameters[0].name.elements) if(ts.isIdentifier(e.name))refs.push(f.createShorthandPropertyAssignment(e.name.text));
            key=f.createPropertyAccessChain(f.createIdentifier('product'),f.createToken(ts.SyntaxKind.QuestionDotToken),'id');
          }
          if(label==='productTariffPriceById')for(const n of ['activeTariffTokens','productPriceIndex','products'])refs.push(f.createShorthandPropertyAssignment(n));
          if(refs.length)metadata=f.createArrowFunction(undefined,undefined,[],undefined,f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),f.createParenthesizedExpression(f.createObjectLiteralExpression([f.createPropertyAssignment('key',key),f.createPropertyAssignment('refs',f.createObjectLiteralExpression(refs)),...(label==='productTariffPriceById'?[f.createPropertyAssignment('sizes',f.createObjectLiteralExpression([f.createPropertyAssignment('products',f.createPropertyAccessChain(f.createIdentifier('products'),f.createToken(ts.SyntaxKind.QuestionDotToken),'length'))]))]:[])])));
          const body=f.createBlock([f.createReturnStatement(f.createCallExpression(f.createIdentifier('__posDiagTarget'),undefined,[f.createStringLiteral(id.split('/').pop()+':'+label+':'+(source.getLineAndCharacterOfPosition(original.getStart(source)).line+1)),f.createArrowFunction(undefined,undefined,[],undefined,f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),u.body),metadata, /^(focusSalesScannerInput|restoreScannerFocus)$/.test(label)?f.createTrue():f.createFalse()]))],true);
          if(ts.isArrowFunction(u))return f.updateArrowFunction(u,u.modifiers,u.typeParameters,u.parameters,u.type,u.equalsGreaterThanToken,body);
          if(ts.isFunctionExpression(u))return f.updateFunctionExpression(u,u.modifiers,u.asteriskToken,u.name,u.typeParameters,u.parameters,u.type,body);
          if(ts.isFunctionDeclaration(u))return f.updateFunctionDeclaration(u,u.modifiers,u.asteriskToken,u.name,u.typeParameters,u.parameters,u.type,body);
        }
        const handler=ui && /^(handleKeyPress|handleProductCardClick|handleProductClick|handleNodeSelect|handleTableAction|handleConfigUpdated|addToCart|authorizeSubtotalizedEdit|blockRecoveredUberOrderMutation|ensureSalesWithOpenZPermission|canAddItemToCart|getProductPrice|onUpdateCart|handleUpdateParkedTickets|handleFocusIn)$/.test(label);
        const method=service && /^(initialize|getCollection|readStoredDocuments|fromStoredDocuments)$/.test(label);
        const continuation=ts.isCallExpression(p)&&((ts.isPropertyAccessExpression(p.expression)&&/^(then|catch|finally)$/.test(p.expression.name.text))||p.expression.getText(source)==='queueMicrotask');
        if(!handler&&!method&&!continuation)return updated;
        if(continuation)label=p.expression.getText(source).slice(-80)+':callback';
        label+=':'+ (source.getLineAndCharacterOfPosition(original.getStart(source)).line+1);
        count++;const u=updated as any,async=original.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword);
        const body=f.createBlock([f.createReturnStatement(f.createCallExpression(f.createIdentifier('__posDiagRun'),undefined,[f.createStringLiteral(id.split('/').pop()+':'+label),f.createArrowFunction(async?[f.createModifier(ts.SyntaxKind.AsyncKeyword)]:undefined,undefined,[],undefined,f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),u.body),f.createStringLiteral(label.startsWith('getProductPrice:')?'direct-helper':handler?'action':'background')]))],true);
        if(ts.isArrowFunction(u))return f.updateArrowFunction(u,u.modifiers,u.typeParameters,u.parameters,u.type,u.equalsGreaterThanToken,body);
        if(ts.isFunctionExpression(u))return f.updateFunctionExpression(u,u.modifiers,u.asteriskToken,u.name,u.typeParameters,u.parameters,u.type,body);
        if(ts.isFunctionDeclaration(u))return f.updateFunctionDeclaration(u,u.modifiers,u.asteriskToken,u.name,u.typeParameters,u.parameters,u.type,body);
        return f.updateMethodDeclaration(u,u.modifiers,u.asteriskToken,u.name,u.questionToken,u.typeParameters,u.parameters,u.type,body);
      };
      return ts.visitNode(root,visit) as ts.SourceFile;
    };
    const result=ts.transform(source,[transform]);const output=ts.createPrinter().printFile(result.transformed[0]);result.dispose();
    if(!count)return;
    return {code:`import {diagRun as __posDiagRun,diagSet as __posDiagSet,diagSync as __posDiagSync,diagTarget as __posDiagTarget} from '/diagnostics/runtime';\n`+output,map:null};
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

