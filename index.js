// Parker Pong Server (Node.js + Express + Socket.IO)
// Fully supports:
// - Real-time Pong physics
// - Host, Player1, Player2 roles
// - Match IDs (unique per round)
// - endMatch = revoke player control
// - Serving client from /public/index.html

const express = require("express");
const path = require("path");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: {
    origin: "*"
  }
});

// Serve static client files
app.use(express.static(path.join(__dirname, "public")));

// ===============================
// GAME STATE + MATCH MANAGEMENT
// ===============================
const endedMatches = new Set(); // stores ended match IDs

const makeInitialState = () => ({
  p1Y: 0.5,
  p2Y: 0.5,
  ballX: 0.5,
  ballY: 0.5,
  ballVX: 0.5,
  ballVY: 0.2,
  score1: 0,
  score2: 0,
});

const gameStates = {}; // matchId → state
const lastTimes = {};  // matchId → timestamp


function resetBall(state, direction) {
  state.ballX = 0.5;
  state.ballY = 0.5;
  state.ballVX = 0.5 * direction;
  state.ballVY = (Math.random() - 0.5) * 0.6;
}


// ===============================
// SOCKET LOGIC
// ===============================
io.on("connection", (socket) => {
  console.log("Client connected");

  socket.on("join", ({ role, matchId }) => {
    socket.role = role;
    socket.matchId = matchId;

    // If match does not exist, create it
    if (!gameStates[matchId] && !endedMatches.has(matchId)) {
      console.log("Creating new match:", matchId);
      gameStates[matchId] = makeInitialState();
      lastTimes[matchId] = Date.now();
    }

    // If match has ended, notify the client and stop
    if (endedMatches.has(matchId)) {
      socket.emit("matchEnded");
      return;
    }

    // Send initial state
    socket.emit("state", gameStates[matchId]);
    console.log(`Client joined as ${role} for match ${matchId}`);
  });

  // Paddle movement
  socket.on("paddle", (data) => {
    const { matchId, role } = socket;
    if (!matchId || endedMatches.has(matchId)) return;

    const state = gameStates[matchId];
    if (!state) return;

    // Update paddle position
    if (role === "p1") state.p1Y = clamp(data.y, 0, 1);
    if (role === "p2") state.p2Y = clamp(data.y, 0, 1);
  });

  // Host ends match
  socket.on("endMatch", () => {
    if (socket.role !== "host" || !socket.matchId) return;

    const matchId = socket.matchId;
    console.log("Ending match:", matchId);

    endedMatches.add(matchId);

    // Notify all players in this match
    io.sockets.sockets.forEach((s) => {
      if (s.matchId === matchId) {
        s.emit("matchEnded");
      }
    });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});


// ===============================
// GAME PHYSICS LOOP
// ===============================
function gameLoop() {
  const matchIds = Object.keys(gameStates);

  matchIds.forEach((matchId) => {
    if (endedMatches.has(matchId)) return;

    const state = gameStates[matchId];
    const now = Date.now();
    const dt = (now - lastTimes[matchId]) / 1000;
    lastTimes[matchId] = now;

    // Move ball
    state.ballX += state.ballVX * dt;
    state.ballY += state.ballVY * dt;

    // Wall collisions
    if (state.ballY < 0) {
      state.ballY = 0;
      state.ballVY *= -1;
    }
    if (state.ballY > 1) {
      state.ballY = 1;
      state.ballVY *= -1;
    }

    const paddleHeight = 0.25;
    const halfH = paddleHeight / 2;
    const paddleThickness = 0.03;

    const p1X = 0.06;
    const p2X = 0.94;

    // Left paddle (p1)
    if (
      state.ballX < p1X + paddleThickness &&
      state.ballX > p1X &&
      state.ballY > state.p1Y - halfH &&
      state.ballY < state.p1Y + halfH &&
      state.ballVX < 0
    ) {
      state.ballX = p1X + paddleThickness;
      state.ballVX *= -1;
      const offset = state.ballY - state.p1Y;
      state.ballVY += offset * 1.5;
    }

    // Right paddle (p2)
    if (
      state.ballX > p2X - paddleThickness &&
      state.ballX < p2X &&
      state.ballY > state.p2Y - halfH &&
      state.ballY < state.p2Y + halfH &&
      state.ballVX > 0
    ) {
      state.ballX = p2X - paddleThickness;
      state.ballVX *= -1;
      const offset = state.ballY - state.p2Y;
      state.ballVY += offset * 1.5;
    }

    // Scoring
    if (state.ballX < 0) {
      state.score2 += 1;
      resetBall(state, 1);
    }
    if (state.ballX > 1) {
      state.score1 += 1;
      resetBall(state, -1);
    }

    // Broadcast state to all clients
    io.to(matchId).emit("state", state);

    // Broadcast to everyone (simpler, fine for MVP)
    io.emit("state", state);
  });

  setTimeout(gameLoop, 1000 / 60);
}

gameLoop();


// ===============================
// HELPERS
// ===============================
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}


// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log("Parker Pong server running on port", PORT);
});
