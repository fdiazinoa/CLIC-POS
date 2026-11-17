import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const modal=readFileSync(new URL('../components/PaymentModal.tsx',import.meta.url),'utf8');
const pos=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../components/handheldPayment.css',import.meta.url),'utf8');
const tree=ts.createSourceFile('PaymentModal.tsx',modal,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const classText=(node:ts.JsxElement)=>node.openingElement.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(tree)==='className')?.getText(tree)||'';
const finalizers:ts.JsxElement[]=[];
const visit=(node:ts.Node)=>{
 if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(tree)==='button'&&node.openingElement.attributes.properties.some(a=>ts.isJsxAttribute(a)&&a.name.getText(tree)==='onClick'&&a.initializer?.getText(tree)==='{handleFinalize}'))finalizers.push(node);
 ts.forEachChild(node,visit);
};visit(tree);

test('one finalization control stays outside the scrollable input and numeric keypad',()=>{
 assert.equal(finalizers.length,1);
 const classes:string[]=[];
 for(let parent:ts.Node|undefined=finalizers[0].parent;parent;parent=parent.parent)if(ts.isJsxElement(parent))classes.push(classText(parent));
 assert.ok(classes.some(c=>c.includes('payment-finalization')));
 assert.ok(classes.some(c=>c.includes('payment-dialog')));
 assert.ok(!classes.some(c=>c.includes('payment-input-section')||c.includes('payment-numpad')));
 assert.match(css,/grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
 assert.match(css,/\.payment-finalization\s*\{[^}]*grid-row:\s*3/);
 assert.match(css,/\.payment-finalize-button\s*\{[^}]*min-height:\s*44px/);
});

test('mobile sizing cannot remove incomplete-payment, gateway or card-outcome guards',()=>{
 const disabled=finalizers[0].openingElement.attributes.properties.find(a=>ts.isJsxAttribute(a)&&a.name.getText(tree)==='disabled')?.getText(tree);
 assert.equal(disabled,'disabled={(!canFinalize && !paymentOperationId) || isFinalizing || isProcessingGateway || Boolean(cardOutcome)}');
 assert.match(modal,/onClick=\{\(\) => handleAddPayment\(\)\}/);
 assert.match(modal,/onClick=\{\(\) => handleNumPad\('BACK'\)\}/);
});

test('compact payment is an explicit opt-in from the handheld sales gate; CSS cannot affect other dialogs',()=>{
 assert.match(modal,/compactHandheld = false/);
 assert.match(pos,/<UnifiedPaymentModal compactHandheld=\{isCompactHandheld\}/);
 assert.match(modal,/data-handheld-payment=\{compactHandheld \? 'true' : undefined\}/);
 const rules=css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{[^{}]*\}/g);
 for(const [,selectors] of rules)for(const selector of selectors.split(','))assert.ok(selector.includes("[data-handheld-payment='true']"),selector);
 assert.doesNotMatch(css,/\bdvh\b|:has\(/);
});
