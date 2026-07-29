import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTeamHubTabs } from '../utils/teamHubAccess';

test('fichaje is available without administrative permissions', () => {
  assert.deepEqual(resolveTeamHubTabs('ATTENDANCE', false), ['CLOCK']);
});

test('attendance managers can access schedules and hour reports', () => {
  assert.deepEqual(
    resolveTeamHubTabs('ATTENDANCE', true),
    ['CLOCK', 'SCHEDULE', 'REPORTS'],
  );
});

test('settings keeps only team and permission administration', () => {
  assert.deepEqual(resolveTeamHubTabs('ADMIN', true), ['USERS', 'ROLES']);
});
