// ── MATRIX ──────────────────────────────────────────────────
const cv=document.getElementById('mc'),cx=cv.getContext('2d');
cv.width=window.innerWidth;cv.height=window.innerHeight;
const cols=Math.floor(cv.width/16),drops=Array(cols).fill(1);
const chs2='アイウエオ0123456789ABCDEF◈<>{}[]$¥€';
setInterval(()=>{cx.fillStyle='rgba(2,12,2,0.05)';cx.fillRect(0,0,cv.width,cv.height);cx.fillStyle='#00ff41';cx.font='14px Share Tech Mono';drops.forEach((y,i)=>{cx.fillText(chs2[Math.floor(Math.random()*chs2.length)],i*16,y*16);if(y*16>cv.height&&Math.random()>.975)drops[i]=0;drops[i]++;});},50);

// ── FIREBASE INIT ─────────────────────────────────────────────
let db=null, auth=null, fbOK=false;
const isConfigured=()=>FIREBASE_CONFIG.apiKey!=='YOUR_API_KEY';
const isHttps=()=>location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1';

// authReady — a resettable promise that blocks DB ops until a user is signed in.
// _authReady holds the current promise; _authUnlock resolves it.
// On signout it resets so subsequent DB ops wait for the next signin.
let _authReady, _authUnlock;
function _resetAuthReady(){
  _authReady=new Promise(r=>{ _authUnlock=r; });
}
_resetAuthReady(); // initialise before Firebase loads

function authReady(){ return _authReady; }

// Internal email helper — users never see this address.
function ghostEmail(u){ return u.toLowerCase()+'@ghost-msg.local'; }

setTimeout(()=>{
  document.getElementById('boot').style.display='none';
  document.getElementById('app').style.display='flex';
  if(!isHttps()){
    document.getElementById('https-warn').style.display='block';
    _authUnlock(); // unblock so local fallback still works
  }
  if(!isConfigured()){
    document.getElementById('setup-warn').style.display='block';
    _authUnlock(); // local mode — unblock immediately
  } else {
    try{
      if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      db=firebase.database();
      auth=firebase.auth();
      fbOK=true; // Firebase is configured and initialized — always true from this point

      auth.onAuthStateChanged(async firebaseUser=>{
        if(firebaseUser){
          _authUnlock(); // unblock all pending DB operations
          console.log('[GHOST_MSG] Auth ready ✓', firebaseUser.uid);
          const badge=document.getElementById('auth-ok-badge');
          if(badge)badge.style.display='block';
          db.ref('.info/connected').on('value',snap=>{
            const on=snap.val()===true;
            const dot=document.querySelector('.sdot');
            const st=document.getElementById('conn-status');
            if(dot){dot.style.background=on?'var(--g)':'var(--red)';dot.style.boxShadow='0 0 6px '+(on?'var(--g)':'var(--red)');}
            if(st)st.textContent=on?'CONNECTED':'RECONNECTING...';
            if(on&&CU){if(CC)listenMessages(CC.id,CC.type);loadSidebar();}
          });
          if(!CU) await tryRestoreSession(firebaseUser);
        }
        // Note: we do NOT reset authReady on signout here — that would block
        // DB writes mid-registration. authReady resets only in logout().
      });

    }catch(e){
      document.getElementById('setup-warn').style.display='block';
      document.getElementById('fb-err-msg').textContent='Firebase error: '+e.message;
      console.error('Firebase init failed:', e);
      _authUnlock(); // unblock even on error so local fallback works
    }
  }
},2400);