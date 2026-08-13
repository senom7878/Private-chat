const express=require("express");
const http=require("http");
const crypto=require("crypto");
const {Server}=require("socket.io");

const app=express(), server=http.createServer(app);
const io=new Server(server,{maxHttpBufferSize: 12*1024*1024});
app.use(express.static("public"));

const rooms=new Map();
const TTL=30*60*1000;

function id(){return crypto.randomBytes(7).toString("base64url")}
function destroy(roomId){
  const r=rooms.get(roomId); if(!r)return;
  clearTimeout(r.timer); rooms.delete(roomId);
  io.to(roomId).emit("room-ended");
}
function timer(roomId){
  const r=rooms.get(roomId); if(!r)return;
  clearTimeout(r.timer); r.timer=setTimeout(()=>destroy(roomId),TTL);
}

io.on("connection",s=>{
  s.on("create-room",(reply)=>{
    const roomId=id();
    rooms.set(roomId,{sockets:new Set([s.id]),timer:null});
    s.join(roomId); timer(roomId);
    reply({ok:true,roomId});
  });

  s.on("join-room",({roomId},reply)=>{
    const r=rooms.get(String(roomId||"").trim());
    if(!r)return reply({ok:false,error:"Link expired or room not found."});
    if(r.sockets.size>=2)return reply({ok:false,error:"This chat already has 2 people."});
    r.sockets.add(s.id); s.join(roomId); timer(roomId);
    reply({ok:true});
    s.to(roomId).emit("peer-joined");
  });

  s.on("message",({roomId,payload},reply)=>{
    const r=rooms.get(roomId);
    if(!r||!r.sockets.has(s.id))return;
    s.to(roomId).emit("message",payload);
    if(reply)reply({ok:true});
  });

  s.on("typing",({roomId,value})=>{
    const r=rooms.get(roomId);
    if(r&&r.sockets.has(s.id))s.to(roomId).emit("typing",!!value);
  });

  s.on("end-room",({roomId})=>{
    const r=rooms.get(roomId);
    if(r&&r.sockets.has(s.id))destroy(roomId);
  });

  s.on("disconnect",()=>{
    for(const [roomId,r] of rooms){
      if(r.sockets.delete(s.id)){
        if(!r.sockets.size)destroy(roomId);
        else {io.to(roomId).emit("peer-left");timer(roomId);}
      }
    }
  });
});
server.listen(process.env.PORT||3000,()=>console.log("Private chat running"));
