export type ScanFeedbackTone = 'added' | 'not-found';
export type SalesScanFeedback = ScanFeedbackTone | 'handled' | 'rejected';

const sampleRate = 8_000;
const tones: Record<ScanFeedbackTone, readonly { hz: number; ms: number }[]> = {
   added: [{ hz: 1_240, ms: 75 }],
   'not-found': [{ hz: 520, ms: 100 }, { hz: 0, ms: 40 }, { hz: 340, ms: 120 }],
};
const sources: Partial<Record<ScanFeedbackTone, string>> = {};

function createWavSource(tone: ScanFeedbackTone): string {
   const segments = tones[tone];
   const samples = segments.reduce((total, segment) => total + segment.ms * sampleRate / 1_000, 0);
   const bytes = new Uint8Array(44 + samples);
   const header = new DataView(bytes.buffer);
   for (const [offset, tag] of [[0, 'RIFF'], [8, 'WAVEfmt '], [36, 'data']] as const) {
      bytes.set(Array.from(tag, character => character.charCodeAt(0)), offset);
   }
   header.setUint32(4, bytes.length - 8, true);
   header.setUint32(16, 16, true);
   header.setUint16(20, 1, true); // PCM
   header.setUint16(22, 1, true); // Mono
   header.setUint32(24, sampleRate, true);
   header.setUint32(28, sampleRate, true);
   header.setUint16(32, 1, true);
   header.setUint16(34, 8, true);
   header.setUint32(40, samples, true);

   let offset = 44;
   for (const segment of segments) {
      const length = segment.ms * sampleRate / 1_000;
      for (let i = 0; i < length; i++) {
         const envelope = Math.min(1, i / 32, (length - 1 - i) / 48);
         bytes[offset++] = Math.round(128 + 75 * envelope * Math.sin(2 * Math.PI * segment.hz * i / sampleRate));
      }
   }
   return `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
}

export function playScanFeedbackSound(tone: ScanFeedbackTone): void {
   if (typeof Audio === 'undefined') return;
   try {
      const audio = new Audio(sources[tone] ??= createWavSource(tone));
      audio.volume = 0.5;
      void audio.play()?.catch(() => { /* Audio availability does not affect the sale. */ });
   } catch {
      // Keep visual feedback when audio is unavailable.
   }
}
