const assert = require('assert');
const { makeRoom, addPlayer, callToss, chooseRole, throwNumber, BALLS_PER_INNINGS } = require('./roomEngine');

function log(name, fn) {
  try { fn(); console.log('PASS:', name); }
  catch (e) { console.log('FAIL:', name, '-', e.message); process.exitCode = 1; }
}

// ---------- Test 1: basic join flow ----------
log('two players can join, third is rejected', () => {
  const room = makeRoom('ABCD');
  assert(addPlayer(room, 'p1', 'Alice').ok);
  assert(addPlayer(room, 'p2', 'Bob').ok);
  assert(room.state.phase === 'toss');
  const third = addPlayer(room, 'p3', 'Eve');
  assert(third.ok === false);
});

// ---------- Test 2: toss + role selection wiring ----------
log('toss caller must be player 1; toss winner chooses role correctly', () => {
  const room = makeRoom('T1');
  addPlayer(room, 'p1', 'Alice');
  addPlayer(room, 'p2', 'Bob');

  const badCaller = callToss(room, 'p2', 'heads');
  assert(badCaller.ok === false);

  // force a deterministic flip by monkeypatching Math.random for this test
  const orig = Math.random;
  Math.random = () => 0.1; // < 0.5 -> flip = 'heads'
  const result = callToss(room, 'p1', 'heads'); // p1 called heads, flip is heads -> p1 wins
  Math.random = orig;
  assert(result.ok);
  assert.strictEqual(result.flip, 'heads');
  assert.strictEqual(result.winnerId, 'p1');

  const roleResult = chooseRole(room, 'p1', 'bat');
  assert(roleResult.ok);
  assert.strictEqual(room.state.battingId, 'p1');
  assert.strictEqual(room.state.bowlingId, 'p2');
  assert.strictEqual(room.state.phase, 'innings');

  // wrong player trying to choose role should fail (phase already moved on, but test the guard directly)
  const room2 = makeRoom('T2');
  addPlayer(room2, 'a', 'A'); addPlayer(room2, 'b', 'B');
  const origR = Math.random; Math.random = () => 0.9; // flip = tails
  callToss(room2, 'a', 'heads'); // a called heads, flip tails -> b wins
  Math.random = origR;
  const wrongChoice = chooseRole(room2, 'a', 'bat'); // a is not the winner
  assert(wrongChoice.ok === false);
});

// ---------- Test 3: full match with a normal chase and a clean win ----------
log('full match: innings swap, target set correctly, chase completes and ends match', () => {
  const room = makeRoom('T3');
  addPlayer(room, 'p1', 'Alice');
  addPlayer(room, 'p2', 'Bob');
  const origR = Math.random; Math.random = () => 0.1; // heads
  callToss(room, 'p1', 'heads'); // p1 wins toss
  Math.random = origR;
  chooseRole(room, 'p1', 'bat'); // p1 bats innings 1, p2 bowls

  // Innings 1: p1 bats varied numbers, p2 bowls different numbers (no ties) for 5 balls, then a tie to end it
  const throws = [[3,1],[4,2],[5,6],[2,4],[6,5]]; // [battingNum(p1), bowlingNum(p2)]
  let expectedScore = 0;
  for (const [a,b] of throws) {
    throwNumber(room, 'p1', a);
    const r = throwNumber(room, 'p2', b);
    expectedScore += a;
    assert.strictEqual(r.ballResult.score, expectedScore);
  }
  // now end innings 1 with a tie (both throw 3)
  throwNumber(room, 'p1', 3);
  const tieResult = throwNumber(room, 'p2', 3);
  assert.strictEqual(tieResult.ballResult.out, true);
  assert.strictEqual(tieResult.endInfo.type, 'innings-break');
  assert.strictEqual(tieResult.endInfo.target, expectedScore + 1);
  assert.strictEqual(room.state.battingId, 'p2'); // swapped
  assert.strictEqual(room.state.bowlingId, 'p1');
  assert.strictEqual(room.state.score, 0);
  assert.strictEqual(room.state.balls, 0);

  const target = room.state.target;
  // Innings 2: p2 now bats, needs `target` runs. Feed enough non-tying balls to reach it.
  let score2 = 0;
  let ballsUsed = 0;
  while (score2 < target && ballsUsed < BALLS_PER_INNINGS) {
    const batNum = 6; // p2's throw
    const bowlNum = 1; // p1's throw, never ties with 6
    throwNumber(room, 'p2', batNum);
    const r = throwNumber(room, 'p1', bowlNum);
    score2 += batNum;
    ballsUsed++;
    if (r.endInfo.type === 'match-over') {
      assert.strictEqual(r.endInfo.winnerId, 'p2'); // chasing side won
      assert.strictEqual(r.endInfo.reason, 'chase');
      assert.strictEqual(room.state.gameOver, true);
      break;
    }
  }
  assert.strictEqual(room.state.gameOver, true);
});

