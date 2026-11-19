/* Vídeo do tema escuro (escuro.html). Arquivo à parte: a CSP de /video/ só aceita script do próprio site. */
/* ============ utilidades ============ */
const $=(s,r=document)=>r.querySelector(s);
const stage=$('#stage'), scenesEl=$('#scenes'), capEl=$('#cap');
function fit(){const s=Math.min(innerWidth/1920,innerHeight/1080);stage.style.transform=`translate(${(innerWidth-1920*s)/2}px,${(innerHeight-1080*s)/2}px) scale(${s})`}
addEventListener('resize',fit);fit();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function rng(seed){return()=>(seed=(seed*1664525+1013904223)>>>0)/4294967296}
const mix=(a,b,t)=>{const p=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));const A=p(a),B=p(b);return'#'+A.map((v,i)=>Math.round(v+(B[i]-v)*t).toString(16).padStart(2,'0')).join('')};

/* ============ áudio ============ */
let AC=null,master,musicBus,sfxBus,noiseBuf,muted=false,musicTimer=null;
let useMp3=true; /* narração em MP3; vira false se narracao.mp3 falhar (aí a voz do navegador) */
function initAudio(){
  if(AC){AC.resume&&AC.resume();return}
  try{AC=new(window.AudioContext||window.webkitAudioContext)()}catch(e){AC=null;return}
  master=AC.createGain();master.gain.value=1;
  const comp=AC.createDynamicsCompressor();comp.threshold.value=-18;comp.ratio.value=3;
  master.connect(comp);comp.connect(AC.destination);
  musicBus=AC.createGain();musicBus.gain.value=.42;musicBus.connect(master);
  sfxBus=AC.createGain();sfxBus.gain.value=.8;sfxBus.connect(master);
  noiseBuf=AC.createBuffer(1,AC.sampleRate*2,AC.sampleRate);
  const d=noiseBuf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
  AC.resume&&AC.resume();
}
const mtof=m=>440*Math.pow(2,(m-69)/12);
function env(g,t,a,peak,d,end=.0008){g.gain.cancelScheduledValues(t);g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(peak,t+a);g.gain.exponentialRampToValueAtTime(end,t+a+d)}
function noise(t,dur,type,f0,f1,peak,a=.005,Q=1){
  if(!AC)return;const s=AC.createBufferSource();s.buffer=noiseBuf;s.loop=true;
  const f=AC.createBiquadFilter();f.type=type;f.Q.value=Q;f.frequency.setValueAtTime(f0,t);if(f1!==f0)f.frequency.exponentialRampToValueAtTime(f1,t+dur);
  const g=AC.createGain();env(g,t,a,peak,dur-a);s.connect(f);f.connect(g);g.connect(sfxBus);s.start(t,Math.random());s.stop(t+dur+.05);
}
function tone(t,type,f0,f1,dur,peak,a=.004,bus){
  if(!AC)return;const o=AC.createOscillator();o.type=type;o.frequency.setValueAtTime(f0,t);if(f1!==f0)o.frequency.exponentialRampToValueAtTime(f1,t+dur);
  const g=AC.createGain();env(g,t,a,peak,dur-a);o.connect(g);g.connect(bus||sfxBus);o.start(t);o.stop(t+dur+.05);
}
const sfx={
  whoosh(){if(!AC)return;const t=AC.currentTime;noise(t,.45,'bandpass',250,3400,.4,.12,1.1)},
  pop(){if(!AC)return;const t=AC.currentTime;tone(t,'sine',720,160,.13,.5);noise(t,.03,'highpass',3000,3000,.12)},
  tick(alt){if(!AC)return;const t=AC.currentTime;tone(t,'square',alt?1500:1100,alt?1500:1100,.035,.08);noise(t,.03,'bandpass',alt?3000:2200,alt?3000:2200,.2,.002,4)},
  ding(){if(!AC)return;const t=AC.currentTime;tone(t,'sine',1318,1318,1.3,.28);tone(t,'sine',2637,2637,.8,.07);tone(t+.002,'sine',1976,1976,.9,.06)},
  scratch(dur){if(!AC)return;const t=AC.currentTime;for(let i=0;i<9;i++){noise(t+i*dur/9,dur/10,'bandpass',2600+Math.random()*1800,2000+Math.random()*2000,.12,.01,2)}},
  stamp(){if(!AC)return;const t=AC.currentTime;tone(t,'sine',120,42,.32,.9,.003);noise(t,.14,'lowpass',900,200,.5,.002)},
  rumble(){if(!AC)return;const t=AC.currentTime;noise(t,.55,'lowpass',160,90,.5,.05)},
  holo(){if(!AC)return;const t=AC.currentTime;tone(t,'sine',52,118,1.0,.7,.25);tone(t+.1,'triangle',104,236,.9,.18,.3);tone(t+.5,'sine',880,1320,.7,.06,.2)},
  tap(){if(!AC)return;const t=AC.currentTime;tone(t,'sine',980,980,.07,.22)}
};
/* trilha: ~100 BPM, baixo + pad + hi-hat */
const CH=[{b:45,p:[57,60,64]},{b:41,p:[53,57,60]},{b:48,p:[55,60,64]},{b:43,p:[55,59,62]}];
let mStep=0,mNext=0;
function musicStart(){
  if(!AC||musicTimer)return;mStep=0;mNext=AC.currentTime+.1;
  musicTimer=setInterval(()=>{
    while(mNext<AC.currentTime+.5){musicStep(mStep,mNext);mNext+=.3;mStep++}
  },100);
}
function musicStop(){clearInterval(musicTimer);musicTimer=null}
function musicStep(n,t){
  const bar=Math.floor(n/8)%4,s=n%8,c=CH[bar];
  if(s===0){
    c.p.forEach((m,i)=>{
      [-4,4].forEach(dt=>{
        const o=AC.createOscillator();o.type='triangle';o.frequency.value=mtof(m);o.detune.value=dt+i;
        const f=AC.createBiquadFilter();f.type='lowpass';f.frequency.value=850;
        const g=AC.createGain();g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(.045,t+.7);g.gain.setValueAtTime(.045,t+1.9);g.gain.linearRampToValueAtTime(.0001,t+2.6);
        o.connect(f);f.connect(g);g.connect(musicBus);o.start(t);o.stop(t+2.7);
      });
    });
  }
  if(s===0||s===3||s===5){
    const m=c.b+(s===5?7:0);
    const o=AC.createOscillator();o.type='sine';o.frequency.value=mtof(m);
    const g=AC.createGain();env(g,t,.01,s===0?.34:.24,s===0?.7:.35);
    o.connect(g);g.connect(musicBus);o.start(t);o.stop(t+.85);
  }
  if(s%2===1){
    const sr=AC.createBufferSource();sr.buffer=noiseBuf;
    const h=AC.createBiquadFilter();h.type='highpass';h.frequency.value=7500;
    const g=AC.createGain();env(g,t,.002,s===7?.07:.045,s===7?.12:.04);
    sr.connect(h);h.connect(g);g.connect(musicBus);sr.start(t,Math.random()*1.5);sr.stop(t+.2);
  }
}
function duck(on){if(!AC)return;musicBus.gain.setTargetAtTime(on?.15:.42,AC.currentTime,.12)}
function setMuted(m){muted=m;try{NARR.muted=m}catch(e){}if(master)master.gain.setTargetAtTime(m?0:1,AC.currentTime,.05);$('#mw').style.display=m?'none':'';$('#mx').style.display=m?'':'none'}
$('#mute').onclick=e=>{e.stopPropagation();setMuted(!muted)};

