const socket = io();

const $ = (id) => document.getElementById(id);

let roomId = null;
let key = null;
let participantToken = null;

let connected = false;
let typingTimer = null;


/*
==================================================
HELPERS
==================================================
*/

function toast(message) {

  $("toast").textContent =
    message;

  $("toast").style.display =
    "block";

  clearTimeout(
    toast.timer
  );

  toast.timer =
    setTimeout(() => {

      $("toast").style.display =
        "none";

    }, 2400);
}


/*
==================================================
TIME FORMAT
==================================================
*/

function formatSeen(timestamp) {

  if (!timestamp) {
    return "Seen";
  }

  const seconds =
    Math.floor(
      (Date.now() - timestamp) / 1000
    );


  if (seconds < 10) {
    return "Seen just now";
  }


  if (seconds < 60) {
    return `Seen ${seconds} sec ago`;
  }


  const minutes =
    Math.floor(
      seconds / 60
    );


  if (minutes === 1) {
    return "Seen 1 min ago";
  }


  if (minutes < 60) {
    return `Seen ${minutes} min ago`;
  }


  const hours =
    Math.floor(
      minutes / 60
    );


  if (hours === 1) {
    return "Seen 1 hour ago";
  }


  return `Seen ${hours} hours ago`;
}


/*
==================================================
BASE64
==================================================
*/

function b64(bytes) {

  let binary = "";

  bytes.forEach(
    (x) => {
      binary +=
        String.fromCharCode(x);
    }
  );

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}


function ub64(value) {

  value =
    value
      .replaceAll("-", "+")
      .replaceAll("_", "/");

  while (
    value.length % 4
  ) {
    value += "=";
  }

  return Uint8Array.from(
    atob(value),
    (c) =>
      c.charCodeAt(0)
  );
}


/*
==================================================
PASSWORD KEY
==================================================
*/

async function derive(
  password,
  room
) {

  const base =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder()
        .encode(password),
      {
        name: "PBKDF2"
      },
      false,
      ["deriveKey"]
    );


  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",

      salt:
        new TextEncoder()
          .encode(
            "private-chat-v2:" +
            room
          ),

      iterations: 150000,

      hash: "SHA-256"
    },

    base,

    {
      name: "AES-GCM",
      length: 256
    },

    false,

    [
      "encrypt",
      "decrypt"
    ]
  );
}


/*
==================================================
OUTER ENCRYPTION
==================================================
*/

async function encryptObject(
  object
) {

  if (!key) {
    throw new Error(
      "Encryption key missing"
    );
  }


  const iv =
    crypto.getRandomValues(
      new Uint8Array(12)
    );


  const raw =
    new TextEncoder()
      .encode(
        JSON.stringify(object)
      );


  const encrypted =
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv
      },
      key,
      raw
    );


  return {

    iv: b64(iv),

    data:
      b64(
        new Uint8Array(
          encrypted
        )
      )
  };
}


/*
==================================================
OUTER DECRYPTION
==================================================
*/

async function decryptObject(
  packet
) {

  try {

    if (
      !key ||
      !packet
    ) {
      return null;
    }


    const decrypted =
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",

          iv:
            ub64(
              packet.iv
            )
        },

        key,

        ub64(
          packet.data
        )
      );


    return JSON.parse(
      new TextDecoder()
        .decode(
          decrypted
        )
    );

  } catch (error) {

    return null;
  }
}


/*
==================================================
SAVE PARTICIPANT TOKEN
==================================================
*/

function saveToken(
  room,
  token
) {

  try {

    localStorage.setItem(
      "privateChatToken:" +
      room,
      token
    );

  } catch (error) {}
}


function getSavedToken(
  room
) {

  try {

    return localStorage.getItem(
      "privateChatToken:" +
      room
    );

  } catch (error) {

    return null;
  }
}


/*
==================================================
DELETE TOKEN
==================================================
*/

function removeSavedToken(
  room
) {

  try {

    localStorage.removeItem(
      "privateChatToken:" +
      room
    );

  } catch (error) {}
}


