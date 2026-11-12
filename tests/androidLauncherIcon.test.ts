import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../android/app/src/main/res/',import.meta.url);
test('Android adaptive launchers use the approved bag vector and navy background',()=>{
 for(const name of ['ic_launcher','ic_launcher_round']){
  const xml=readFileSync(new URL(`mipmap-anydpi-v26/${name}.xml`,root),'utf8');
  assert.ok(xml.includes('@drawable/ic_launcher_foreground'));
  assert.ok(xml.includes('@color/ic_launcher_background'));
 }
 assert.ok(readFileSync(new URL('values/ic_launcher_background.xml',root),'utf8').includes('#050E33'));
 const vector=readFileSync(new URL('drawable-v24/ic_launcher_foreground.xml',root),'utf8');
 assert.ok(vector.includes('#00DBE8'));
 assert.ok(vector.includes('M43,60 L51,68 L66,53'));
});
test('classic, round and foreground icons have correct PNG dimensions at every density',()=>{
 for(const [density,size] of [['mdpi',48],['hdpi',72],['xhdpi',96],['xxhdpi',144],['xxxhdpi',192]] as const){
  for(const name of ['ic_launcher','ic_launcher_round','ic_launcher_foreground']){
   const png=readFileSync(new URL(`mipmap-${density}/${name}.png`,root));
   assert.equal(png.subarray(1,4).toString(),'PNG');
   const expected=name==='ic_launcher_foreground'?size*108/48:size;
   assert.equal(png.readUInt32BE(16),expected);assert.equal(png.readUInt32BE(20),expected);
  }
 }
});
