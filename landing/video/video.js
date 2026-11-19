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

/* ============ narração em MP3 (ElevenLabs) ============ */
/* início e fim de cada frase dentro de narracao.mp3, na ordem das cenas */
const CUES=[[0.00,2.07],[2.33,4.29],[4.56,6.77],[6.99,10.30],[10.56,14.08],[14.42,15.17],[15.41,17.91],[18.14,21.10],[21.31,23.62],[23.93,26.60],[26.93,29.31]];
const NARR=new Audio('narracao.mp3');NARR.preload='auto';
let useMp3=true;
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
const rankColor=r=>mix('#352D27','#EBA774',Math.pow(1-r/93,1.7));

/* holograma da unidade */
function holoHTML(){
  const W=300,D=230,H=190;
  const f=(w,h,tf,st,inner,cls)=>`<div class="f ${cls||''}" style="width:${w}px;height:${h}px;margin:${-h/2}px 0 0 ${-w/2}px;transform:${tf};${st||''}">${inner||''}</div>`;
  const side=(a,w,d,st,inner)=>f(w,H,`rotateZ(${a}deg) translate3d(0,${d/2}px,${H/2}px) rotateX(-90deg)`,st,inner);
  const frontIn=`<div style="position:absolute;left:8%;top:8%;width:84%;height:17%;background:#181512"><div style="position:absolute;left:6%;top:42%;width:34%;height:16%;background:#EBA774"></div></div>
   <div style="position:absolute;left:8%;top:42%;width:56%;height:42%;background:#EBA774;border:4px solid #181512"><div style="position:absolute;left:33%;top:0;bottom:0;width:4px;background:#181512"></div><div style="position:absolute;left:66%;top:0;bottom:0;width:4px;background:#181512"></div><div style="position:absolute;left:8%;bottom:0;width:20%;height:42%;background:#C58A62"></div><div style="position:absolute;left:40%;bottom:0;width:20%;height:58%;background:#C58A62"></div></div>
   <div style="position:absolute;left:72%;top:38%;width:20%;height:62%;background:#181512"><div style="position:absolute;right:14%;top:52%;width:9%;height:6%;border-radius:50%;background:#EBA774"></div></div>`;
  const sideIn=`<div style="position:absolute;left:16%;top:34%;width:22%;height:32%;background:#EBA774;opacity:.9;border:4px solid #181512"></div><div style="position:absolute;left:62%;top:34%;width:22%;height:32%;background:#EBA774;opacity:.9;border:4px solid #181512"></div>`;
  let h='';
  h+=side(0,W,D,'background:#352D27',frontIn);
  h+=side(180,W,D,'background:#2b2521');
  h+=side(90,D,W,'background:#2b2521',sideIn);
  h+=side(270,D,W,'background:#2b2521',sideIn);
  h+=f(W,D,`translate3d(0,0,${H}px)`,'background:#221D1A');
  h+=f(W+14,16,`translate3d(0,${D/2+4}px,${H-6}px)`,'background:#181512;border:none');
  const ext=70,drop=44,L=Math.hypot(ext,drop),ang=Math.atan2(drop,ext)*180/Math.PI;
  h+=f(W*.92,L,`translate3d(0,${D/2+ext/2}px,${H*.70-drop/2}px) rotateX(-${ang}deg)`,'background:repeating-linear-gradient(90deg,#EBA774 0 32px,#C58A62 32px 64px);border:none');
  const box=(x,y,w,d,hh)=>{
    let s='';[0,90,180,270].forEach(a=>{const ww=a%180?d:w,dd=a%180?w:d;s+=f(ww,hh,`rotateZ(${a}deg) translate3d(0,${dd/2}px,${hh/2}px) rotateX(-90deg)`,'background:#352D27')});
    s+=f(w,d,`translate3d(0,0,${hh}px)`,'background:radial-gradient(circle at 25% 30%,#EBA774 0 7px,transparent 8px),radial-gradient(circle at 70% 35%,#C58A62 0 7px,transparent 8px),radial-gradient(circle at 45% 72%,#EBA774 0 7px,transparent 8px),#221D1A;border:none');
    return`<div class="bx" style="transform:translate3d(${x}px,${y}px,0)">${s}</div>`};
  h+=box(-W/2+22,D/2+60,52,40,40)+box(W/2-22,D/2+60,52,40,40);
  const beamB=`<div class="bp" style="transform:translate3d(0,0,60px) rotateX(-90deg)"></div><div class="bp" style="transform:translate3d(0,0,60px) rotateZ(90deg) rotateX(-90deg)"></div>`;
  return`<div class="ring"></div><div class="ring2"></div>${beamB}<div class="lift"><div class="spin">${h}</div></div>`;
}

