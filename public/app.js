const socket=io();
const $=id=>document.getElementById(id);
let roomId=null,key=null,connected=false,typingTimer=null;

function toast(t){$("toast").textContent=t;$("toast").style.display="block";clearTimeout(toast.t);toast.t=setTimeout(()=>$("toast").style.display="none",2400)}
function b64(u){let s="";u.forEach(x=>s+=String.fromCharCode(x));return btoa(s).replaceAll("+","-").replaceAll("/","_").replaceAll("=","")}
function ub64(s){s=s.replaceAll("-","+").replaceAll("_","/");while(s.length%4)s+="=";return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function derive(password,room){
  const base=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),{name:"PBKDF2"},false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt:new TextEncoder().encode("private-chat-v2:"+room),iterations:150000,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function enc(obj){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const raw=new TextEncoder().encode(JSON.stringify(obj));
  const c=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,raw);
  return {iv:b64(iv),data:b64(new Uint8Array(c))};
}
async function dec(p){
  try{const x=await crypto.subtle.decrypt({name:"AES-GCM",iv:ub64(p.iv)},key,ub64(p.data));return JSON.parse(new TextDecoder().decode(x))}
  catch{return null}
}
function openChat(id,invite){
  roomId=id;$("home").classList.add("hidden");$("chat").classList.remove("hidden");
  $("invite").classList.toggle("hidden",!invite);$("inviteText").textContent=invite||"";
  $("msgs").innerHTML="";setConn(false);
}
function setConn(v){connected=v;$("state").textContent=v?"Connected • encrypted":"Waiting for the other person…";$("text").disabled=!v;$("file").disabled=!v;$("send").disabled=!v}

function askPassword(title,desc,cb){
  $("modalTitle").textContent=title;$("modalDesc").textContent=desc;$("password").value="";$("modal").classList.remove("hidden");
  $("password").focus();$("modalOk").onclick=()=>{const p=$("password").value.trim();if(!p)return toast("Enter password");$("modal").classList.add("hidden");cb(p)}
}
$("create").onclick=()=>socket.emit("create-room",res=>{
  if(!res.ok)return toast("Could not create room");
  roomId=res.roomId;
  const invite=location.origin+"/?room="+encodeURIComponent(roomId);
  openChat(roomId,invite);
  askPassword("Set chat password","Give this password to the other person. Example: 2300",(p)=>{key=null;derive(p,roomId).then(k=>{key=k;setConn(false);$("invite").classList.remove("hidden");toast("Send the link + password")})});
});
$("join").onclick=()=>{
  let v=$("code").value.trim(),id=v;
  try{if(v.includes("?room="))id=new URL(v).searchParams.get("room")}catch{}
  if(!id)return toast("Paste the chat link or room code");
  askPassword("Chat password","Enter the password given by the creator",(p)=>{
    socket.emit("join-room",{roomId:id},async res=>{
      if(!res.ok)return toast(res.error);
      roomId=id;key=await derive(p,roomId);openChat(roomId,null);
    })
  })
};
$("copy").onclick=async()=>{await navigator.clipboard.writeText($("inviteText").textContent);toast("Link copied")};

$("form").onsubmit=async e=>{
 e.preventDefault();const text=$("text").value.trim();if(!text||!connected)return;
 socket.emit("message",{roomId,payload:await enc({type:"text",text})});addText(text,true);$("text").value="";
};
$("text").oninput=()=>{socket.emit("typing",{roomId,value:true});clearTimeout(typingTimer);typingTimer=setTimeout(()=>socket.emit("typing",{roomId,value:false}),600)}

$("file").onchange=async()=>{
 const f=$("file").files[0];if(!f||!connected)return;
 if(f.size>8*1024*1024){toast("Maximum file size is 8 MB");$("file").value="";return}
 if(!/^image\/|^video\//.test(f.type)){toast("Only photos and videos are allowed");return}
 toast("Encrypting & sending…");
 const buf=new Uint8Array(await f.arrayBuffer());
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,buf);
 const payload={type:"file",name:f.name,mime:f.type,size:f.size,iv:b64(iv),data:b64(new Uint8Array(cipher))};
 socket.emit("message",{roomId,payload},r=>{if(r?.ok){addFile(payload,true);toast("Sent")}else toast("Send failed")});
 $("file").value="";
};

function bubble(cls){
 const d=document.createElement("div");d.className="msg "+cls;$("msgs").appendChild(d);$("msgs").scrollTop=$("msgs").scrollHeight;return d
}
function addText(t,mine){const d=bubble(mine?"mine":"theirs"),s=document.createElement("span");s.textContent=t;d.appendChild(s);time(d)}
function time(d){const t=document.createElement("span");t.className="time";t.textContent=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});d.appendChild(t)}
async function addFile(p,mine){
 const d=bubble(mine?"mine":"theirs"),img=document.createElement(p.mime.startsWith("video/")?"video":"img");
 const blob=await (async()=>{const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:ub64(p.iv)},key,ub64(p.data));return new Blob([plain],{type:p.mime})})();
 const url=URL.createObjectURL(blob);img.src=url;img.className="media";if(p.mime.startsWith("video/")){img.controls=true;img.playsInline=true}
 d.appendChild(img);const a=document.createElement("a");a.className="download";a.href=url;a.download=p.name;a.textContent="Download";d.appendChild(a);time(d)
}
socket.on("peer-joined",()=>{setConn(true);$("invite").classList.add("hidden");toast("The other person joined")});
socket.on("message",async p=>{const x=await dec(p);if(!x)return toast("Wrong password or invalid message");if(x.type==="text")addText(x.text,false);else if(x.type==="file")await addFile(x,false)});
socket.on("typing",v=>$("typing").textContent=v?"typing…":"");
socket.on("peer-left",()=>setConn(false));
socket.on("room-ended",()=>{
 roomId=null;key=null;connected=false;$("msgs").innerHTML="";$("chat").classList.add("hidden");$("home").classList.remove("hidden");history.replaceState(null,"","/");toast("Chat ended. Link has expired.")
});
$("end").onclick=()=>{if(roomId&&confirm("End this chat for both people?"))socket.emit("end-room",{roomId})};
window.addEventListener("beforeunload",()=>{key=null;roomId=null});
