export type TeamHubMode = 'ADMIN' | 'ATTENDANCE';

export type TeamHubTab = 'CLOCK' | 'USERS' | 'SCHEDULE' | 'ROLES' | 'REPORTS';

export const resolveTeamHubTabs = (
  mode: TeamHubMode,
  canManageAttendance: boolean,
): TeamHubTab[] => {
  if (mode === 'ADMIN') {
    return ['USERS', 'ROLES'];
  }

  return canManageAttendance
    ? ['CLOCK', 'SCHEDULE', 'REPORTS']
    : ['CLOCK'];
};
