const socket = io();

const $ = (id) => document.getElementById(id);

let roomId = null;
let key = null;
let connected = false;
let typingTimer = null;

function toast(message) {
  $("toast").textContent = message;
  $("toast").style.display = "block";

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    $("toast").style.display = "none";
  }, 2400);
}

function b64(bytes) {
  let binary = "";

  bytes.forEach((x) => {
    binary += String.fromCharCode(x);
  });

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function ub64(value) {
  value = value
    .replaceAll("-", "+")
    .replaceAll("_", "/");

  while (value.length % 4) {
    value += "=";
  }

  return Uint8Array.from(
    atob(value),
    (c) => c.charCodeAt(0)
  );
}

async function derive(password, room) {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(
        "private-chat-v2:" + room
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
    ["encrypt", "decrypt"]
  );
}

async function encryptObject(object) {
  const iv = crypto.getRandomValues(
    new Uint8Array(12)
  );

  const raw = new TextEncoder().encode(
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
    data: b64(
      new Uint8Array(encrypted)
    )
  };
}

async function decryptObject(packet) {
  try {
    const decrypted =
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: ub64(packet.iv)
        },
        key,
        ub64(packet.data)
      );

    return JSON.parse(
      new TextDecoder().decode(decrypted)
    );
  } catch (error) {
    return null;
  }
}

function openChat(id, invite) {
  roomId = id;

  $("home").classList.add("hidden");
  $("chat").classList.remove("hidden");

  $("invite").classList.toggle(
    "hidden",
    !invite
  );

  $("inviteText").textContent =
    invite || "";

  $("msgs").innerHTML = "";

  setConnection(false);
}

function setConnection(value) {
  connected = value;

  $("state").textContent = value
    ? "Connected • encrypted"
    : "Waiting for the other person…";

  $("text").disabled = !value;
  $("file").disabled = !value;
  $("send").disabled = !value;
}

function askPassword(title, description, callback) {
  $("modalTitle").textContent = title;
  $("modalDesc").textContent = description;
  $("password").value = "";

  $("modal").classList.remove("hidden");

  $("password").focus();

  $("modalOk").onclick = () => {
    const password =
      $("password").value.trim();

    if (!password) {
      toast("Enter password");
      return;
    }

    $("modal").classList.add("hidden");

    callback(password);
  };
}


/* =========================
   CREATE ROOM
========================= */

$("create").onclick = () => {

  socket.emit(
    "create-room",
    (result) => {

      if (!result.ok) {
        toast("Could not create room");
        return;
      }

      roomId = result.roomId;

      const invite =
        location.origin +
        "/?room=" +
        encodeURIComponent(roomId);

      openChat(
        roomId,
        invite
      );

      askPassword(
        "Set chat password",
        "Give this password to the other person. Example: 2300",
        async (password) => {

          key =
            await derive(
              password,
              roomId
            );

          setConnection(false);

          $("invite")
            .classList
            .remove("hidden");

          toast(
            "Send the link + password"
          );
        }
      );
    }
  );
};


/* =========================
   JOIN ROOM
========================= */

$("join").onclick = () => {

  const value =
    $("code").value.trim();

  let id = value;

  try {
    if (value.includes("?room=")) {
      id =
        new URL(value)
          .searchParams
          .get("room");
    }
  } catch (error) {}

  if (!id) {
    toast(
      "Paste the chat link or room code"
    );
    return;
  }

  askPassword(
    "Chat password",
    "Enter the password given by the creator",
    (password) => {

      socket.emit(
        "join-room",
        {
          roomId: id
        },
        async (result) => {

          if (!result.ok) {
            toast(result.error);
            return;
          }

          roomId = id;

          key =
            await derive(
              password,
              roomId
            );

          openChat(
            roomId,
            null
          );

          /*
           * IMPORTANT:
           * The joining user is also
           * connected immediately.
           */
          setConnection(true);

          toast(
            "Connected • encrypted"
          );
        }
      );
    }
  );
};


/* =========================
   COPY LINK
========================= */

$("copy").onclick = async () => {

  try {

    await navigator.clipboard.writeText(
      $("inviteText").textContent
    );

    toast("Link copied");

  } catch (error) {

    toast(
      "Copy failed"
    );
  }
};


/* =========================
   SEND TEXT
========================= */

$("form").onsubmit = async (event) => {

  event.preventDefault();

  const text =
    $("text").value.trim();

  if (!text) return;

  if (!connected) {
    toast(
      "Waiting for connection"
    );
    return;
  }

  try {

    const payload =
      await encryptObject({
        type: "text",
        text: text
      });

    socket.emit(
      "message",
      {
        roomId: roomId,
        payload: payload
      },
      (result) => {

        if (result && !result.ok) {
          toast("Message failed");
        }

      }
    );

    addText(
      text,
      true
    );

    $("text").value = "";

  } catch (error) {

    toast(
      "Could not send message"
    );
  }
};


