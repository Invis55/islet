'use strict';
const glow = document.getElementById('glow'), bars = document.getElementById('bars');
window.islet.onAmbient((m) => {
  if (!m || m.mode === 'off') { glow.classList.remove('on'); bars.classList.remove('on'); return; }
  glow.classList.toggle('calm', !!m.calm);
  // restart the animation when the mode changes
  glow.classList.remove('on'); void glow.offsetWidth;
  glow.dataset.mode = m.mode; glow.classList.add('on');
  bars.classList.toggle('on', m.mode === 'chequered');
});
