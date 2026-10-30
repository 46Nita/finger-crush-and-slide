const $=id=>document.getElementById(id);
const inviteCode=(new URL(location.href).searchParams.get('room')||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);
if(inviteCode)$('code').value=inviteCode;
let session;try{session=JSON.parse(sessionStorage.getItem('fcs')||'null')}catch{session=null}
if(inviteCode&&session?.code!==inviteCode)session=null;
let socket,state=null,offset=0,best=Infinity,muted=false,retry,connected=false,
  lastSound='',lastImpact='',lastOutcome='',localDodge=null,lastLocalDodge=0;
const appearance=()=>({color:$('color').value,gender:$('gender').value,finger:$('finger').value});
function send(message){if(socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify(message));return true}return false}
function showHome(message=''){$('game').classList.add('hidden');$('home').classList.remove('hidden');$('error').textContent=message;state=null;}
function clearSession(){session=null;sessionStorage.removeItem('fcs');localDodge=null;lastLocalDodge=0;}
function connect(){
  const current=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host);socket=current;
  current.onopen=()=>{
    if(socket!==current)return;connected=true;clearTimeout(retry);best=Infinity;
    $('connection').textContent='● CONNECTED';
    for(let i=0;i<3;i++)setTimeout(()=>{if(socket===current)send({type:'ping',clientTime:Date.now()})},i*200);
    if(session)send({type:'join',...session,appearance:appearance()});
  };
  current.onmessage=e=>{
    if(socket!==current)return;let m;try{m=JSON.parse(e.data)}catch{return}
    if(m.type==='pong'){const rtt=Date.now()-m.clientTime;if(rtt<best){best=rtt;offset=m.serverTime-(m.clientTime+rtt/2)}return;}
    if(m.type==='joined'){
      session={code:m.code,token:m.token,index:m.index};sessionStorage.setItem('fcs',JSON.stringify(session));
      $('home').classList.add('hidden');$('game').classList.remove('hidden');$('room').textContent=m.code;return;
    }
    if(m.type==='state'){
      if(!state||state.round!==m.state.round||state.phase!==m.state.phase&&m.state.phase==='tutorial'){localDodge=null;lastLocalDodge=0;}
      state=m.state;render();return;
    }
    if(m.type==='dodgeAck'){localDodge=m.dodge||null;if(!m.accepted)lastLocalDodge=m.dodge?.start||0;return;}
    if(m.type==='error'){
      if(session&&m.message.includes('not found')){clearSession();showHome(m.message)}else $('error').textContent=m.message;return;
    }
    if(m.type==='expired'){clearSession();showHome(m.message)}
  };
  current.onclose=()=>{
    if(socket!==current)return;connected=false;
    if(session){$('connection').textContent='● RECONNECTING';overlay('CONNECTION LOST','RECONNECTING…','Your room will wait for you for up to two minutes.');}
    retry=setTimeout(connect,1500);
  };
  current.onerror=()=>{};
}
function overlay(k,title,text,label,action){
  $('overlay').classList.remove('hidden');$('overlay-kicker').textContent=k;$('overlay-title').textContent=title;$('overlay-text').textContent=text;
  $('overlay-button').classList.toggle('hidden',!label);
  if(label){$('overlay-button').textContent=label;$('overlay-button').onclick=action;}
}
function tone(freq=440){if(muted)return;try{const c=new(window.AudioContext||window.webkitAudioContext)(),o=c.createOscillator(),g=c.createGain();o.type='triangle';o.frequency.value=freq;g.gain.setValueAtTime(.05,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.18);o.connect(g).connect(c.destination);o.start();o.stop(c.currentTime+.18);setTimeout(()=>c.close(),350)}catch{}}
function render(){
  if(!state||!session)return;
  const s=state,me=session.index,isWalker=me===s.roleWalker,now=Date.now()+offset;
  $('room').textContent=s.code;$('score').textContent=`P1 ${s.score[0]} — ${s.score[1]} P2`;
  $('round').textContent=`ROUND ${s.round} · BEST OF 3`;$('role').textContent=isWalker?'YOU ARE THE WALKER':'YOU ARE THE FINGER';
  $('buttons').classList.toggle('hidden',s.phase!=='playing'||!isWalker||!!s.paused);
  $('attackButtons').classList.toggle('hidden',s.phase!=='playing'||isWalker||!!s.paused);
  $('hint').textContent=s.phase==='lobby'?'Share your invite link with a friend.':isWalker?'CRUSH → Jump Forward · SWEEP → Slide Away. Time it near impact!':'Choose crush or sweep. Mix your attacks and timing to catch a wrong move.';
  $('overlay').classList.add('hidden');$('overlay-button').classList.add('hidden');
  if(!connected)overlay('CONNECTION LOST','RECONNECTING…','Hang tight. We’re reconnecting to your room.');
  else if(s.paused)overlay('PAUSED','WAITING FOR OPPONENT','Your round is paused while your friend reconnects.');
  else if(s.phase==='lobby')overlay('ROOM '+s.code,s.players.length<2?'WAITING FOR YOUR FRIEND':'READY FOR THE CORNER STORE?',isWalker?'You are the Walker. Jump forward to escape a crush; slide away from a sweep. Get to the store!':'You are the Finger. Choose CRUSH or SLIDE, then watch your opponent’s reaction. Stop them before the store!',s.players.length===2&&me===0?'START MATCH':null,()=>send({type:'start'}));
  else if(s.phase==='tutorial')overlay('HOW TO PLAY · '+Math.max(0,Math.ceil((s.endsAt-now)/1000))+'s',isWalker?'JUMP. SLIDE. REACH THE STORE!':'CRUSH OR SWEEP?',isWalker?'CRUSH: Jump Forward. SLIDE: Slide Away. Move just before impact. Green = safe, red = danger, yellow = evading. Unlimited defenses; short recovery.':'Mix CRUSH and SLIDE. Your shadow locks just before impact. Catch the Walker choosing the wrong defense or moving too early.');
  else if((s.phase==='roundEnd'||s.phase==='matchEnd')&&now-(s.outcome?.at||0)>=1100){
    if(s.phase==='roundEnd')overlay('ROUND '+s.round,s.winner===me?'YOU WON THE ROUND!':'YOUR OPPONENT WON!',s.notice+' Roles switch next round.');
    else overlay('FINAL SCORE · '+s.score[0]+' — '+s.score[1],s.winner===me?'YOU WIN THE MATCH!':'YOUR OPPONENT WINS!',s.rematch[me]?'Waiting for your opponent to play again.':'Another trip to the corner store?',s.rematch[me]?null:'PLAY AGAIN',()=>send({type:'rematch'}));
  }
  drawScene();
}
function drawScene(){
  if(!state||!session)return;
  const s=state,a=s.attack,impact=s.impact,now=s.paused||Date.now()+offset;
  const outcome=s.outcome,won=!!outcome?.walkerWon,lost=!!outcome&&!outcome.walkerWon;
  const impactAge=impact?Math.max(0,now-impact.at):Infinity,hit=!!impact&&!impact.avoided;
  let d=s.dodge;if(session.index===s.roleWalker&&localDodge&&(!d||localDodge.start>d.start))d=localDodge;
  let progress=s.progress;
  if(s.phase==='playing'&&!s.paused&&connected){let elapsed=Math.min(150,Math.max(0,now-s.serverTime));if(a)elapsed=Math.max(0,Math.min(elapsed,a.resolve-s.serverTime));progress=Math.min(1,progress+elapsed/(s.tuning?.roundMs||26000)*(a?1.3:1));}
  if(hit)progress=impact.progress;
  let evading=!!d&&now>=d.start&&now<=d.end;
  const correct=d?.kind===(a?.kind==='crush'?'jump':'slide');
  if(a&&now>=a.resolve&&correct&&d.start<=a.resolve&&d.end>=a.resolve)evading=true;
  if(impact?.avoided&&impactAge<170)evading=true;
  const runner=$('runner'),face=$('runner-face');
  runner.style.left=(9+progress*74)+'%';runner.style.opacity='1';
  runner.style.setProperty('--walker-accent',s.players[s.roleWalker]?.appearance.color||'#ffcc4d');
  const glow=won?'#ffffff':hit?'#ff3939':evading?'#ffe53b':a?'#ff3939':'#54f286';
  runner.style.setProperty('--danger',glow);runner.style.setProperty('--body-glow',glow);
  runner.classList.toggle('walker-victory',won);
  let transform='';face.textContent=s.players[s.roleWalker]?.appearance.gender==='feminine'?'✦ᴗ✦':s.players[s.roleWalker]?.appearance.gender==='masculine'?'•_•':'•ᴗ•';
  if(evading){
    const kind=d?.kind||impact?.dodgeKind;
    if(kind==='jump'){const t=Math.max(0,Math.min(1,(now-(d?.start||now))/520));transform=`translate(${48*Math.sin(Math.PI*t/2)}px,${-52*Math.sin(Math.PI*Math.min(t,.85))}px) rotate(-8deg)`;face.textContent='•ᗜ•';}
    else{transform='translate(-32px,26px) rotate(-24deg) scaleY(.65)';face.textContent='≧ᴗ≦';}
  }else if(a)face.textContent=a.kind==='crush'?'⊙o⊙':'•o•';
  if(hit){face.textContent='×_×';const t=Math.max(0,Math.min(1,(impactAge-100)/400));if(impact.kind==='slide'){transform=`translate(${t*145}px,${t*170}px) rotate(${t*150}deg)`;runner.style.opacity=String(1-Math.max(0,t-.7)/.3)}else transform=`scale(${1+t*.25},${1-t*.8})`;}
  if(won)face.textContent='✦ᗜ✦';runner.style.transform=transform;
  $('progress').style.width=(progress*100)+'%';
  $('signal').textContent=won?'STORE REACHED!':hit?(impact.kind==='crush'?'CRUSHED!':'SLID OFF!'):evading?(d?.kind==='jump'?'JUMPING!':'EVADING!'):a?(a.kind==='crush'?'CRUSH → JUMP!':'SWEEP → SLIDE!'):'SAFE';
  $('signal').style.background=won?'#fff':hit?'#ff7070':evading?'#ffe53b':a?'#ff7070':'#8fdb83';
  const showFinger=!!a||!!impact&&(impactAge<850||lost);
  for(const id of ['shadow','fingerArt','fingerGlow'])$(id).classList.toggle('hidden',!showFinger);
  $('stage').classList.toggle('danger-active',!!a&&!s.paused);$('stage').classList.toggle('finger-victory',lost);
  if(showFinger){
    const kind=a?.kind||impact.kind,target=a?a.target:hit?impact.progress:impact.target;
    const anchor=`calc(${9+target*74}% + 11px)`;
    $('fingerArt').style.left=anchor;$('fingerGlow').style.left=anchor;$('shadow').style.left=`calc(${9+target*74}% + 10px)`;
    $('fingerArt').style.color=s.players[1-s.roleWalker]?.appearance.finger||'#b67652';
    const wind=a?Math.min(.85,Math.max(0,(now-a.at)/(a.resolve-a.at))):1;$('stage').style.setProperty('--rumble',(0.5+wind*2.5)+'px');
    if(kind==='crush'){$('fingerArt').style.transform=`translateY(${-75*(1-wind)}px) rotate(180deg)`;$('fingerArt').style.bottom='115px';}
    else{$('fingerArt').style.transform=`translate(${-45-85*(1-wind)}px,35px) rotate(90deg)`;$('fingerArt').style.bottom='85px';}
    $('shadow').classList.toggle('locked',!!a?.locked);
    if(a&&lastSound!==String(a.at)){lastSound=String(a.at);tone(kind==='crush'?180:320);if(navigator.vibrate)navigator.vibrate([40,30,60]);}
  }
  if(impact&&lastImpact!==String(impact.at)){lastImpact=String(impact.at);tone(impact.avoided?700:impact.kind==='crush'?90:230);if(!impact.avoided&&navigator.vibrate)navigator.vibrate(120);}
  if(outcome&&lastOutcome!==String(outcome.at)){lastOutcome=String(outcome.at);tone(won?880:140);}
  const inactive=s.phase!=='playing'||!!s.paused||!connected;
  const recovering=now-Math.max(s.dodge?.start||0,lastLocalDodge)<(s.tuning?.dodgeCooldownMs||550);
  $('left').disabled=$('right').disabled=inactive||recovering;
  $('slide').disabled=$('crush').disabled=inactive||!!a||now<(s.nextAttackAt||0);
}
function evade(kind){
  if(!state||!session||state.phase!=='playing'||state.paused||session.index!==state.roleWalker||!connected)return;
  const at=Date.now()+offset;if(at-Math.max(lastLocalDodge,state.dodge?.start||0)<(state.tuning?.dodgeCooldownMs||550))return;
  lastLocalDodge=at;localDodge={kind,direction:kind==='jump'?'right':'left',start:at,end:at+(state.tuning?.dodgeMs||520)};
  send({type:'dodge',kind,at});drawScene();tone(kind==='jump'?560:420);
}
function animate(){drawScene();requestAnimationFrame(animate)}requestAnimationFrame(animate);
$('create').onclick=()=>{if(!send({type:'create',appearance:appearance()}))$('error').textContent='Connecting to the server. Please try again in a moment.';};
$('join').onclick=()=>{clearSession();$('error').textContent='';if(!send({type:'join',code:$('code').value,appearance:appearance()}))$('error').textContent='Connecting to the server. Please try again in a moment.';};
$('code').onkeydown=e=>{if(e.key==='Enter')$('join').click()};
$('left').onclick=()=>evade('jump');$('right').onclick=()=>evade('slide');
for(const kind of ['slide','crush'])$(kind).onclick=()=>send({type:'attack',kind});
$('mute').onclick=()=>{muted=!muted;$('mute').textContent=muted?'🔇':'🔊';$('mute').setAttribute('aria-label',muted?'Unmute sound':'Mute sound')};
$('copy').onclick=async()=>{const u=new URL(location.origin+location.pathname);u.searchParams.set('room',state.code);try{await navigator.clipboard.writeText(u.toString());$('copy').textContent='LINK COPIED';setTimeout(()=>$('copy').textContent='COPY INVITE LINK',1800)}catch{window.prompt('Copy this invite link:',u.toString())}};
$('leave').onclick=()=>{clearSession();clearTimeout(retry);socket.onclose=null;socket.close();connected=false;showHome();connect()};
if(inviteCode)$('error').textContent='Invite ready! Choose your look, then press JOIN.';
connect();setInterval(()=>{if(connected)send({type:'ping',clientTime:Date.now()})},5000);