/* ============ voz ============ */
let voice=null;
function pickVoice(){
  if(!('speechSynthesis' in window)){voice=null;showVoice();return}
  const vs=speechSynthesis.getVoices().filter(v=>(v.lang||'').replace('_','-').toLowerCase()==='pt-br');
  const order=[/natural/i,/francisca/i,/thalita/i,/antonio/i,/google/i];
  voice=null;
  for(const re of order){const v=vs.find(x=>re.test(x.name));if(v){voice=v;break}}
  if(!voice&&vs.length)voice=vs[0];
  showVoice();
}
function showVoice(){$('#voice').textContent=useMp3?'':(voice?('Voz · '+voice.name):'Voz · nenhuma pt-BR disponível — só legendas')}
if('speechSynthesis' in window){speechSynthesis.onvoiceschanged=pickVoice;pickVoice()}else showVoice();

/* ============ legenda ============ */
let capWords=[],capStart=[],capChars=[];
const norm=s=>s.toLowerCase().replace(/[.,!?]/g,'');
function setCaption(text,hl){
  capEl.style.visibility='visible';
  const ws=text.split(' ');let acc=0,tot=ws.reduce((a,w)=>a+w.length+1,0);
  capStart=[];capChars=[];let ch=0;
  capEl.innerHTML=ws.map(w=>{capStart.push(acc/tot);acc+=w.length+1;capChars.push(ch);ch+=w.length+1;
    return`<span class="w${(hl||[]).includes(norm(w))?' k':''}">${w}</span>`}).join(' ');
  capWords=[...capEl.children];
}
function showWords(n){capWords.forEach((w,i)=>w.classList.toggle('on',i<n))}
function wordAtChar(c){let k=0;for(let i=0;i<capChars.length;i++)if(capChars[i]<=c)k=i;return k}

let runId=0;

/* ============ narração em MP3 (a mesma do vídeo do tema claro: index.html / video.js) ============ */
/* início e fim de cada frase dentro de narracao.mp3, na ordem das cenas (as 11 falas são idênticas) */
const CUES=[[0.00,2.07],[2.33,4.29],[4.56,6.77],[6.99,10.30],[10.56,14.08],[14.42,15.17],[15.41,17.91],[18.14,21.10],[21.31,23.62],[23.93,26.60],[26.93,29.31]];
const NARR=new Audio('narracao.mp3');NARR.preload='auto';
NARR.addEventListener('error',()=>{useMp3=false;showVoice()});
function needGesture(){stopAll();$('#start').style.display='flex'}
function narrate(text,est,id){
  const k=window.__scene;
  if(!useMp3||!CUES[k])return narrateTTS(text,est,id);
  const a=CUES[k][0],b=CUES[k][1],dur=b-a;
  return new Promise(resolve=>{
    let done=false,raf=0,t0=performance.now();
    const finish=()=>{if(done)return;done=true;cancelAnimationFrame(raf);try{NARR.pause()}catch(e){}showWords(capWords.length);duck(false);resolve()};
    const tick=()=>{if(done||id!==runId)return;
      const f=(performance.now()-t0)/1000/dur;let n=0;capStart.forEach((st,i)=>{if(f>=st)n=i+1});showWords(n);
      if(NARR.currentTime>=b){finish();return}
      raf=requestAnimationFrame(tick)};
    try{NARR.currentTime=a}catch(e){}
    NARR.muted=muted;
    const p=NARR.play();
    duck(true);
    if(p&&p.catch)p.catch(()=>needGesture());
    tick();
    setTimeout(finish,(dur+1.5)*1000);
  });
}
/* voz do navegador: só se o MP3 falhar */
function narrateTTS(text,est,id){
  return new Promise(resolve=>{
    let done=false,gotB=false,t0=performance.now(),raf=0,wd=0;
    const finish=()=>{if(done)return;done=true;cancelAnimationFrame(raf);clearTimeout(wd);showWords(capWords.length);duck(false);resolve()};
    const tick=()=>{if(done||id!==runId)return;
      if(!gotB){const f=(performance.now()-t0)/1000/est;let n=0;capStart.forEach((s,i)=>{if(f>=s)n=i+1});showWords(n)}
      raf=requestAnimationFrame(tick)};tick();
    if(!voice||!('speechSynthesis' in window)){wd=setTimeout(finish,est*1000);return}
    try{
      const u=new SpeechSynthesisUtterance(text);u.lang='pt-BR';u.voice=voice;u.rate=1.05;u.volume=muted?0:1;
      u.onstart=()=>{t0=performance.now();duck(true)};
      u.onboundary=e=>{if(e.charIndex!==undefined){gotB=true;showWords(wordAtChar(e.charIndex)+1)}};
      u.onend=finish;u.onerror=finish;
      wd=setTimeout(finish,Math.max(est*2200,6500));
      speechSynthesis.cancel();speechSynthesis.speak(u);
      duck(true);
    }catch(e){wd=setTimeout(finish,est*1000)}
  });
}

/* ============ blocos visuais ============ */
const bubble=(size,cls,style)=>`<div class="bub ${cls||''}" style="width:${size}px;height:${size}px;font-size:${size}px;${style||''}"><div class="bub-body"><div class="eyes"><i class="eye"><b></b></i><i class="eye"><b></b></i></div><div class="mouth"></div></div></div>`;
const dots=(n)=>Array.from({length:5},(_,i)=>`<i data-i="${i}"></i>`).join('');

