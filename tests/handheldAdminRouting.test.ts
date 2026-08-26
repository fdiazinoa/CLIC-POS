import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

test('sincroniza la sesión activa con el guard de navegación de terminales handheld', () => {
  assert.match(
    appSource,
    /useEffect\(\(\) => \{\s*terminalRouter\.setCurrentUser\(currentUser\);\s*\}, \[currentUser\]\);/,
  );
});