/*
==================================================
OPEN CHAT
==================================================
*/

function openChat(
  id,
  invite
) {

  roomId = id;

  $("home")
    .classList
    .add("hidden");

  $("chat")
    .classList
    .remove("hidden");


  $("invite")
    .classList
    .toggle(
      "hidden",
      !invite
    );


  $("inviteText")
    .textContent =
      invite || "";


  $("msgs").innerHTML =
    "";


  setConnection(
    false
  );
}


/*
==================================================
CONNECTION
==================================================
*/

function setConnection(
  value
) {

  connected =
    value;


  $("state")
    .textContent =
      value
        ? "Connected • encrypted"
        : "User inactive";


  $("text")
    .disabled =
      !value;


  $("file")
    .disabled =
      !value;


  $("send")
    .disabled =
      !value;
}


/*
==================================================
PASSWORD MODAL
==================================================
*/

function askPassword(
  title,
  description,
  callback
) {

  $("modalTitle")
    .textContent =
      title;


  $("modalDesc")
    .textContent =
      description;


  $("password")
    .value =
      "";


  $("modal")
    .classList
    .remove("hidden");


  $("password")
    .focus();


  $("modalOk")
    .onclick =
      () => {

        const password =
          $("password")
            .value
            .trim();


        if (!password) {

          toast(
            "Enter password"
          );

          return;
        }


        $("modal")
          .classList
          .add("hidden");


        callback(
          password
        );
      };
}


/*
==================================================
CREATE ROOM
==================================================
*/

$("create").onclick =
  () => {

    socket.emit(
      "create-room",
      (result) => {

        if (!result.ok) {

          toast(
            "Could not create room"
          );

          return;
        }


        roomId =
          result.roomId;


        participantToken =
          result.participantToken;


        saveToken(
          roomId,
          participantToken
        );


        const invite =
          location.origin +
          "/?room=" +
          encodeURIComponent(
            roomId
          );


        openChat(
          roomId,
          invite
        );


        askPassword(

          "Set chat password",

          "Give this password to the other person. Example: 2300",

          async (password) => {

            try {

              key =
                await derive(
                  password,
                  roomId
                );


              setConnection(
                false
              );


              $("invite")
                .classList
                .remove(
                  "hidden"
                );


              toast(
                "Send link + password"
              );

            } catch (error) {

              toast(
                "Could not create secure key"
              );
            }

          }
        );

      }
    );
  };


/*
==================================================
JOIN / RECONNECT
==================================================
*/

$("join").onclick =
  () => {

    const value =
      $("code")
        .value
        .trim();


    let id =
      value;


    try {

      if (
        value.includes(
          "?room="
        )
      ) {

        id =
          new URL(
            value
          )
            .searchParams
            .get(
              "room"
            );
      }

    } catch (error) {}


    if (!id) {

      toast(
        "Paste chat link or room code"
      );

      return;
    }


    askPassword(

      "Chat password",

      "Enter the password given by the creator",

      (password) => {


        /*
        Check whether this browser
        already has participant identity.
        */

        const savedToken =
          getSavedToken(
            id
          );


        socket.emit(

          "join-room",

          {
            roomId:
              id,

            participantToken:
              savedToken || null
          },

          async (result) => {


            if (!result.ok) {

              toast(
                result.error
              );

              return;
            }


            try {

              roomId =
                id;


              participantToken =
                result.participantToken;


              saveToken(
                roomId,
                participantToken
              );


              key =
                await derive(
                  password,
                  roomId
                );


              openChat(
                roomId,
                null
              );


              setConnection(
                true
              );


              /*
              Restore old messages.
              */

              if (
                Array.isArray(
                  result.history
                )
              ) {

                await restoreHistory(
                  result.history
                );
              }


              markSeen();


              toast(
                "Connected • chat restored"
              );

            } catch (error) {

              console.error(
                error
              );

              toast(
                "Could not open chat"
              );
            }

          }
        );

      }
    );
  };


/*
==================================================
RESTORE CHAT HISTORY
==================================================
*/

