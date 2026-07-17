const assert = require('assert');
const {
  getOrCreatePlayer, recordMatch, leaderboard, eloLeaderboard, playerSummary,
  WIN_ELO, LOSS_ELO, ELO_FLOOR, STARTING_ELO
} = require('./playerStore');

function log(name, fn) {
  try { fn(); console.log('PASS:', name); }
  catch (e) { console.log('FAIL:', name, '-', e.message); process.exitCode = 1; }
}

log('new player starts at 1000 elo, 0 wins/losses', () => {
  const players = {};
  const p = getOrCreatePlayer(players, 'Alice');
  assert.strictEqual(p.elo, STARTING_ELO);
  assert.strictEqual(p.wins, 0);
  assert.strictEqual(p.losses, 0);
});

log('name matching is trimmed and case-insensitive (same identity)', () => {
  const players = {};
  const a = getOrCreatePlayer(players, '  Alice ');
  const b = getOrCreatePlayer(players, 'alice');
  assert.strictEqual(a, b); // same underlying record
});

log('winner gets +7 elo and a win, loser gets -5 elo and a loss', () => {
  const players = {};
  getOrCreatePlayer(players, 'Alice');
  getOrCreatePlayer(players, 'Bob');
  const result = recordMatch(players, { winnerName: 'Alice', loserName: 'Bob', winnerScore: 42, loserScore: 30 });
  assert.strictEqual(result.winnerElo, STARTING_ELO + WIN_ELO);
  assert.strictEqual(result.loserElo, STARTING_ELO - LOSS_ELO);
  assert.strictEqual(players[require('./playerStore').keyOf('Alice')].wins, 1);
  assert.strictEqual(players[require('./playerStore').keyOf('Bob')].losses, 1);
});

log('elo never drops below the floor even after many losses', () => {
  const players = {};
  getOrCreatePlayer(players, 'Winner');
  const loserKey = require('./playerStore').keyOf('Loser');
  getOrCreatePlayer(players, 'Loser');
  // force loser's elo very low, then take one more loss
  players[loserKey].elo = 3;
  recordMatch(players, { winnerName: 'Winner', loserName: 'Loser', winnerScore: 10, loserScore: 5 });
  assert.strictEqual(players[loserKey].elo, ELO_FLOOR); // 3 - 5 would be -2, clamped to 0
});

log('leaderboard(period) only counts scores inside that time window', () => {
  const players = {};
  getOrCreatePlayer(players, 'Alice');
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  players[require('./playerStore').keyOf('Alice')].scores.push(
    { runs: 90, ts: now - 40 * DAY },  // outside week/month, inside year
    { runs: 20, ts: now - 2 * DAY },   // inside week
    { runs: 50, ts: now - 10 * DAY }   // inside month, outside week
  );

  const week = leaderboard(players, 'week', 20, now);
  assert.strictEqual(week[0].score, 20); // only the 2-day-old score counts

  const month = leaderboard(players, 'month', 20, now);
  assert.strictEqual(month[0].score, 50); // best of the two inside 30 days

  const year = leaderboard(players, 'year', 20, now);
  assert.strictEqual(year[0].score, 90); // best of all three inside 365 days

  const alltime = leaderboard(players, 'alltime', 20, now);
  assert.strictEqual(alltime[0].score, 90);
});

log('leaderboard ranks by each player\'s BEST score, not total', () => {
  const players = {};
  getOrCreatePlayer(players, 'Alice');
  getOrCreatePlayer(players, 'Bob');
  const now = Date.now();
  players[require('./playerStore').keyOf('Alice')].scores.push({ runs: 15, ts: now }, { runs: 20, ts: now });
  players[require('./playerStore').keyOf('Bob')].scores.push({ runs: 25, ts: now });
  const board = leaderboard(players, 'alltime', 20, now);
  assert.strictEqual(board[0].name, 'Bob');   // 25 beats Alice's best of 20
  assert.strictEqual(board[0].score, 25);
  assert.strictEqual(board[1].name, 'Alice');
  assert.strictEqual(board[1].score, 20);     // not 35 (sum) — best single innings
});

log('eloLeaderboard sorts descending by elo', () => {
  const players = {};
  getOrCreatePlayer(players, 'Alice').elo = 1050;
  getOrCreatePlayer(players, 'Bob').elo = 1200;
  getOrCreatePlayer(players, 'Carl').elo = 980;
  const board = eloLeaderboard(players);
  assert.deepStrictEqual(board.map(p => p.name), ['Bob', 'Alice', 'Carl']);
});

log('playerSummary reports correct rank among all players', () => {
  const players = {};
  getOrCreatePlayer(players, 'Alice').elo = 1050;
  getOrCreatePlayer(players, 'Bob').elo = 1200;
  getOrCreatePlayer(players, 'Carl').elo = 980;
  const summary = playerSummary(players, 'Alice');
  assert.strictEqual(summary.rank, 2); // Bob(1), Alice(2), Carl(3)
  assert.strictEqual(summary.elo, 1050);
});

log('playerSummary returns null for an unknown player', () => {
  const players = {};
  assert.strictEqual(playerSummary(players, 'Nobody'), null);
});

console.log('\nAll playerStore tests completed.');
