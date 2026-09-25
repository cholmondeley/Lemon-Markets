import './styles.css';
import {
  PRESET_HIRING, PRESET_DATING, DT,
  gammaFromSlider, sliderFromGamma, spreadWidth,
  genAgents, step, poolStats, theory,
} from './model.js';
var labels = {
  hiring:{
    zoneA:"Job Hunting", zoneU:"Employed",
    viewA:"On the market", viewU:"Already taken",
    viewHelpA:"The pool of people currently job hunting — the ones you'd actually interview.",
    viewHelpU:"People currently employed elsewhere — worth poaching?",
    liarsLabelA:"Share of job hunters overselling their skills",
    liarsLabelU:"Share of the already-employed overselling their skills",
    overstateLabel:"Average skill overstatement"
  },
  dating:{
    zoneA:"Single & Looking", zoneU:"In a Relationship",
    viewA:"On the market", viewU:"Already taken",
    viewHelpA:"The pool of people currently single and looking — the ones you'd actually match with.",
    viewHelpU:"People currently in relationships — the ones a fast-churning market says are worth poaching.",
    liarsLabelA:"Share of singles overselling themselves",
    liarsLabelU:"Share of the already-taken overselling themselves",
    overstateLabel:"Average overstatement of character"
  }
};

var state = {
  domain:"hiring", gamma:PRESET_HIRING, n:260, screening:0.31, view:"A",
  playing:false, speed:0.5, stepAccum:0, t:0, tick:0, agents:[], history:[],
  recordEvery:0.15, lastRecordT:-999
};




function resetSim(){
  state.agents = genAgents(state.n, state.screening);
  state.t = 0; state.tick=0;
  state.history = [];
  state.recordEvery = 0.15;
  state.lastRecordT = -999;
  recordHistory();
}

function simTick(dt){
  step(state.agents, state.gamma, dt, state.tick);
  state.t += dt; state.tick++;
}


function recordHistory(){
  if(state.t - state.lastRecordT < state.recordEvery) return;
  state.lastRecordT = state.t;
  var avail = state.agents.filter(function(a){return a.s==='A';});
  var taken = state.agents.filter(function(a){return a.s==='U';});
  state.history.push({t:state.t, avgA:poolStats(avail).avgX, avgU:poolStats(taken).avgX});
  if(state.history.length > 900){
    var compact=[]; for(var i=0;i<state.history.length;i+=2) compact.push(state.history[i]);
    state.history = compact;
    state.recordEvery *= 2;
  }
}


var C = {};
function readColors(){
  var cs = getComputedStyle(document.documentElement);
  function v(name){ return cs.getPropertyValue(name).trim(); }
  C.ink=v('--ink'); C.inkMuted=v('--ink-muted'); C.inkFaint=v('--ink-faint');
  C.surface2=v('--surface-2'); C.surface3=v('--surface-3'); C.rule=v('--rule');
  C.red=v('--red'); C.blue=v('--blue'); C.accent=v('--accent');
}
function hexToRgb(hex){
  hex = hex.replace('#','');
  if(hex.length===3) hex = hex.split('').map(function(c){return c+c;}).join('');
  var num = parseInt(hex,16);
  return [(num>>16)&255,(num>>8)&255,num&255];
}
function lerp(a,b,t){ return a+(b-a)*t; }
function honestyColor(x){
  x = Math.max(0, Math.min(2, x));
  var red=hexToRgb(C.red), mid=hexToRgb(C.inkFaint), blue=hexToRgb(C.blue);
  var c1,c2,t;
  if(x<=1){ c1=red; c2=mid; t=Math.pow(x,0.7); } else { c1=mid; c2=blue; t=1-Math.pow(2-x,0.7); }
  return 'rgb('+[0,1,2].map(function(i){return Math.round(lerp(c1[i],c2[i],t));}).join(',')+')';
}

function fitCanvas(canvas, cssHeight){
  var dpr = window.devicePixelRatio||1;
  var w = canvas.parentElement.clientWidth;
  if(cssHeight==='fill') cssHeight = canvas.parentElement.clientHeight || 230;
  else canvas.style.height = cssHeight+'px';
  canvas.width = Math.round(w*dpr);
  canvas.height = Math.round(cssHeight*dpr);
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return {ctx:ctx, w:w, h:cssHeight};
}

var poolCanvas = document.getElementById('poolCanvas');
var histCanvas = document.getElementById('histCanvas');
var timeCanvas = document.getElementById('timeCanvas');

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

