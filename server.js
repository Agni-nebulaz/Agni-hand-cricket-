// server.js
// Real-time multiplayer server for HANDDOWN hand cricket.
// Run with: npm install && npm start   (defaults to port 3001, or set PORT env var)
//
// This server does double duty: it runs the Socket.io backend AND (if you
// keep hand-cricket-multiplayer.html in this same folder) serves the client
// page itself at "/". That's what lets you deploy this as a single Render
// service instead of hosting the client separately.

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { makeRoom, addPlayer, removePlayer, callToss, chooseRole, throwNumber, getPlayerScore } = require('./roomEngine');
const playerStore = require('./playerStore');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // tighten this to your real domain before going to production
});

// Serve every file in this folder (so hand-cricket-multiplayer.html, if it's
// sitting right here, is reachable), and explicitly serve it at the root path.
app.use(express.static(__dirname));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'hand-cricket-multiplayer.html'), (err) => {
    if (err) res.status(404).send('hand-cricket-multiplayer.html was not found next to server.js on this deployment.');
  });
});

const rooms = new Map(); // code -> room
const socketRoom = new Map(); // socketId -> roomCode (shared map so matchmaking can set it for both sides)
const matchmakingQueue = []; // [{socketId, name}], FIFO
const ROOM_TTL_MS = 30 * 60 * 1000; // clean up abandoned rooms after 30 minutes

