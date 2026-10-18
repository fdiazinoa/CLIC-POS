import QRCode from 'qrcode';
/** Bundled qrcode 1.5.4 (MIT). Encodes the exact verified URL; no network or synthesized fiscal fields. */
export const fiscalQrSvg=(value:string,width=140):Promise<string>=>{
 if(typeof value!=='string'||!value||value.length>4096)throw Error('FISCAL_QR_VALUE_INVALID');
 return QRCode.toString(value,{type:'svg',errorCorrectionLevel:'M',margin:4,width});
};