/* ============ cenas ============ */
const SCENES=[
/* 1 — gancho */
{text:'Você achou que não tinha concorrência.',hl:['concorrência'],min:3.2,mount(r,c){
  let shops='';for(let i=0;i<24;i++)shops+=`<svg class="shop" style="animation-delay:${i*38}ms"><use href="#shop"/></svg>`;
  r.innerHTML=`<div class="panel" id="p1" style="left:400px;top:120px;width:1120px;height:660px">
    <div class="lbl" style="position:absolute;left:56px;top:50px">Painel · bairro exemplo</div>
    <div class="pill" style="position:absolute;right:56px;top:36px">Concorrência</div>
    <div id="a1" class="fade">
      <div class="h1" style="position:absolute;left:56px;top:120px">Pouca<br><em>concorrência</em></div>
      <svg style="position:absolute;right:70px;top:370px" width="420" height="250" viewBox="0 0 420 250"><path d="M30 230A180 180 0 0 1 390 230" stroke="#221D1A" stroke-width="34" fill="none" stroke-linecap="round"/><path id="g1" d="M30 230A180 180 0 0 1 390 230" stroke="#EBA774" stroke-width="34" fill="none" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100" style="transition:stroke-dashoffset 1s cubic-bezier(.3,.8,.3,1)"/></svg>
      <div class="lbl" style="position:absolute;left:56px;top:560px">Nível · baixo</div>
    </div>
    <div id="b1" class="fade hid">
      <div class="lbl" style="position:absolute;left:56px;top:110px;color:#F3EDE7">Estabelecimentos do mesmo tipo · já instalados</div>
      <div class="shops">${shops}</div>
      <div class="lbl" style="position:absolute;left:56px;bottom:44px">Fonte · Receita Federal — CNPJ</div>
    </div></div>`;
  c.at(350,()=>{$('#g1').style.strokeDashoffset=82;sfx.ding()});
  c.at(1800,()=>{$('#p1').classList.add('shake');sfx.rumble()});
  c.at(2250,()=>{$('#a1').classList.add('hid');const b=$('#b1');b.classList.remove('hid');
    [0,90,180,300,420].forEach(d=>c.at(d,()=>sfx.pop()))});
}},
/* 2 — contrato */
{text:'O contrato já estava assinado.',hl:['assinado'],min:2.8,mount(r,c){
  r.innerHTML=bubble(320,'pop','left:330px;top:430px;--lx:.035em;--ly:.0em')+
  `<div class="paper" id="pp" style="left:960px;top:100px;width:600px;height:730px;transform:rotate(2deg);animation-delay:.15s">
    <div class="lbl dk" style="margin:54px 0 0 56px">Contrato de locação</div>
    <div class="ptitle" style="margin:22px 56px 28px">Prazo<br><em>5 anos</em></div>
    <div class="pline"></div><div class="pline" style="width:80%"></div><div class="pline" style="width:90%"></div><div class="pline" style="width:60%"></div>
    <svg style="position:absolute;left:70px;top:520px" width="420" height="120" viewBox="0 0 420 120"><path d="M0 100H420" stroke="#d9d0c8" stroke-width="3"/><path id="sg" d="M10 80C40 10 60 110 90 50S130 20 150 70S200 100 230 40S270 90 300 60L400 62" stroke="#181512" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg>
    <svg id="pen" style="position:absolute;left:0;top:0;width:80px;height:80px;opacity:0" viewBox="0 0 80 80"><path d="M2 78L10 52L62 0L80 18L28 70Z" fill="#352D27"/><path d="M2 78L10 52L20 62Z" fill="#C58A62"/></svg>
    <div class="stamp" id="st">Assinado</div></div>`;
  const sg=$('#sg'),pen=$('#pen'),len=sg.getTotalLength();
  c.at(500,()=>{sfx.scratch(1.0);const t0=performance.now();pen.style.opacity=1;
    const loop=()=>{if(c.dead)return;const p=Math.min(1,(performance.now()-t0)/1000);const e=p<.5?2*p*p:1-Math.pow(-2*p+2,2)/2;
      sg.style.strokeDashoffset=100*(1-e);const pt=sg.getPointAtLength(len*e);pen.style.left=(70+pt.x-4)+'px';pen.style.top=(520+pt.y-76)+'px';
      if(p<1)requestAnimationFrame(loop);else pen.style.opacity=0};loop()});
  c.at(1650,()=>{$('#st').classList.add('on');sfx.stamp();const b=$('.bub');b.classList.remove('pop');b.classList.add('shock','sq')});
}},
/* 3 — concorrente */
{text:'O concorrente estava a duas quadras.',hl:['duas','quadras.'.replace('.','')],min:2.6,mount(r,c){
  r.innerHTML=`<div class="abs" style="left:160px;right:160px;top:720px;height:4px;background:#4a4038;border-radius:2px"></div>
  ${bubble(250,'dark pop','left:1260px;top:482px;--lx:-.03em;opacity:0;transition:opacity .01s').replace('class="bub dark pop"','class="bub dark" id="b3b"')}
  <div class="bl" style="left:1050px;top:470px;width:190px;height:250px"><i style="left:30px;top:40px"></i><i style="left:84px;top:40px"></i><i style="left:138px;top:40px"></i><i style="left:30px;top:120px"></i><i style="left:84px;top:120px"></i><i style="left:138px;top:120px"></i></div>
  <div class="bl" style="left:820px;top:540px;width:200px;height:180px;background:#2b2521"><i style="left:40px;top:40px"></i><i style="left:130px;top:40px"></i></div>
  ${bubble(300,'pop','left:330px;top:420px;--lx:.04em')}
  <div class="lbl abs" style="left:420px;top:760px">Você</div>
  <div class="lbl abs" id="lb3" style="left:1280px;top:760px;opacity:0;transition:opacity .4s">Concorrente</div>
  <svg class="abs" style="left:0;top:0" width="1920" height="1080"><g id="ms" opacity="0" style="transition:opacity .4s"><path d="M520 340H1380" stroke="#EBA774" stroke-width="4" stroke-dasharray="14 12"/><path d="M520 322V358M1380 322V358" stroke="#EBA774" stroke-width="4"/></g></svg>
  <div class="abs" id="q3" style="left:660px;width:600px;top:250px;text-align:center;font-size:62px;font-weight:800;color:#EBA774;opacity:0;transform:translateY(20px);transition:all .45s cubic-bezier(.2,.9,.3,1)">2 quadras</div>`;
  c.at(700,()=>{const b=$('#b3b');b.style.opacity=1;b.classList.add('pop');sfx.pop();$('#lb3').style.opacity=1});
  c.at(1300,()=>{$('#ms').setAttribute('opacity',1);const q=$('#q3');q.style.opacity=1;q.style.transform='none';sfx.tap()});
}},
/* 5 — hospital */
{text:'Comércios que ajudariam sua venda ficavam longe demais.',hl:['comércios','longe'],min:3.3,mount(r,c){
  r.innerHTML=`<div class="abs" style="left:160px;right:160px;top:760px;height:4px;background:#4a4038;border-radius:2px"></div>
  ${bubble(300,'pop','left:260px;top:460px;--lx:.04em;--ly:-.01em')}
  <div class="hosp" id="hp"><svg width="440" height="440"><use href="#shop"/></svg>
   <div class="lbl" style="text-align:center;margin-top:48px">Comércio complementar</div></div>
  ${[0,1,2].map(i=>`<div class="streak" id="sk${i}" style="left:${900+i*70}px;top:${420+i*70}px;width:${260-i*40}px"></div>`).join('')}`;
  c.at(900,()=>{$('#hp').classList.add('away');sfx.whoosh();[0,1,2].forEach(i=>c.at(i*90,()=>$('#sk'+i).classList.add('on')))});
  c.at(1900,()=>{$('.bub').style.setProperty('--lx','.055em')});
}},
/* 6 — madrugada */
{text:'O dado existia. Estava público. E de graça.',hl:['público.'.replace('.',''),'graça'.replace('.','')],min:3.6,mount(r,c){
  const R=rng(3);let cards='';const names=['cnpj.csv','malha_bairros.shp','censo2022.zip','cnes.csv','dados.xlsx','municipios.shp'];
  for(let i=0;i<16;i++){
    const x=240+R()*880,y=170+R()*480,rot=(R()-.5)*20,dx=(R()-.5)*500,dy=(R()-.5)*300;
    const tab=i%3===1;
    cards+=tab?`<div class="card6" style="left:${x}px;top:${y}px;width:340px;height:200px;--r:${rot}deg;--dx:${dx}px;--dy:${dy}px;animation-delay:${.25+i*.14}s"><div class="hd">Mapa</div><svg width="340" height="166" viewBox="0 0 340 166" style="position:absolute;top:34px"><rect width="340" height="166" fill="#2b2521"/><path d="M0 120L90 60L170 100L250 30L340 80" stroke="#4a4038" stroke-width="6" fill="none"/><path d="M60 166L130 0M210 166L260 0" stroke="#3d342d" stroke-width="5"/><circle cx="170" cy="86" r="14" fill="#EBA774"/></svg></div>`
    :`<div class="card6" style="left:${x}px;top:${y}px;width:310px;height:210px;--r:${rot}deg;--dx:${dx}px;--dy:${dy}px;animation-delay:${.25+i*.14}s"><div class="hd">${names[i%names.length]}</div><div class="gr"></div></div>`;
  }
  let ticks='';for(let i=0;i<12;i++){const a=i*30;ticks+=`<line x1="160" y1="20" x2="160" y2="${i%3?32:40}" stroke="#B8ABA2" stroke-width="${i%3?3:5}" transform="rotate(${a} 160 160)"/>`}
  r.innerHTML=cards+`<div class="clock"><svg width="320" height="320" viewBox="0 0 320 320"><circle cx="160" cy="160" r="150" fill="#352D27" stroke="#4a4038" stroke-width="4"/>${ticks}
    <line x1="160" y1="160" x2="160" y2="70" stroke="#F3EDE7" stroke-width="8" stroke-linecap="round"/>
    <line x1="160" y1="160" x2="${160+Math.sin(60*Math.PI/180)*62}" y2="${160-Math.cos(60*Math.PI/180)*62}" stroke="#F3EDE7" stroke-width="11" stroke-linecap="round"/>
    <g id="sec"><line x1="160" y1="180" x2="160" y2="46" stroke="#EBA774" stroke-width="4" stroke-linecap="round"/></g><circle cx="160" cy="160" r="9" fill="#EBA774"/></svg>
    <div class="lbl" style="text-align:center;margin-top:18px;font-size:34px;color:#F3EDE7">02:00</div><div class="lbl" style="text-align:center;margin-top:6px">Madrugada</div></div>`;
  let s=0,alt=0;const sec=$('#sec');
  c.every(1000,()=>{s++;sec.setAttribute('transform',`rotate(${s*6} 160 160)`);sfx.tick(alt^=1)});
  for(let i=0;i<16;i+=2)c.at(250+i*140+250,()=>sfx.pop());
}},
/* 7 — logo */
{text:'VICUS.',hl:[],noCap:true,min:2.9,mount(r,c){
  r.innerHTML=`<div class="abs" style="left:0;right:0;top:190px;display:flex;justify-content:center"><svg width="230" height="230" viewBox="0 0 200 200"><path class="vpath" d="M30 30L100 170L170 30" fill="none" stroke="#EBA774" stroke-width="34" stroke-linejoin="miter" pathLength="100"/></svg></div>
  <div class="abs wm" style="left:0;right:0;top:470px">${'VICUS'.split('').map((l,i)=>`<span style="animation-delay:${.85+i*.08}s">${l}</span>`).join('')}</div>
  <div class="lbl abs" style="left:0;right:0;top:700px;text-align:center;animation:cr .6s 1.7s both">Do latim · bairro, vizinhança, rua</div>`;
  c.at(120,()=>sfx.whoosh());c.at(1000,()=>sfx.ding());
}},
/* 8 — função 1 */
{text:'Você diz o que importa para o seu negócio.',hl:['importa'],min:3.8,mount(r,c){
  const row=(n,w)=>`<div class="row"><div class="rn">${n}</div><div style="display:flex;align-items:center;gap:22px"><div class="dots" data-w="${w}">${dots()}</div><div class="wv" data-v="${w}"></div></div></div>`;
  r.innerHTML=`<div class="lbl abs" style="left:0;right:0;top:70px;text-align:center">Negócio · academia (exemplo) · peso de 1 a 5</div>
  <div class="card" style="left:200px;top:140px;width:720px;height:560px;animation-delay:.05s"><div class="hd"><div class="ic" style="background:var(--cu);color:var(--g1)">+</div>Quero perto</div>${row('Fisioterapia',4)}${row('Loja de suplementos',3)}<div class="addrow">+ adicionar critério</div></div>
  <div class="card" style="left:960px;top:140px;width:720px;height:560px;animation-delay:.2s"><div class="hd"><div class="ic" style="border:4px solid var(--tx2);color:var(--tx2)">−</div>Quero longe</div>${row('Outra academia',5)}<div class="addrow">+ adicionar critério</div></div>`;
  let delay=700;
  document.querySelectorAll('.dots').forEach(d=>{const w=+d.dataset.w;const v=d.parentNode.querySelector('.wv');
    for(let i=0;i<w;i++){c.at(delay,()=>{d.children[i].classList.add('on');v.textContent=i+1;sfx.tap()});delay+=170}
    delay+=250});
}},
/* 9 — função 2: mapa */
{text:'O mapa ordena os bairros pelos seus critérios.',hl:['mapa','ordena'],min:3.9,mount(r,c){
  const C=buildCity();
  // Brasil (contorno simplificado)
  const pts=[[-60,5.2],[-57,5],[-54,2.3],[-51.6,4],[-50,1.5],[-50.3,-.3],[-48,-.8],[-46,-1],[-44.2,-2.4],[-41.5,-2.9],[-39,-3],[-37.2,-4.6],[-35.2,-5.3],[-34.8,-7],[-35.2,-9],[-36.5,-10.6],[-37.3,-11.5],[-38.5,-13],[-39,-15.5],[-39.2,-17.8],[-40,-20],[-41,-22],[-42,-23],[-44.5,-23.3],[-46.5,-24],[-48.5,-26],[-48.6,-28],[-50.5,-30],[-53,-33.5],[-53.5,-33.7],[-55.5,-30.5],[-57.6,-30.2],[-56,-28.2],[-54.5,-27.2],[-54.2,-25.6],[-54.6,-24],[-55.8,-22.5],[-57.8,-22],[-58,-20],[-57.8,-18],[-58.5,-16.3],[-60,-15],[-60.5,-13.5],[-63,-12.5],[-65.4,-10.4],[-68.5,-11],[-70.5,-11],[-73,-9.5],[-72.8,-7.5],[-70,-4.5],[-69.5,-4],[-70.2,-2],[-69.5,-1],[-69.8,1],[-67.5,2.2],[-65.8,1.2],[-64,4.2],[-62,3.5]];
  const k=19,P=([lo,la])=>[(lo+74)*k,(5.5-la)*k];
  const bd='M'+pts.map(p=>P(p).map(v=>v.toFixed(1)).join(' ')).join('L')+'Z';
  const rec=P([-34.88,-8.05]);
  const bx=580,by=70,rpx=bx+rec[0],rpy=by+rec[1];
  const S=16,tx=960-bx-S*rec[0],ty=450-by-S*rec[1];
  const cells=C.cells.map((p,i)=>`<path class="cell" id="cl${i}" d="M${p.map(q=>q[0].toFixed(1)+' '+q[1].toFixed(1)).join('L')}Z"/>`).join('');
  let badges='';for(let rk=0;rk<9;rk++){const i=C.order[rk],s=C.sites[i];badges+=`<g class="bdg" id="bd${rk}" style="opacity:0;transition:opacity .3s"><circle cx="${s[0].toFixed(1)}" cy="${s[1].toFixed(1)}" r="21" fill="#181512"/><text class="badge badge-c" x="${s[0].toFixed(1)}" y="${(s[1]+1).toFixed(1)}">${rk+1}</text></g>`}
  const sw=[0,.25,.5,.75,1].map(t=>`<i style="background:${mix('#352D27','#EBA774',Math.pow(t,1.7))}"></i>`).join('');
  r.innerHTML=`<div class="crumbs" id="cr9"></div>
   <div class="bg" id="bz" style="transform-origin:0 0"><svg width="800" height="780" viewBox="0 0 800 780" style="overflow:visible"><path d="${bd}" fill="#352D27" stroke="#B8ABA2" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><circle id="rdot" cx="${rec[0].toFixed(1)}" cy="${rec[1].toFixed(1)}" r="8" fill="#EBA774" style="transition:opacity .35s"/></svg></div>
   <div class="persp"><div class="plate" id="plate" style="transform:translate(0px,0px) rotateX(0deg) scale(.1);opacity:0">
     <svg width="1000" height="760" viewBox="0 0 1000 760" style="position:absolute;inset:0"><defs><clipPath id="blob"><path d="${C.blobD}"/></clipPath></defs><g clip-path="url(#blob)" id="cg">${cells}</g><path d="${C.blobD}" fill="none" stroke="#B8ABA2" stroke-width="2" opacity=".5"/><g id="bgs">${badges}</g></svg></div></div>
   <div class="legend" id="lg" style="opacity:0"><div class="lbl" style="margin-bottom:6px">Combina com os critérios</div><div class="sw">${sw}</div><div class="ends"><span>Menos</span><span>Mais</span></div><div class="lbl" style="margin-top:34px;font-size:16px;opacity:.7">Exemplo ilustrativo</div></div>
   <div class="osm">© OpenStreetMap contributors</div>`;
  const cr=$('#cr9');
  const add=(t,cur)=>{if(cr.children.length)cr.insertAdjacentHTML('beforeend','<span class="sep">›</span>');cr.insertAdjacentHTML('beforeend',`<span class="${cur?'cur':''}">${t}</span>`);cr.querySelectorAll('.cur').forEach((e,i,a)=>{if(i<a.length-1)e.classList.remove('cur')})};
  add('Brasil',1);
  c.at(120,()=>sfx.whoosh());
  c.at(100,()=>{$('#bz').style.transform=`translate(${tx}px,${ty}px) scale(${S})`});
  c.at(1000,()=>{$('#rdot').style.opacity=0});c.at(550,()=>add('Nordeste',1));c.at(950,()=>add('Pernambuco',1));c.at(1350,()=>add('Recife',1));
  c.at(1450,()=>{$('#bz').style.opacity=0;const p=$('#plate');p.style.opacity=1;p.style.transform='translate(0px,0px) rotateX(0deg) scale(1)'});
  c.at(1850,()=>add('94 bairros · Censo 2022',1));
  c.at(1500,()=>{$('#lg').style.opacity=1});
  // colorir do menor ao maior
  for(let rk=93;rk>=0;rk--){const i=C.order[rk];c.at(1700+(93-rk)*17,()=>{const el=$('#cl'+i);if(el)el.style.fill=rankColor(rk);if(rk<9){const b=$('#bd'+rk);if(b)b.style.opacity=1}if(rk%9===0)sfx.tick(rk%2)})}
  c.at(1700+93*17+80,()=>sfx.ding());
}},
/* 10 — função 3 */
{text:'Com fonte e data em cada número.',hl:['fonte','data'],continues:true,min:3.4,mount(r,c){
  const C=buildCity();
  const rows=[['População','IBGE · Censo 2022'],['Renda','IBGE · Censo 2022'],['Estabelecimentos','Receita Federal · CNPJ'],['Saúde','CNES']];
  const cardRows=rows.map(([n,s],i)=>`<div class="dr"><div class="t"><div class="n">${n}</div><div class="s">${s}</div></div><div class="pls"><b>Fonte</b><b>Data de referência</b><b>Cobertura</b></div></div>`).join('');
  r.insertAdjacentHTML('beforeend',`<div class="dcard" id="dc"><div class="lbl" style="margin-bottom:18px">Bairro selecionado · exemplo</div>${cardRows}<div class="cmp"><div class="lbl" style="font-size:20px">Comparar cidades</div><div class="c cu">Recife</div><div class="c" style="color:var(--tx2)">⇄</div><div class="c">Olinda</div></div></div>`);
  $('#lg').style.opacity=0;
  const t=$('#cg').querySelector('#cl'+C.target);t.style.stroke='#F3EDE7';t.style.strokeWidth=6;$('#cg').appendChild(t);
  $('#plate').style.transform='translate(-430px,0px) rotateX(0deg) scale(.74)';
  const cr=$('#cr9');cr.innerHTML='';cr.insertAdjacentHTML('beforeend','<span>Recife</span><span class="sep">›</span><span class="cur">Bairro selecionado</span>');
  c.at(100,()=>sfx.whoosh());
  const rowEls=[...document.querySelectorAll('.dr')];
  rowEls.forEach((row,ri)=>{[...row.querySelectorAll('b')].forEach((b,bi)=>c.at(550+ri*480+bi*140,()=>{b.classList.add('on');sfx.tap()}))});
  c.at(550+4*480,()=>sfx.ding());
}},
/* 11 — alívio */
{text:'Agora a decisão é sua, com os dados na mão.',hl:['decisão','sua,'.replace(',','')],continues:true,light:true,min:3.4,mount(r,c){
  const C=buildCity();
  const dc=$('#dc');if(dc){dc.style.transition='transform .5s cubic-bezier(.6,0,.9,.4),opacity .4s';dc.style.transform='translateX(200px)';dc.style.opacity=0;setTimeout(()=>dc.remove(),600)}
  const cr=$('#cr9');cr.innerHTML='<span>Recife</span><span class="sep">›</span><span class="cur">Bairro escolhido</span>';
  r.insertAdjacentHTML('afterbegin','<div class="sun" id="sun"></div>');
  const plate=$('#plate'),s=C.sites[C.target];
  const h=document.createElement('div');h.className='holo';h.id='holo';h.style.left=s[0]+'px';h.style.top=s[1]+'px';h.innerHTML=holoHTML();plate.appendChild(h);
  const bd=$('#bd0');if(bd)bd.style.opacity=0;
  c.at(80,()=>{$('#sun').classList.add('up');plate.style.transform='translate(0px,60px) rotateX(58deg) scale(1.2)';sfx.whoosh()});
  c.at(1500,()=>{h.classList.add('on');sfx.holo()});
}},
/* 12 — fecho */
{text:'VICUS. Do Brasil ao bairro.',hl:['brasil','bairro'],min:2.8,mount(r,c){
  r.innerHTML=`<div class="abs" style="left:0;right:0;top:190px;display:flex;justify-content:center"><svg width="230" height="230" viewBox="0 0 200 200"><path class="vpath" d="M30 30L100 170L170 30" fill="none" stroke="#EBA774" stroke-width="34" stroke-linejoin="miter" pathLength="100"/></svg></div>
  <div class="abs wm" style="left:0;right:0;top:490px">${'VICUS'.split('').map((l,i)=>`<span style="animation-delay:${.85+i*.08}s">${l}</span>`).join('')}</div>`;
  c.at(100,()=>sfx.whoosh());c.at(1000,()=>sfx.ding());
}}
];