// Player records (ELO + score history) persisted to players.json.
// Loaded once at startup, saved after every match result.
let players = playerStore.loadPlayers();
function persistPlayers(){ playerStore.savePlayers(players); }

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous O/0/I/1
  let code;
  do {
    code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function scheduleCleanup(code) {
  setTimeout(() => {
    const room = rooms.get(code);
    if (room && room.players.length === 0) rooms.delete(code);
  }, ROOM_TTL_MS);
}

function otherPlayer(room, id) {
  return room.players.find(p => p.id !== id);
}

function broadcastOnlineCount() {
  io.emit('players-online', { count: io.engine.clientsCount });
}

function publicState(room) {
  // Only send what clients need — no hidden info to leak since both throws
  // are only ever revealed to clients after both have already been submitted.
  const s = room.state;
  return {
    phase: s.phase,
    players: room.players.map(p => ({ id: p.id, name: p.name })),
    tossCallerId: s.tossCallerId,
    tossWinnerId: s.tossWinnerId,
    battingId: s.battingId,
    bowlingId: s.bowlingId,
    innings: s.innings,
    target: s.target,
    score: s.score,
    wkts: s.wkts,
    balls: s.balls,
    gameOver: s.gameOver,
    winnerId: s.winnerId
  };
}

io.on('connection', (socket) => {
  broadcastOnlineCount();

  socket.on('create-room', ({ name }, ack) => {
    const code = makeRoomCode();
    const room = makeRoom(code);
    addPlayer(room, socket.id, (name || 'Player').slice(0, 20));
    rooms.set(code, room);
    socketRoom.set(socket.id, code);
    socket.join(code);
    ack && ack({ ok: true, code, playerId: socket.id, state: publicState(room) });
  });

  socket.on('join-room', ({ code, name }, ack) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room) return ack && ack({ ok: false, error: 'Room not found' });
    const result = addPlayer(room, socket.id, (name || 'Player').slice(0, 20));
    if (!result.ok) return ack && ack({ ok: false, error: result.error });

    socketRoom.set(socket.id, room.code);
    socket.join(room.code);
    ack && ack({ ok: true, code: room.code, playerId: socket.id, state: publicState(room) });
    io.to(room.code).emit('room-ready', publicState(room));
  });

  socket.on('quick-match', ({ name }, ack) => {
    const myName = (name || 'Player').slice(0, 20);
    // don't match yourself if you're still in the queue from a stale click
    const queueIdx = matchmakingQueue.findIndex(q => q.socketId !== socket.id);
    if (queueIdx !== -1) {
      const opponent = matchmakingQueue.splice(queueIdx, 1)[0];
      const opponentSocket = io.sockets.sockets.get(opponent.socketId);
      if (!opponentSocket) { // they vanished between queueing and now — just queue this player instead
        matchmakingQueue.push({ socketId: socket.id, name: myName });
        return ack && ack({ ok: true, matched: false });
      }
      const code = makeRoomCode();
      const room = makeRoom(code);
      addPlayer(room, opponent.socketId, opponent.name);
      addPlayer(room, socket.id, myName);
      rooms.set(code, room);
      socketRoom.set(opponent.socketId, code);
      socketRoom.set(socket.id, code);
      opponentSocket.join(code);
      socket.join(code);
      ack && ack({ ok: true, matched: true, code, playerId: socket.id, state: publicState(room) });
      io.to(opponent.socketId).emit('quick-match-found', { code, playerId: opponent.socketId, state: publicState(room) });
      io.to(code).emit('room-ready', publicState(room));
    } else {
      matchmakingQueue.push({ socketId: socket.id, name: myName });
      ack && ack({ ok: true, matched: false });
    }
  });

  socket.on('cancel-quick-match', () => {
    const idx = matchmakingQueue.findIndex(q => q.socketId === socket.id);
    if (idx !== -1) matchmakingQueue.splice(idx, 1);
  });

  socket.on('call-toss', ({ call }, ack) => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room) return ack && ack({ ok: false, error: 'No active room' });
    const result = callToss(room, socket.id, call);
    if (!result.ok) return ack && ack(result);
    ack && ack({ ok: true });
    io.to(room.code).emit('toss-result', { flip: result.flip, winnerId: result.winnerId, state: publicState(room) });
  });

  socket.on('choose-role', ({ role }, ack) => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room) return ack && ack({ ok: false, error: 'No active room' });
    const result = chooseRole(room, socket.id, role);
    if (!result.ok) return ack && ack(result);
    ack && ack({ ok: true });
    io.to(room.code).emit('innings-start', { state: publicState(room) });
  });

  socket.on('throw-number', ({ n }, ack) => {
    const room = rooms.get(socketRoom.get(socket.id));
    if (!room) return ack && ack({ ok: false, error: 'No active room' });
    const result = throwNumber(room, socket.id, n);
    if (!result.ok) return ack && ack(result);
    ack && ack({ ok: true });

    if (result.waiting) {
      // let the opponent know a throw came in, without revealing the number
      const opp = otherPlayer(room, socket.id);
      if (opp) io.to(opp.id).emit('opponent-threw');
      return;
    }

    io.to(room.code).emit('ball-result', { ball: result.ballResult, state: publicState(room) });

    if (result.endInfo.type === 'innings-break') {
      io.to(room.code).emit('innings-break', { ...result.endInfo, state: publicState(room) });
    } else if (result.endInfo.type === 'match-over') {
      io.to(room.code).emit('match-over', { ...result.endInfo, state: publicState(room) });
      applyMatchResult(room, result.endInfo.winnerId);
    }
  });

  socket.on('get-leaderboard', ({ period }, ack) => {
    ack && ack({ ok: true, period, entries: playerStore.leaderboard(players, period) });
  });

  socket.on('get-elo-leaderboard', (_payload, ack) => {
    ack && ack({ ok: true, entries: playerStore.eloLeaderboard(players) });
  });

  socket.on('get-player-stats', ({ name }, ack) => {
    ack && ack({ ok: true, stats: playerStore.playerSummary(players, name) });
  });

  socket.on('leave-room', () => handleLeave());
  socket.on('disconnect', () => {
    const qIdx = matchmakingQueue.findIndex(q => q.socketId === socket.id);
    if (qIdx !== -1) matchmakingQueue.splice(qIdx, 1);
    handleLeave();
    broadcastOnlineCount();
  });

  function handleLeave() {
    const code = socketRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    socketRoom.delete(socket.id);
    if (!room) return;
    removePlayer(room, socket.id);
    io.to(room.code).emit('opponent-left');
    socket.leave(room.code);
    if (room.players.length === 0) scheduleCleanup(room.code);
  }
});

// Updates ELO + score history for both players once a match ends, then
// tells each player their own result individually (their elo change differs).
function applyMatchResult(room, winnerId) {
  const winnerP = room.players.find(p => p.id === winnerId);
  const loserP = room.players.find(p => p.id !== winnerId);
  if (!winnerP || !loserP) return; // opponent disconnected mid-match — nothing to score

  const winnerScore = getPlayerScore(room, winnerP.id);
  const loserScore = getPlayerScore(room, loserP.id);
  const eloResult = playerStore.recordMatch(players, {
    winnerName: winnerP.name, loserName: loserP.name, winnerScore, loserScore
  });
  persistPlayers();

  io.to(winnerP.id).emit('elo-update', { elo: eloResult.winnerElo, delta: playerStore.WIN_ELO, won: true, score: winnerScore });
  io.to(loserP.id).emit('elo-update', { elo: eloResult.loserElo, delta: -playerStore.LOSS_ELO, won: false, score: loserScore });
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`HANDDOWN multiplayer server listening on :${PORT}`));

