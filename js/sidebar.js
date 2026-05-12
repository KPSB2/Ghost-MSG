async function loadSidebar(){
  renderDMList();
  renderGroupList();
  if(fbOK&&!CU?.isGuest){
    authReady().then(()=>{
      renderPubRoomList();
      db.ref('dms').on('value',()=>renderDMList());
      db.ref('groups').on('value',()=>renderGroupList());
      db.ref('pubrooms').on('value',()=>renderPubRoomList());
    });
  } else {
    renderPubRoomList();
  }
}

async function renderDMList(){
  const list=document.getElementById('dm-list');
  let dms=[];
  if(fbOK&&!CU?.isGuest){
    const all=await fbGet('dms');
    if(all)dms=Object.entries(all).filter(([k])=>k.includes(CU.id)).map(([k,v])=>({key:k,...v}));
  } else {
    const d=ldb();
    dms=Object.entries(d.dms||{}).filter(([k])=>k.includes(CU.id)).map(([k,v])=>({key:k,...v}));
  }
  list.innerHTML='';
  dms.forEach(dm=>{
    const other=dm.key.split('::').find(x=>x!==CU.id)||'?';
    const msgs=dm.messages?Object.values(dm.messages):[];
    const last=msgs.sort((a,b)=>b.ts-a.ts)[0];
    const prev=last?(last.type==='pay'?`◈ ${fmt(last.amount)} GHO`:last.text?.slice(0,22)||''):'no messages';
    const item=document.createElement('div');
    const _mDM=isMuted(dm.key);
    item.className='ci'+(CC?.id===dm.key?' active':'')+(_mDM?' ci-muted':'');
    item.onclick=()=>openDM(other,dm.key);
    item.innerHTML=`<div class="ci-av">${other[0].toUpperCase()}</div><div class="ci-info"><div class="ci-name">${esc(other)}${_mDM?' 🔇':''}</div><div class="ci-prev">${esc(prev)}</div></div>`;
    list.appendChild(item);
  });
}

async function renderGroupList(){
  const list=document.getElementById('grp-list');
  let groups=[];
  if(fbOK&&!CU?.isGuest){
    const all=await fbGet('groups');
    if(all)groups=Object.entries(all).filter(([,v])=>v.members&&v.members[CU.id]).map(([k,v])=>({key:k,...v}));
  } else {
    const d=ldb();
    groups=Object.entries(d.groups||{}).filter(([,v])=>v.members&&v.members[CU.id]).map(([k,v])=>({key:k,...v}));
  }
  list.innerHTML='';
  groups.forEach(g=>{
    const msgs=g.messages?Object.values(g.messages):[];
    const last=msgs.sort((a,b)=>b.ts-a.ts)[0];
    const prev=last?(last.type==='pay'?`◈ ${fmt(last.amount)} GHO`:last.text?.slice(0,22)||''):'no messages';
    const item=document.createElement('div');
    const _mG=isMuted(g.key);
    item.className='ci'+(CC?.id===g.key?' active':'')+(_mG?' ci-muted':'');
    item.onclick=()=>openGroup(g.key,g);
    item.innerHTML=`<div class="ci-av group">#</div><div class="ci-info"><div class="ci-name" style="color:var(--cyn)">${esc(g.name)}${_mG?' 🔇':''}</div><div class="ci-prev">${esc(prev)}</div></div>`;
    list.appendChild(item);
  });
}

