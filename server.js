const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  // 50 MB file + encryption/Base64 overhead ke liye margin
  maxHttpBufferSize: 75 * 1024 * 1024
});

app.use(express.static("public"));

/*
==================================================
SETTINGS
==================================================
*/

const ROOM_IDLE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_PEOPLE = 2;


/*
==================================================
ROOM STRUCTURE

rooms = Map(
  roomId => {
    participants: Map(
      participantToken => {
        socketId,
        connected,
        lastSeen,
        lastActive
      }
    ),

    messages: [
      encrypted messages
    ],

    timer
  }
)
==================================================
*/

const rooms = new Map();


/*
==================================================
ROOM ID
==================================================
*/

function createRoomId() {
  return crypto.randomBytes(7).toString("base64url");
}


/*
==================================================
PARTICIPANT TOKEN

Ye password nahi hai.

Ye sirf browser/device ko A ya B ke
participant ke roop mein recognize karne ke
liye temporary identity hai.
==================================================
*/

function createParticipantToken() {
  return crypto.randomBytes(24).toString("base64url");
}


/*
==================================================
GET ROOM
==================================================
*/

function getRoom(roomId) {
  return rooms.get(
    String(roomId || "").trim()
  );
}


/*
==================================================
CHECK ACTIVE CONNECTIONS
==================================================
*/

function hasConnectedPeople(room) {
  for (const participant of room.participants.values()) {
    if (participant.connected) {
      return true;
    }
  }

  return false;
}


/*
==================================================
DESTROY ROOM
==================================================
*/

function destroyRoom(roomId) {
  const room = rooms.get(roomId);

  if (!room) {
    return;
  }

  clearTimeout(room.timer);

  rooms.delete(roomId);

  io.to(roomId).emit("room-ended");
}


/*
==================================================
START / RESET 5 MINUTE EXPIRY TIMER

Room tabhi expire hoga jab koi bhi connected
participant nahi hoga.

Agar 5 min ke andar koi wapas aa gaya:
timer cancel ho jayega.
==================================================
*/

function scheduleRoomExpiry(roomId) {
  const room = rooms.get(roomId);

  if (!room) {
    return;
  }

  clearTimeout(room.timer);

  if (hasConnectedPeople(room)) {
    room.timer = null;
    return;
  }

  room.timer = setTimeout(() => {

    const currentRoom = rooms.get(roomId);

    if (!currentRoom) {
      return;
    }

    if (!hasConnectedPeople(currentRoom)) {
      destroyRoom(roomId);
    } else {
      scheduleRoomExpiry(roomId);
    }

  }, ROOM_IDLE_TTL);
}


/*
==================================================
FIND PARTICIPANT BY SOCKET
==================================================
*/

function findParticipant(room, socketId) {

  if (!room) {
    return null;
  }

  for (const [token, participant] of room.participants) {

    if (participant.socketId === socketId) {

      return {
        token,
        participant
      };
    }
  }

  return null;
}


/*
==================================================
FIND PARTICIPANT BY TOKEN
==================================================
*/

function getParticipant(room, token) {

  if (!room || !token) {
    return null;
  }

  return room.participants.get(token) || null;
}


/*
==================================================
CREATE MESSAGE ID
==================================================
*/

function createMessageId() {
  return crypto.randomBytes(12).toString("hex");
}


/*
==================================================
BROADCAST PEER STATUS
==================================================
*/

function broadcastPresence(roomId) {

  const room = rooms.get(roomId);

  if (!room) {
    return;
  }

  const connectedParticipants = [];

  for (const [token, participant] of room.participants) {

    if (participant.connected) {

      connectedParticipants.push({
        token,
        connected: true,
        lastSeen: participant.lastSeen || null
      });

    }
  }

  io.to(roomId).emit(
    "presence",
    connectedParticipants
  );
}


/*
==================================================
BROADCAST SEEN STATUS
==================================================
*/

function broadcastSeen(roomId, token, timestamp) {

  const room = rooms.get(roomId);

  if (!room) {
    return;
  }

  for (const [otherToken, participant] of room.participants) {

    if (
      otherToken !== token &&
      participant.connected
    ) {

      io.to(participant.socketId).emit(
        "peer-seen",
        {
          timestamp
        }
      );
    }
  }
}


/*
==================================================
SOCKET CONNECTION
==================================================
*/

