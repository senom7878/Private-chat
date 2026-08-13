# Private Disappearing Chat v2

Features:
- One room, maximum two people.
- Creator creates a link and chooses a password such as 2300.
- Guest needs both the link and password.
- Password derives the AES-256-GCM encryption key in the browser.
- Text, photos and videos can be sent.
- Photos/videos are encrypted before being sent and are not stored in a database.
- Recipient can download received media.
- Server relays ciphertext only.
- Ending the chat destroys the server room and clears the UI on both connected clients.
- Empty rooms/rooms after disconnect expire automatically.
- File limit: 8 MB in this demo.

Run:
npm install
npm start
open http://localhost:3000

Important:
This is a working demo, not an audited secure messenger. The server still sees connection/room metadata and can relay encrypted payloads. A recipient can screenshot, screen-record, save files, or copy content. Deleting the room cannot erase copies already made on a device. For production, use HTTPS, strict security headers, rate limits, abuse protection, robust key verification, secure deployment, logging/privacy review, and an independent security audit.