// ── PUBLIC ROOMS ─────────────────────────────────────────────
async function renderPubRoomList(){
  var list=document.getElementById('pub-list');if(!list)return;
  if(!fbOK){list.innerHTML='';return;}
  var all=await fbGet('pubrooms');
  list.innerHTML='';if(!all)return;
  Object.entries(all).forEach(function(entry){
    var k=entry[0],v=entry[1];
    var info=v&&v.info?v.info:v;
    if(!info||!info.name)return;
    var msgs=v.messages?Object.values(v.messages):[];
    var last=msgs.sort(function(a,b){return b.ts-a.ts;})[0];
    var prev=last&&last.text?last.text.slice(0,22):'no messages';
    var item=document.createElement('div');
    item.className='ci'+(CC&&CC.id===k?' active':'');
    item.onclick=(function(kk,ii){return function(){openPubRoom(kk,ii);};})(k,info);
    item.innerHTML='<div class="ci-av group" style="background:rgba(0,245,255,.08);color:var(--cyn);border-color:rgba(0,245,255,.25)">☰</div><div class="ci-info"><div class="ci-name" style="color:var(--cyn)">#'+esc(info.name)+'</div><div class="ci-prev">'+esc(prev)+'</div></div>';
    list.appendChild(item);
  });
}
async function renderPubRoomModal(){
  var _cs=document.getElementById('pub-create-sec'),_gn=document.getElementById('pub-guest-note');
  if(_cs)_cs.style.display=(fbOK&&CU&&!CU.isGuest)?'block':'none';
  if(_gn)_gn.style.display=(fbOK&&CU&&!CU.isGuest)?'none':'block';
  var list=document.getElementById('pub-room-list');if(!list)return;
  if(!fbOK){list.innerHTML='<div style="padding:16px;font-size:10px;color:var(--gd)">Firebase required.</div>';return;}
  list.innerHTML='<div style="padding:12px 16px;font-size:9px;color:var(--gd)">Loading...</div>';
  var all=await fbGet('pubrooms');
  if(!all){list.innerHTML='<div style="padding:16px;font-size:10px;color:var(--gd)">No public rooms yet.</div>';return;}
  list.innerHTML=Object.entries(all).filter(function(e){
    var info=e[1]&&e[1].info?e[1].info:e[1];return info&&info.name;
  }).map(function(e){
    var k=e[0],v=e[1],info=v.info?v.info:v;
    var members=v.joined?Object.keys(v.joined).length:0;
    var count=v.messages?Object.keys(v.messages).length:0;
    return '<div class="ci" style="padding:10px 16px" onclick="(function(){openPubRoom(\''+esc(k)+'\',{name:\''+esc(info.name)+'\',desc:\''+esc(info.desc||'')+'\'}); closeMod(\'pubmod\');})()"><div class="ci-av group" style="background:rgba(0,245,255,.08);color:var(--cyn);border-color:rgba(0,245,255,.25)">☰</div><div class="ci-info"><div class="ci-name" style="color:var(--cyn)">#'+esc(info.name)+'</div><div class="ci-prev">'+esc(info.desc||'')+' &middot; '+members+' joined &middot; '+count+' msgs</div></div></div>';
  }).join('');
}
async function doCreatePubRoom(){
  if(CU&&CU.isGuest){SFX.guestLimit();document.getElementById('puberr').textContent='Register to create public rooms';return;}
  var name=document.getElementById('pub-name')
    .value.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g,'');
  var desc=document.getElementById('pub-desc').value.trim();
  var errEl=document.getElementById('puberr');
  errEl.textContent='';
  if(!name || name.length<2){
    errEl.textContent='Name: 2+ chars, letters/numbers/_';
    return;
  }
  if(!fbOK){
    errEl.textContent='Firebase required';
    return;
  }
  if(await fbGet('pubrooms/'+name)){
    errEl.textContent='Room name taken';
    return;
  }
  var room={
    name:name,
    desc:desc||'',
    owner:CU.id,
    createdAt:Date.now()
  };
  await fbSet('pubrooms/'+name+'/info',room);
  if(!CU.isGuest){
    await fbSet('pubrooms/'+name+'/joined/'+CU.id,{ts:Date.now()});
  }
  closeMod('pubmod');
  openPubRoom(name,room);
  renderPubRoomList();
}
function openPubRoom(key,rdata){
  if(CC&&msgListeners[CC.id]){msgListeners[CC.id]();delete msgListeners[CC.id];}
  var info=rdata&&rdata.info?rdata.info:rdata;
  var roomName=info&&info.name?info.name:key;
  CC={id:key,type:'pubroom',name:roomName,data:info};
  document.getElementById('empty').style.display='none';
  document.getElementById('achat').style.display='flex';
  var av=document.getElementById('chav');av.textContent='☰';av.className='chav group';av.style.color='var(--cyn)';
  document.getElementById('chn').textContent='#'+roomName.toUpperCase()+' [PUBLIC]';
  document.getElementById('chs').innerHTML='<span class="sdot" style="width:5px;height:5px;background:var(--cyn);box-shadow:0 0 4px var(--cyn)"></span> PUBLIC ROOM // OPEN TO ALL';
  document.getElementById('mbr-btn').style.display='none';
  document.getElementById('pay-btn').style.display='none';
  if(fbOK&&CU&&!CU.isGuest)fbSet('pubrooms/'+key+'/joined/'+CU.id,{ts:ts()});
  listenMessages('pubrooms/'+key+'/messages');
  renderPubRoomList();
  if(window.innerWidth<=700)closeSidebar();
}
// ── OPEN CHATS ────────────────────────────────────────────────
function openDM(otherUser,key){
  // stop previous listener
  if(CC&&msgListeners[CC.id]){msgListeners[CC.id]();delete msgListeners[CC.id];}
  const dmKey=key||[CU.id,otherUser].sort().join('::');
  CC={id:dmKey,type:'dm',name:otherUser};
  document.getElementById('empty').style.display='none';
  document.getElementById('achat').style.display='flex';
  document.getElementById('chav').textContent=otherUser[0].toUpperCase();
  document.getElementById('chav').className='chav';
  document.getElementById('chn').textContent=otherUser.toUpperCase();
  document.getElementById('chs').innerHTML=`<span class="sdot" style="width:5px;height:5px"></span> DM // AES-256 ACTIVE`;
  document.getElementById('mbr-btn').style.display='none';
  document.getElementById('pay-btn').style.display='flex';
  document.getElementById('pton').textContent=otherUser;
  closeMod('ncmod');
  listenMessages('dms/'+dmKey+'/messages');
  renderDMList();updateMuteBtn();
  if(window.innerWidth<=700)closeSidebar();
}

