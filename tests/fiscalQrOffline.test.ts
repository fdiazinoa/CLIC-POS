import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {fiscalQrSvg} from '../services/fiscal/FiscalQrSvg';
const require=createRequire(import.meta.url),ZXing=require('../node_modules/html5-qrcode/third_party/zxing-js.umd.js');
test('bundled SVG QR decodes byte-for-byte offline using independent ZXing reader',async()=>{
 const literal='https://ecf.dgii.gov.do/testecf/ConsultaTimbre?RncEmisor=130090752&RncComprador=101010101&ENCF=E310000001021&FechaEmision=15-10-2026&MontoTotal=352.00&FechaFirma=15-10-2026%2023%3A30%3A53&CodigoSeguridad=NVrTbH';
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('NETWORK_FORBIDDEN');};
 try{const svg=await fiscalQrSvg(literal),size=Number(svg.match(/viewBox="0 0 (\d+) \d+"/)![1]),scale=4,width=size*scale,pixels=new Uint8ClampedArray(width*width).fill(255);assert.doesNotMatch(svg,/<script|<image|href=/);const path=svg.match(/stroke="#000000" d="([^"]+)"/)![1];
 let x=0,y=0;for(const match of path.matchAll(/([Mmh])([0-9.]+)(?: ([0-9.]+))?/g)){const [_,cmd,a,b]=match;if(cmd==='M'){x=Number(a);y=Number(b);}else if(cmd==='m'){x+=Number(a);y+=Number(b);}else{const end=x+Number(a);for(let xx=x*scale;xx<end*scale;xx++)for(let yy=Math.floor(y)*scale;yy<(Math.floor(y)+1)*scale;yy++)pixels[yy*width+xx]=0;x=end;}}
 const decoded=new ZXing.QRCodeReader().decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.RGBLuminanceSource(pixels,width,width))));assert.equal(decoded.getText(),literal);
 }finally{globalThis.fetch=old;}
});
