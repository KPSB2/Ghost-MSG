// ── MEMBERS MANAGEMENT ────────────────────────────────────────
async function openMembers(){
  if(!CC||CC.type!=='group')return;
  let gData;
  if(fbOK){gData=await fbGet('groups/'+CC.id);}
  else{gData=ldb().groups[CC.id];}
  if(!gData)return;
  CC.data=gData;
  document.getElementById('mbr-title').textContent='// '+esc(gData.name.toUpperCase())+' — MEMBERS';
  const isAdmin=gData.members[CU.id]?.role==='ADMIN';
  const list=document.getElementById('mbr-list');
  list.innerHTML='';
  Object.entries(gData.members||{}).forEach(([uid,info])=>{
    const item=document.createElement('div');item.className='mbr-item';
    const roleOpts=ROLES.map(r=>`<option value="${r}"${info.role===r?' selected':''}>${r}</option>`).join('');
    item.innerHTML=`
      <div class="mbr-av">${esc(uid[0].toUpperCase())}</div>
      <div class="mbr-name">${esc(uid)}</div>
      ${uid!==CU.id?`<button class="mbr-mute${isMuted(uid)?' on':''}" onclick="toggleMute('${esc(uid)}');openMembers()">${isMuted(uid)?'🔇':'🔔'}</button><button class="mbr-block${isBlocked(uid)?' on':''}" onclick="toggleBlock('${esc(uid)}');openMembers()">${isBlocked(uid)?'UNBLK':'BLOCK'}</button>`:''}
      ${isAdmin&&uid!==CU.id?`<select class="mbr-role-sel" onchange="setMemberRole('${esc(uid)}',this.value)">${roleOpts}</select><button class="mbr-kick" onclick="kickMember('${esc(uid)}')">KICK</button>`:`<span class="mtag tag-${info.role||'MEMBER'}" style="font-size:9px;padding:1px 5px">[${info.role||'MEMBER'}]</span>`}
    `;
    list.appendChild(item);
  });
  document.getElementById('inverr').textContent='';
  const _xd=document.getElementById('del-grp-btn');if(_xd)_xd.remove();
  if(gData.owner===CU.id||gData.members[CU.id]?.role==='ADMIN'){
    const _db=document.createElement('button');
    _db.id='del-grp-btn';_db.className='del-btn';_db.textContent='⚠ DELETE THIS GROUP';
    _db.onclick=()=>{closeMod('mbrmod');openMod('delgrpmod');};
    document.querySelector('#mbrmod .mbdy').appendChild(_db);
  }
  openMod('mbrmod');
}

async function setMemberRole(uid,role){
  // Only allow valid roles
  if(!ROLES.includes(role))return;
  const path='groups/'+CC.id+'/members/'+uid+'/role';
  if(fbOK){await fbSet(path,role);}
  else{const d=ldb();if(d.groups[CC.id]?.members?.[uid])d.groups[CC.id].members[uid].role=role;lsv(d);}
}

async function kickMember(uid){
  if(!uid||uid===CU.id)return; // cannot kick yourself
  const path='groups/'+CC.id+'/members/'+uid;
  if(fbOK){await authReady();await db.ref(path).remove();}
  else{const d=ldb();if(d.groups[CC.id]?.members)delete d.groups[CC.id].members[uid];lsv(d);}
  openMembers();
}

async function confirmDeleteGroup(){
  if(!CC||CC.type!=='group')return;
  const _gd=CC.data;
  if(!(_gd&&(_gd.owner===CU.id||_gd.members?.[CU.id]?.role==='ADMIN'))){closeMod('delgrpmod');return;}
  if(fbOK){await authReady();await db.ref('groups/'+CC.id).remove();}
  else{const d=ldb();delete d.groups[CC.id];lsv(d);}
  closeMod('delgrpmod');closeChat();renderGroupList();
}

async function doInvite(){
  const raw=document.getElementById('inv-user').value.trim();
  const errEl=document.getElementById('inverr');
  errEl.textContent='';
  if(!raw){errEl.textContent='Enter as username#TAG';return;}
  if(!raw.includes('#')){errEl.textContent='Format: username#TAG';return;}
  const [uPart,tagPart]=raw.split('#');
  const u=uPart.trim().toLowerCase();
  const tag=tagPart.trim().toUpperCase();
  if(!u||!tag){errEl.textContent='Both username and tag required';return;}
  // Validate format
  if(!/^[a-z0-9_]{2,20}$/.test(u)){errEl.textContent='Invalid username format';return;}
  let userData=null;
  if(fbOK){userData=await getPublicProfileByUsername(u);}
  else{const d=ldb();userData=d.users[u]||null;}
  if(!userData){errEl.textContent='User not found';return;}
  if(userData.tag!==tag){errEl.textContent='Tag mismatch — check the exact tag';return;}
  const path='groups/'+CC.id+'/members/'+u;
  if(fbOK){await fbSet(path,{role:'MEMBER',joined:ts()});}
  else{const d=ldb();if(d.groups[CC.id])d.groups[CC.id].members[u]={role:'MEMBER',joined:ts()};lsv(d);}
  document.getElementById('inv-user').value='';
  openMembers();
  renderGroupList();
}