/* cidade: Voronoi com 94 bairros (Recife) */
let CITY=null;
function buildCity(){
  if(CITY)return CITY;
  const R=rng(11),W=1000,H=760,cx=500,cy=380,rx=470,ry=345;
  const rr=t=>1+.07*Math.sin(3*t+.6)+.05*Math.sin(5*t+2);
  const inside=(x,y)=>{const t=Math.atan2((y-cy)/ry,(x-cx)/rx);return Math.hypot((x-cx)/rx,(y-cy)/ry)<rr(t)-.03};
  const blob=[];for(let i=0;i<72;i++){const t=i/72*Math.PI*2,r=rr(t);blob.push([cx+rx*r*Math.cos(t),cy+ry*r*Math.sin(t)])}
  const blobD='M'+blob.map(p=>p[0].toFixed(1)+' '+p[1].toFixed(1)).join('L')+'Z';
  let sites=[],dmin=80,tries=0;
  while(sites.length<94){
    const x=R()*W,y=R()*H;tries++;
    if(inside(x,y)&&sites.every(s=>Math.hypot(s[0]-x,s[1]-y)>dmin))sites.push([x,y]);
    if(tries>3000&&sites.length<94){dmin*=.95;tries=0}
  }
  const clip=(poly,a,b,c)=>{const out=[];for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length];const dp=a*p[0]+b*p[1]-c,dq=a*q[0]+b*q[1]-c;
    if(dp<=0)out.push(p);if((dp<0&&dq>0)||(dp>0&&dq<0)){const t=dp/(dp-dq);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t])}}return out};
  const cells=sites.map((s,i)=>{let poly=[[0,0],[W,0],[W,H],[0,H]];
    sites.forEach((o,j)=>{if(i===j)return;const a=o[0]-s[0],b=o[1]-s[1],c=(o[0]*o[0]+o[1]*o[1]-s[0]*s[0]-s[1]*s[1])/2;poly=clip(poly,a,b,c)});
    return poly});
  const hot=[530,350];let target=0,bd=1e9;
  sites.forEach((s,i)=>{const d=Math.hypot(s[0]-hot[0],s[1]-hot[1]);if(d<bd){bd=d;target=i}});
  const R2=rng(5);
  const score=sites.map((s,i)=>i===target?1e6:-Math.hypot(s[0]-hot[0],s[1]-hot[1])+R2()*210);
  const order=sites.map((_,i)=>i).sort((a,b)=>score[b]-score[a]);
  const rank=[];order.forEach((i,r)=>rank[i]=r);
  CITY={sites,cells,blobD,target,rank,order};
  return CITY;
}
const STOPS=['#12304F','#16456C','#2D6A9B','#639CC5','#A9CBE3'];
const rankColor=r=>{if(r===0)return'#E8895A';const t=Math.pow(1-r/93,1.2)*4,i=Math.min(3,Math.floor(t));return mix(STOPS[i],STOPS[i+1],t-i)};

/* holograma da unidade */
function holoHTML(){
  const W=300,D=230,H=190;
  const f=(w,h,tf,st,inner,cls)=>`<div class="f ${cls||''}" style="width:${w}px;height:${h}px;margin:${-h/2}px 0 0 ${-w/2}px;transform:${tf};${st||''}">${inner||''}</div>`;
  const side=(a,w,d,st,inner)=>f(w,H,`rotateZ(${a}deg) translate3d(0,${d/2}px,${H/2}px) rotateX(-90deg)`,st,inner);
  const frontIn=`<div style="position:absolute;left:8%;top:8%;width:84%;height:17%;background:#010F1E"><div style="position:absolute;left:6%;top:42%;width:34%;height:16%;background:#E8895A"></div></div>
   <div style="position:absolute;left:8%;top:42%;width:56%;height:42%;background:#E8895A;border:4px solid #010F1E"><div style="position:absolute;left:33%;top:0;bottom:0;width:4px;background:#010F1E"></div><div style="position:absolute;left:66%;top:0;bottom:0;width:4px;background:#010F1E"></div><div style="position:absolute;left:8%;bottom:0;width:20%;height:42%;background:#C46A3D"></div><div style="position:absolute;left:40%;bottom:0;width:20%;height:58%;background:#C46A3D"></div></div>
   <div style="position:absolute;left:72%;top:38%;width:20%;height:62%;background:#010F1E"><div style="position:absolute;right:14%;top:52%;width:9%;height:6%;border-radius:50%;background:#E8895A"></div></div>`;
  const sideIn=`<div style="position:absolute;left:16%;top:34%;width:22%;height:32%;background:#E8895A;opacity:.9;border:4px solid #010F1E"></div><div style="position:absolute;left:62%;top:34%;width:22%;height:32%;background:#E8895A;opacity:.9;border:4px solid #010F1E"></div>`;
  let h='';
  h+=side(0,W,D,'background:#0B2B4B',frontIn);
  h+=side(180,W,D,'background:#08233F');
  h+=side(90,D,W,'background:#08233F',sideIn);
  h+=side(270,D,W,'background:#08233F',sideIn);
  h+=f(W,D,`translate3d(0,0,${H}px)`,'background:#071E36');
  h+=f(W+14,16,`translate3d(0,${D/2+4}px,${H-6}px)`,'background:#010F1E;border:none');
  const ext=70,drop=44,L=Math.hypot(ext,drop),ang=Math.atan2(drop,ext)*180/Math.PI;
  h+=f(W*.92,L,`translate3d(0,${D/2+ext/2}px,${H*.70-drop/2}px) rotateX(-${ang}deg)`,'background:repeating-linear-gradient(90deg,#E8895A 0 32px,#C46A3D 32px 64px);border:none');
  const box=(x,y,w,d,hh)=>{
    let s='';[0,90,180,270].forEach(a=>{const ww=a%180?d:w,dd=a%180?w:d;s+=f(ww,hh,`rotateZ(${a}deg) translate3d(0,${dd/2}px,${hh/2}px) rotateX(-90deg)`,'background:#0B2B4B')});
    s+=f(w,d,`translate3d(0,0,${hh}px)`,'background:radial-gradient(circle at 25% 30%,#E8895A 0 7px,transparent 8px),radial-gradient(circle at 70% 35%,#C46A3D 0 7px,transparent 8px),radial-gradient(circle at 45% 72%,#E8895A 0 7px,transparent 8px),#071E36;border:none');
    return`<div class="bx" style="transform:translate3d(${x}px,${y}px,0)">${s}</div>`};
  h+=box(-W/2+22,D/2+60,52,40,40)+box(W/2-22,D/2+60,52,40,40);
  const beamB=`<div class="bp" style="transform:translate3d(0,0,60px) rotateX(-90deg)"></div><div class="bp" style="transform:translate3d(0,0,60px) rotateZ(90deg) rotateX(-90deg)"></div>`;
  return`<div class="ring"></div><div class="ring2"></div>${beamB}<div class="lift"><div class="spin">${h}</div></div>`;
}

