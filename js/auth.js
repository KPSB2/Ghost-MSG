// ── SESSION RESTORE ──────────────────────────────────────────
async function tryRestoreSession(firebaseUser){
  try{
    if(fbOK && firebaseUser){
      const uid=firebaseUser.uid;
      // Use db.ref directly — _authUnlock was just called so auth token is ready
      const pubSnap=await db.ref('users/'+uid+'/public').get();
      const pub=pubSnap.exists()?pubSnap.val():null;
      if(!pub){
        console.warn('[SESSION] No profile for uid',uid);
        const lerr=document.getElementById('lerr');
        if(lerr&&!document.getElementById('chat-page').classList.contains('active'))
          lerr.textContent='Profile not found — please register.';
        setBtnLoading('login-btn',false,'ACCESS CHANNEL');
        if(auth)auth.signOut();
        return;
      }
      const privSnap=await db.ref('users/'+uid+'/private').get();
      const priv=privSnap.exists()?privSnap.val():null;
      const username=pub.username;
      if(!username){
        console.warn('[SESSION] Profile missing username');
        setBtnLoading('login-btn',false,'ACCESS CHANNEL');
        if(auth)auth.signOut();
        return;
      }
      enterApp({id:username,uid,...pub,...(priv||{})});
    } else if(!fbOK){
      const raw=localStorage.getItem('gm_session');
      if(!raw)return;
      let sess;
      try{ sess=JSON.parse(raw); }catch(e){ localStorage.removeItem('gm_session'); return; }
      if(!sess||!sess.id){ localStorage.removeItem('gm_session'); return; }
      const d=ldb(); const userData=d.users[sess.id]||null;
      if(!userData){localStorage.removeItem('gm_session');return;}
      enterApp({id:sess.id,uid:sess.id,...userData});
    }
  }catch(e){
    console.warn('Session restore failed:',e);
    const lerr=document.getElementById('lerr');
    if(lerr&&!document.getElementById('chat-page').classList.contains('active'))
      lerr.textContent='Login error: '+(e.message||'Unknown error');
    setBtnLoading('login-btn',false,'ACCESS CHANNEL');
  }
}

let CU=null;
let CC=null;
let timerMode=false;
let msgListeners={};
let timerIntervals={};
// Rate limiter — also extended by security.js RATE object
const _rl={msg:{t:5,l:0,max:5,r:5000},auth:{t:5,l:0,max:5,r:10000}};
function rateCheck(k){const b=_rl[k],n=Date.now(),d=Math.floor((n-(b.l||n))/b.r);if(d>0){b.t=Math.min(b.max,b.t+d);b.l=n;}if(!b.l)b.l=n;if(b.t<=0)return false;b.t--;return true;}

// ── MUTE / BLOCK ─────────────────────────────────────────────
function _prefs(){
  try{ return JSON.parse(localStorage.getItem('gm_prefs')||'{"muted":{},"blocked":{}}'); }
  catch(e){ return {muted:{},blocked:{}}; }
}
function _savePrefs(p){try{localStorage.setItem('gm_prefs',JSON.stringify(p));}catch(e){}}
function isMuted(key){return!!_prefs().muted[key];}
function isBlocked(uid){return!!_prefs().blocked[uid];}
function toggleMute(key){const p=_prefs();if(p.muted[key])delete p.muted[key];else p.muted[key]=1;_savePrefs(p);renderDMList();renderGroupList();renderPubRoomList();}
function toggleBlock(uid){const p=_prefs();if(p.blocked[uid])delete p.blocked[uid];else p.blocked[uid]=1;_savePrefs(p);}
function toggleCurrentMute(){if(!CC)return;toggleMute(CC.id);updateMuteBtn();}
function updateMuteBtn(){const btn=document.getElementById('mute-btn');if(!btn||!CC)return;const m=isMuted(CC.id);btn.textContent=m?'🔇':'🔔';btn.style.color=m?'var(--yel)':'';}
function toggleBlockProfile(){if(!profTarget)return;toggleBlock(profTarget);const b=document.getElementById('prof-block-btn');if(!b)return;const bl=isBlocked(profTarget);b.textContent=bl?'UNBLOCK USER':'BLOCK USER';b.style.color=bl?'var(--red)':'#ff6666';b.style.borderColor=bl?'var(--red)':'#3a0000';}

const ROLES=['ADMIN','MOD','GHOST','MEMBER'];
function roleColor(r){return r==='ADMIN'?'var(--adm)':r==='MOD'?'var(--mod)':r==='GHOST'?'var(--ghost)':'var(--gd)';}

