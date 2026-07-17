const assert = require('assert');
const { makeRoom, addPlayer, callToss, chooseRole, throwNumber, getPlayerScore } = require('./roomEngine');
const { getOrCreatePlayer, recordMatch, leaderboard, eloLeaderboard, STARTING_ELO, WIN_ELO, LOSS_ELO } = require('./playerStore');

function log(name, fn) {
  try { fn(); console.log('PASS:', name); }
  catch (e) { console.log('FAIL:', name, '-', e.message); process.exitCode = 1; }
}

log('full match end-to-end: room engine result feeds correctly into ELO + leaderboard', () => {
  const room = makeRoom('INT1');
  addPlayer(room, 'alice-id', 'Alice');
  addPlayer(room, 'bob-id', 'Bob');

  const origR = Math.random;
  Math.random = () => 0.1; // heads
  callToss(room, 'alice-id', 'heads'); // Alice wins toss
  Math.random = origR;
  chooseRole(room, 'alice-id', 'bat'); // Alice bats innings 1, Bob bowls

  // Alice scores 25 then gets out (tie)
  throwNumber(room, 'alice-id', 3); throwNumber(room, 'bob-id', 1); // +3
  throwNumber(room, 'alice-id', 5); throwNumber(room, 'bob-id', 2); // +5
  throwNumber(room, 'alice-id', 6); throwNumber(room, 'bob-id', 4); // +6
  throwNumber(room, 'alice-id', 5); throwNumber(room, 'bob-id', 1); // +5
  throwNumber(room, 'alice-id', 6); throwNumber(room, 'bob-id', 3); // +6  => 25 runs so far
  const outResult = throwNumber(room, 'alice-id', 2);
  const outResult2 = throwNumber(room, 'bob-id', 2); // tie -> out, Alice's innings = 25

  assert.strictEqual(outResult2.endInfo.type, 'innings-break');
  assert.strictEqual(outResult2.endInfo.target, 26);

  // now Bob chases 26, Alice bowls. Bob scores enough to win.
  let ballsUsed = 0;
  let lastResult;
  while (ballsUsed < 30) {
    throwNumber(room, 'bob-id', 6);
    lastResult = throwNumber(room, 'alice-id', 1); // never ties with 6
    ballsUsed++;
    if (lastResult.endInfo.type === 'match-over') break;
  }
  assert.strictEqual(lastResult.endInfo.type, 'match-over');
  assert.strictEqual(lastResult.endInfo.winnerId, 'bob-id');
  assert.strictEqual(lastResult.endInfo.reason, 'chase');

  // Scores as the server would compute them for ELO purposes
  const aliceScore = getPlayerScore(room, 'alice-id');
  const bobScore = getPlayerScore(room, 'bob-id');
  assert.strictEqual(aliceScore, 25);
  assert.strictEqual(bobScore, 30); // 5 balls * 6 runs = 30, reached target of 26 mid-way

  // Feed into the player store exactly like server.js's applyMatchResult does
  const players = {};
  getOrCreatePlayer(players, 'Alice');
  getOrCreatePlayer(players, 'Bob');
  const eloResult = recordMatch(players, {
    winnerName: 'Bob', loserName: 'Alice', winnerScore: bobScore, loserScore: aliceScore
  });

  assert.strictEqual(eloResult.winnerElo, STARTING_ELO + WIN_ELO);
  assert.strictEqual(eloResult.loserElo, STARTING_ELO - LOSS_ELO);

  const board = leaderboard(players, 'alltime');
  assert.strictEqual(board[0].name, 'Bob');
  assert.strictEqual(board[0].score, 30);
  assert.strictEqual(board[1].name, 'Alice');
  assert.strictEqual(board[1].score, 25);

  const elos = eloLeaderboard(players);
  assert.strictEqual(elos[0].name, 'Bob');
  assert.strictEqual(elos[0].wins, 1);
  assert.strictEqual(elos[1].name, 'Alice');
  assert.strictEqual(elos[1].losses, 1);
});

console.log('\nAll integration tests completed.');