/* ============ helpers de movimento ============ */
const el=h=>{const t=document.createElement('div');t.innerHTML=h.trim();return t.firstElementChild};
const sq=b=>{b.classList.remove('sq');void b.offsetWidth;b.classList.add('sq')};
function addProp(r,h){const e=el(h);e.classList.add('prop');r.appendChild(e);return e}
function clearProps(r){r.querySelectorAll('.prop').forEach(p=>{p.classList.add('x');setTimeout(()=>p.remove(),480)})}
let hero=null;
function mkHero(r){hero=el(`<div id="hero" style="position:absolute;left:330px;top:470px;width:300px;height:300px;transform-origin:50% 100%;z-index:5">${bubble(300,'','left:0;top:0')}</div>`);r.appendChild(hero);return hero}
function hm(x,y,sx,sy,rot,dur,ease){hero.style.transition=dur?`transform ${dur}s ${ease||'cubic-bezier(.34,1.56,.64,1)'}`:'none';hero.style.transform=`translate(${x}px,${y}px) rotate(${rot||0}deg) scale(${sx},${sy})`}
const hb=()=>hero.querySelector('.bub');
function burst(r,x,y,n,col,dist){n=n||12;col=col||'#E8895A';dist=dist||180;
  for(let i=0;i<n;i++){const d=el(`<i style="position:absolute;left:${x}px;top:${y}px;width:${10+Math.random()*12}px;height:${10+Math.random()*12}px;margin:-8px;border-radius:50%;background:${col};z-index:6"></i>`);r.appendChild(d);
    const a=Math.random()*6.283,k=dist*(.45+Math.random()*.8);
    d.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${Math.cos(a)*k}px,${Math.sin(a)*k+60}px) scale(0)`,opacity:.2}],{duration:650+Math.random()*350,easing:'cubic-bezier(.2,.8,.3,1)'}).onfinish=()=>d.remove()}}
function ripple(r,x,y,big){const d=el(`<div class="rip" style="left:${x}px;top:${y}px"></div>`);if(big)d.style.setProperty('--k',big);r.appendChild(d);setTimeout(()=>d.remove(),900)}
sfx.boing=()=>{if(!AC)return;const t=AC.currentTime;const o=AC.createOscillator();o.type='sine';const g=AC.createGain();
  o.frequency.setValueAtTime(220,t);o.frequency.exponentialRampToValueAtTime(520,t+.08);o.frequency.exponentialRampToValueAtTime(180,t+.35);
  env(g,t,.004,.5,.4);o.connect(g);g.connect(sfxBus);o.start(t);o.stop(t+.45)};
sfx.slurp=()=>{if(!AC)return;const t=AC.currentTime;noise(t,.7,'bandpass',1400,180,.5,.1,3);tone(t,'sine',420,110,.7,.2,.05)};
sfx.snap=()=>{if(!AC)return;const t=AC.currentTime;noise(t,.08,'highpass',2500,2500,.5,.001);tone(t,'triangle',1800,300,.18,.35,.001)};
sfx.thud=()=>{if(!AC)return;const t=AC.currentTime;tone(t,'sine',140,50,.22,.7,.002);noise(t,.06,'lowpass',700,200,.25,.001)};

/* ============ cenas ============ */
const SCENES=[
/* 1 — gancho */
{text:'Você achou que não tinha concorrência.',hl:['concorrência'],mount(r,c){
  let shops='';for(let i=0;i<24;i++){const col=i%8,row=Math.floor(i/8);shops+=`<svg class="shop" style="animation-delay:${Math.hypot(col-3.5,(row-1)*1.6)*80}ms"><use href="#shop"/></svg>`}
  const lt=(t,cls,d0)=>t.split('').map((ch,i)=>`<span class="ch ${cls||''}" style="animation-delay:${d0+i*.04}s">${ch}</span>`).join('');
  const fl=[[250,200,46],[330,640,30],[1640,180,34],[1700,560,52],[1560,760,26],[300,420,22],[1500,70,24],[800,70,20]].map(([x,y,s],i)=>`<i class="fl" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;animation-delay:${i*.12}s"></i>`).join('');
  r.innerHTML=`<div class="fls" id="fls">${fl}</div>
  <div class="pw" id="pw" style="left:400px;top:120px;width:1120px;height:660px"><div class="flip" id="flip">
   <div class="panel face" style="left:0;top:0;width:100%;height:100%">
     <div class="lbl" style="position:absolute;left:56px;top:50px">Painel · bairro exemplo</div>
     <div class="pill" style="position:absolute;right:56px;top:36px">Concorrência</div>
     <div class="h1" style="position:absolute;left:56px;top:120px">${lt('Pouca','',.2)}<br>${lt('concorrência','it',.45)}</div>
     <svg style="position:absolute;right:70px;top:370px" width="420" height="250" viewBox="0 0 420 250"><path d="M30 230A180 180 0 0 1 390 230" stroke="#071E36" stroke-width="34" fill="none" stroke-linecap="round"/><path id="g1" d="M30 230A180 180 0 0 1 390 230" stroke="#E8895A" stroke-width="34" fill="none" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" style="transition:stroke-dashoffset 1.1s cubic-bezier(.3,1.3,.3,1)"/></svg>
     <div class="lbl" style="position:absolute;left:56px;top:560px">Nível · baixo</div>
   </div>
   <div class="panel face back" id="bk" style="left:0;top:0;width:100%;height:100%">
     <div class="lbl" style="position:absolute;left:56px;top:54px;color:#F4F8FB">Estabelecimentos do mesmo tipo · já instalados</div>
     <div class="shops">${shops}</div>
     <div class="lbl" style="position:absolute;left:56px;bottom:44px">Fonte · Receita Federal — CNPJ</div>
   </div></div></div>`;
  c.at(500,()=>{$('#g1').style.strokeDashoffset=82;sfx.ding()});
  c.at(1650,()=>{$('#pw').classList.add('shake');sfx.rumble()});
  c.at(2050,()=>{$('#flip').style.transform='rotateY(180deg)';sfx.whoosh();
    document.querySelectorAll('#fls .fl').forEach((f,i)=>{f.style.transition='transform .6s cubic-bezier(.2,.8,.3,1),opacity .6s';f.style.transform=`translate(${(i%2?1:-1)*(200+i*30)}px,${(i%3-1)*160}px) scale(3)`;f.style.opacity=0})});
  c.at(2600,()=>{$('#bk').classList.add('go');[0,90,180,280,380].forEach(d=>c.at(d,()=>sfx.pop()))});
}},
/* 2 — contrato (mascote cai) */
{text:'O contrato já estava assinado.',hl:['assinado'],min:3.2,tr:'wipe',wx:960,wy:450,mount(r,c){
  r.innerHTML=`<div class="ground" id="gr"></div>`;
  mkHero(r);const b=hb();b.style.setProperty('--lx','.035em');
  hm(0,-950,.9,1.15,0,0);void hero.offsetWidth;
  c.at(80,()=>hm(0,0,.9,1.15,0,.5,'cubic-bezier(.55,0,.85,.45)'));
  c.at(600,()=>{sq(b);hm(0,0,1,1,0,.45,'cubic-bezier(.3,1.8,.5,1)');sfx.thud();ripple(r,480,770,16);burst(r,480,770,10,'#E8895A',200)});
  c.at(450,()=>{
    addProp(r,`<div class="paper" id="pp" style="left:960px;top:100px;width:600px;height:730px;transform:rotate(2deg)">
      <div class="lbl dk" style="margin:54px 0 0 56px">Contrato de locação</div>
      <div class="ptitle" style="margin:22px 56px 28px">Prazo<br><em>5 anos</em></div>
      <div class="pline"></div><div class="pline" style="width:80%"></div><div class="pline" style="width:90%"></div><div class="pline" style="width:60%"></div>
      <svg style="position:absolute;left:70px;top:520px" width="420" height="120" viewBox="0 0 420 120"><path d="M0 100H420" stroke="#D5E0EA" stroke-width="3"/><path id="sg" d="M10 80C40 10 60 110 90 50S130 20 150 70S200 100 230 40S270 90 300 60L400 62" stroke="#010F1E" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg>
      <svg id="pen" style="position:absolute;left:0;top:0;width:80px;height:80px;opacity:0" viewBox="0 0 80 80"><path d="M2 78L10 52L62 0L80 18L28 70Z" fill="#0B2B4B"/><path d="M2 78L10 52L20 62Z" fill="#C46A3D"/></svg>
      <div class="stamp" id="st">Assinado</div></div>`);
    sfx.whoosh()});
  c.at(1200,()=>{const sg=$('#sg'),pen=$('#pen'),len=sg.getTotalLength();sfx.scratch(.9);const t0=performance.now();pen.style.opacity=1;
    const loop=()=>{if(c.dead)return;const p=Math.min(1,(performance.now()-t0)/900);const e=p<.5?2*p*p:1-Math.pow(-2*p+2,2)/2;
      sg.style.strokeDashoffset=100*(1-e);const pt=sg.getPointAtLength(len*e);pen.style.left=(70+pt.x-4)+'px';pen.style.top=(520+pt.y-76)+'px';
      if(p<1)requestAnimationFrame(loop);else pen.style.opacity=0};loop()});
  c.at(2250,()=>{$('#st').classList.add('on');sfx.stamp();r.classList.add('shakeR');setTimeout(()=>r.classList.remove('shakeR'),400);
    b.classList.add('shock');sq(b);ripple(r,1380,600,10);burst(r,1380,600,14,'#C46A3D',220)});
}},
/* 3 — concorrente (o mascote se divide) */
{text:'O concorrente estava a duas quadras.',hl:['duas','quadras'],continues:true,mount(r,c){
  clearProps(r);const b=hb();b.classList.remove('shock');b.style.setProperty('--lx','.05em');
  const bl=(l,t,w,h,col,i)=>addProp(r,`<div class="bl" style="left:${l}px;top:${t}px;width:${w}px;height:${h}px;background:${col};animation-delay:${i*.12}s"><i style="left:30px;top:40px"></i><i style="left:84px;top:40px"></i><i style="left:${w-60}px;top:40px"></i><i style="left:30px;top:120px"></i><i style="left:${w-60}px;top:120px"></i></div>`);
  bl(820,540,200,230,'#08233F',0);bl(1050,480,170,290,'#0B2B4B',1);
  sfx.whoosh();
  c.at(250,()=>{
    hm(36,0,1.14,.9,0,.35,'ease-out');
    const g=addProp(r,`<div class="goo" style="left:300px;top:400px;width:1300px;height:420px"><i style="left:40px;top:80px;width:280px;height:280px"></i><i id="gB" style="left:55px;top:95px;width:250px;height:250px"></i></div>`);
    $('#gB').animate([{transform:'translate(0,0) scale(1)'},{transform:'translate(300px,-190px) scale(.9)',offset:.35},{transform:'translate(700px,10px) scale(1.08,.9)',offset:.75},{transform:'translate(1020px,25px) scale(1)'}],{duration:1150,easing:'cubic-bezier(.45,.05,.4,1)',fill:'forwards'});
    c.at(450,()=>hm(0,0,1,1,0,.7,'cubic-bezier(.3,1.9,.5,1)'));
    c.at(1180,()=>{const bb=addProp(r,bubble(250,'dark pop','left:1260px;top:520px;--lx:-.03em').replace('class="bub dark pop"','class="bub dark pop" id="b2"'));g.classList.add('x');sfx.pop();ripple(r,1385,770,10)});
  });
  c.at(1500,()=>{
    addProp(r,`<svg class="abs" style="left:0;top:0;pointer-events:none" width="1920" height="1080"><path d="M520 400H1380" stroke="#E8895A" stroke-width="5" stroke-dasharray="14 12" pathLength="100" style="stroke-dashoffset:100;animation:draw .7s cubic-bezier(.5,0,.2,1) forwards"/><path d="M520 380V420M1380 380V420" stroke="#E8895A" stroke-width="5"/></svg>`);
    addProp(r,`<div class="kin" style="left:560px;width:800px;top:230px"><span class="n" style="animation-delay:.05s">2</span> <span class="it" style="animation-delay:.18s">quadras</span></div>`);sfx.tap()});
}},
/* 4 — comércios longe (elástico) */
{text:'Comércios que ajudariam sua venda ficavam longe demais.',hl:['comércios','longe'],continues:true,mount(r,c){
  clearProps(r);const b=hb();b.style.setProperty('--lx','.055em');
  hero.style.transformOrigin='10% 100%';
  c.at(300,()=>{addProp(r,`<div id="shopw" class="abs shopin" style="left:1060px;top:420px;width:350px;height:380px"><svg width="350" height="350"><use href="#shop"/></svg><div class="lbl" style="text-align:center;margin-top:20px;white-space:nowrap">Comércio complementar</div></div>`);
    addProp(r,`<svg class="abs" style="left:0;top:0;pointer-events:none" width="1920" height="1080"><path id="rope" d="" stroke="#E8895A" stroke-width="8" fill="none" stroke-linecap="round"/></svg>`);sfx.pop()});
  c.at(1100,()=>{const sh=$('#shopw'),rope=$('#rope');if(!sh)return;sfx.whoosh();const t0=performance.now();let snapped=false;
    const step=()=>{if(c.dead&&!snapped&&performance.now()-t0>3000)return;
      const p=Math.min(1,(performance.now()-t0)/1250),e=p*p*p;
      sh.style.transformOrigin='50% 100%';sh.style.transform=`translate(${e*620}px,${-e*30}px) scale(${1-.88*e})`;sh.style.animation='none';sh.style.opacity=1;
      const sx=1+.9*e,sy=1-.2*e;hm(0,0,sx,sy,0,0);
      const left=360-30*sx,right=left+300*sx;const x2=1235+e*620,y2=690-e*20;
      rope.setAttribute('d',`M${right-20} 655Q${(right+x2)/2} ${700+Math.sin(p*30)*3*(1-e)} ${x2} ${y2}`);rope.setAttribute('stroke-width',8*(1-.75*e));
      if(p<1)requestAnimationFrame(step);else{snapped=true;sfx.snap();rope.animate([{opacity:1},{opacity:0}],{duration:140,fill:'forwards'});
        hm(0,0,1,1,0,.9,'cubic-bezier(.3,2,.5,1)');sq(b);b.classList.add('worry');ripple(r,480,770,8)}};
    step()});
}},
/* 5 — madrugada (o mascote derrete) */
{text:'O dado existia. Estava público. E de graça.',hl:['público','graça'],continues:true,mount(r,c){
  clearProps(r);const b=hb();b.classList.remove('worry');hero.style.transformOrigin='50% 100%';
  addProp(r,'<div class="night"></div>');
  const R=rng(9);let st='';for(let i=0;i<26;i++)st+=`<i class="star" style="left:${R()*1900}px;top:${R()*700}px;animation-delay:${R()*3}s"></i>`;
  addProp(r,`<div class="abs" style="inset:0">${st}</div>`);
  c.at(350,()=>{b.classList.add('sleepy');hm(0,0,1.9,.2,0,1,'cubic-bezier(.6,0,.3,1)');sfx.slurp();
    addProp(r,`<div class="goo" style="left:130px;top:690px;width:760px;height:120px"><i style="left:80px;top:62px;width:560px;height:40px;opacity:0;animation:fadeIn .5s .5s forwards"></i><i style="left:140px;top:44px;width:80px;height:60px;opacity:0;animation:fadeIn .5s .6s forwards"></i><i style="left:420px;top:48px;width:110px;height:56px;opacity:0;animation:fadeIn .5s .7s forwards"></i></div>`)});
  const nm=['cnpj.csv','malha_bairros.shp','censo2022.zip','cnes.csv','dados.xlsx','municipios.shp'];let cards='';
  for(let i=0;i<14;i++){const x=830+R()*360,y=170+R()*430,rot=(R()-.5)*18,tab=i%3===1;
    cards+=tab?`<div class="card6" style="left:${x}px;top:${y}px;width:340px;height:200px;--r:${rot}deg;animation-delay:${.35+i*.15}s"><div class="hd">Mapa</div><svg width="340" height="166" viewBox="0 0 340 166" style="position:absolute;top:34px"><rect width="340" height="166" fill="#08233F"/><path d="M0 120L90 60L170 100L250 30L340 80" stroke="#1E4468" stroke-width="6" fill="none"/><path d="M60 166L130 0M210 166L260 0" stroke="#174062" stroke-width="5"/><circle cx="170" cy="86" r="14" fill="#E8895A"/></svg></div>`
    :`<div class="card6" style="left:${x}px;top:${y}px;width:310px;height:210px;--r:${rot}deg;animation-delay:${.35+i*.15}s"><div class="hd">${nm[i%nm.length]}</div><div class="gr"></div></div>`}
  addProp(r,`<div class="abs" style="inset:0">${cards}</div>`);
  for(let i=0;i<14;i+=2)c.at(350+i*150+300,()=>sfx.thud());
  let ticks='';for(let i=0;i<12;i++)ticks+=`<line x1="160" y1="20" x2="160" y2="${i%3?32:40}" stroke="#A9BDCF" stroke-width="${i%3?3:5}" transform="rotate(${i*30} 160 160)"/>`;
  addProp(r,`<div class="clock" style="animation:propIn .7s .2s cubic-bezier(.3,1.6,.5,1) both"><svg width="320" height="320" viewBox="0 0 320 320"><circle cx="160" cy="160" r="150" fill="#0B2B4B" stroke="#1E4468" stroke-width="4"/>${ticks}
   <line x1="160" y1="160" x2="160" y2="70" stroke="#F4F8FB" stroke-width="8" stroke-linecap="round"/><line x1="160" y1="160" x2="${160+Math.sin(1.0472)*62}" y2="${160-Math.cos(1.0472)*62}" stroke="#F4F8FB" stroke-width="11" stroke-linecap="round"/>
   <g id="sec"><line x1="160" y1="180" x2="160" y2="46" stroke="#E8895A" stroke-width="4" stroke-linecap="round"/></g><circle cx="160" cy="160" r="9" fill="#E8895A"/></svg>
   <div class="lbl" style="text-align:center;margin-top:18px;font-size:34px;color:#F4F8FB">02:00</div><div class="lbl" style="text-align:center;margin-top:6px">Madrugada</div></div>`);
  let s=0,alt=0;c.every(1000,()=>{s++;const sc=$('#sec');if(sc)sc.setAttribute('transform',`rotate(${s*6} 160 160)`);sfx.tick(alt^=1)});
}},
/* 6 — logo (o mascote vira o V) */
{text:'VICUS.',hl:[],noCap:true,min:3.4,continues:true,mount(r,c){
  clearProps(r);const b=hb();b.classList.remove('sleepy');
  const g=$('.ground',r);if(g){g.style.transition='opacity .4s';g.style.opacity=0}
  hm(0,0,1,1,0,.5,'cubic-bezier(.3,1.8,.5,1)');sfx.boing();
  c.at(600,()=>{hm(480,-452,.12,.12,0,.5,'cubic-bezier(.6,0,.9,.5)');sfx.whoosh()});
  c.at(1120,()=>{hero.style.opacity=0;burst(r,960,320,16,'#E8895A',230);ripple(r,960,320,12);sfx.ding();
    r.insertAdjacentHTML('beforeend',`<div class="abs" style="left:0;right:0;top:190px;display:flex;justify-content:center"><svg width="230" height="230" viewBox="0 0 200 200"><path class="vpath" d="M30 30L100 170L170 30" fill="none" stroke="#E8895A" stroke-width="34" stroke-linejoin="miter" pathLength="100"/></svg></div>`)});
  c.at(1350,()=>{r.insertAdjacentHTML('beforeend',`<div class="abs wm" style="left:0;right:0;top:490px">${'VICUS'.split('').map((l,i)=>`<span style="animation-delay:${i*.08}s">${l}</span>`).join('')}</div><div class="lbl abs" style="left:0;right:0;top:710px;text-align:center;animation:cr .6s .5s both">Do latim · bairro, vizinhança, rua</div>`)});
}},
/* 7 — função 1 */
{text:'Você diz o que importa para o seu negócio.',hl:['importa'],tr:'wipe',wx:960,wy:320,mount(r,c){
  const row=(n,w)=>`<div class="row"><div class="rn">${n}</div><div style="display:flex;align-items:center;gap:22px"><div class="dots" data-w="${w}">${dots()}</div><div class="wv"></div></div></div>`;
  r.innerHTML=`<div class="lbl abs" style="left:0;right:0;top:70px;text-align:center;animation:cr .5s .1s both">Negócio · academia (exemplo) · peso de 1 a 5</div>
  <div class="card cl" style="left:200px;top:140px;width:720px;height:560px;animation-delay:.05s"><div class="hd"><div class="ic" style="background:var(--cu);color:var(--g1)">+</div>Quero <span class="sf">perto</span></div>${row('Fisioterapia',4)}${row('Loja de suplementos',3)}<div class="addrow">+ adicionar critério</div></div>
  <div class="card cr" style="left:980px;top:140px;width:720px;height:560px;animation-delay:.2s"><div class="hd"><div class="ic" style="border:4px solid var(--tx2);color:var(--tx2)">−</div>Quero <span class="sf">longe</span></div>${row('Outra academia',5)}<div class="addrow">+ adicionar critério</div></div>`;
  let delay=800;
  document.querySelectorAll('.dots').forEach(d=>{const w=+d.dataset.w;const v=d.parentNode.querySelector('.wv');
    for(let i=0;i<w;i++){c.at(delay,()=>{d.children[i].classList.add('on');v.textContent=i+1;v.classList.remove('bump');void v.offsetWidth;v.classList.add('bump');sfx.tap()});delay+=160}
    delay+=260});
}},
/* 8 — função 2: mapa */
{text:'O mapa ordena os bairros pelos seus critérios.',hl:['mapa','ordena'],tr:'whip',mount(r,c){
  const C=buildCity();
  const pts=[[-60,5.2],[-57,5],[-54,2.3],[-51.6,4],[-50,1.5],[-50.3,-.3],[-48,-.8],[-46,-1],[-44.2,-2.4],[-41.5,-2.9],[-39,-3],[-37.2,-4.6],[-35.2,-5.3],[-34.8,-7],[-35.2,-9],[-36.5,-10.6],[-37.3,-11.5],[-38.5,-13],[-39,-15.5],[-39.2,-17.8],[-40,-20],[-41,-22],[-42,-23],[-44.5,-23.3],[-46.5,-24],[-48.5,-26],[-48.6,-28],[-50.5,-30],[-53,-33.5],[-53.5,-33.7],[-55.5,-30.5],[-57.6,-30.2],[-56,-28.2],[-54.5,-27.2],[-54.2,-25.6],[-54.6,-24],[-55.8,-22.5],[-57.8,-22],[-58,-20],[-57.8,-18],[-58.5,-16.3],[-60,-15],[-60.5,-13.5],[-63,-12.5],[-65.4,-10.4],[-68.5,-11],[-70.5,-11],[-73,-9.5],[-72.8,-7.5],[-70,-4.5],[-69.5,-4],[-70.2,-2],[-69.5,-1],[-69.8,1],[-67.5,2.2],[-65.8,1.2],[-64,4.2],[-62,3.5]];
  const k=19,P=([lo,la])=>[(lo+74)*k,(5.5-la)*k];
  const bd='M'+pts.map(p=>P(p).map(v=>v.toFixed(1)).join(' ')).join('L')+'Z';
  const rec=P([-34.88,-8.05]);const bx=580,by=70,S=16,tx=960-bx-S*rec[0],ty=450-by-S*rec[1];
  const cells=C.cells.map((p,i)=>`<path class="cell" id="cl${i}" d="M${p.map(q=>q[0].toFixed(1)+' '+q[1].toFixed(1)).join('L')}Z"/>`).join('');
  let badges='';for(let rk=0;rk<9;rk++){const i=C.order[rk],s=C.sites[i];badges+=`<g class="bdg" id="bd${rk}" style="opacity:0;transform-box:fill-box;transform-origin:center;transform:scale(0);transition:transform .45s cubic-bezier(.3,1.8,.5,1),opacity .2s"><circle cx="${s[0].toFixed(1)}" cy="${s[1].toFixed(1)}" r="21" fill="#010F1E"/><text class="badge badge-c" x="${s[0].toFixed(1)}" y="${(s[1]+1).toFixed(1)}">${rk+1}</text></g>`}
  const sw=STOPS.map(c=>`<i style="background:${c}"></i>`).join('');
  r.innerHTML=`<div class="crumbs" id="cr9"></div>
   <div class="bg" id="bz" style="transform-origin:0 0"><svg width="800" height="780" viewBox="0 0 800 780" style="overflow:visible"><path d="${bd}" fill="#0B2B4B" stroke="#A9BDCF" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><circle id="rdot" cx="${rec[0].toFixed(1)}" cy="${rec[1].toFixed(1)}" r="8" fill="#E8895A" style="transition:opacity .35s"/></svg></div>
   <div class="persp"><div class="plate" id="plate" style="transform:translate(0px,0px) rotateX(0deg) rotateZ(0deg) scale(.1);opacity:0">
     <svg width="1000" height="760" viewBox="0 0 1000 760" style="position:absolute;inset:0"><defs><clipPath id="blob"><path d="${C.blobD}"/></clipPath></defs><g clip-path="url(#blob)" id="cg">${cells}</g><path d="${C.blobD}" fill="none" stroke="#000" stroke-width="6"/><g id="bgs">${badges}</g></svg></div></div>
   <div class="legend" id="lg" style="opacity:0"><div class="lbl" style="margin-bottom:6px">Combina com os critérios</div><div class="sw">${sw}</div><div class="ends"><span>Menos</span><span>Mais</span></div><div class="lbl" style="margin-top:34px;font-size:16px;opacity:.7">Exemplo ilustrativo</div></div>
   <div class="osm">© OpenStreetMap contributors</div>`;
  const cr=$('#cr9');
  const add=t=>{if(cr.children.length)cr.insertAdjacentHTML('beforeend','<span class="sep">›</span>');cr.insertAdjacentHTML('beforeend',`<span class="cur">${t}</span>`);cr.querySelectorAll('.cur').forEach((e,i,a)=>{if(i<a.length-1)e.classList.remove('cur')})};
  add('Brasil');
  c.at(60,()=>{$('#bz').style.transition='transform 1.7s cubic-bezier(.65,0,.25,1),opacity .4s';$('#bz').style.transform=`translate(${tx}px,${ty}px) scale(${S})`;sfx.whoosh()});
  c.at(500,()=>{add('Nordeste');sfx.tick(0)});c.at(850,()=>{add('Pernambuco');sfx.tick(1)});c.at(1200,()=>{add('Recife');sfx.tick(0)});
  c.at(950,()=>{$('#rdot').style.opacity=0});
  c.at(1250,()=>{$('#bz').style.opacity=0;const p=$('#plate');p.style.opacity=1;p.style.transform='translate(0px,0px) rotateX(0deg) rotateZ(0deg) scale(.88)'});
  c.at(1600,()=>{add('94 bairros · Censo 2022');$('#lg').style.opacity=1});
  const T=C.sites[C.target];
  C.sites.forEach((s,i)=>{const d=Math.hypot(s[0]-T[0],s[1]-T[1]);c.at(1450+d*1.7,()=>{const e=$('#cl'+i);if(e){e.style.fill=rankColor(C.rank[i]);e.classList.add('pop')}if(i%6===0)sfx.tick(i%2)})});
  for(let rk=8;rk>=0;rk--)c.at(2400+(8-rk)*130,()=>{const b=$('#bd'+rk);if(b){b.style.opacity=1;b.style.transform='scale(1)';if(rk%3===0)sfx.pop()}});
  c.at(3500,()=>sfx.ding());
}},
/* 9 — função 3 */
{text:'Com fonte e data em cada número.',hl:['fonte','data'],continues:true,mount(r,c){
  const C=buildCity();
  const rows=[['População','IBGE · Censo 2022'],['Renda','IBGE · Censo 2022'],['Estabelecimentos','Receita Federal · CNPJ'],['Saúde','CNES']];
  r.insertAdjacentHTML('beforeend',`<div class="dcard" id="dc"><div class="lbl" style="margin-bottom:18px">Bairro selecionado · exemplo</div>${rows.map(([n,s],i)=>`<div class="dr" style="animation:rowIn .5s ${.2+i*.1}s cubic-bezier(.3,1.4,.5,1) both"><div class="t"><div class="n">${n}</div><div class="s">${s}</div></div><div class="pls"><b>Fonte</b><b>Data de referência</b><b>Cobertura</b></div></div>`).join('')}<div class="cmp"><div class="lbl" style="font-size:20px">Comparar cidades</div><div class="c cu">Recife</div><div class="c" style="color:var(--tx2)">⇄</div><div class="c">Olinda</div></div></div>`);
  $('#lg').style.opacity=0;
  const t=$('#cg').querySelector('#cl'+C.target);t.style.stroke='#F4F8FB';t.style.strokeWidth=6;$('#cg').appendChild(t);
  $('#plate').style.transform='translate(-440px,-10px) rotateX(0deg) rotateZ(0deg) scale(.68)';
  const cr=$('#cr9');cr.innerHTML='<span>Recife</span><span class="sep">›</span><span class="cur">Bairro selecionado</span>';
  c.at(60,()=>sfx.whoosh());
  [...document.querySelectorAll('.dr')].forEach((row,ri)=>{[...row.querySelectorAll('b')].forEach((b,bi)=>c.at(650+ri*480+bi*150,()=>{b.classList.add('on');sfx.tap()}))});
  c.at(650+4*480,()=>sfx.ding());
}},
/* 10 — alívio */
{text:'Agora a decisão é sua, com os dados na mão.',hl:['decisão','sua'],continues:true,light:true,min:3.6,mount(r,c){
  const C=buildCity();
  const dc=$('#dc');if(dc){dc.style.transition='transform .5s cubic-bezier(.6,0,.9,.4),opacity .4s';dc.style.transform='translateX(260px) rotate(6deg)';dc.style.opacity=0;setTimeout(()=>dc.remove(),600)}
  const cr=$('#cr9');cr.innerHTML='<span>Recife</span><span class="sep">›</span><span class="cur">Bairro escolhido</span>';
  r.insertAdjacentHTML('afterbegin','<div class="sun" id="sun"></div>');
  const plate=$('#plate'),s=C.sites[C.target];
  const h=document.createElement('div');h.className='holo';h.id='holo';h.style.left=s[0]+'px';h.style.top=s[1]+'px';h.innerHTML=holoHTML();plate.appendChild(h);
  const bd=$('#bd0');if(bd)bd.style.opacity=0;
  c.at(80,()=>{$('#sun').classList.add('up');plate.style.transform='translate(0px,10px) rotateX(58deg) rotateZ(0deg) scale(1.02)';sfx.whoosh()});
  c.at(1400,()=>{h.classList.add('on');sfx.holo();ripple(r,960,560,6)});
  c.at(1500,()=>{plate.style.transition='transform 7s ease-in-out';plate.style.transform='translate(0px,10px) rotateX(58deg) rotateZ(-14deg) scale(1.02)'});
}},
/* 11 — fecho */
{text:'VICUS. Do Brasil ao bairro.',hl:['brasil','bairro'],min:3,tr:'wipe',wx:960,wy:520,mount(r,c){
  r.innerHTML=`<div class="abs" style="left:0;right:0;top:190px;display:flex;justify-content:center"><svg width="230" height="230" viewBox="0 0 200 200"><path class="vpath" d="M30 30L100 170L170 30" fill="none" stroke="#E8895A" stroke-width="34" stroke-linejoin="miter" pathLength="100"/></svg></div>
  <div class="abs wm" style="left:0;right:0;top:490px">${'VICUS'.split('').map((l,i)=>`<span style="animation-delay:${.5+i*.08}s">${l}</span>`).join('')}</div>`;
  c.at(500,()=>{burst(r,960,320,14,'#E8895A',230);sfx.ding()});c.at(700,()=>sfx.pop());
}}
];