function openGroup(key,gdata){
  if(CC&&msgListeners[CC.id]){msgListeners[CC.id]();delete msgListeners[CC.id];}
  CC={id:key,type:'group',name:gdata.name,data:gdata};
  document.getElementById('empty').style.display='none';
  document.getElementById('achat').style.display='flex';
  document.getElementById('chav').textContent='#';
  document.getElementById('chav').className='chav group';
  document.getElementById('chn').textContent='#'+gdata.name.toUpperCase();
  const mCount=Object.keys(gdata.members||{}).length;
  document.getElementById('chs').innerHTML=`<span class="sdot" style="width:5px;height:5px;background:var(--cyn);box-shadow:0 0 4px var(--cyn)"></span> GROUP // ${mCount} MEMBERS`;
  document.getElementById('mbr-btn').style.display='flex';
  document.getElementById('pay-btn').style.display='none'; // group pay disabled (DMs only)
  listenMessages('groups/'+key+'/messages');
  renderGroupList();updateMuteBtn();
  if(window.innerWidth<=700)closeSidebar();
}

// ── MESSAGES LISTENER ─────────────────────────────────────────
function listenMessages(path){
  if(!CC)return;
  const ccId=CC.id;
  if(fbOK&&!CU?.isGuest){
    authReady().then(()=>{
      const ref=db.ref(path);
      const handler=ref.on('value',snap=>{
        if(CC&&CC.id===ccId){
          var _d=snap.val();
          if(_d){var _mv=Object.values(_d),_l=_mv.reduce(function(a,b){return b.ts>a.ts?b:a;},{ts:0});if(_l.from&&_l.from!==CU?.id&&Date.now()-_l.ts<3000&&!isMuted(ccId))SFX.msgRecv();}
          renderMessages(_d);
        }
      });
      msgListeners[ccId]=()=>ref.off('value',handler);
    });
  } else {
    // local mode: read once
    const d=ldb();
    const msgs=CC.type==='dm'?d.dms[CC.id]?.messages:d.groups[CC.id]?.messages;
    renderMessages(msgs||{});
  }
}