io.on("connection", (socket) => {


  /*
  ================================================
  CREATE ROOM
  ================================================
  */

  socket.on("create-room", (reply) => {

    const roomId = createRoomId();

    const participantToken =
      createParticipantToken();

    const room = {

      participants: new Map(),

      messages: [],

      timer: null

    };


    room.participants.set(
      participantToken,
      {
        socketId: socket.id,
        connected: true,
        lastSeen: Date.now(),
        lastActive: Date.now()
      }
    );


    rooms.set(
      roomId,
      room
    );


    socket.join(roomId);


    reply({
      ok: true,
      roomId,
      participantToken
    });

  });


  /*
  ================================================
  JOIN / RECONNECT ROOM
  ================================================
  */

  socket.on(
    "join-room",
    (
      {
        roomId,
        participantToken
      },
      reply
    ) => {

      const room =
        getRoom(roomId);


      /*
      Room doesn't exist
      */

      if (!room) {

        reply({
          ok: false,
          error:
            "Link expired or room not found."
        });

        return;
      }


      let token =
        String(
          participantToken || ""
        ).trim();


      /*
      ============================================
      RECONNECT EXISTING PARTICIPANT
      ============================================
      */

      if (
        token &&
        room.participants.has(token)
      ) {

        const participant =
          room.participants.get(token);

        participant.socketId =
          socket.id;

        participant.connected =
          true;

        participant.lastActive =
          Date.now();

        participant.lastSeen =
          Date.now();

        socket.join(roomId);

        clearTimeout(room.timer);

        room.timer = null;


        /*
        Send complete encrypted history
        */

        reply({
          ok: true,
          roomId,
          participantToken: token,
          history: room.messages
        });


        socket.to(roomId).emit(
          "peer-joined"
        );


        broadcastPresence(roomId);

        return;
      }


      /*
      ============================================
      NEW PERSON
      ============================================
      */

      let peopleCount =
        room.participants.size;


      if (peopleCount >= MAX_PEOPLE) {

        reply({
          ok: false,
          error:
            "This chat already has 2 people."
        });

        return;
      }


      const newToken =
        createParticipantToken();


      room.participants.set(
        newToken,
        {
          socketId: socket.id,
          connected: true,
          lastSeen: Date.now(),
          lastActive: Date.now()
        }
      );


      socket.join(roomId);


      clearTimeout(room.timer);

      room.timer = null;


      /*
      Send existing encrypted messages
      */

      reply({
        ok: true,
        roomId,
        participantToken: newToken,
        history: room.messages
      });


      socket.to(roomId).emit(
        "peer-joined"
      );


      broadcastPresence(roomId);

    }
  );


  /*
  ================================================
  MESSAGE
  ================================================
  */

  socket.on(
    "message",
    (
      {
        roomId,
        payload
      },
      reply
    ) => {

      const room =
        getRoom(roomId);


      if (!room) {

        if (reply) {
          reply({
            ok: false,
            error:
              "Chat has expired."
          });
        }

        return;
      }


      const found =
        findParticipant(
          room,
          socket.id
        );


      if (!found) {

        if (reply) {
          reply({
            ok: false,
            error:
              "Not connected to this chat."
          });
        }

        return;
      }


      /*
      Update activity
      */

      found.participant.lastActive =
        Date.now();


      /*
      Add message ID + timestamp

      Payload remains encrypted.
      Server cannot decrypt it.
      */

      const message = {

        id: createMessageId(),

        sender: found.token,

        timestamp: Date.now(),

        payload

      };


      /*
      Temporary encrypted history
      */

      room.messages.push(
        message
      );


      /*
      Send only to the other person
      */

      socket.to(roomId).emit(
        "message",
        message
      );


      if (reply) {

        reply({
          ok: true
        });

      }

    }
  );


  /*
  ================================================
  TYPING
  ================================================
  */

  socket.on(
    "typing",
    (
      {
        roomId,
        value
      }
    ) => {

      const room =
        getRoom(roomId);

      if (!room) {
        return;
      }

      const found =
        findParticipant(
          room,
          socket.id
        );

      if (!found) {
        return;
      }


      found.participant.lastActive =
        Date.now();


      socket.to(roomId).emit(
        "typing",
        {
          value: !!value
        }
      );

    }
  );


  /*
  ================================================
  SEEN
  ================================================
  */

  socket.on(
    "seen",
    (
      {
        roomId,
        timestamp
      }
    ) => {

      const room =
        getRoom(roomId);

      if (!room) {
        return;
      }


      const found =
        findParticipant(
          room,
          socket.id
        );

      if (!found) {
        return;
      }


      found.participant.lastSeen =
        timestamp || Date.now();


      found.participant.lastActive =
        Date.now();


      broadcastSeen(
        roomId,
        found.token,
        found.participant.lastSeen
      );

    }
  );


  /*
  ================================================
  END CHAT
  ================================================
  */

  socket.on(
    "end-room",
    ({ roomId }) => {

      const room =
        getRoom(roomId);

      if (!room) {
        return;
      }


      const found =
        findParticipant(
          room,
          socket.id
        );

      if (!found) {
        return;
      }


      /*
      Creator/any connected participant
      can manually end the chat.
      */

      destroyRoom(roomId);

    }
  );


  /*
  ================================================
  DISCONNECT
  ================================================
  */

  socket.on(
    "disconnect",
    () => {

      /*
      Find which participant disconnected.
      */

      for (
        const [roomId, room]
        of rooms
      ) {

        const found =
          findParticipant(
            room,
            socket.id
          );


        if (!found) {
          continue;
        }


        const participant =
          found.participant;


        participant.connected =
          false;

        participant.socketId =
          null;

        participant.lastActive =
          Date.now();


        /*
        Tell other person
        */

        socket.to(roomId).emit(
          "peer-left",
          {
            lastActive:
              participant.lastActive
          }
        );


        broadcastPresence(
          roomId
        );


        /*
        Start 5 minute countdown.
        */

        scheduleRoomExpiry(
          roomId
        );

        break;
      }

    }
  );

});


/*
==================================================
SERVER START
==================================================
*/

const PORT =
  process.env.PORT || 3000;

server.listen(
  PORT,
  () => {
    console.log(
      `Private chat running on port ${PORT}`
    );
  }
);
