async function sendMsg(){
  if(!CC)return;
  if(!rateCheck('msg')){const i2=document.getElementById('minput');const op=i2.placeholder;i2.placeholder='// SLOW DOWN...';setTimeout(()=>i2.placeholder=op,1500);return;}
  const inp=document.getElementById('minput');
  const text=inp.value.trim();
  if(!text)return;
  if(text.length>2000){alert('Max 2000 chars');return;}
  inp.value='';document.getElementById('cctr').textContent='0 chars';

  // get sender role if group
  let senderRole='';
  if(CC.type==='group'){
    const path=fbOK?await fbGet('groups/'+CC.id+'/members/'+CU.id):ldb().groups?.[CC.id]?.members?.[CU.id];
    senderRole=path?.role||'MEMBER';
  }

  const msg={
    type:'text',
    from:CU.id,
    tag:CU.tag||'',
    role:senderRole,
    text,
    ts:ts()
  };
  if(timerMode){
    const dur=parseInt(document.getElementById('timer-dur').value)*1000;
    msg.expireAt=ts()+dur;
  }

  const path=CC.type==='dm'?'dms/'+CC.id+'/messages':CC.type==='pubroom'?'pubrooms/'+CC.id+'/messages':'groups/'+CC.id+'/messages';
  SFX.msgSend();
  if(fbOK&&!CU?.isGuest){
    try{await fbPush(path,msg);}
    catch(e){
      inp.value=text;document.getElementById('cctr').textContent=text.length+' chars';
      const eb=document.getElementById('send-err');
      if(eb){eb.textContent='⚠ Send failed — check connection';eb.style.display='block';setTimeout(()=>eb.style.display='none',3000);}
      return;
    }
  }
  else{
    const d=ldb();
    const base=CC.type==='dm'?d.dms:d.groups;
    if(!base[CC.id])base[CC.id]={messages:{}};
    if(!base[CC.id].messages)base[CC.id].messages={};
    base[CC.id].messages[Date.now()]=msg;
    lsv(d);
    renderMessages(base[CC.id].messages);
  }
  renderDMList();renderGroupList();
}

function handleKey(e){if(e.key==='Enter')sendMsg();}
function updCC(){const v=document.getElementById('minput').value;document.getElementById('cctr').textContent=v.length+' chars';}
function toggleTimer(){
  timerMode=!timerMode;
  document.getElementById('timer-toggle').classList.toggle('active',timerMode);
  document.getElementById('timer-dur').style.display=timerMode?'inline-block':'none';
}
function clearChat(){
  if(!CC)return;
  if(CC.type==='dm'){
    // simple 2-click confirm for DMs
    openClearConfirmDM();
  } else {
    // group: requires all members to vote
    openClearConfirmGroup();
  }
}

function openClearConfirmDM(){
  // show vote status first (async load)
  document.getElementById('clr-title').textContent='CLEAR DM — MUTUAL VOTE';
  document.getElementById('clr-body').innerHTML=`<div style="font-size:11px;color:var(--gd);text-align:center;padding:20px">LOADING...</div>`;
  openMod('clr-ov');
  _loadDMClearVotes();
}
async function _loadDMClearVotes(){
  if(!CC)return;
  let votes={};
  if(fbOK){const v=await fbGet('dms/'+CC.id+'/clearVotes');votes=v||{};}
  else{const d=ldb();votes=d.dms?.[CC.id]?.clearVotes||{};}
  const alreadyVoted=!!votes[CU.id];
  const vc=Object.keys(votes).length;
  const otherUser=CC.id.split('::').find(u=>u!==CU.id)||'other';
  document.getElementById('clr-body').innerHTML=`
    <div style="font-size:11px;color:var(--wht);line-height:1.8;margin-bottom:12px">
      Clearing requires <span style="color:var(--yel)">BOTH people</span> to vote.<br>
      <span style="color:var(--gd)">Votes: <span style="color:var(--g);font-family:'Orbitron',sans-serif">${vc}/2</span></span>
    </div>
    <div style="border:1px solid var(--border);padding:10px 12px;margin-bottom:14px;font-size:10px;">
      <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(0,60,10,.3)">
        <span style="color:var(--g)">${esc(CU.id)} (you)</span>
        <span style="color:${votes[CU.id]?'var(--g)':'var(--gd)'}">${votes[CU.id]?'✓ VOTED':'pending'}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:4px 0">
        <span style="color:var(--wht)">${esc(otherUser)}</span>
        <span style="color:${votes[otherUser]?'var(--g)':'var(--gd)'}">${votes[otherUser]?'✓ VOTED':'pending'}</span>
      </div>
    </div>
    ${alreadyVoted
      ?`<div style="color:var(--gd);font-size:10px;text-align:center;padding:6px">Waiting for ${esc(otherUser)} to confirm...</div>
        <button onclick="closeMod('clr-ov')" style="width:100%;margin-top:10px;padding:9px;background:none;border:1px solid var(--border);color:var(--gd);font-family:'Share Tech Mono',monospace;font-size:10px;cursor:pointer;letter-spacing:2px">CLOSE</button>`
      :`<div style="display:flex;gap:8px">
          <button onclick="closeMod('clr-ov')" style="flex:1;padding:9px;background:none;border:1px solid var(--border);color:var(--gd);font-family:'Share Tech Mono',monospace;font-size:10px;cursor:pointer;letter-spacing:2px">CANCEL</button>
          <button onclick="voteClearDM()" style="flex:1;padding:9px;background:rgba(255,42,42,.08);border:1px solid var(--red);color:var(--red);font-family:'Orbitron',monospace;font-size:10px;cursor:pointer;letter-spacing:2px;font-weight:700">VOTE TO CLEAR</button>
        </div>`}`;
}

