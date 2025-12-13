# MeetShare
WEB : https://meetshare.onrender.com
Peer-to-peer file sharing (MeetShare). Static frontend served by Express and a minimal WebSocket-based signaling server. Files are transferred P2P over WebRTC DataChannels — no server-side storage.
![image alt](https://github.com/me2-z/meetshare/blob/3839c79abca9e69729dafb9d38e66611bd0ffd60/websitelook.png)
## Deploy
1. Push repo to GitHub.
2. Connect repo on Render.com (New → Web Service). Render detects `.render.yaml`.
3. Deploy. URL will be like `https://your-app.onrender.com`.

## Usage
- Sender: open site, choose file, click "Create transfer & get link", copy link and share.
- Receiver: open link, wait for download link to appear and click to download.


