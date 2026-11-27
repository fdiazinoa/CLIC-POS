import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { playScanFeedbackSound } from '../utils/scanFeedbackSound';

test('the success bip and warning have valid, distinct PCM waveforms', async () => {
   const sources: string[] = [];
   const originalAudio = globalThis.Audio;
   try {
      globalThis.Audio = class {
         constructor(source: string) { sources.push(source); }
         play() { return Promise.reject(new Error('Autoplay blocked')); }
      } as unknown as typeof Audio;

      playScanFeedbackSound('added');
      playScanFeedbackSound('not-found');
      assert.equal(sources.length, 2);

      const [success, warning] = sources.map(source => {
         assert.match(source, /^data:audio\/wav;base64,/);
         const wav = Buffer.from(source.split(',')[1], 'base64');
         assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
         assert.equal(wav.readUInt32LE(4), wav.length - 8);
         assert.equal(wav.toString('ascii', 8, 16), 'WAVEfmt ');
         assert.equal(wav.readUInt16LE(20), 1);
         assert.equal(wav.readUInt16LE(22), 1);
         assert.equal(wav.readUInt32LE(24), 8000);
         assert.equal(wav.readUInt16LE(34), 8);
         assert.equal(wav.toString('ascii', 36, 40), 'data');
         assert.equal(wav.readUInt32LE(40), wav.length - 44);
         return wav.subarray(44);
      });

      assert.ok(success.some(sample => sample !== 128));
      assert.ok(warning.subarray(0, 800).some(sample => sample !== 128));
      assert.ok(warning.subarray(800, 1120).every(sample => sample === 128));
      assert.ok(warning.subarray(1120).some(sample => sample !== 128));
      assert.ok(warning.length > success.length);
      await Promise.resolve();
   } finally {
      globalThis.Audio = originalAudio;
   }
});

test('sales scan routes only successful additions to green and gives missing codes a warning', () => {
   const pos = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
   const modal = readFileSync(new URL('../components/BarcodeScannerModal.tsx', import.meta.url), 'utf8');
   const scan = pos.slice(pos.indexOf('const performBarcode ='), pos.indexOf('const processBarcode ='));
   const enter = pos.slice(pos.indexOf('const submitProductTextSearch ='), pos.indexOf('const categoryOptions =', pos.indexOf('const submitProductTextSearch =')));

   assert.match(scan, /added === 'pending'\) return finish\('handled'/);
   assert.match(scan, /added === true\s+\? finish\('added'/);
   assert.match(scan, /const added = await addToCart\([\s\S]+?return finishProduct\(added, match.product\)/);
   assert.match(scan, /return finish\('not-found', 'Código no encontrado'\)/);
   assert.match(enter, /return false;[\s\S]+?announceSaleScan\('not-found'/);
   assert.match(pos, /if \(!inCamera && feedback === 'added'\) \{\s*setErrorToast\(null\);\s*setSuccessToast\(message\);\s*playScanFeedbackSound\('added'\)/);
   assert.match(modal, /result\.feedback === 'added'\) playScanFeedbackSound\('added'\)/);
   assert.match(modal, /result\.feedback === 'not-found'\) playScanFeedbackSound\('not-found'\)/);
});