// ---------- Test 4: chasing side gets out before reaching target -> bowling side wins ----------
log('chasing side dismissed short of target -> bowling side wins', () => {
  const room = makeRoom('T4');
  addPlayer(room, 'p1', 'Alice');
  addPlayer(room, 'p2', 'Bob');
  const origR = Math.random; Math.random = () => 0.9; // tails
  callToss(room, 'p1', 'heads'); // p1 called heads, flip tails -> p2 wins
  Math.random = origR;
  chooseRole(room, 'p2', 'bat'); // p2 bats innings1, p1 bowls

  // innings 1: instant tie for a low target
  throwNumber(room, 'p2', 4);
  const r1 = throwNumber(room, 'p1', 4); // tie -> out immediately, score 0
  assert.strictEqual(r1.endInfo.type, 'innings-break');
  assert.strictEqual(r1.endInfo.target, 1); // 0 + 1
  assert.strictEqual(room.state.battingId, 'p1'); // p1 now chases just 1 run
  assert.strictEqual(room.state.bowlingId, 'p2');

  // innings 2: p1 (batting) immediately ties with p2 (bowling) -> out for 0, short of target 1
  const r2a = throwNumber(room, 'p1', 5);
  const r2 = throwNumber(room, 'p2', 5); // tie
  assert.strictEqual(r2.ballResult.out, true);
  assert.strictEqual(r2.endInfo.type, 'match-over');
  assert.strictEqual(r2.endInfo.reason, 'wicket');
  assert.strictEqual(r2.endInfo.winnerId, 'p2'); // bowling side (p2) wins since chase failed
});

// ---------- Test 5: match decided by overs running out, not a wicket ----------
log('second innings ends by overs without reaching target -> bowling side wins', () => {
  const room = makeRoom('T5');
  addPlayer(room, 'p1', 'Alice');
  addPlayer(room, 'p2', 'Bob');
  const origR = Math.random; Math.random = () => 0.1;
  callToss(room, 'p1', 'heads');
  Math.random = origR;
  chooseRole(room, 'p1', 'bat');

  // innings 1: score exactly 60 runs over 30 balls (2 runs/ball), no ties, then overs run out
  for (let i = 0; i < BALLS_PER_INNINGS; i++) {
    throwNumber(room, 'p1', 2);
    throwNumber(room, 'p2', 5); // never ties with 2
  }
  // after 30 balls, next resolved ball should have ended innings 1 via overs
  // (the 30th ball already triggered it inside the loop above)
  assert.strictEqual(room.state.innings, 2);
  assert.strictEqual(room.state.target, 61);
  assert.strictEqual(room.state.battingId, 'p2');

  // innings 2: p2 scores only 1 run/ball for all 30 balls -> 30 runs, short of target 61, no wicket
  for (let i = 0; i < BALLS_PER_INNINGS; i++) {
    throwNumber(room, 'p2', 1);
    const r = throwNumber(room, 'p1', 4); // never ties with 1
    if (i === BALLS_PER_INNINGS - 1) {
      assert.strictEqual(r.endInfo.type, 'match-over');
      assert.strictEqual(r.endInfo.reason, 'overs');
      assert.strictEqual(r.endInfo.winnerId, 'p1'); // bowling side wins, chase fell short
    }
  }
});

// ---------- Test 6: a player can't throw twice for the same ball ----------
log('a player cannot submit two throws for the same ball', () => {
  const room = makeRoom('T6');
  addPlayer(room, 'p1', 'Alice'); addPlayer(room, 'p2', 'Bob');
  const origR = Math.random; Math.random = () => 0.1;
  callToss(room, 'p1', 'heads');
  Math.random = origR;
  chooseRole(room, 'p1', 'bat');
  const first = throwNumber(room, 'p1', 3);
  assert.strictEqual(first.waiting, true);
  const second = throwNumber(room, 'p1', 4);
  assert.strictEqual(second.ok, false);
});

console.log('\nAll roomEngine tests completed.');
