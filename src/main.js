import './styles.css';
import { initChrome } from './chrome.js';
import { initJobs } from './jobs.js';
import { createStory } from './story.js';
import { createPlayground } from './playground.js';
import { createAct2Story, createAct2Play } from './act2.js';
import { createAct3Story, createAct3Play } from './act3.js';
import { createAct4Story, createAct4Play } from './act4.js';

initChrome();
initJobs();
const story = createStory(document.getElementById('act-1-story'));
const playground = createPlayground(document.getElementById('act-1-play'));
const act2 = createAct2Story(document.getElementById('act-2-story'));
const act2play = createAct2Play(document.getElementById('act-2-play'));
const act3 = createAct3Story(document.getElementById('act-3-story'));
createAct3Play(document.getElementById('act-3-play'));
const act4 = createAct4Story(document.getElementById('act-4-story'));
const act4play = createAct4Play(document.getElementById('act-4-play'));

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', playground.render);

let last = null;
function loop(ts) {
  const dt = last === null ? 0 : Math.min(0.1, (ts - last) / 1000);
  last = ts;
  story.frame(dt);
  playground.frame(dt);
  act2.frame(dt);
  act2play.frame(dt);
  act3.frame(dt);
  act4.frame(dt);
  act4play.frame(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