function renderPool(){
  var dims = fitCanvas(poolCanvas, 260);
  var ctx=dims.ctx, w=dims.w, h=dims.h;
  ctx.clearRect(0,0,w,h);
  var pad=10, gap=10;
  var zoneH = (h - pad*2 - gap)/2;
  var zones = [
    {key:'A', y:pad, h:zoneH, label: labels[state.domain].zoneA},
    {key:'U', y:pad+zoneH+gap, h:zoneH, label: labels[state.domain].zoneU}
  ];
  zones.forEach(function(z){
    ctx.fillStyle = C.surface3;
    roundRect(ctx, pad, z.y, w-pad*2, z.h, 8);
    ctx.fill();
    ctx.fillStyle = C.inkMuted;
    ctx.font = '600 11px "IBM Plex Sans", sans-serif';
    ctx.fillText(z.label.toUpperCase(), pad+10, z.y+16);
  });

  var groups = {A:[], U:[]};
  state.agents.forEach(function(a){ groups[a.s].push(a); });

  zones.forEach(function(z){
    var list = groups[z.key];
    var innerPad = 8, top = z.y+24, innerH = z.h-24-innerPad;
    var innerW = w-pad*2-innerPad*2;
    if(list.length===0) return;
    var cell = Math.max(5, Math.min(16, Math.sqrt((innerW*innerH)/list.length)*0.92));
    var cols = Math.max(1, Math.floor(innerW/cell));
    list.forEach(function(a, i){
      var col = i%cols, row = Math.floor(i/cols);
      var cx = pad+innerPad + col*cell + cell/2;
      var cy = top + row*cell + cell/2;
      if(cy > top+innerH) return;
      var age = (state.tick - a.flip)/14;
      if(age<1){
        ctx.beginPath();
        ctx.arc(cx, cy, cell*0.34 + age*6, 0, Math.PI*2);
        ctx.strokeStyle = honestyColor(a.x);
        ctx.globalAlpha = 1-age;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.arc(cx, cy, cell*0.32, 0, Math.PI*2);
      ctx.fillStyle = honestyColor(a.x);
      ctx.fill();
    });
  });
}

function currentPool(){
  return state.agents.filter(function(a){ return a.s===state.view; });
}

function renderHist(){
  var dims = fitCanvas(histCanvas, 230);
  var ctx=dims.ctx, w=dims.w, h=dims.h;
  ctx.clearRect(0,0,w,h);
  var padL=8, padB=20, padT=8, padR=8;
  var plotW = w-padL-padR, plotH = h-padT-padB;

  var bins=20, binW = 2/bins;
  var counts = new Array(bins).fill(0);
  var pool = currentPool();
  pool.forEach(function(a){
    counts[Math.min(bins-1, Math.floor(a.x/binW))]++;
  });
  var maxDensity = pool.length ? Math.max.apply(null, counts.map(function(c){return c/pool.length/binW;})) : 1;

  var ws = spreadWidth(state.screening);
  var trueDensity = 1/(2*ws);
  maxDensity = Math.max(maxDensity, trueDensity)*1.08;

  function xToPx(x){ return padL + (x/2)*plotW; }
  function dToPy(d){ return padT + plotH - (d/maxDensity)*plotH; }

  ctx.fillStyle = C.surface3;
  ctx.globalAlpha = 0.7;
  ctx.fillRect(xToPx(1-ws), dToPy(trueDensity), xToPx(1+ws)-xToPx(1-ws), padT+plotH-dToPy(trueDensity));
  ctx.globalAlpha = 1;

  if(pool.length){
    for(var i=0;i<bins;i++){
      var d = counts[i]/pool.length/binW;
      var by = dToPy(d);
      ctx.fillStyle = honestyColor(i*binW+binW/2);
      ctx.fillRect(xToPx(i*binW), by, xToPx((i+1)*binW)-xToPx(i*binW)-2, padT+plotH-by);
    }
  }

  ctx.strokeStyle = C.rule; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(padL, padT+plotH); ctx.lineTo(padL+plotW, padT+plotH); ctx.stroke();
  var x1 = xToPx(1);
  ctx.beginPath(); ctx.moveTo(x1, padT); ctx.lineTo(x1, padT+plotH);
  ctx.strokeStyle = C.inkFaint; ctx.setLineDash([3,3]); ctx.stroke(); ctx.setLineDash([]);

  ctx.fillStyle = C.inkMuted; ctx.font='11px "IBM Plex Sans", sans-serif';
  ctx.textAlign='left'; ctx.fillText('← overselling', padL, h-4);
  ctx.textAlign='center'; ctx.fillText('as advertised', x1, h-4);
  ctx.textAlign='right'; ctx.fillText('underselling →', padL+plotW, h-4);
  ctx.textAlign='left';
}

function renderTime(){
  var dims = fitCanvas(timeCanvas, 'fill');
  var ctx=dims.ctx, w=dims.w, h=dims.h;
  ctx.clearRect(0,0,w,h);
  var padL=28, padB=20, padT=8, padR=8;
  var plotW=w-padL-padR, plotH=h-padT-padB;
  var maxT = Math.max(5, state.t);
  function xToPx(t){ return padL + (t/maxT)*plotW; }
  function yToPx(v){ return padT + plotH - (v/2)*plotH; }

  ctx.strokeStyle=C.rule; ctx.lineWidth=1;
  [0,0.5,1,1.5,2].forEach(function(v){
    ctx.beginPath(); ctx.moveTo(padL,yToPx(v)); ctx.lineTo(padL+plotW,yToPx(v)); ctx.stroke();
  });
  ctx.fillStyle=C.inkFaint; ctx.font='10px "IBM Plex Mono", monospace';
  ctx.fillText('1.0', 2, yToPx(1)+3);
  ctx.fillText('2.0', 2, yToPx(2)+9);

  var th = theory(state.gamma, spreadWidth(state.screening));
  var ref = state.view==='A' ? th.EXA : th.EXU;
  ctx.strokeStyle = C.inkFaint; ctx.setLineDash([4,3]); ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.moveTo(padL, yToPx(ref)); ctx.lineTo(padL+plotW, yToPx(ref)); ctx.stroke();
  ctx.setLineDash([]);

  var key = state.view==='A' ? 'avgA' : 'avgU';
  var hist = state.history;
  if(hist.length>1){
    ctx.strokeStyle = C.accent; ctx.lineWidth=2; ctx.beginPath();
    var started=false;
    hist.forEach(function(p){
      if(isNaN(p[key])) return;
      var px=xToPx(p.t), py=yToPx(p[key]);
      if(!started){ ctx.moveTo(px,py); started=true; } else { ctx.lineTo(px,py); }
    });
    ctx.stroke();
    var last = hist[hist.length-1];
    if(!isNaN(last[key])){
      ctx.beginPath(); ctx.arc(xToPx(last.t), yToPx(last[key]), 3.2, 0, Math.PI*2);
      ctx.fillStyle=C.accent; ctx.fill();
    }
  }
  ctx.fillStyle=C.inkFaint; ctx.font='10px "IBM Plex Mono", monospace';
  ctx.fillText('t=0', padL-2, h-5);
  ctx.textAlign='right'; ctx.fillText('t='+maxT.toFixed(0), padL+plotW, h-5); ctx.textAlign='left';
}

function fmtPct(x){ return isNaN(x) ? '—' : Math.round(x*100)+'%'; }

function updateStats(){
  var pool = currentPool();
  var availCount = state.agents.filter(function(a){return a.s==='A';}).length;
  var ps = poolStats(pool);
  var th = theory(state.gamma, spreadWidth(state.screening));
  var L = labels[state.domain];

  document.getElementById('statLiarsLabel').textContent = state.view==='A' ? L.liarsLabelA : L.liarsLabelU;
  document.getElementById('statLiars').textContent = fmtPct(ps.fracLiars);
  document.getElementById('statLiarsTheory').textContent = state.view==='A' ? ('theory: '+fmtPct(th.PXlt1_A)+' at steady state') : '';

  document.getElementById('statOverstateLabel').textContent = L.overstateLabel;
  var overstate = ps.avgX>0 ? (1/ps.avgX - 1) : NaN;
  document.getElementById('statOverstate').textContent = isNaN(overstate) ? '—' : (overstate>=0?'+':'')+Math.round(overstate*100)+'%';
  var refX = state.view==='A' ? th.EXA : th.EXU;
  document.getElementById('statOverstateTheory').textContent = 'theory: avg truth ratio ≈ '+refX.toFixed(2)+'';

  document.getElementById('statFracAvail').textContent = fmtPct(availCount/state.agents.length);
  document.getElementById('statFracAvailTheory').textContent = 'theory: '+fmtPct(th.PA)+' at steady state';
}

function renderAll(){
  readColors();
  renderPool();
  renderHist();
  renderTime();
  updateStats();
  document.getElementById('tReadout').textContent = 't = '+state.t.toFixed(1);
}

var gammaSlider=document.getElementById('gammaSlider');
var nSlider=document.getElementById('nSlider');
var screenSlider=document.getElementById('screenSlider');
var speedSlider=document.getElementById('speedSlider');
var playBtn=document.getElementById('playBtn');
var histScrim=document.getElementById('histScrim');

function setPlaying(p){
  state.playing = p;
  playBtn.classList.toggle('playing', p);
  playBtn.classList.toggle('paused', !p);
  playBtn.setAttribute('aria-label', p ? 'Pause' : 'Play');
  histScrim.classList.toggle('hidden', p);
}

function syncGammaReadout(){
  document.getElementById('gammaReadout').textContent = state.gamma.toFixed(2);
  document.getElementById('gammaHelp').textContent =
      state.gamma < 0.12 ? 'Slow market: once someone is taken, they tend to stay taken.'
    : state.gamma > 0.5 ? 'Fast market: even great matches keep cycling back onto the market.'
    : 'Middling churn: some good people cycle back, most stay put.';
}

gammaSlider.addEventListener('input', function(){
  state.gamma = gammaFromSlider(+gammaSlider.value);
  syncGammaReadout();
});
nSlider.addEventListener('input', function(){
  state.n = +nSlider.value;
  document.getElementById('nReadout').textContent = state.n;
  resetSim();
});
function applyScreening(){
  state.screening = +screenSlider.value/100;
  document.getElementById('screenReadout').textContent = state.screening.toFixed(2);
  resetSim();
}
screenSlider.addEventListener('input', applyScreening);
document.querySelectorAll('.tickrow button[data-screen]').forEach(function(btn){
  btn.addEventListener('click', function(){
    screenSlider.value = btn.dataset.screen;
    applyScreening();
  });
});
speedSlider.addEventListener('input', function(){
  state.speed = +speedSlider.value/2;
  document.getElementById('speedReadout').textContent = state.speed.toFixed(1)+'×';
});

document.querySelectorAll('.tickrow button[data-preset]').forEach(function(btn){
  btn.addEventListener('click', function(){
    state.gamma = btn.dataset.preset==='hiring' ? PRESET_HIRING : PRESET_DATING;
    gammaSlider.value = sliderFromGamma(state.gamma);
    syncGammaReadout();
  });
});

document.querySelectorAll('.domain-toggle button').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('.domain-toggle button').forEach(function(b){b.classList.remove('active');});
    btn.classList.add('active');
    state.domain = btn.dataset.domain;
    var root = document.documentElement.style;
    root.setProperty('--accent', state.domain==='hiring' ? 'var(--hiring)' : 'var(--dating)');
    root.setProperty('--accent-soft', state.domain==='hiring' ? 'var(--hiring-soft)' : 'var(--dating-soft)');
    state.gamma = state.domain==='hiring' ? PRESET_HIRING : PRESET_DATING;
    gammaSlider.value = sliderFromGamma(state.gamma);
    syncGammaReadout();
    updateViewHelp();
    resetSim();
  });
});