/* ============ execução ============ */
let prevRoot=null,vis=0;
async function play(from){
  const id=++runId;
  scenesEl.innerHTML='';prevRoot=null;
  if(AC&&master)master.gain.setTargetAtTime(muted?0:1,AC.currentTime,.05);
  duck(false);musicStart();
  let i=from;while(i>0&&SCENES[i].continues)i--;
  for(;i<SCENES.length;i++){
    if(id!==runId)return;
    const sc=SCENES[i];
    const ctx={dead:false,tm:[],
      at(ms,fn){const t=setTimeout(()=>{if(!ctx.dead&&id===runId)fn()},ms);ctx.tm.push(t)},
      every(ms,fn){const t=setInterval(()=>{if(!ctx.dead&&id===runId)fn()},ms);ctx.tm.push(t)}};
    let root;
    if(sc.continues&&prevRoot){root=prevRoot}
    else{
      root=document.createElement('div');root.className='sc';scenesEl.appendChild(root);
      if(prevRoot){const old=prevRoot;old.classList.add('out');setTimeout(()=>old.remove(),420);sfx.whoosh()}
    }
    stage.classList.toggle('light',!!sc.light);
    window.__scene=i;
    const est=Math.max(sc.min||2,sc.text.length/14.5+.3);
    if(sc.noCap){capEl.style.visibility='hidden';capWords=[];capStart=[]}else setCaption(sc.text,(sc.hl||[]).map(norm));
    sc.mount(root,ctx);
    const minT=sleep((sc.min||2)*1000);
    const speech=sc.noCap?narrate(sc.text,est,id).then(()=>{}):narrate(sc.text,est,id);
    await Promise.all([speech,minT]);
    ctx.dead=true;ctx.tm.forEach(t=>{clearTimeout(t);clearInterval(t)});
    prevRoot=root;
    if(id!==runId)return;
  }
  // fecho: segura o logo e apaga a trilha
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
if(q.has('embed')){document.getElementById('voice').style.display='none'}
if(q.has('cena')){begin(+q.get('cena')-1)}
else if(q.has('auto')){begin(0);setTimeout(()=>{if(AC&&AC.state!=='running')needGesture()},500)}
