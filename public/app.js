// public/app.js

// UI elements
const drop = document.getElementById("drop");
const chooseBtn = document.getElementById("chooseBtn");
const fileInput = document.getElementById("fileInput");
const createBtn = document.getElementById("createBtn");
const fileInfo = document.getElementById("fileInfo");
const fileNameDiv = document.getElementById("fileName");
const shareUrlInput = document.getElementById("shareUrl");
const copyBtn = document.getElementById("copyBtn");
const linkArea = document.getElementById("linkArea");
const status = document.getElementById("status");
const receivedList = document.getElementById("receivedList");

let files = [];
let pc = null;
let dataChannel = null;
let ws = null;
let roomId = null;
let isSender = false;

// WebSocket URL (same host)
const WS_URL = (() => {
  const loc = window.location;
  return (loc.protocol === "https:" ? "wss:" : "ws:") + "//" + loc.host;
})();

// Choose file
chooseBtn.onclick = () => fileInput.click();
fileInput.onchange = e => {
  if (e.target.files.length) {
    files = Array.from(e.target.files);
    showFiles();
    createBtn.disabled = false;
  }
};

// Drag & drop
["dragenter", "dragover"].forEach(ev =>
  drop.addEventListener(ev, e => {
    e.preventDefault();
    drop.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach(ev =>
  drop.addEventListener(ev, e => {
    e.preventDefault();
    drop.classList.remove("dragover");
  })
);

drop.addEventListener("drop", e => {
  const dt = e.dataTransfer;
  if (!dt) return;
  files = Array.from(dt.files);
  showFiles();
  createBtn.disabled = false;
});

// Display selected files
function showFiles() {
  fileInfo.classList.remove("hidden");
  fileNameDiv.textContent = files
    .map(f => `${f.name} (${Math.round(f.size / 1024)} KB)`)
    .join(", ");
}

// Generate random room ID
function genId(len = 12) {
  const s = "abcdefghijklmnopqrstuvwxyz0123456789";
  let r = "";
  for (let i = 0; i < len; i++) r += s[Math.floor(Math.random() * s.length)];
  return r;
}

// Connect WebSocket
function connectWS(onOpen) {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log("🔗 WS connected");
    onOpen && onOpen();
  };

  ws.onclose = () => console.log("🔌 WS disconnected");

  ws.onerror = e => console.error("❌ WS error:", e);

  ws.onmessage = async event => {
    console.log("📨 WS raw:", event.data);

    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    console.log("📨 WS parsed:", msg);

    if (msg.type === "peer-joined" && isSender) {
      console.log("👤 Peer joined — creating offer");
      startSender();
    }

    if (msg.type === "offer" && !isSender) {
      handleOffer(msg);
    }

    if (msg.type === "answer" && isSender) {
      await pc.setRemoteDescription(new RTCSessionDescription(msg.answer));
      console.log("📩 Answer received & set");
    }

    if (msg.type === "candidate") {
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch (e) {
        console.error("❌ ICE add error", e);
      }
    }
  };
}

// Send signaling message
function send(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

// ----- SENDER -----
async function startSender() {
  if (pc) return; // avoid duplicates

  console.log("🚀 Creating RTCPeerConnection (sender)");

  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  // Create DataChannel
  dataChannel = pc.createDataChannel("file");
  dataChannel.binaryType = "arraybuffer";

  dataChannel.onopen = () => {
    console.log("📡 DataChannel OPEN");
    status.textContent = "Sending file...";
    sendChunks();
  };

  dataChannel.onclose = () => console.log("📡 DataChannel CLOSED");

  // ICE
  pc.onicecandidate = e => {
    if (e.candidate)
      send({ type: "candidate", room: roomId, candidate: e.candidate });
  };

  // Offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send({ type: "offer", room: roomId, offer });
}

// Send files (chunked)
async function sendChunks() {
  const CHUNK = 64 * 1024;

  // Manifest
  const manifest = files.map(f => ({
    name: f.name,
    size: f.size,
    type: f.type,
  }));

  dataChannel.send(JSON.stringify({ meta: "manifest", files: manifest }));

  for (const f of files) {
    let offset = 0;
    while (offset < f.size) {
      const slice = f.slice(offset, offset + CHUNK);
      const ab = await slice.arrayBuffer();
      dataChannel.send(ab);

      offset += CHUNK;

      // Prevent buffer overflow
      while (dataChannel.bufferedAmount > 512 * 1024) {
        await new Promise(r => setTimeout(r, 30));
      }
    }

    dataChannel.send(JSON.stringify({ meta: "file-done", name: f.name }));
  }

  dataChannel.send(JSON.stringify({ meta: "all-done" }));

  status.textContent = "File sent.";
}

// ----- RECEIVER -----
async function handleOffer(msg) {
  console.log("📨 Received offer");

  roomId = msg.room;

  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  pc.ondatachannel = e => {
    console.log("📡 Receiver DataChannel");
    dataChannel = e.channel;
    dataChannel.binaryType = "arraybuffer";
    setupReceiver();
  };

  pc.onicecandidate = e => {
    if (e.candidate)
      send({ type: "candidate", room: roomId, candidate: e.candidate });
  };

  await pc.setRemoteDescription(new RTCSessionDescription(msg.offer));

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  send({ type: "answer", room: roomId, answer });
}

// --------------------------
// RECEIVER FILE ASSEMBLY
// --------------------------

let incomingFiles = [];
let index = 0;

function setupReceiver() {
  console.log("🔧 Setting up receiver");

  dataChannel.onmessage = e => {
    if (typeof e.data === "string") {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      if (msg.meta === "manifest") {
        incomingFiles = msg.files.map(f => ({
          name: f.name,
          size: f.size,
          type: f.type,
          chunks: [],
        }));
        status.textContent = "Receiving files...";
      }

      if (msg.meta === "file-done") index++;

      if (msg.meta === "all-done") {
        finalizeFiles();
      }

      return;
    }

    // Binary chunk
    incomingFiles[index].chunks.push(e.data);
  };
}

function finalizeFiles() {
  receivedList.innerHTML = "";

  incomingFiles.forEach(f => {
    const blob = new Blob(f.chunks, { type: f.type || "application/octet-stream" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    a.textContent = `Download ${f.name}`;
    a.className = "download-btn";

    receivedList.appendChild(a);
  });

  status.textContent = "Files ready!";
}

// =========================================
// BUTTON: CREATE TRANSFER
// =========================================

createBtn.onclick = () => {
  roomId = genId();
  isSender = true;

  connectWS(() => {
    send({ type: "join", room: roomId });

    const link = new URL(location.href);
    link.searchParams.set("room", roomId);
    shareUrlInput.value = link.toString();

    linkArea.classList.remove("hidden");
    navigator.clipboard.writeText(link.toString());

    status.textContent = "Waiting for receiver...";
  });
};

// =========================================
// RECEIVER: join automatically
// =========================================

window.onload = () => {
  const url = new URL(location.href);
  const r = url.searchParams.get("room");
  if (r) {
    roomId = r;
    isSender = false;

    connectWS(() => {
      send({ type: "join", room: roomId });
      status.textContent = "Joined room — waiting for offer...";
    });

    createBtn.style.display = "none";
  }
};
