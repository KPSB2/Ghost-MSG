function openMod(id){document.getElementById(id).classList.add('active');SFX.open();if(id==='pubmod')renderPubRoomModal();}
function closeMod(id){document.getElementById(id).classList.remove('active');}
document.querySelectorAll('.mov').forEach(o=>o.addEventListener('click',function(e){if(e.target===this)closeMod(this.id);}));

// ── USER PROFILE ──────────────────────────────────────────────
let profTarget=null;
let profHideBal=false; // tracks toggle state during edit session

async function openProfile(uid){
  profTarget=uid;
  // Show modal immediately with loading state
  document.getElementById('prof-av').textContent=uid[0].toUpperCase();
  document.getElementById('prof-name').textContent=uid.toUpperCase();
  document.getElementById('prof-bio').textContent='// loading...';
  document.getElementById('prof-bal').textContent='——';
  document.getElementById('prof-usd').textContent='——';
  document.getElementById('prof-txc').textContent='—';
  document.getElementById('prof-edit-section').style.display='none';
  document.getElementById('prof-dm-section').style.display='none';
  openMod('profmod');

  let userData=null,walData=null,txs=[],targetUid=uid;
  try{
    if(fbOK){
      // uid param may be a username — resolve to Firebase UID first
      const resolved=await getUid(uid);
      if(resolved){targetUid=resolved;}
      // fetch public profile (readable by all authenticated users)
      const pub=await fbGet('users/'+targetUid+'/public');
      // fetch private only if viewing own profile
      const isOwn=(uid===CU.id||targetUid===(CU.uid||CU.id));
      const priv=isOwn?await fbGet('users/'+targetUid+'/private'):null;
      userData=pub?{...pub,...(priv||{})}:null;
      // wallet readable only by owner
      if(isOwn){
        walData=await fbGet('wallets/'+targetUid);
        const t=await fbGet('txs/'+targetUid);
        txs=t?Object.values(t):[];
      }
    } else {
      const d=ldb();
      userData=d.users?.[uid]||null;
      walData=d.wal?.[uid]||null;
      txs=d.txs?.[uid]||[];
    }
  }catch(e){
    console.error('[PROFILE] fetch error:',e);
    document.getElementById('prof-bio').textContent='// error loading profile';
    return;
  }

  if(!userData){
    document.getElementById('prof-bio').textContent='// user not found';
    return;
  }

  const isMe=(uid===CU.id||targetUid===(CU.uid||CU.id));
  const bal=(walData&&typeof walData.balance==='number')?walData.balance:0;
  const usd=(bal/100).toFixed(2);
  const theyHide=!!userData.hideBalance;
  const showBal=isMe||!theyHide;

  // Populate all fields
  document.getElementById('prof-title').querySelector('span').textContent=
    isMe?'// MY PROFILE':'// USER: '+uid.toUpperCase();
  document.getElementById('prof-av').textContent=uid[0].toUpperCase();
  document.getElementById('prof-name').textContent=uid.toUpperCase();
  document.getElementById('prof-tag').textContent='['+(userData.tag||'?')+']';
  document.getElementById('prof-since').textContent=
    'JOINED: '+new Date(userData.created||Date.now()).toLocaleDateString();
  document.getElementById('prof-addr').textContent=
    (walData&&walData.address)?'ADDR: '+walData.address:'';

  // ── BIO FIX: always show something, never blank ──
  const bioText=(typeof userData.bio==='string'&&userData.bio.trim())
    ? userData.bio.trim()
    : '// no bio set.';
  document.getElementById('prof-bio').textContent=bioText;

  // Balance row
  document.getElementById('prof-bal').textContent=showBal?fmt(bal):'••••••';
  document.getElementById('prof-usd').textContent=showBal?'$'+usd:'$••••';
  document.getElementById('prof-txc').textContent=txs.length;
  const balLabel=document.getElementById('prof-bal-label');
  if(balLabel)balLabel.textContent=(!isMe&&theyHide)?'HIDDEN':'BALANCE (GHO)';

  // Show correct sections
  document.getElementById('prof-edit-section').style.display=isMe?'block':'none';
  document.getElementById('prof-dm-section').style.display=isMe?'none':'block';
  if(!isMe){const _bb=document.getElementById('prof-block-btn');if(_bb){const _bl=isBlocked(uid);_bb.textContent=_bl?'UNBLOCK USER':'BLOCK USER';_bb.style.color=_bl?'var(--red)':'#ff6666';_bb.style.borderColor=_bl?'var(--red)':'#3a0000';}}

  if(isMe){
    document.getElementById('prof-bio-input').value=userData.bio||'';
    profHideBal=!!userData.hideBalance;
    _updateProfHideBtn();
  } else {
    document.getElementById('prof-dm-btn').textContent='► DM '+uid.toUpperCase();
  }
}

