import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CheckCircle2,Printer,Mail,Repeat} from 'lucide-react';

const source=readFileSync(new URL('../components/PaymentModal.tsx',import.meta.url),'utf8');
const tree=ts.createSourceFile('PaymentModal.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let expression='';
const visit=(node:ts.Node)=>{
 if(ts.isIfStatement(node)&&node.expression.getText(tree)==='isSuccessScreen'&&ts.isBlock(node.thenStatement)){
  const returned=node.thenStatement.statements.find(ts.isReturnStatement);expression=returned?.expression?.getText(tree)||'';
 }
 ts.forEachChild(node,visit);
};visit(tree);
const js=ts.transpileModule('return '+expression+';',{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function render(compactHandheld:boolean,canStartNewSale:boolean,isInstallmentPayment=false,showEmailInput=false){
 let effects=0;
 const noop=()=>{effects++};
 const scope={React,CheckCircle2,Printer,Mail,Repeat,gatewayProgressOverlay:null,compactHandheld,showEmailInput,emailInput:'',isSendingEmail:false,
  setShowEmailInput:noop,setEmailInput:noop,sendReceiptEmail:noop,isInstallmentPayment,currencySymbol:'RD$',
  completedPaymentSettlement:{totalReceivedBase:1557.6,totalAppliedBase:1557.6,totalChangeBase:0},totalPaid:1557.6,absTotal:1557.6,change:0,
  baseCurrency:{code:'DOP'},successNotice:null,isPrintingTicket:false,handleSendEmail:noop,canStartNewSale,onClose:noop,themeBgClass:'bg-blue-600'};
 const element=new Function(...Object.keys(scope),js)(...Object.values(scope));
 const html=renderToStaticMarkup(element);assert.equal(effects,0,'rendering must not print, email or start another sale');return html;
}

test('success receipt keeps the received/applied amounts and its three actions in handheld mode',()=>{
 assert.ok(expression);
 const html=render(true,true);
 assert.match(html,/data-handheld-payment="true"/);
 for(const label of ['¡Venta Exitosa!','Recibido','Aplicado','RD$1557.60','Ticket','Email','Nueva Venta'])assert.ok(html.includes(label),label);
});

test('compacting success does not bypass new-sale permissions or add receipt actions to installments',()=>{
 for(const compact of [false,true]){
  assert.doesNotMatch(render(compact,false),/Nueva Venta/);
  const installment=render(compact,true,true);
  assert.match(installment,/Cuota registrada/);assert.match(installment,/Continuar con la cuenta/);
  assert.doesNotMatch(installment,/>Ticket<|>Email</);
 }
});

test('other profiles do not opt in and the existing email controls remain available',()=>{
 assert.doesNotMatch(render(false,true),/data-handheld-payment=/);
 const email=render(true,true,false,true);
 for(const label of ['Enviar Ticket por Correo','cliente@ejemplo.com','Cancelar','Enviar'])assert.ok(email.includes(label));
 assert.match(email,/type="email"/);
 assert.match(email,/disabled=""/,'empty email cannot be submitted');
});