function updateViewHelp(){
  var L = labels[state.domain];
  document.getElementById('viewAvailBtn').textContent = L.viewA;
  document.getElementById('viewTakenBtn').textContent = L.viewU;
  document.getElementById('viewHelp').textContent = state.view==='A' ? L.viewHelpA : L.viewHelpU;
}
function setView(v){
  state.view=v;
  document.getElementById('viewAvailBtn').classList.toggle('active', v==='A');
  document.getElementById('viewTakenBtn').classList.toggle('active', v==='U');
  updateViewHelp();
}
document.getElementById('viewAvailBtn').addEventListener('click', function(){ setView('A'); });
document.getElementById('viewTakenBtn').addEventListener('click', function(){ setView('U'); });

playBtn.addEventListener('click', function(){ setPlaying(!state.playing); });
document.getElementById('resetBtn').addEventListener('click', function(){
  resetSim(); setPlaying(false); renderAll();
});
document.getElementById('ffBtn').addEventListener('click', function(){
  for(var i=0;i<12000;i++){ simTick(DT); if(i%40===0) recordHistory(); }
  recordHistory();
  renderAll();
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll);
window.addEventListener('resize', renderAll);

var lastFrame=null;
function loop(ts){
  if(lastFrame===null) lastFrame=ts;
  var dtReal = Math.min(0.1, (ts-lastFrame)/1000);
  lastFrame = ts;
  if(state.playing){
    state.stepAccum += state.speed*dtReal/DT*8;
    var steps = Math.floor(state.stepAccum);
    state.stepAccum -= steps;
    for(var i=0;i<steps;i++){ simTick(DT); recordHistory(); }
  }
  renderAll();
  requestAnimationFrame(loop);
}

gammaSlider.value = sliderFromGamma(PRESET_HIRING);
syncGammaReadout();
updateViewHelp();
resetSim();
requestAnimationFrame(loop);
