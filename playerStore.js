// playerStore.js
// Persistent player records: ELO rating and score history, used to drive
// the ELO leaderboard and the week/month/year/alltime top-scorer boards.
//
// Identity note: players are identified by name only (trimmed, case-insensitive).
// There is no login system, so two people using the same name share a record.
// That's a real limitation — fine for casual play, but if you want real accounts
// this is the layer to swap for one (replace keyOf()/getOrCreatePlayer() with a
// real user id from your auth system, everything else stays the same).

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'players.json');
const WIN_ELO = 7;
const LOSS_ELO = 5;
const ELO_FLOOR = 0;
const STARTING_ELO = 1000;

const PERIOD_MS = {
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
  alltime: Infinity
};

function loadPlayers() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    return {}; // no file yet, or unreadable — start fresh
  }
}

function savePlayers(players) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(players, null, 2));
  } catch (e) {
    console.error('Could not save players.json:', e.message);
  }
}

function keyOf(name) {
  return (name || '').trim().toLowerCase();
}

function getOrCreatePlayer(players, name) {
  const k = keyOf(name);
  if (!k) return null;
  if (!players[k]) {
    players[k] = { name: name.trim(), elo: STARTING_ELO, scores: [], wins: 0, losses: 0 };
  }
  return players[k];
}

// Records the result of one match. Scores are each player's individual runs
// scored while batting that match (hand cricket gives each side exactly one
// innings per match, so this is unambiguous).
function recordMatch(players, { winnerName, loserName, winnerScore, loserScore, now = Date.now() }) {
  const winner = getOrCreatePlayer(players, winnerName);
  const loser = getOrCreatePlayer(players, loserName);

  if (winner) {
    winner.elo += WIN_ELO;
    winner.wins += 1;
    winner.scores.push({ runs: winnerScore, ts: now });
  }
  if (loser) {
    loser.elo = Math.max(ELO_FLOOR, loser.elo - LOSS_ELO);
    loser.losses += 1;
    loser.scores.push({ runs: loserScore, ts: now });
  }

  return {
    winnerElo: winner ? winner.elo : null,
    loserElo: loser ? loser.elo : null
  };
}

// Top scorer leaderboard for a period: each player's *best single innings*
// within the window, not a sum — matches "top scorer of the week" intuition.
function leaderboard(players, period, limit = 20, now = Date.now()) {
  const windowMs = PERIOD_MS[period] ?? Infinity;
  const cutoff = windowMs === Infinity ? -Infinity : now - windowMs;
  const rows = [];
  for (const key in players) {
    const p = players[key];
    let best = null;
    for (const s of p.scores) {
      if (s.ts >= cutoff && (best === null || s.runs > best)) best = s.runs;
    }
    if (best !== null) rows.push({ name: p.name, score: best });
  }
  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, limit);
}

function eloLeaderboard(players, limit = 20) {
  const rows = Object.values(players).map(p => ({ name: p.name, elo: p.elo, wins: p.wins, losses: p.losses }));
  rows.sort((a, b) => b.elo - a.elo);
  return rows.slice(0, limit);
}

function playerSummary(players, name) {
  const k = keyOf(name);
  const p = players[k];
  if (!p) return null;
  const ranked = eloLeaderboard(players, Infinity);
  const rank = ranked.findIndex(r => keyOf(r.name) === k) + 1;
  return { name: p.name, elo: p.elo, wins: p.wins, losses: p.losses, rank };
}

module.exports = {
  loadPlayers, savePlayers, getOrCreatePlayer, recordMatch,
  leaderboard, eloLeaderboard, playerSummary, keyOf,
  WIN_ELO, LOSS_ELO, ELO_FLOOR, STARTING_ELO
};