function fmt(n){return Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function esc(t){return String(t==null?'':t).replace(/\0/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');}
function genAddr(){return'0x'+[...Array(16)].map(()=>Math.floor(Math.random()*16).toString(16)).join('');}
function genTxId(){return'TX'+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,5).toUpperCase();}
function ts(){return Date.now();}
function timeStr(t){return new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
function dateStr(t){return new Date(t).toLocaleString([],{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}

// ── SOUND ENGINE ─────────────────────────────────────────────
let _ac=null;
function _ctx(){if(!_ac)_ac=new(window.AudioContext||window.webkitAudioContext)();if(_ac.state==='suspended')_ac.resume();return _ac;}
function _beep(freq,dur,vol,type,fi,fo){vol=vol||0.08;type=type||'square';fi=fi||0.005;fo=fo||0.08;
  try{const c=_ctx(),o=c.createOscillator(),g=c.createGain();
  o.connect(g);g.connect(c.destination);o.type=type;o.frequency.setValueAtTime(freq,c.currentTime);
  g.gain.setValueAtTime(0,c.currentTime);g.gain.linearRampToValueAtTime(vol,c.currentTime+fi);
  g.gain.setValueAtTime(vol,c.currentTime+dur-fo);g.gain.linearRampToValueAtTime(0,c.currentTime+dur);
  o.start(c.currentTime);o.stop(c.currentTime+dur);}catch(e){}}
const SFX={
  msgSend:function(){_beep(880,0.04,0.07,'square');setTimeout(function(){_beep(1320,0.06,0.05,'square');},30);},
  msgRecv:function(){_beep(440,0.05,0.06,'sine');setTimeout(function(){_beep(660,0.07,0.05,'sine');},40);},
  login:function(){_beep(220,0.06,0.07,'sawtooth');setTimeout(function(){_beep(440,0.08,0.07,'sawtooth');},80);setTimeout(function(){_beep(880,0.14,0.07,'square');},180);},
  logout:function(){_beep(440,0.08,0.07,'sawtooth');setTimeout(function(){_beep(220,0.12,0.06,'sawtooth');},120);},
  error:function(){_beep(180,0.1,0.08,'sawtooth');setTimeout(function(){_beep(150,0.12,0.07,'sawtooth');},100);},
  pay:function(){[0,60,120,180].forEach(function(d,i){setTimeout(function(){_beep(440*Math.pow(1.25,i),0.08,0.07,'sine');},d);});},
  open:function(){_beep(660,0.05,0.06,'sine');setTimeout(function(){_beep(880,0.07,0.05,'sine');},40);},
  guestLimit:function(){_beep(200,0.08,0.08,'sawtooth');setTimeout(function(){_beep(150,0.1,0.07,'sawtooth');},90);},
};

// ── LOCAL FALLBACK ────────────────────────────────────────────
function ldb(){
  try{ return JSON.parse(sessionStorage.getItem('gm4db')||'{"users":{},"dms":{},"groups":{},"wal":{},"txs":{}}'); }
  catch(e){ return {users:{},dms:{},groups:{},wal:{},txs:{}}; }
}
function lsv(d){try{sessionStorage.setItem('gm4db',JSON.stringify(d));}catch(e){console.warn('lsv failed:',e);}}

// ── FIREBASE HELPERS ──────────────────────────────────────────
function fbRef(path){return db?db.ref(path):null;}
async function fbSet(path,val){await authReady();if(db)await db.ref(path).set(val);}
async function fbUpdate(path,val){await authReady();if(db)await db.ref(path).update(val);}
async function fbGet(path){await authReady();if(!db)return null;const s=await db.ref(path).get();return s.exists()?s.val():null;}
async function fbPush(path,val){await authReady();if(!db)return null;try{const r=db.ref(path).push();await r.set(val);return r.key;}catch(e){console.error('[fbPush]',path,e.code||e.message);throw e;}}

// ── UID LOOKUP HELPERS ────────────────────────────────────────
async function getUid(username){
  if(!db)return username;
  try{
    const snap=await db.ref('usernames/'+username).get();
    return snap.exists()?snap.val():null;
  }catch(e){return null;}
}
async function getPublicProfile(uid){
  return await fbGet('users/'+uid+'/public');
}
async function getPublicProfileByUsername(username){
  const uid=await getUid(username);
  if(!uid)return null;
  const pub=await getPublicProfile(uid);
  if(!pub)return null;
  return{...pub,_uid:uid};
}

// ── AUTH ──────────────────────────────────────────────────────
function switchTab(tab,e){
  document.querySelectorAll('.atab').forEach(t=>t.classList.remove('active'));e.target.classList.add('active');
  document.getElementById('lform').style.display=tab==='login'?'block':'none';
  document.getElementById('rform').style.display=tab==='register'?'block':'none';
  var gf=document.getElementById('guestform');if(gf)gf.style.display=tab==='guest'?'block':'none';
  ['lerr','rerr','guerr'].forEach(function(id){var el=document.getElementById(id);if(el)el.textContent='';});
}

function setBtnLoading(btnId,loading,label){
  const b=document.getElementById(btnId);
  if(!b)return;
  b.disabled=loading;
  b.textContent=loading?'PROCESSING...':label;
  b.style.opacity=loading?'0.6':'1';
}

async function doLogin(){
  const u=document.getElementById('lu').value.trim().toLowerCase();
  const p=document.getElementById('lp').value;
  const errEl=document.getElementById('lerr');
  errEl.textContent='';
  if(!u||!p){errEl.textContent='All fields required';return;}
  // Validate username format to prevent injection
  if(!/^[a-z0-9_]{2,20}$/.test(u)){errEl.textContent='Invalid username format';return;}

  if(!rateCheck('auth')){errEl.textContent='Too many attempts — wait a moment';return;}
  // Also check security.js RATE if available
  if(window.RATE){const rl=window.RATE.auth();if(!rl.ok){errEl.textContent=`Too many attempts — wait ${Math.ceil(rl.waitMs/1000)}s`;return;}}

  setBtnLoading('login-btn',true,'ACCESS CHANNEL');
  try{
    if(fbOK){
      await Promise.race([
        auth.signInWithEmailAndPassword(ghostEmail(u),p),
        new Promise((_,rej)=>setTimeout(()=>rej({code:'auth/timeout',message:'Request timed out. Make sure the app is served over HTTPS.'}),10000))
      ]);
      // onAuthStateChanged will fire and call tryRestoreSession
      // Button stays loading until enterApp() resets it
    } else {
      const d=ldb(); const userData=d.users[u]||null;
      if(!userData){errEl.textContent='Identity not found on network';return;}
      if(userData.pass!==btoa(p)){errEl.textContent='Invalid passphrase';return;}
      enterApp({id:u,uid:u,...userData});
    }
  }catch(e){
    SFX.error();
    const code=e.code||'';
    if(code==='auth/invalid-login-credentials'||code==='auth/user-not-found'||code==='auth/wrong-password'||code==='auth/invalid-credential'){
      errEl.textContent='Invalid alias or passphrase';
    } else if(code==='auth/too-many-requests'){
      errEl.textContent='Too many attempts — try again later';
    } else if(code==='auth/timeout'){
      errEl.textContent=e.message;
    } else if(code==='auth/network-request-failed'){
      errEl.textContent='Network error — check your connection and ensure app is served over HTTPS';
    } else {
      errEl.textContent='Error: '+(e.message||'Unknown error');
    }
  }finally{
    if(!CU) setBtnLoading('login-btn',false,'ACCESS CHANNEL');
  }
}

async function doRegister(){
  const u=document.getElementById('ru').value.trim().toLowerCase();
  const tag=document.getElementById('rtag').value.trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  const p=document.getElementById('rp').value;
  const p2=document.getElementById('rp2').value;
  const errEl=document.getElementById('rerr');
  errEl.textContent='';

  // ── Validation (all checks before any network call) ──
  if(!u){errEl.textContent='Username is required';return;}
  if(!tag){errEl.textContent='Custom tag is required (2-5 chars)';return;}
  if(!p){errEl.textContent='Passphrase is required';return;}
  if(!p2){errEl.textContent='Please confirm your passphrase';return;}
  if(u.length<3||u.length>20){errEl.textContent='Alias must be 3–20 chars';return;}
  if(!/^[a-z0-9_]+$/.test(u)){errEl.textContent='Alias: letters, numbers and _ only';return;}
  if(tag.length<2||tag.length>5){errEl.textContent='Tag must be 2–5 chars (letters/numbers only)';return;}
  // Stronger password: min 8 chars, must include letter + number
  if(p.length<8){errEl.textContent='Passphrase must be at least 8 chars';return;}
  if(!/[a-zA-Z]/.test(p)){errEl.textContent='Passphrase must contain at least one letter';return;}
  if(!/[0-9]/.test(p)){errEl.textContent='Passphrase must contain at least one number';return;}
  if(p!==p2){errEl.textContent='Passphrases do not match';return;}

  if(!rateCheck('auth')){errEl.textContent='Too many attempts — wait a moment';return;}
  if(window.RATE){const rl=window.RATE.auth();if(!rl.ok){errEl.textContent=`Too many attempts — wait ${Math.ceil(rl.waitMs/1000)}s`;return;}}

  setBtnLoading('reg-btn',true,'CREATE GHOST IDENTITY');
  try{
    const addr=genAddr();
    const bio=document.getElementById('rbio').value.trim().slice(0,100);
    const userData={tag,address:addr,bio:bio||'',created:ts()};

    if(fbOK){
      const existingUid=await getUid(u);
      if(existingUid){errEl.textContent='Alias already taken — choose another';return;}

      let cred;
      try{
        cred=await Promise.race([
          auth.createUserWithEmailAndPassword(ghostEmail(u),p),
          new Promise((_,rej)=>setTimeout(()=>rej({code:'auth/timeout',message:'Request timed out. Make sure the app is served over HTTPS.'}),10000))
        ]);
      }catch(authErr){
        if(authErr.code==='auth/email-already-in-use'){errEl.textContent='Alias already taken — choose another';}
        else if(authErr.code==='auth/weak-password'){errEl.textContent='Passphrase too weak — use 8+ chars with a number';}
        else{errEl.textContent='Error: '+(authErr.message||'Registration failed');}
        return;
      }

      const fbUid=cred.user.uid;
      const pubData={username:u,tag,address:addr,bio:bio||'',created:ts()};
      await fbSet('users/'+fbUid+'/public',pubData);
      await fbSet('users/'+fbUid+'/private',{hideBalance:false});
      await fbSet('usernames/'+u,fbUid);
      await fbSet('wallets/'+fbUid,{balance:0,address:addr});

      _doLogoutCleanup(true);
      enterApp({id:u,uid:fbUid,...pubData,hideBalance:false});
    } else {
      const d=ldb();
      if(d.users[u]){errEl.textContent='Alias already taken — choose another';return;}
      d.users[u]={...userData,pass:btoa(p)};
      d.wal[u]={balance:0,address:addr};
      d.txs[u]=[];
      lsv(d);
      enterApp({id:u,uid:u,...userData});
    }
  }catch(e){
    errEl.textContent='Error: '+(e.message||'Unknown error');
    console.error('Register error:',e);
  }finally{
    setBtnLoading('reg-btn',false,'CREATE GHOST IDENTITY');
  }
}

function doGuest(){
  var u=document.getElementById('gu').value.trim().toLowerCase();
  var tag=document.getElementById('gtag').value.trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  var errEl=document.getElementById('guerr');errEl.textContent='';
  if(!u){errEl.textContent='Guest alias required';return;}
  if(!/^[a-z0-9_]{2,20}$/.test(u)){errEl.textContent='2-20 chars, letters/numbers/underscore';return;}
  if(!tag||tag.length<2||tag.length>5){errEl.textContent='Tag: 2-5 letters/numbers';return;}
  enterApp({id:'g_'+u,uid:'guest_'+Date.now(),tag:tag,address:null,isGuest:true,hideBalance:true});
}

function enterApp(user){
  CU=user;
  SFX.login();
  setBtnLoading('login-btn',false,'ACCESS CHANNEL');
  setBtnLoading('reg-btn',false,'CREATE GHOST IDENTITY');
  document.getElementById('auth-page').classList.remove('active');
  document.getElementById('chat-page').classList.add('active');
  document.getElementById('tbar-auth').style.display='none';
  document.getElementById('tbar-live').style.display='flex';
  document.getElementById('t-uname').textContent=(CU.isGuest?'[G] ':'')+CU.id.toUpperCase();
  document.getElementById('t-uname').style.cursor='pointer';
  document.getElementById('t-uname').onclick=()=>openProfile(CU.id);
  const tagEl=document.getElementById('t-utag');
  tagEl.innerHTML=`<span class="user-tag-badge tag-custom" style="border-color:rgba(0,245,255,.4);color:var(--cyn);cursor:pointer" onclick="openProfile('${esc(CU.id)}')">[${esc(CU.tag)}]</span>`;
  if(CU.isGuest){document.getElementById('wal-badge').style.display='none';document.getElementById('pay-btn').style.display='none';}
  else{document.getElementById('wal-badge').style.display='';showTicker();updTopBal();}
  loadSidebar();
  // Save minimal session info — never store password
  try{localStorage.setItem('gm_session',JSON.stringify({id:CU.id,uid:CU.uid,tag:CU.tag,address:CU.address}));}catch(e){}
  if(fbOK&&db){
    fbSet('presence/'+(CU.uid||CU.id),{online:true,last:ts()});
    // Register server-side onDisconnect if Cloud Functions are available
    if(typeof firebase!=='undefined'&&firebase.functions){
      try{
        const fn=firebase.functions().httpsCallable('setPresenceOfflineOnDisconnect');
        fn().catch(()=>{});
      }catch(e){}
    }
  }
}

function logout(){
  SFX.logout();
  if(CU)fbSet('presence/'+(CU.uid||CU.id),{online:false,last:ts()});
  _resetAuthReady();
  if(auth)auth.signOut();
  _doLogoutCleanup();
}

function _doLogoutCleanup(skipUI=false){
  Object.values(msgListeners).forEach(off=>off&&off());
  msgListeners={};
  Object.values(timerIntervals).forEach(clearInterval);
  timerIntervals={};
  CU=null;CC=null;timerMode=false;
  try{localStorage.removeItem('gm_session');}catch(e){}
  if(skipUI)return;
  document.getElementById('gho-ticker').style.display='none';
  document.getElementById('chat-page').classList.remove('active');
  document.getElementById('auth-page').classList.add('active');
  document.getElementById('tbar-auth').style.display='flex';
  document.getElementById('tbar-live').style.display='none';
  document.getElementById('achat').style.display='none';
  document.getElementById('empty').style.display='flex';
  document.getElementById('dm-list').innerHTML='';
  document.getElementById('grp-list').innerHTML='';
  try{['lu','lp'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});}catch(e){}
  const lerr=document.getElementById('lerr');if(lerr)lerr.textContent='';
}

// ── WALLET ────────────────────────────────────────────────────
let balHidden=false;

async function getBal(){
  try{
    if(fbOK){
      const v=await fbGet('wallets/'+(CU.uid||CU.id)+'/balance');
      return v!==null&&v!==undefined?Number(v):0;
    } else {
      const d=ldb();return typeof d.wal?.[CU.id]?.balance==='number'?d.wal[CU.id].balance:0;
    }
  }catch(e){console.warn('getBal error:',e);return 0;}
}

async function updTopBal(){
  const b=await getBal();
  const el=document.getElementById('topbal');
  if(el)el.textContent=balHidden?'••••• GHO':fmt(b)+' GHO';
}

function toggleBalHide(){
  balHidden=!balHidden;
  const btn=document.getElementById('balhide-btn');
  if(btn)btn.title=balHidden?'Show balance':'Hide balance';
  updTopBal();
  if(document.getElementById('walmod').classList.contains('active'))openWallet();
}

async function openWallet(){
  const b=await getBal();
  const usd=(b/100).toFixed(2);
  document.getElementById('wbigbal').textContent=balHidden?'••••••':fmt(b);
  document.getElementById('wusd-equiv').textContent=balHidden?'$••••':'$'+usd;
  document.getElementById('waddr').textContent='ADDR: '+(CU.address||'——');
  let txs=[];
  if(fbOK){const t=await fbGet('txs/'+(CU.uid||CU.id));txs=t?Object.values(t).sort((a,b2)=>b2.ts-a.ts):[];}
  else{const d=ldb();txs=(d.txs[CU.id]||[]).slice().reverse();}
  let sent=0,recv=0;
  txs.forEach(t=>{if(t.type==='out')sent+=t.amount;else recv+=t.amount;});
  document.getElementById('wssent').textContent=balHidden?'••••':fmt(sent);
  document.getElementById('wsrecv').textContent=balHidden?'••••':fmt(recv);
  document.getElementById('wstxc').textContent=txs.length;
  const list=document.getElementById('txlist');
  if(!txs.length){list.innerHTML='<div class="txempty">NO TRANSACTIONS YET</div>';}
  else{list.innerHTML=txs.map(t=>{
    const a=balHidden?'••••':(t.type==='out'?'- ':'+ ')+fmt(t.amount);
    return`<div class="txi"><div class="txl"><div class="txw">${t.type==='out'?'→ ':'← '}${esc(t.with)}</div>${t.note?`<div class="txn">"${esc(t.note)}"</div>`:''}<div class="txwh">${dateStr(t.ts)} · ${esc(t.id)}</div></div><div class="txa ${t.type==='in'?'in':'out'}">${a}</div></div>`;
  }).join('');}
  switchWalTab('history');
  openMod('walmod');
}

function switchWalTab(tab){
  ['history','exchange'].forEach(t=>{
    const el=document.getElementById('wtab-'+t);
    const btn=document.getElementById('wtbtn-'+t);
    if(el)el.style.display=t===tab?'block':'none';
    if(btn){btn.style.color=t===tab?'var(--gold)':'var(--gd)';btn.style.borderBottom=t===tab?'2px solid var(--gold)':'2px solid transparent';}
  });
}

// ── SIDEBAR ───────────────────────────────────────────────────
// (sidebar.js handles rendering)
