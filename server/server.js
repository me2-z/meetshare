// server/server.js
import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Serve static frontend from ../public
app.use(express.static(path.join(__dirname, "../public")));

app.get("/health", (req, res) => res.send("ok"));

const wss = new WebSocketServer({ server });

// rooms: roomId -> Set of ws clients
const rooms = new Map();

wss.on("connection", (ws) => {
  console.log("🔌 New WebSocket connection");

  ws.room = null;

  ws.on("error", (err) => console.error("❌ WS error:", err));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      console.warn("⚠️ Non-JSON WS message:", raw.toString());
      return;
    }

    console.log("📩 Incoming WS message:", msg);

    // JOIN MESSAGE
    if (msg.type === "join" && msg.room) {
      ws.room = msg.room;
      console.log(`👥 Client joining room: ${msg.room}`);

      if (!rooms.has(msg.room)) rooms.set(msg.room, new Set());
      const clients = rooms.get(msg.room);

      // Notify existing peers that someone joined
      for (const client of clients) {
        if (client !== ws && client.readyState === 1) {
          try {
            client.send(JSON.stringify({ type: "peer-joined", room: msg.room }));
            console.log("📢 Sent peer-joined to existing peer");
          } catch (e) {
            console.error("❌ Error sending peer-joined:", e);
          }
        }
      }

      // Add ws to room after notifying
      clients.add(ws);
      return;
    }

    // Relay messages: offer / answer / candidate
    if (!ws.room) return;
    const clients = rooms.get(ws.room);
    if (!clients) return;

    for (const client of clients) {
      if (client !== ws && client.readyState === 1) {
        try {
          client.send(JSON.stringify(msg));
          console.log(`➡️ Relayed ${msg.type} to peer`);
        } catch (e) {
          console.error("❌ Relay error:", e);
        }
      }
    }
  });

  ws.on("close", () => {
    console.log("❎ WebSocket disconnected");
    if (ws.room && rooms.has(ws.room)) {
      rooms.get(ws.room).delete(ws);
      if (rooms.get(ws.room).size === 0) {
        rooms.delete(ws.room);
        console.log("🗑 Room deleted (empty)");
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🔥 MeetShare signaling server running on port ${PORT}`)
);
