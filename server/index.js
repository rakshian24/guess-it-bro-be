const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"],
  },
});

const rooms = new Map();

function generateRoomId() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function generateUserId() {
  return crypto.randomUUID();
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("room:create", ({ nickname, userId }, callback) => {
    const roomId = generateRoomId();
    const finalUserId = userId || generateUserId();

    const room = {
      roomId,
      hostUserId: finalUserId,
      players: [
        {
          userId: finalUserId,
          socketId: socket.id,
          nickname,
        },
      ],
      strokes: [],
    };

    rooms.set(roomId, room);
    socket.join(roomId);

    callback({
      success: true,
      roomId,
      userId: finalUserId,
      room,
      shareUrl: `http://localhost:5173/room/${roomId}`,
    });

    io.to(roomId).emit("room:updated", room);
  });

  socket.on("room:join", ({ roomId, nickname, userId }, callback) => {
    const room = rooms.get(roomId);

    if (!room) {
      callback({
        success: false,
        message: "Room not found",
      });
      return;
    }

    const finalUserId = userId || generateUserId();

    const existingPlayer = room.players.find(
      (player) => player.userId === finalUserId,
    );

    if (existingPlayer) {
      existingPlayer.socketId = socket.id;
      existingPlayer.nickname = nickname;
    } else {
      const duplicateNickname = room.players.some(
        (player) =>
          player.nickname.toLowerCase() === nickname.toLowerCase() &&
          player.userId !== finalUserId,
      );

      if (duplicateNickname) {
        callback({
          success: false,
          message: "Nickname already taken",
        });
        return;
      }

      room.players.push({
        userId: finalUserId,
        socketId: socket.id,
        nickname,
      });
    }

    socket.join(roomId);

    callback({
      success: true,
      roomId,
      userId: finalUserId,
      room,
      shareUrl: `http://localhost:5173/room/${roomId}`,
    });

    io.to(roomId).emit("room:updated", room);
    socket.emit("canvas:sync", room.strokes);
  });

  socket.on("canvas:draw", ({ roomId, stroke }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    room.strokes.push(stroke);
    socket.to(roomId).emit("canvas:draw", stroke);
  });

  socket.on("canvas:clear", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    room.strokes = [];
    io.to(roomId).emit("canvas:clear");
  });

  socket.on("disconnecting", () => {
    for (const joinedRoomId of socket.rooms) {
      if (joinedRoomId === socket.id) continue;

      const room = rooms.get(joinedRoomId);
      if (!room) continue;

      const disconnectedPlayer = room.players.find(
        (player) => player.socketId === socket.id,
      );

      if (!disconnectedPlayer) continue;

      disconnectedPlayer.socketId = null;

      io.to(joinedRoomId).emit("room:updated", room);

      setTimeout(() => {
        const latestRoom = rooms.get(joinedRoomId);
        if (!latestRoom) return;

        const latestPlayer = latestRoom.players.find(
          (player) => player.userId === disconnectedPlayer.userId,
        );

        if (latestPlayer && latestPlayer.socketId === null) {
          latestRoom.players = latestRoom.players.filter(
            (player) => player.userId !== disconnectedPlayer.userId,
          );

          if (latestRoom.hostUserId === disconnectedPlayer.userId) {
            latestRoom.hostUserId = latestRoom.players[0]?.userId || null;
          }

          if (latestRoom.players.length === 0) {
            rooms.delete(joinedRoomId);
            console.log(`Room ${joinedRoomId} deleted`);
          } else {
            io.to(joinedRoomId).emit("room:updated", latestRoom);
          }
        }
      }, 5000);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

app.get("/", (_, res) => {
  res.send("Guess It Bro socket server running");
});

server.listen(4000, () => {
  console.log("Server running on http://localhost:4000");
});
