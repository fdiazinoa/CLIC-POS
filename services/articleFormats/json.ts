/** Contract data is JSON. This clone works on the supported Android WebView (Chrome 83).
 * ISO timestamps are strings; undefined object properties retain JSON wire semantics. */
export function cloneFormatJSON<T>(value:T):T {
 const text=JSON.stringify(value);
 if(text===undefined)throw Error('POS_FORMAT_NON_JSON_PAYLOAD');
 return JSON.parse(text) as T;
}
