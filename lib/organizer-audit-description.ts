const stateActions: Record<string, string> = {
  dispatchGame: 'Assign a game to a court',
  releaseGameCourt: 'Release a court',
  holdGame: 'Put a game on hold',
  resumeGame: 'Return a held game to the queue',
  forfeitGame: 'Record a forfeiture',
  clearForfeit: 'Clear a forfeiture',
  updateProjectorSettings: 'Update the projector slideshow',
  regenerateBrackets: 'Regenerate brackets and matchups',
  resetGames: 'Reset all games and release their courts',
  registerPlayer: 'Add a registration',
  updateRegistration: 'Edit a registration',
  resetRegistrations: 'Reset registrations',
  replaceRegistrationPin: 'Replace a registration PIN',
  viewRegistrationPin: 'View a registration PIN',
  courtHelp: 'Update a court help request',
  changeUmpirePin: 'Change the umpire access PIN',
  changeOrganizerPin: 'Change the organizer access PIN',
  verifyOrganizer: 'Verify organizer access',
  verifyAccess: 'Verify umpire access',
  verifyMatch: 'Verify a game PIN',
  lookupRegistration: 'Look up a registration',
};

const settings: Record<string, string> = {
  tournamentName: 'tournament name', venue: 'venue', status: 'tournament phase', theme: 'color mode',
  divisions: 'divisions or draw settings', registrations: 'registration records', matches: 'matchups, schedules or game results',
  gameDay: 'game day settings', projector: 'projector settings', startDate: 'start date', endDate: 'end date',
  dayStart: 'daily start time', dayEnd: 'daily end time', courts: 'court count', gameDuration: 'planned game length',
  'registration deadline': 'registration deadline',
};

function describeRoute(method: string, path: string, action = '', image = false, exportLinks = false) {
  switch (path) {
    case '/api/umpires': {
      const descriptions: Record<string, string> = { enable: 'Enable personal umpire access', newTournament: 'Renew tournament umpire credentials', add: 'Add an umpire', rename: 'Rename an umpire', issuePin: 'Issue an umpire PIN', revokePin: 'Revoke an umpire PIN', deactivate: 'Change umpire roster status', assignCourt: 'Assign or hand off an umpire court', resolvePlayers: 'Resolve an incorrect player report', returnDispute: 'Return a dispute to the umpire', releaseDispute: 'Release a disputed game’s court', rule: 'Record an official ruling' };
      return Object.hasOwn(descriptions, action) ? descriptions[action] : 'Manage umpires';
    }
    case '/api/state':
      if (method === 'PATCH') return action === 'completeGame' ? 'Complete a game and release its court' : 'Save a game score';
      if (method === 'PUT') {
        const sections = action.split(', ').flatMap(key => Object.hasOwn(settings, key) ? [settings[key]] : []);
        return sections.length ? `Update ${sections.join(', ')}` : 'Save tournament changes';
      }
      return Object.hasOwn(stateActions, action) ? stateActions[action] : 'Use a tournament control';
    case '/api/payment-proof':
      if (exportLinks) return 'Create private links for a payment proof export';
      return method === 'DELETE' ? 'Remove payment proof photos' : 'Upload a payment proof photo';
    case '/api/payment-details': return 'Save reviewed payment details';
    case '/api/payment-settings':
      if (method === 'DELETE') return 'Remove the payment QR image';
      return image ? 'Upload the payment QR image' : 'Update payment instructions or account details';
    case '/api/sponsors': return method === 'DELETE' ? 'Remove a sponsor image from the slideshow' : 'Upload a sponsor image';
    case '/api/demo': return 'Start an organizer practice session';
    case '/api/organizers':
      if (action === 'login') return 'Sign in to organizer access';
      if (action === 'logout') return 'Sign out of organizer access';
      if (action === 'reset') return 'Reset an organizer password';
      if (action === 'createAdmin') return 'Add an organizer admin';
      if (action === 'activate') return 'Set up named organizer accounts';
      return 'Update organizer account details';
    default: return 'Use an organizer control';
  }
}

type AuditState = Record<string, unknown>;
type AuditRecord = Record<string, unknown> & { id: string };
const records = (value: unknown): AuditRecord[] => Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string') : [];
const changed = (before: unknown, after: unknown) => JSON.stringify(before) !== JSON.stringify(after);
const countLabel = (count: number) => `${count} player ${count === 1 ? 'entry' : 'entries'}`;