// ── PAYMENT ───────────────────────────────────────────────────
async function openPay(){
  if(!CC||CC.type!=='dm')return;
  document.getElementById('pbal').textContent=fmt(await getBal());
  document.getElementById('pamt').value='';document.getElementById('pnote').value='';
  document.getElementById('perr').textContent='';clrP();
  openMod('paymod');setTimeout(()=>document.getElementById('pamt').focus(),50);
}
function setP(n,el){document.getElementById('pamt').value=n;document.querySelectorAll('.pbtn2').forEach(b=>b.classList.remove('sel'));el.classList.add('sel');}
function clrP(){document.querySelectorAll('.pbtn2').forEach(b=>b.classList.remove('sel'));}

async function doPayment(){
  if(CU&&CU.isGuest){SFX.guestLimit();document.getElementById('perr').textContent='GUEST MODE: wallet disabled';return;}
  // Client-side rate limit
  if(window.RATE){const rl=window.RATE.transfer();if(!rl.ok){document.getElementById('perr').textContent=`Transfer rate limited — wait ${Math.ceil(rl.waitMs/1000)}s`;return;}}

  const amtRaw=document.getElementById('pamt').value;
  const note=document.getElementById('pnote').value.trim().slice(0,200);
  const errEl=document.getElementById('perr');
  const amt=Math.round(parseFloat(amtRaw)*100)/100;

  if(!amtRaw||isNaN(amt)||amt<=0){errEl.textContent='Enter a valid amount';return;}
  if(amt<0.01){errEl.textContent='Minimum transfer is 0.01 GHO';return;}
  if(amt>500000){errEl.textContent='Max 500,000 GHO per transfer';return;}

  const recipient=CC.name;
  const txId=genTxId();const now=ts();

  if(fbOK){
    // ── Use Cloud Function for secure atomic transfer ──
    try{
      const result=await window.__secureTransfer(recipient,amt,note);
      // Post pay message to DM
      const pmsg={type:'pay',from:CU.id,to:recipient,tag:CU.tag||'',amount:amt,note,txId:result.txId||txId,ts:now};
      await fbPush('dms/'+CC.id+'/messages',pmsg);
    }catch(e){
      errEl.textContent='Transfer failed: '+(e.message||'Unknown error');
      SFX.error();return;
    }
  } else {
    // Local fallback
    const d=ldb();
    if(!d.wal[CU.id])d.wal[CU.id]={balance:1000,address:genAddr()};
    if(!d.wal[recipient])d.wal[recipient]={balance:0,address:genAddr()};
    const bal=d.wal[CU.id].balance;
    if(amt>bal){errEl.textContent='Insufficient balance ('+fmt(bal)+' GHO)';return;}
    d.wal[CU.id].balance=Math.round((bal-amt)*100)/100;
    d.wal[recipient].balance=Math.round((d.wal[recipient].balance+amt)*100)/100;
    if(!d.txs[CU.id])d.txs[CU.id]=[];if(!d.txs[recipient])d.txs[recipient]=[];
    d.txs[CU.id].unshift({id:txId,type:'out',with:recipient,amount:amt,note,ts:now});
    d.txs[recipient].unshift({id:txId,type:'in',with:CU.id,amount:amt,note,ts:now});
    const pmsg={type:'pay',from:CU.id,to:recipient,tag:CU.tag||'',amount:amt,note,txId,ts:now};
    if(!d.dms[CC.id])d.dms[CC.id]={messages:{}};
    d.dms[CC.id].messages[now]=pmsg;
    lsv(d);renderMessages(d.dms[CC.id].messages);
  }

  closeMod('paymod');updTopBal();
  document.getElementById('pssub').textContent='◈ '+fmt(amt)+' GHO → '+esc(recipient.toUpperCase());
  SFX.pay();const ov=document.getElementById('psov');ov.classList.add('active');setTimeout(()=>ov.classList.remove('active'),2200);
}

// ── MODALS ────────────────────────────────────────────────────