function _updateProfHideBtn(){
  const btn=document.getElementById('prof-balhide-toggle');
  if(!btn)return;
  btn.textContent=profHideBal?'ON':'OFF';
  btn.style.color=profHideBal?'var(--g)':'var(--gd)';
  btn.style.borderColor=profHideBal?'var(--g)':'var(--border)';
  btn.style.background=profHideBal?'rgba(0,255,65,.08)':'rgba(0,20,0,.4)';
}

function toggleProfileBalHide(){
  profHideBal=!profHideBal;
  _updateProfHideBtn();
}

async function saveBio(){
  const bio=document.getElementById('prof-bio-input').value.trim().slice(0,100);
  const errEl=document.getElementById('prof-err');
  try{
    if(fbOK){
      const myUid=CU.uid||CU.id;
      await fbSet('users/'+myUid+'/public/bio',bio);
      await fbSet('users/'+myUid+'/private/hideBalance',profHideBal);
    } else {
      const d=ldb();
      if(d.users[CU.id]){d.users[CU.id].bio=bio;d.users[CU.id].hideBalance=profHideBal;}
      lsv(d);
    }
    document.getElementById('prof-bio').textContent=bio||'// no bio set.';
    errEl.textContent='';errEl.style.color='var(--g)';
    errEl.textContent='[OK] Profile saved';
    setTimeout(()=>errEl.textContent='',2500);
  }catch(e){errEl.style.color='var(--red)';errEl.textContent='Error: '+e.message;}
}

async function dmFromProfile(){
  if(!profTarget)return;
  // need tag to open DM
  let userData=null;
  if(fbOK){userData=await getPublicProfileByUsername(profTarget);}
  else{const d=ldb();userData=d.users[profTarget]||null;}
  if(!userData){closeMod('profmod');return;}
  const key=[CU.id,profTarget].sort().join('::');
  if(fbOK){await fbSet('dms/'+key+'/meta',{users:[CU.id,profTarget],created:ts()});}
  else{const d=ldb();if(!d.dms[key])d.dms[key]={meta:{},messages:{}};lsv(d);}
  closeMod('profmod');
  openDM(profTarget,key);
  renderDMList();
}

// show GHO ticker when logged in
function showTicker(){
  const t=document.getElementById('gho-ticker');
  if(t){t.style.display='flex';}
}
// make username in message meta clickable
function clickUser(uid){openProfile(uid);}

// ── MOBILE SIDEBAR ────────────────────────────────────────────
function toggleSidebar(){
  const sb=document.getElementById('sidebar');
  const ov=document.getElementById('sb-overlay');
  const isOpen=sb.classList.contains('mob-open');
  if(isOpen){closeSidebar();}else{sb.classList.add('mob-open');ov.classList.add('active');}
}
function closeSidebar(){
  document.getElementById('sidebar').classList.remove('mob-open');
  document.getElementById('sb-overlay').classList.remove('active');
}
function mobileBack(){
  closeChat();
  // on mobile re-open sidebar
  if(window.innerWidth<=700)toggleSidebar();
}