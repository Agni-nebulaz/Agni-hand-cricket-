// roomEngine.js
// Pure, framework-free game logic for a 2-player HANDDOWN match.
// No Socket.io / networking in here on purpose — this is the part most likely
// to have subtle bugs, so it's kept separate and unit-testable in plain Node.

const BALLS_PER_INNINGS = 30;

function makeRoom(code) {
  return {
    code,
    players: [],           // [{id, name}] — max 2
    state: {
      phase: 'waiting',     // waiting -> toss -> choose -> innings -> over
      tossCallerId: null,   // room creator calls the toss
      tossWinnerId: null,
      battingId: null,
      bowlingId: null,
      innings: 1,
      target: null,
      score: 0,
      wkts: 0,
      balls: 0,
      pendingThrows: {},    // playerId -> number, for the ball in progress
      firstInningsSummary: null,
      gameOver: false,
      winnerId: null
    }
  };
}

function addPlayer(room, id, name) {
  if (room.players.length >= 2) return { ok: false, error: 'Room is full' };
  if (room.players.some(p => p.id === id)) return { ok: false, error: 'Already joined' };
  room.players.push({ id, name });
  if (room.players.length === 1) room.state.tossCallerId = id;
  if (room.players.length === 2) room.state.phase = 'toss';
  return { ok: true };
}

function removePlayer(room, id) {
  room.players = room.players.filter(p => p.id !== id);
}

function callToss(room, byId, call) {
  const s = room.state;
  if (room.players.length < 2) return { ok: false, error: 'Waiting for opponent' };
  if (s.phase !== 'toss') return { ok: false, error: 'Not the toss phase' };
  if (byId !== s.tossCallerId) return { ok: false, error: 'Not your toss to call' };

  const flip = Math.random() < 0.5 ? 'heads' : 'tails';
  const won = flip === call;
  const otherId = room.players.find(p => p.id !== byId).id;
  s.tossWinnerId = won ? byId : otherId;
  s.phase = 'choose';
  return { ok: true, flip, winnerId: s.tossWinnerId };
}

function chooseRole(room, byId, role) {
  const s = room.state;
  if (s.phase !== 'choose') return { ok: false, error: 'Not the choose phase' };
  if (byId !== s.tossWinnerId) return { ok: false, error: 'Not your choice to make' };
  if (role !== 'bat' && role !== 'bowl') return { ok: false, error: 'Invalid role' };

  const otherId = room.players.find(p => p.id !== byId).id;
  s.battingId = role === 'bat' ? byId : otherId;
  s.bowlingId = role === 'bat' ? otherId : byId;
  startInnings(room);
  return { ok: true, battingId: s.battingId, bowlingId: s.bowlingId, innings: s.innings };
}

function startInnings(room) {
  const s = room.state;
  s.score = 0; s.wkts = 0; s.balls = 0; s.pendingThrows = {};
  s.phase = 'innings';
}

// Returns { ok, ballResult, endInfo } or { ok:false, error }
function throwNumber(room, byId, n) {
  const s = room.state;
  if (s.phase !== 'innings') return { ok: false, error: 'Not in play' };
  if (n < 1 || n > 6) return { ok: false, error: 'Number must be 1-6' };
  if (s.pendingThrows[byId] != null) return { ok: false, error: 'Already thrown this ball' };

  s.pendingThrows[byId] = n;
  const ids = room.players.map(p => p.id);
  const bothIn = ids.every(id => s.pendingThrows[id] != null);
  if (!bothIn) return { ok: true, waiting: true };

  const battingNum = s.pendingThrows[s.battingId];
  const bowlingNum = s.pendingThrows[s.bowlingId];
  s.balls++;
  const out = battingNum === bowlingNum;
  let runs = 0;
  if (out) { s.wkts = 1; } else { runs = battingNum; s.score += runs; }
  s.pendingThrows = {};

  const ballResult = {
    battingId: s.battingId, bowlingId: s.bowlingId,
    battingNum, bowlingNum, out, runs,
    score: s.score, wkts: s.wkts, balls: s.balls, innings: s.innings
  };
  const endInfo = checkInningsEnd(room, out);
  return { ok: true, waiting: false, ballResult, endInfo };
}

function checkInningsEnd(room, justOut) {
  const s = room.state;
  const chaseWon = s.innings === 2 && s.target != null && s.score >= s.target;
  const oversDone = s.balls >= BALLS_PER_INNINGS;

  if (chaseWon) {
    s.gameOver = true; s.phase = 'over'; s.winnerId = s.battingId;
    return { type: 'match-over', winnerId: s.winnerId, reason: 'chase' };
  }
  if (justOut || oversDone) {
    if (s.innings === 1) {
      s.firstInningsSummary = { runs: s.score, battingId: s.battingId };
      s.target = s.score + 1;
      s.innings = 2;
      const newBattingId = s.bowlingId, newBowlingId = s.battingId;
      s.battingId = newBattingId; s.bowlingId = newBowlingId;
      startInnings(room); // resets score/wkts/balls, phase stays 'innings'
      return {
        type: 'innings-break', target: s.target,
        battingId: s.battingId, bowlingId: s.bowlingId,
        firstInningsSummary: s.firstInningsSummary, innings: s.innings
      };
    } else {
      s.gameOver = true; s.phase = 'over';
      s.winnerId = (s.score >= s.target) ? s.battingId : s.bowlingId;
      return { type: 'match-over', winnerId: s.winnerId, reason: justOut ? 'wicket' : 'overs' };
    }
  }
  return { type: 'continue' };
}

// A player's score for a match is the runs they scored in their one innings —
// hand cricket gives each side exactly one innings per match.
function getPlayerScore(room, playerId) {
  const s = room.state;
  if (s.firstInningsSummary && s.firstInningsSummary.battingId === playerId) return s.firstInningsSummary.runs;
  if (s.battingId === playerId) return s.score;
  return 0;
}

module.exports = { makeRoom, addPlayer, removePlayer, callToss, chooseRole, throwNumber, getPlayerScore, BALLS_PER_INNINGS };