function renderMessages(msgsObj){
  const msgs=msgsObj?Object.entries(msgsObj).map(([k,v])=>({_key:k,...v})).sort((a,b)=>a.ts-b.ts):[];
  const container=document.getElementById('msgs');
  // preserve scroll position if near bottom
  const nearBottom=container.scrollHeight-container.scrollTop-container.clientHeight<80;
  container.innerHTML='';

  const sys=document.createElement('div');
  sys.className='sysmsg';
  sys.textContent=CC.type==='group'?`GROUP: ${CC.name.toUpperCase()}`:CC.type==='pubroom'?`PUBLIC: #${CC.name.toUpperCase()}`:`ENCRYPTED DM: ${CC.name.toUpperCase()}`;
  container.appendChild(sys);

  msgs.forEach(msg=>{
    const isMe=msg.from===CU.id;
    if(!isMe&&msg.from&&isBlocked(msg.from))return;
    if(msg.type==='sys'){
      const s=document.createElement('div');s.className='sysmsg';s.textContent=msg.text||'';container.appendChild(s);return;
    }
    const row=document.createElement('div');
    row.className='mrow'+(isMe?' me':'');
    row.dataset.msgid=msg._key;
    const t=timeStr(msg.ts);
    // build tag html
    let tagHtml='';
    if(msg.tag)tagHtml+=`<span class="mtag tag-custom">[${esc(msg.tag)}]</span>`;
    if(msg.role&&msg.role!=='MEMBER')tagHtml+=`<span class="mtag tag-${msg.role}">[${msg.role}]</span>`;

    if(msg.type==='pay'){
      row.innerHTML=`<div class="mav2" onclick="openProfile('${esc(msg.from)}')" style="cursor:pointer">${msg.from[0].toUpperCase()}</div><div class="mcon"><div class="mmeta"><span onclick="openProfile('${esc(msg.from)}')" style="cursor:pointer;color:var(--g)">${esc(msg.from)}</span> ${tagHtml} <span>${t}</span></div><div class="pbub"><div class="pbhdr">◈ GHOST_CASH — ${isMe?'SENT TO '+esc(msg.to):'RECEIVED FROM '+esc(msg.from)}</div><div class="pbamt"><span>◈</span>${fmt(msg.amount)} <span style="font-size:10px;opacity:.6">GHO</span></div>${msg.note?`<div class="pbnote">"${esc(msg.note)}"</div>`:''}<div class="pbtx">TX: ${esc(msg.txId)}</div></div></div>`;
    } else {
      // check timed
      const isTimed=!!msg.expireAt;
      const now=Date.now();
      const expired=isTimed&&now>=msg.expireAt;
      const remaining=isTimed?Math.max(0,msg.expireAt-now):0;
      const total=isTimed?(msg.expireAt-msg.ts):0;
      const pct=total>0?Math.min(100,(remaining/total)*100):100;
      let timerHtml='';
      if(isTimed){
        const fillColor=pct>50?'var(--g)':pct>20?'var(--yel)':'var(--red)';
        const secs=Math.ceil(remaining/1000);
        const tLabel=expired?'EXPIRED':secs<60?`${secs}s`:secs<3600?`${Math.ceil(secs/60)}m`:`${Math.ceil(secs/3600)}h`;
        timerHtml=`<div class="timer-bar"><div class="timer-fill" id="tf-${msg._key}" style="width:${pct}%;background:${fillColor}"></div></div><div class="timer-label" id="tl-${msg._key}">⏱ ${tLabel}</div>`;
      }
      const blurClass=expired?'blurred':'';
      row.innerHTML=`<div class="mav2" onclick="openProfile('${esc(msg.from)}')" style="cursor:pointer">${msg.from[0].toUpperCase()}</div><div class="mcon"><div class="mmeta"><span onclick="openProfile('${esc(msg.from)}')" style="cursor:pointer;color:var(--g)">${esc(msg.from)}</span> ${tagHtml} <span>${t}</span></div><div class="mbub timed ${blurClass}" id="mb-${msg._key}"><span class="msg-text">${esc(msg.text||'')}</span>${timerHtml}</div></div>`;

      // start live timer
      if(isTimed&&!expired){
        if(timerIntervals[msg._key])clearInterval(timerIntervals[msg._key]);
        timerIntervals[msg._key]=setInterval(()=>{
          const now2=Date.now();
          const rem2=Math.max(0,msg.expireAt-now2);
          const pct2=Math.min(100,(rem2/total)*100);
          const fillEl=document.getElementById('tf-'+msg._key);
          const lblEl=document.getElementById('tl-'+msg._key);
          const bubEl=document.getElementById('mb-'+msg._key);
          if(!fillEl){clearInterval(timerIntervals[msg._key]);return;}
          const col=pct2>50?'var(--g)':pct2>20?'var(--yel)':'var(--red)';
          fillEl.style.width=pct2+'%';fillEl.style.background=col;
          const s2=Math.ceil(rem2/1000);
          if(lblEl)lblEl.textContent='⏱ '+(rem2<=0?'EXPIRED':s2<60?`${s2}s`:s2<3600?`${Math.ceil(s2/60)}m`:`${Math.ceil(s2/3600)}h`);
          if(rem2<=0&&bubEl&&!bubEl.classList.contains('blurred')){
            bubEl.classList.add('blurred');
            clearInterval(timerIntervals[msg._key]);
          }
        },500);
      }
    }
    container.appendChild(row);
  });
  if(nearBottom||msgs.length<=1)container.scrollTop=container.scrollHeight;
}

// ── SEND MESSAGE ──────────────────────────────────────────────