/* =========================
   TYPING
========================= */

$("text").oninput = () => {

  if (!connected) return;

  socket.emit(
    "typing",
    {
      roomId: roomId,
      value: true
    }
  );

  clearTimeout(
    typingTimer
  );

  typingTimer =
    setTimeout(() => {

      socket.emit(
        "typing",
        {
          roomId: roomId,
          value: false
        }
      );

    }, 600);
};


/* =========================
   PHOTO / VIDEO
========================= */

$("file").onchange = async () => {

  const file =
    $("file").files[0];

  if (!file) return;

  if (!connected) {
    toast(
      "Waiting for connection"
    );

    $("file").value = "";

    return;
  }

  if (
    file.size >
    8 * 1024 * 1024
  ) {

    toast(
      "Maximum file size is 8 MB"
    );

    $("file").value = "";

    return;
  }

  if (
    !file.type.startsWith("image/") &&
    !file.type.startsWith("video/")
  ) {

    toast(
      "Only photos and videos are allowed"
    );

    $("file").value = "";

    return;
  }

  toast(
    "Encrypting & sending…"
  );

  try {

    const bytes =
      new Uint8Array(
        await file.arrayBuffer()
      );

    const iv =
      crypto.getRandomValues(
        new Uint8Array(12)
      );

    const encrypted =
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: iv
        },
        key,
        bytes
      );

    const payload = {
      type: "file",
      name: file.name,
      mime: file.type,
      size: file.size,
      iv: b64(iv),
      data: b64(
        new Uint8Array(encrypted)
      )
    };

    socket.emit(
      "message",
      {
        roomId: roomId,
        payload: payload
      },
      (result) => {

        if (result && result.ok) {

          addFile(
            payload,
            true
          );

          toast("Sent");

        } else {

          toast(
            "Send failed"
          );
        }
      }
    );

  } catch (error) {

    console.error(error);

    toast(
      "Could not send file"
    );

  } finally {

    $("file").value = "";
  }
};


/* =========================
   MESSAGE BUBBLE
========================= */

function createBubble(type) {

  const element =
    document.createElement("div");

  element.className =
    "msg " + type;

  $("msgs").appendChild(
    element
  );

  $("msgs").scrollTop =
    $("msgs").scrollHeight;

  return element;
}


/* =========================
   TEXT MESSAGE
========================= */

function addText(
  text,
  mine
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
    bubble
  );
}


/* =========================
   TIME
========================= */

function addTime(
  element
) {

  const time =
    document.createElement(
      "span"
    );

  time.className =
    "time";

  time.textContent =
    new Date().toLocaleTimeString(
      [],
      {
        hour: "2-digit",
        minute: "2-digit"
      }
    );

  element.appendChild(
    time
  );
}


/* =========================
   FILE MESSAGE
========================= */

async function addFile(
  packet,
  mine
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
          name: "AES-GCM",
          iv: ub64(packet.iv)
        },
        key,
        ub64(packet.data)
      );

    const blob =
      new Blob(
        [decrypted],
        {
          type: packet.mime
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

      media.controls = true;
      media.playsInline = true;

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
      bubble
    );

  } catch (error) {

    console.error(error);

    toast(
      "Could not open media"
    );
  }
}


/* =========================
   OTHER PERSON JOINED
========================= */

socket.on(
  "peer-joined",
  () => {

    setConnection(true);

    $("invite")
      .classList
      .add("hidden");

    toast(
      "The other person joined"
    );
  }
);


/* =========================
   RECEIVE MESSAGE
========================= */

socket.on(
  "message",
  async (packet) => {

    const message =
      await decryptObject(
        packet
      );

    if (!message) {

      toast(
        "Wrong password or invalid message"
      );

      return;
    }

    if (
      message.type === "text"
    ) {

      addText(
        message.text,
        false
      );

    } else if (
      message.type === "file"
    ) {

      await addFile(
        message,
        false
      );
    }
  }
);


/* =========================
   TYPING RECEIVED
========================= */

socket.on(
  "typing",
  (value) => {

    $("typing").textContent =
      value
        ? "typing…"
        : "";
  }
);


/* =========================
   OTHER PERSON LEFT
========================= */

socket.on(
  "peer-left",
  () => {

    setConnection(false);

    toast(
      "The other person left"
    );
  }
);


/* =========================
   ROOM ENDED
========================= */

socket.on(
  "room-ended",
  () => {

    roomId = null;
    key = null;
    connected = false;

    $("msgs").innerHTML = "";

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


/* =========================
   END CHAT
========================= */

$("end").onclick = () => {

  if (
    roomId &&
    confirm(
      "End this chat for both people?"
    )
  ) {

    socket.emit(
      "end-room",
      {
        roomId: roomId
      }
    );
  }
};


/* =========================
   PAGE CLOSE
========================= */

window.addEventListener(
  "beforeunload",
  () => {

    key = null;
    roomId = null;

  }
);