/* ============ execução ============ */
let prevRoot=null;
const wipeEl=$('#wipe');
function newRoot(){const d=document.createElement('div');d.className='sc';scenesEl.appendChild(d);return d}
async function play(from){
  const id=++runId;
  scenesEl.innerHTML='';prevRoot=null;wipeEl.style.transition='none';wipeEl.style.clipPath='circle(0px at 50% 50%)';
  if(AC&&master)master.gain.setTargetAtTime(muted?0:1,AC.currentTime,.05);
  duck(false);musicStart();
  let i=from;while(i>0&&SCENES[i].continues)i--;
  for(;i<SCENES.length;i++){
    if(id!==runId)return;
    const sc=SCENES[i];
    const ctx={dead:false,tm:[],
      at(ms,fn){const t=setTimeout(()=>{if(!ctx.dead&&id===runId)fn()},ms);ctx.tm.push(t)},
      every(ms,fn){const t=setInterval(()=>{if(!ctx.dead&&id===runId)fn()},ms);ctx.tm.push(t)}};
    let root,wx=sc.wx||960,wy=sc.wy||540,reveal=false;
    if(sc.continues&&prevRoot){root=prevRoot}
    else if(!prevRoot){root=newRoot();root.classList.add('intro')}
    else if(sc.tr==='whip'){const old=prevRoot;old.classList.add('whipOut');setTimeout(()=>old.remove(),420);root=newRoot();root.classList.add('whipIn');sfx.whoosh()}
    else{
      const old=prevRoot;wipeEl.style.transition='none';wipeEl.style.clipPath=`circle(0px at ${wx}px ${wy}px)`;void wipeEl.offsetWidth;
      wipeEl.style.transition='clip-path .45s cubic-bezier(.65,0,.3,1)';wipeEl.style.clipPath=`circle(2300px at ${wx}px ${wy}px)`;sfx.whoosh();
      await sleep(440);if(id!==runId)return;
      old.remove();root=newRoot();reveal=true;
    }
    stage.classList.toggle('light',!!sc.light);
    window.__scene=i;
    const est=Math.max(sc.min||2,sc.text.length/14.5+.3);
    if(sc.noCap){capEl.style.visibility='hidden';capWords=[];capStart=[]}else setCaption(sc.text,(sc.hl||[]).map(norm));
    sc.mount(root,ctx);
    if(reveal){requestAnimationFrame(()=>{wipeEl.style.transition='clip-path .65s cubic-bezier(.5,0,.2,1)';wipeEl.style.clipPath=`circle(0px at ${wx}px ${wy}px)`})}
    const minT=sleep((sc.min||2)*1000);
    await Promise.all([narrate(sc.text,est,id),minT]);
    ctx.dead=true;ctx.tm.forEach(t=>{clearTimeout(t);clearInterval(t)});
    prevRoot=root;
    if(id!==runId)return;
  }
  await sleep(2500);
  if(id!==runId)return;
  if(AC&&master){master.gain.setTargetAtTime(0,AC.currentTime,.8)}
  await sleep(2200);
  if(id===runId)musicStop();
}
function stopAll(){runId++;try{NARR.pause()}catch(e){}try{speechSynthesis.cancel()}catch(e){}musicStop();[...document.querySelectorAll('.sc')].forEach(e=>e.remove())}
async function begin(from=0){
  initAudio();pickVoice();
  if('speechSynthesis' in window){try{speechSynthesis.cancel()}catch(e){}}
  $('#start').style.display='none';
  play(from);
}
$('#start').onclick=()=>begin(0);
$('#replay').onclick=e=>{e.stopPropagation();stopAll();begin(0)};
const q=new URLSearchParams(location.search);
document.getElementById('voice').style.display='none'; /* rótulo técnico: nunca para o público (com ou sem ?embed=1) */
if(q.has('cena')){begin(+q.get('cena')-1)}
else if(q.has('auto')){begin(0);setTimeout(()=>{if(AC&&AC.state!=='running')needGesture()},500)}
