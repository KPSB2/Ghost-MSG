// ── MATRIX ──────────────────────────────────────────────────
const cv=document.getElementById('mc'),cx=cv.getContext('2d');
cv.width=window.innerWidth;cv.height=window.innerHeight;
const cols=Math.floor(cv.width/16),drops=Array(cols).fill(1);
const chs2='アイウエオ0123456789ABCDEF◈<>{}[]$¥€';
setInterval(()=>{cx.fillStyle='rgba(2,12,2,0.05)';cx.fillRect(0,0,cv.width,cv.height);cx.fillStyle='#00ff41';cx.font='14px Share Tech Mono';drops.forEach((y,i)=>{cx.fillText(chs2[Math.floor(Math.random()*chs2.length)],i*16,y*16);if(y*16>cv.height&&Math.random()>.975)drops[i]=0;drops[i]++;});},50);