async function voteClearDM(){
  if(!CC||CC.type!=='dm')return;
  const otherUser=CC.id.split('::').find(u=>u!==CU.id)||'other';
  if(fbOK){
    await fbSet('dms/'+CC.id+'/clearVotes/'+CU.id,{ts:ts()});
    const votes=await fbGet('dms/'+CC.id+'/clearVotes');
    const vc=votes?Object.keys(votes).length:0;
    if(vc>=2){
      await authReady();await db.ref('dms/'+CC.id+'/messages').remove();
      await db.ref('dms/'+CC.id+'/clearVotes').remove();
      await fbPush('dms/'+CC.id+'/messages',{type:'sys',text:'Chat cleared by mutual agreement.',ts:ts()});
    } else {
      await fbPush('dms/'+CC.id+'/messages',{type:'sys',text:CU.id+' voted to clear. Waiting for '+otherUser+'...',ts:ts()});
    }
  } else {
    const d=ldb();
    if(!d.dms[CC.id])return;
    if(!d.dms[CC.id].clearVotes)d.dms[CC.id].clearVotes={};
    d.dms[CC.id].clearVotes[CU.id]={ts:ts()};
    if(!d.dms[CC.id].messages)d.dms[CC.id].messages={};
    const vc=Object.keys(d.dms[CC.id].clearVotes).length;
    if(vc>=2){
      d.dms[CC.id].messages={};
      delete d.dms[CC.id].clearVotes;
      d.dms[CC.id].messages[Date.now()]={type:'sys',text:'Chat cleared by mutual agreement.',ts:ts()};
    } else {
      d.dms[CC.id].messages[Date.now()]={type:'sys',text:CU.id+' voted to clear. Waiting for '+otherUser+'...',ts:ts()};
    }
    lsv(d);renderMessages(d.dms[CC.id].messages||{});
  }
  closeMod('clr-ov');
}

async function execClearDM(){/* legacy – unused */}

async function openClearConfirmGroup(){
  // get current member list
  let gData;
  if(fbOK){gData=await fbGet('groups/'+CC.id);}
  else{gData=ldb().groups?.[CC.id];}
  if(!gData)return;
  const members=Object.keys(gData.members||{});
  const totalNeeded=members.length;

  // check existing votes
  let votes={};
  if(fbOK){const v=await fbGet('groups/'+CC.id+'/clearVotes');votes=v||{};}
  const alreadyVoted=!!votes[CU.id];
  const voteCount=Object.keys(votes).length;

  const ov=document.getElementById('clr-ov');
  document.getElementById('clr-title').textContent='CLEAR CHANNEL VOTE';
  document.getElementById('clr-body').innerHTML=`
    <div style="font-size:11px;color:var(--wht);line-height:1.8;margin-bottom:12px">
      Clearing a group channel requires <span style="color:var(--yel)">ALL ${totalNeeded} members</span> to vote.<br>
      <span style="color:var(--gd)">Current votes: <span style="color:var(--g);font-family:'Orbitron',sans-serif">${voteCount}/${totalNeeded}</span></span>
    </div>
    <div style="border:1px solid var(--border);padding:10px 12px;margin-bottom:14px;font-size:10px;color:var(--gd)">
      ${members.map(m=>`<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(0,60,10,.3)">
        <span style="color:${m===CU.id?'var(--g)':'var(--wht)'}">${esc(m)}</span>
        <span style="color:${votes[m]?'var(--g)':'var(--gd)'}">${votes[m]?'✓ VOTED':'pending'}</span>
      </div>`).join('')}
    </div>
    ${alreadyVoted?
      `<div style="color:var(--gd);font-size:10px;text-align:center;padding:8px">You have already voted to clear. Waiting for others...</div>
       <button onclick="closeMod('clr-ov')" style="width:100%;padding:9px;background:none;border:1px solid var(--border);color:var(--gd);font-family:'Share Tech Mono',monospace;font-size:10px;cursor:pointer;letter-spacing:2px">CLOSE</button>`:
      `<div style="display:flex;gap:8px">
        <button onclick="closeMod('clr-ov')" style="flex:1;padding:9px;background:none;border:1px solid var(--border);color:var(--gd);font-family:'Share Tech Mono',monospace;font-size:10px;cursor:pointer;letter-spacing:2px">CANCEL</button>
        <button onclick="voteClear(${totalNeeded})" style="flex:1;padding:9px;background:rgba(255,42,42,.08);border:1px solid var(--red);color:var(--red);font-family:'Orbitron',monospace;font-size:10px;cursor:pointer;letter-spacing:2px;font-weight:700">VOTE TO CLEAR</button>
      </div>`
    }`;
  openMod('clr-ov');
}