async function restoreHistory(
  history
) {

  for (
    const message
    of history
  ) {

    /*
    Don't show messages that
    belong to current participant
    twice if needed.
    */

    const decrypted =
      await decryptObject(
        message.payload
      );


    if (!decrypted) {
      continue;
    }


    if (
      decrypted.type === "text"
    ) {

      addText(
        decrypted.text,

        message.sender ===
        participantToken,

        message.timestamp
      );

    } else if (
      decrypted.type === "file"
    ) {

      await addFile(
        decrypted,

        message.sender ===
        participantToken,

        message.timestamp
      );
    }
  }
}


/*
==================================================
COPY LINK
==================================================
*/

$("copy").onclick =
  async () => {

    try {

      await navigator
        .clipboard
        .writeText(
          $("inviteText")
            .textContent
        );


      toast(
        "Link copied"
      );

    } catch (error) {

      toast(
        "Copy failed"
      );
    }
  };


/*
==================================================
SEND TEXT
==================================================
*/

$("form").onsubmit =
  async (event) => {

    event.preventDefault();


    const text =
      $("text")
        .value
        .trim();


    if (!text) {
      return;
    }


    if (
      !connected ||
      !key
    ) {

      toast(
        "User inactive"
      );

      return;
    }


    try {

      const encrypted =
        await encryptObject({

          type:
            "text",

          text:
            text
        });


      socket.emit(

        "message",

        {
          roomId:
            roomId,

          payload:
            encrypted
        },

        (result) => {

          if (
            result &&
            !result.ok
          ) {

            toast(
              "Message failed"
            );
          }
        }
      );


      addText(
        text,
        true,
        Date.now()
      );


      $("text")
        .value =
          "";


      markSeen();


    } catch (error) {

      console.error(
        error
      );

      toast(
        "Could not send message"
      );
    }
  };


/*
==================================================
TYPING
==================================================
*/

$("text").oninput =
  () => {

    if (
      !connected
    ) {
      return;
    }


    socket.emit(
      "typing",
      {
        roomId:
          roomId,

        value:
          true
      }
    );


    clearTimeout(
      typingTimer
    );


    typingTimer =
      setTimeout(
        () => {

          socket.emit(
            "typing",
            {
              roomId:
                roomId,

              value:
                false
            }
          );

        },
        700
      );
  };


/*
==================================================
PHOTO / VIDEO
==================================================
*/

$("file").onchange =
  async () => {

    const file =
      $("file")
        .files[0];


    if (!file) {
      return;
    }


    if (
      !connected ||
      !key
    ) {

      toast(
        "User inactive"
      );

      $("file")
        .value =
          "";

      return;
    }


    /*
    50 MB maximum
    */

    if (
      file.size >
      50 * 1024 * 1024
    ) {

      toast(
        "Maximum file size is 50 MB"
      );

      $("file")
        .value =
          "";

      return;
    }


    /*
    Only image and video
    */

    if (
      !file.type.startsWith(
        "image/"
      ) &&
      !file.type.startsWith(
        "video/"
      )
    ) {

      toast(
        "Only photos and videos are allowed"
      );

      $("file")
        .value =
          "";

      return;
    }


    toast(
      "Encrypting & sending…"
    );


    try {

      /*
      Read file
      */

      const bytes =
        new Uint8Array(
          await file.arrayBuffer()
        );


      /*
      Encrypt file
      */

      const fileIv =
        crypto.getRandomValues(
          new Uint8Array(12)
        );


      const encryptedFile =
        await crypto.subtle.encrypt(

          {
            name:
              "AES-GCM",

            iv:
              fileIv
          },

          key,

          bytes
        );


      const fileObject = {

        type:
          "file",

        name:
          file.name,

        mime:
          file.type,

        size:
          file.size,

        iv:
          b64(
            fileIv
          ),

        data:
          b64(
            new Uint8Array(
              encryptedFile
            )
          )
      };


      /*
      Encrypt complete file object
      again as message.
      */

      const encryptedMessage =
        await encryptObject(
          fileObject
        );


      socket.emit(

        "message",

        {
          roomId:
            roomId,

          payload:
            encryptedMessage
        },

        (result) => {

          if (
            result &&
            result.ok
          ) {

            addFile(
              fileObject,
              true,
              Date.now()
            );


            toast(
              "Sent successfully"
            );

          } else {

            toast(
              "File send failed"
            );
          }
        }
      );


    } catch (error) {

      console.error(
        "FILE SEND ERROR:",
        error
      );


      toast(
        "Could not send photo/video"
      );


    } finally {

      $("file")
        .value =
          "";
    }
  };


