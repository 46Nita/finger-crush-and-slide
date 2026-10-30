const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const TUNING = Object.freeze({ roundMs: 26000, dodgeMs: 520, dodgeCooldownMs: 550,
  graceMs: 300, attackRecoveryMs: 550, jumpBonus: 0.035,
  windMs: { crush: 1100, slide: 1250 }, lockMs: 400 });

function createGameServer({ clock = Date.now, autoTick = true } = {}) {
  const rooms = new Map(), clients = new Map();
  const server = http.createServer((req, res) => {
    const name = req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0].slice(1);
    if (!/^[\w.-]+$/.test(name)) { res.writeHead(404); return res.end(); }
    fs.readFile(path.join(__dirname, 'public', name), (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(data);
    });
  });
  const wss = new WebSocketServer({ server, maxPayload: 8192 });
  const send = (ws, obj) => { if (ws?.readyState === 1) ws.send(JSON.stringify(obj)); };
  const walker = r => (r.round - 1) % 2;
  function snapshot(r) {
    return { code:r.code, phase:r.phase, round:r.round, score:r.score,
      players:r.players.map(p => ({ appearance:p.appearance, connected:p.connected })),
      roleWalker:walker(r), progress:r.progress, attack:r.attack, dodge:r.dodge,
      winner:r.winner, endsAt:r.endsAt, serverTime:clock(), rematch:r.rematch,
      paused:r.paused, notice:r.notice, impact:r.impact, outcome:r.outcome,
      nextAttackAt:r.nextAttackAt, tuning:TUNING };
  }
  function broadcast(r) { for (const p of r.players) send(p.ws, {type:'state', state:snapshot(r)}); }
  function phase(r, name, ms) {
    r.phase=name; r.endsAt=ms ? clock()+ms : null; r.attack=null; r.dodge=null;
    r.lastDodge=0; r.nextAttackAt=0; r.lastTick=clock();
  }
  function startRound(r) {
    r.impact=null; r.outcome=null; r.progress=0; r.notice=''; r.noticeUntil=0;
    phase(r,'tutorial',r.round===1 ? 10000 : 3500);
  }
  function finish(r, winner, why) {
    r.score[winner]++; r.winner=winner; r.notice=why;
    r.outcome={ at:clock(), walkerWon:winner===walker(r) };
    phase(r,'roundEnd',3500);
    if(r.score[winner]>=2) { r.phase='matchEnd'; r.endsAt=null; r.rematch=[false,false]; }
  }
  function makeCode() {
    const chars='ACDEFGHJKMNPQRTUVWXY3469'; let code;
    do { code=Array.from({length:5},()=>chars[crypto.randomInt(chars.length)]).join(''); } while(rooms.has(code));
    return code;
  }
  function pause(r) { if(!r.paused) { r.paused=clock(); broadcast(r); } }
  function resume(r) {
    if(!r.paused || r.players.length!==2 || r.players.some(p=>!p.connected)) return;
    const delta=clock()-r.paused;
    if(r.endsAt)r.endsAt+=delta;
    if(r.attack){r.attack.at+=delta;r.attack.resolve+=delta;r.attack.lockAt+=delta;}
    if(r.dodge){r.dodge.start+=delta;r.dodge.end+=delta;}
    if(r.impact)r.impact.at+=delta;
    if(r.outcome)r.outcome.at+=delta;
    r.lastDodge+=delta;r.nextAttackAt+=delta;if(r.noticeUntil)r.noticeUntil+=delta;
    r.lastTick=clock();r.paused=null;broadcast(r);
  }
  function appearance(a) {
    return { color:['#ffcc4d','#8d5bdb','#34c7a4','#f37d74','#67b5f5'].includes(a?.color)?a.color:'#ffcc4d',
      gender:['masculine','feminine','neutral'].includes(a?.gender)?a.gender:'neutral',
      finger:['#f3bc95','#b67652','#754631','#efcfb4'].includes(a?.finger)?a.finger:'#b67652' };
  }
  function join(r,ws,a) {
    const token=crypto.randomBytes(18).toString('hex'),index=r.players.length;
    r.players.push({token,ws,connected:true,appearance:appearance(a)});clients.set(ws,{room:r,index});
    send(ws,{type:'joined',code:r.code,token,index});broadcast(r);
  }
  wss.on('connection',ws=>{
    ws.on('error',()=>{});
    ws.alive=true;ws.on('pong',()=>ws.alive=true);
    ws.on('message',raw=>{
      let m;try{m=JSON.parse(raw)}catch{return}if(!m||typeof m!=='object')return;
      if(m.type==='ping')return send(ws,{type:'pong',clientTime:m.clientTime,serverTime:clock()});
      if(m.type==='create') {
        if(clients.has(ws))return;
        const r={code:makeCode(),players:[],phase:'lobby',round:1,score:[0,0],progress:0,
          paused:null,rematch:[false,false],nextAttackAt:0,createdAt:clock()};
        rooms.set(r.code,r);join(r,ws,m.appearance);return;
      }
      if(m.type==='join') {
        if(clients.has(ws))return;
        const r=rooms.get(String(m.code||'').trim().toUpperCase());
        if(!r)return send(ws,{type:'error',message:'Room code not found. Create a new room or check your invite.'});
        const index=r.players.findIndex(p=>m.token&&p.token===m.token);
        if(index>=0) {
          const p=r.players[index];if(p.ws&&p.ws!==ws){clients.delete(p.ws);p.ws.close();}
          p.ws=ws;p.connected=true;clients.set(ws,{room:r,index});
          send(ws,{type:'joined',code:r.code,token:p.token,index});resume(r);broadcast(r);return;
        }
        if(r.players.length>=2)return send(ws,{type:'error',message:'This room is full. Ask your friend to create a new room.'});
        join(r,ws,m.appearance);return;
      }
      const c=clients.get(ws);if(!c)return;
      const {room:r,index}=c,now=clock();
      if(m.type==='start'&&index===0&&r.players.length===2&&r.players.every(p=>p.connected)&&r.phase==='lobby') {startRound(r);broadcast(r);}
      if(m.type==='attack'&&r.phase==='playing'&&!r.paused&&index!==walker(r)&&
        ['slide','crush'].includes(m.kind)&&!r.attack&&now>=r.nextAttackAt) {
        r.impact=null;
        r.attack={kind:m.kind,at:now,resolve:now+TUNING.windMs[m.kind],lockAt:now+TUNING.windMs[m.kind]-TUNING.lockMs,target:r.progress,locked:false};
        broadcast(r);
      }
      if(m.type==='dodge'&&r.phase==='playing'&&!r.paused&&index===walker(r)) {
        const kind=m.kind;let at=Number(m.at);
        if(!['jump','slide'].includes(kind)||!Number.isFinite(at))return;
        at=Math.max(now-TUNING.graceMs,Math.min(now+50,at));
        if(at-r.lastDodge<TUNING.dodgeCooldownMs) return send(ws,{type:'dodgeAck',accepted:false,dodge:r.dodge});
        r.lastDodge=at;r.dodge={kind,direction:kind==='jump'?'right':'left',start:at,end:at+TUNING.dodgeMs};
        send(ws,{type:'dodgeAck',accepted:true,dodge:r.dodge});broadcast(r);
      }
      if(m.type==='rematch'&&r.phase==='matchEnd') {
        r.rematch[index]=true;
        if(r.rematch.every(Boolean)){r.round=1;r.score=[0,0];r.rematch=[false,false];startRound(r);}
        broadcast(r);
      }
    });
    ws.on('close',()=>{
      const c=clients.get(ws);clients.delete(ws);if(!c)return;
      const p=c.room.players[c.index];if(p.ws!==ws)return;p.connected=false;p.ws=null;pause(c.room);
    });
  });
  function tick() {
    const now=clock();
    for(const r of rooms.values()) {
      if(r.paused) {
        if(now-r.paused>120000){for(const p of r.players)send(p.ws,{type:'expired',message:'Your opponent was away for two minutes. Please create a new room.'});rooms.delete(r.code);}
        continue;
      }
      if(r.phase==='lobby'&&now-r.createdAt>1800000){for(const p of r.players)send(p.ws,{type:'expired',message:'This waiting room expired. Please create a new one.'});rooms.delete(r.code);continue;}
      if(r.phase==='tutorial'&&now>=r.endsAt)phase(r,'playing');
      else if(r.phase==='playing') {
        const a=r.attack,until=a?Math.min(now,a.resolve):now;
        const dt=Math.max(0,Math.min(until-r.lastTick,150));r.lastTick=now;
        r.progress=Math.min(1,r.progress+dt/TUNING.roundMs*(a?1.3:1));
        if(a&&!a.locked) {
          // Track the predicted contact point, then lock for the final readable cue.
          a.target=Math.min(1,r.progress+Math.max(0,a.resolve-now)/TUNING.roundMs*1.3);
          if(now>=a.lockAt)a.locked=true;
        }
        if(a&&now>=a.resolve+TUNING.graceMs) {
          const d=r.dodge,correct=d?.kind===(a.kind==='crush'?'jump':'slide');
          const avoided=!!(correct&&d.start<=a.resolve&&d.end>=a.resolve);
          r.impact={kind:a.kind,at:now,progress:r.progress,target:a.target,avoided,dodgeKind:d?.kind,direction:d?.direction||'right'};
          if(!avoided){finish(r,1-walker(r),a.kind==='crush'?'CRUSHED!':'SLID OFF THE PATH!');broadcast(r);continue;}
          r.notice=a.kind==='crush'?'FORWARD JUMP!':'CLEAN SLIDE!';r.noticeUntil=now+900;
          if(a.kind==='crush')r.progress=Math.min(1,r.progress+TUNING.jumpBonus);
          r.attack=null;r.nextAttackAt=now+TUNING.attackRecoveryMs;
        }
        if(r.noticeUntil&&now>=r.noticeUntil){r.notice='';r.noticeUntil=0;}
        if(r.progress>=1&&!r.attack)finish(r,walker(r),'MADE IT TO THE STORE!');
      } else if(r.phase==='roundEnd'&&now>=r.endsAt){r.round++;startRound(r);}
      broadcast(r);
    }
  }
  const timer=autoTick?setInterval(tick,50):null;
  const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}},10000);
  const close=()=>{if(timer)clearInterval(timer);clearInterval(heartbeat);for(const ws of wss.clients)ws.terminate();wss.close();return new Promise(resolve=>server.close(resolve));};
  return {server,tick,rooms,close};
}
if(require.main===module){const app=createGameServer();app.server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Finger Crush and Slide — Strategy Edition running'));}
module.exports={createGameServer,TUNING};