function registrationChanges(before: unknown, after: unknown) {
  const previous = records(before), next = records(after);
  const byId = new Map(previous.map(player => [player.id, player]));
  const nextIds = new Set(next.map(player => player.id));
  let added = 0, confirmed = 0, unconfirmed = 0, received = 0, returned = 0;
  let edited = false, paired = false;
  for (const player of next) {
    const old = byId.get(player.id);
    if (!old) { added++; continue; }
    if (old.paid !== true && player.paid === true) confirmed++;
    if (old.paid === true && player.paid !== true) unconfirmed++;
    if (old.shirtReceived !== true && player.shirtReceived === true) received++;
    if (old.shirtReceived === true && player.shirtReceived !== true) returned++;
    paired ||= ['partnerId', 'divisionId', 'poolOverride', 'teamName'].some(key => changed(old[key], player[key]));
    edited ||= ['name', 'club', 'phone', 'facebookProfile', 'playerLevel', 'shirtSize', 'secondShirt'].some(key => changed(old[key], player[key]));
  }
  const removed = previous.filter(player => !nextIds.has(player.id)).length;
  return [added && `Add ${countLabel(added)}`, removed && `Remove ${countLabel(removed)}`,
    confirmed && `Confirm payment for ${countLabel(confirmed)}`, unconfirmed && `Undo payment confirmation for ${countLabel(unconfirmed)}`,
    received && `Mark ${received === 1 ? 'shirt' : 'shirts'} as received for ${countLabel(received)}`, returned && `Undo shirt receipt for ${countLabel(returned)}`,
    paired && 'Update pairing, division or pool assignments', edited && 'Edit player details'].filter(text => typeof text === 'string');
}

function matchChanges(before: unknown, after: unknown) {
  const previous = new Map(records(before).map(match => [match.id, match]));
  const deltas = records(after).flatMap(match => {
    const old = previous.get(match.id);
    return old ? [{ old, match }] : [];
  });
  return [
    deltas.some(({ old, match }) => changed(old.sets, match.sets)) && 'Update game scores',
    deltas.some(({ old, match }) => old.validated !== true && match.validated === true) && 'Validate game results',
    deltas.some(({ old, match }) => old.validated === true && match.validated !== true) && 'Reopen validated results',
    deltas.some(({ old, match }) => old.entryAId !== match.entryAId || old.entryBId !== match.entryBId) && 'Update matchups',
    deltas.some(({ old, match }) => old.scheduledAt !== match.scheduledAt || old.court !== match.court) && 'Update the game schedule',
  ].filter(text => typeof text === 'string');
}

export function describeOrganizerRequest(method: string, url: URL, body: { action?: unknown; state?: unknown }, previous: AuditState) {
  const action = typeof body.action === 'string' ? body.action : '';
  if (method !== 'PUT' || url.pathname !== '/api/state' || !body.state || typeof body.state !== 'object') {
    return describeRoute(method, url.pathname, action, url.searchParams.has('image'), url.searchParams.has('export-links'));
  }
  const next = body.state as AuditState;
  const changes = Array.isArray(next.registrations) ? registrationChanges(previous.registrations, next.registrations) : [];
  const sections = Object.keys(settings).filter(key => key !== 'registrations' && key !== 'registration deadline' &&
    Object.hasOwn(next, key) && changed(previous[key], next[key]));
  if (sections.includes('matches')) {
    const descriptions = matchChanges(previous.matches, next.matches);
    if (descriptions.length) {
      changes.push(...descriptions);
      sections.splice(sections.indexOf('matches'), 1);
    }
  }
  if (next.registrationClosesAt !== undefined && next.registrationClosesAt !== (previous.registrationClosesAt ?? '')) sections.push('registration deadline');
  if (sections.length) changes.push(describeRoute(method, url.pathname, sections.join(', ')));
  return changes.join('. ') || 'Save tournament changes';
}

export function readableAuditDescription(description: string) {
  const legacy = /^(PUT|POST|PATCH|DELETE) (\/api\/[\w/-]+)(?:: (.*))?$/.exec(description);
  if (!legacy) return description;
  const [, method, path, action] = legacy;
  if (method === 'POST' && path === '/api/payment-proof') return 'Use payment proof tools';
  if (method === 'POST' && path === '/api/payment-settings') return 'Update payment instructions or the QR image';
  return describeRoute(method, path, action);
}