/*
==================================================
CREATE MESSAGE BUBBLE
==================================================
*/

function createBubble(
  type
) {

  const element =
    document.createElement(
      "div"
    );


  element.className =
    "msg " + type;


  $("msgs")
    .appendChild(
      element
    );


  $("msgs")
    .scrollTop =
      $("msgs")
        .scrollHeight;


  return element;
}


/*
==================================================
ADD TEXT
==================================================
*/

function addText(
  text,
  mine,
  timestamp
) {

  const bubble =
    createBubble(
      mine
        ? "mine"
        : "theirs"
    );


  const span =
    document.createElement(
      "span"
    );


  span.textContent =
    text;


  bubble.appendChild(
    span
  );


  addTime(
    bubble,
    timestamp
  );
}


/*
==================================================
TIME
==================================================
*/

function addTime(
  element,
  timestamp
) {

  const time =
    document.createElement(
      "span"
    );


  time.className =
    "time";


  time.textContent =
    new Date(
      timestamp || Date.now()
    )
      .toLocaleTimeString(
        [],
        {
          hour:
            "2-digit",

          minute:
            "2-digit"
        }
      );


  element.appendChild(
    time
  );
}


/*
==================================================
ADD PHOTO / VIDEO
==================================================
*/

async function addFile(
  packet,
  mine,
  timestamp
) {

  try {

    const bubble =
      createBubble(
        mine
          ? "mine"
          : "theirs"
      );


    const decrypted =
      await crypto.subtle.decrypt(

        {
          name:
            "AES-GCM",

          iv:
            ub64(
              packet.iv
            )
        },

        key,

        ub64(
          packet.data
        )
      );


    const blob =
      new Blob(
        [decrypted],
        {
          type:
            packet.mime
        }
      );


    const url =
      URL.createObjectURL(
        blob
      );


    let media;


    if (
      packet.mime.startsWith(
        "video/"
      )
    ) {

      media =
        document.createElement(
          "video"
        );


      media.controls =
        true;


      media.playsInline =
        true;


      media.preload =
        "metadata";


    } else {

      media =
        document.createElement(
          "img"
        );
    }


    media.src =
      url;


    media.className =
      "media";


    bubble.appendChild(
      media
    );


    /*
    Download
    */

    const download =
      document.createElement(
        "a"
      );


    download.className =
      "download";


    download.href =
      url;


    download.download =
      packet.name;


    download.textContent =
      "Download";


    bubble.appendChild(
      download
    );


    addTime(
      bubble,
      timestamp
    );


  } catch (error) {

    console.error(
      "FILE RECEIVE ERROR:",
      error
    );


    toast(
      "Could not open photo/video"
    );
  }
}


/*
==================================================
OTHER PERSON JOINED
==================================================
*/

socket.on(
  "peer-joined",
  async () => {

    setConnection(
      true
    );


    $("invite")
      .classList
      .add("hidden");


    toast(
      "User connected"
    );


    markSeen();
  }
);


/*
==================================================
RECEIVE MESSAGE
==================================================
*/

socket.on(
  "message",
  async (message) => {

    if (!message) {
      return;
    }


    const decrypted =
      await decryptObject(
        message.payload
      );


    if (!decrypted) {

      toast(
        "Wrong password or invalid message"
      );

      return;
    }


    if (
      decrypted.type ===
      "text"
    ) {

      addText(
        decrypted.text,

        false,

        message.timestamp
      );


    } else if (
      decrypted.type ===
      "file"
    ) {

      await addFile(
        decrypted,

        false,

        message.timestamp
      );
    }


    /*
    User has seen the incoming message
    */

    markSeen();
  }
);