async function voteClear(totalNeeded){
  if(!CC||CC.type!=='group')return;
  const votePath='groups/'+CC.id+'/clearVotes/'+CU.id;
  if(fbOK){
    await fbSet(votePath, {ts:ts()});
    const votes=await fbGet('groups/'+CC.id+'/clearVotes');
    const voteCount=votes?Object.keys(votes).length:0;
    if(voteCount>=totalNeeded){
      // all voted — clear messages AND reset votes
      await authReady();await db.ref('groups/'+CC.id+'/messages').remove();
      await db.ref('groups/'+CC.id+'/clearVotes').remove();
      // post system message
      await fbPush('groups/'+CC.id+'/messages',{type:'sys',text:'Chat was cleared by unanimous vote.',ts:ts()});
    }
  } else {
    const d=ldb();
    if(!d.groups[CC.id].clearVotes)d.groups[CC.id].clearVotes={};
    d.groups[CC.id].clearVotes[CU.id]={ts:ts()};
    const vc=Object.keys(d.groups[CC.id].clearVotes).length;
    if(vc>=totalNeeded){
      d.groups[CC.id].messages={};
      delete d.groups[CC.id].clearVotes;
    }
    lsv(d);
    renderMessages(d.groups[CC.id].messages||{});
  }
  closeMod('clr-ov');
}
function closeChat(){
  if(CC&&msgListeners[CC.id]){msgListeners[CC.id]();delete msgListeners[CC.id];}
  CC=null;
  document.getElementById('achat').style.display='none';
  document.getElementById('empty').style.display='flex';
  renderDMList();renderGroupList();
}

// ── NEW DM ────────────────────────────────────────────────────
async function doNC(){
  if(CU&&CU.isGuest&&document.querySelectorAll('#dm-list .ci').length>=5){SFX.guestLimit();document.getElementById('ncerr').textContent='GUEST LIMIT: max 5 DM contacts';return;}
  const raw=document.getElementById('ncu').value.trim();
  const errEl=document.getElementById('ncerr');
  errEl.textContent='';
  if(!raw){errEl.textContent='Enter target as username#TAG';return;}
  if(!raw.includes('#')){errEl.textContent='Format required: username#TAG (e.g. ghost_x#DEV)';return;}
  const [uPart,tagPart]=raw.split('#');
  const u=uPart.trim().toLowerCase();
  const tag=tagPart.trim().toUpperCase();
  if(!u||!tag){errEl.textContent='Both username and tag are required';return;}
  if(u===CU.id){errEl.textContent='Cannot message yourself';return;}
  // verify user exists AND tag matches
  let userData=null;
  if(fbOK){userData=await getPublicProfileByUsername(u);}
  else{const d=ldb();userData=d.users[u]||null;}
  if(!userData){errEl.textContent='User not found on network';return;}
  if(userData.tag!==tag){errEl.textContent='Tag does not match — ask the user for their exact tag';return;}
  const key=[CU.id,u].sort().join('::');
  if(fbOK){await fbSet('dms/'+key+'/meta',{users:[CU.id,u],created:ts()});}
  else{const d=ldb();if(!d.dms[key])d.dms[key]={meta:{users:[CU.id,u]},messages:{}};lsv(d);}
  openDM(u,key);
  renderDMList();
}

// ── CREATE GROUP ──────────────────────────────────────────────
async function doCreateGroup(){
  if(CU&&CU.isGuest&&document.querySelectorAll('#grp-list .ci').length>=2){SFX.guestLimit();document.getElementById('gcerr').textContent='GUEST LIMIT: max 2 groups';return;}
  const name=document.getElementById('gname').value.trim().replace(/\s+/g,'_').toLowerCase();
  const desc=document.getElementById('gdesc').value.trim();
  const inviteRaw=document.getElementById('ginvite').value;
  const errEl=document.getElementById('gcerr');
  if(!name){errEl.textContent='Group name required';return;}
  if(name.length<2){errEl.textContent='Name min 2 chars';return;}

  const invites=inviteRaw.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  const members={[CU.id]:{role:'ADMIN',joined:ts()}};
  invites.forEach(u=>{if(u&&u!==CU.id)members[u]={role:'MEMBER',joined:ts()};});

  const gData={name,desc,owner:CU.id,created:ts(),members};
  let gKey;
  if(fbOK){gKey=await fbPush('groups',gData);}
  else{
    gKey='grp_'+Date.now();
    const d=ldb();d.groups[gKey]=gData;lsv(d);
  }
  closeMod('gcmod');
  renderGroupList();
  openGroup(gKey,gData);
}