/*
==================================================
TYPING RECEIVED
==================================================
*/

socket.on(
  "typing",
  (data) => {

    const isTyping =
      typeof data ===
      "object"
        ? data.value
        : data;


    $("typing")
      .textContent =
        isTyping
          ? "Typing..."
          : "";
  }
);


/*
==================================================
USER LEFT / INACTIVE
==================================================
*/

socket.on(
  "peer-left",
  () => {

    setConnection(
      false
    );


    $("typing")
      .textContent =
        "";


    toast(
      "User inactive"
    );
  }
);


/*
==================================================
USER PRESENCE
==================================================
*/

socket.on(
  "presence",
  (participants) => {

    if (
      !Array.isArray(
        participants
      )
    ) {
      return;
    }


    const other =
      participants.find(
        (p) =>
          p.token !==
          participantToken
      );


    if (other) {

      setConnection(
        true
      );

    } else {

      /*
      Don't immediately mark
      inactive during initial creation.
      */

      if (
        connected
      ) {

        setConnection(
          false
        );
      }
    }
  }
);


/*
==================================================
PEER SEEN
==================================================
*/

socket.on(
  "peer-seen",
  (data) => {

    if (
      !data ||
      !data.timestamp
    ) {
      return;
    }


    updateSeenLabels(
      data.timestamp
    );
  }
);


/*
==================================================
UPDATE SEEN TEXT
==================================================
*/

function updateSeenLabels(
  timestamp
) {

  const messages =
    document.querySelectorAll(
      ".msg.mine"
    );


  messages.forEach(
    (message) => {

      let seen =
        message.querySelector(
          ".seen-status"
        );


      if (!seen) {

        seen =
          document.createElement(
            "span"
          );

        seen.className =
          "seen-status";

        message.appendChild(
          seen
        );
      }


      seen.textContent =
        formatSeen(
          timestamp
        );
    }
  );
}


/*
==================================================
MARK SEEN
==================================================
*/

function markSeen() {

  if (
    !roomId ||
    !connected
  ) {
    return;
  }


  const timestamp =
    Date.now();


  socket.emit(
    "seen",
    {
      roomId:
        roomId,

      timestamp:
        timestamp
    }
  );
}


/*
==================================================
WHEN TAB BECOMES ACTIVE
==================================================
*/

document.addEventListener(
  "visibilitychange",
  () => {

    if (
      document.visibilityState ===
      "visible"
    ) {

      markSeen();
    }
  }
);


/*
==================================================
END CHAT
==================================================
*/

$("end").onclick =
  () => {

    if (
      !roomId
    ) {
      return;
    }


    const confirmEnd =
      confirm(
        "End this chat for both people?"
      );


    if (!confirmEnd) {
      return;
    }


    socket.emit(
      "end-room",
      {
        roomId:
          roomId
      }
    );
  };


/*
==================================================
ROOM ENDED
==================================================
*/

socket.on(
  "room-ended",
  () => {

    const oldRoom =
      roomId;


    roomId =
      null;


    key =
      null;


    connected =
      false;


    participantToken =
      null;


    if (oldRoom) {

      removeSavedToken(
        oldRoom
      );
    }


    $("msgs")
      .innerHTML =
        "";


    $("typing")
      .textContent =
        "";


    $("chat")
      .classList
      .add("hidden");


    $("home")
      .classList
      .remove("hidden");


    history.replaceState(
      null,
      "",
      "/"
    );


    toast(
      "Chat ended. Link has expired."
    );
  }
);


/*
==================================================
PAGE CLOSE
==================================================

IMPORTANT:
We DO NOT delete participant token here.

This allows the same user to reconnect
within 5 minutes.
==================================================
*/

window.addEventListener(
  "beforeunload",
  () => {

    key =
      null;

    /*
    roomId and participantToken
    intentionally remain saved.
    */
  }
);
