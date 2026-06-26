(function() {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  const GRID = 22;
  const CELL = 20;
  canvas.width = GRID * CELL;
  canvas.height = GRID * CELL;

  const scoreEl   = document.getElementById('score');
  const highEl    = document.getElementById('highScore');
  const speedLvEl = document.getElementById('speedLv');
  const btnPause  = document.getElementById('btnPause');
  const btnRestart= document.getElementById('btnRestart');

  // polyfill roundRect for older browsers
  if (!ctx.roundRect) {
    ctx.roundRect = function(x, y, w, h, r) {
      if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
      ctx.beginPath();
      ctx.moveTo(x + r.tl, y);
      ctx.lineTo(x + w - r.tr, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r.tr);
      ctx.lineTo(x + w, y + h - r.br);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
      ctx.lineTo(x + r.bl, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r.bl);
      ctx.lineTo(x, y + r.tl);
      ctx.quadraticCurveTo(x, y, x + r.tl, y);
      ctx.closePath();
    };
  }

  /* ---- audio (Web Audio API, no files needed) ---- */
  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function playTone(freq, type, duration, vol, ramp) {
    const ctx = ensureAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (ramp) osc.frequency.linearRampToValueAtTime(ramp, ctx.currentTime + duration);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }

  function soundEat() {
    playTone(440, 'square', 0.08, 0.06, 880);       // quick rising blip
  }

  function soundSpeedUp() {
    const ctx = ensureAudio();
    const now = ctx.currentTime;
    [523, 659, 784].forEach((freq, i) => {             // C5, E5, G5 arpeggio
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.07);
      gain.gain.setValueAtTime(0.08, now + i * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.07 + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.07);
      osc.stop(now + i * 0.07 + 0.12);
    });
  }

  function soundDie() {
    const ctx = ensureAudio();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.linearRampToValueAtTime(80, now + 0.5);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.55);
  }

  const BASE_SPEED  = 200;
  const MIN_SPEED   = 50;
  const SPEED_STEP  = 22;

  let snake, food, dir, nextDir, score, highScore = 0, speed, speedLv;
  let running, paused, lastTickTime, rafId;
  let gameoverTitle = null;
  let gameoverSub = null;
  let particles = [];
  let eatCount;

  /* ---- init / reset ---- */
  function init() {
    const cx = Math.floor(GRID / 2);
    const cy = Math.floor(GRID / 2);
    snake = [
      { x: cx,     y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
    ];
    dir      = 'RIGHT';
    nextDir  = 'RIGHT';
    score    = 0;
    speed    = BASE_SPEED;
    speedLv  = 1;
    eatCount = 0;
    particles = [];
    gameoverTitle = null;
    gameoverSub = null;
    placeFood();

    scoreEl.textContent   = '0';
    highEl.textContent    = highScore;
    speedLvEl.textContent = '1';

    running  = true;
    paused   = false;
    btnPause.textContent = '暂停';
    lastTickTime = performance.now();

    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(renderLoop);
  }

  /* ---- food ---- */
  function placeFood() {
    const occupied = new Set(snake.map(p => `${p.x},${p.y}`));
    const free = [];
    for (let x = 0; x < GRID; x++)
      for (let y = 0; y < GRID; y++)
        if (!occupied.has(`${x},${y}`)) free.push({ x, y });

    if (free.length === 0) { win(); return; }
    food = free[Math.floor(Math.random() * free.length)];
  }

  /* ---- snake tick (pure logic, no rendering) ---- */
  function snakeTick() {
    dir = nextDir;
    const head = snake[0];
    const nh = { x: head.x, y: head.y };
    if (dir === 'UP')    nh.y--;
    if (dir === 'DOWN')  nh.y++;
    if (dir === 'LEFT')  nh.x--;
    if (dir === 'RIGHT') nh.x++;

    if (nh.x < 0 || nh.x >= GRID || nh.y < 0 || nh.y >= GRID) { die(); return; }
    for (let i = 0; i < snake.length; i++)
      if (snake[i].x === nh.x && snake[i].y === nh.y) { die(); return; }

    snake.unshift(nh);

    if (nh.x === food.x && nh.y === food.y) {
      score += 10;
      eatCount++;
      scoreEl.textContent = score;

      if (eatCount % 5 === 0 && speed > MIN_SPEED) {
        speed = Math.max(MIN_SPEED, speed - SPEED_STEP);
        speedLv++;
        speedLvEl.textContent = speedLv;
        soundSpeedUp();
      } else {
        soundEat();
      }

      spawnParticles(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2);
      placeFood();

      if (score > highScore) {
        highScore = score;
        highEl.textContent = highScore;
        try { localStorage.setItem('snake_highscore', highScore); } catch (e) {}
      }
    } else {
      snake.pop();
    }
  }

  function die() {
    running = false;
    soundDie();
    gameoverTitle = '游戏结束';
    gameoverSub = `得分: ${score}`;
  }

  function win() {
    running = false;
    gameoverTitle = '你赢了!';
    gameoverSub = `得分: ${score}`;
  }

  /* ---- render loop (rAF, always ~60 fps) ---- */
  function renderLoop(now) {
    if (running && !paused && now - lastTickTime >= speed) {
      lastTickTime = now;
      snakeTick();
    }

    updateParticles();
    draw();

    rafId = requestAnimationFrame(renderLoop);
  }

  /* ---- drawing ---- */

  function spawnParticles(cx, cy) {
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 / 8) * i + Math.random() * 0.4;
      particles.push({ x: cx, y: cy, vx: Math.cos(a) * 2, vy: Math.sin(a) * 2, life: 1 });
    }
  }

  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.04;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // grid
    ctx.strokeStyle = '#D9D1C7';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= GRID; x++) {
      ctx.beginPath(); ctx.moveTo(x * CELL, 0); ctx.lineTo(x * CELL, GRID * CELL); ctx.stroke();
    }
    for (let y = 0; y <= GRID; y++) {
      ctx.beginPath(); ctx.moveTo(0, y * CELL); ctx.lineTo(GRID * CELL, y * CELL); ctx.stroke();
    }

    // food
    if (food) {
      const fx = food.x * CELL + CELL / 2;
      const fy = food.y * CELL + CELL / 2;
      ctx.fillStyle = 'rgba(194, 122, 106, 0.15)';
      ctx.beginPath();
      ctx.arc(fx, fy, CELL * 0.7, 0, Math.PI * 2);
      ctx.fill();
      const pulse = 1 + Math.sin(Date.now() / 200) * 0.15;
      ctx.fillStyle = '#C27A6A';
      ctx.beginPath();
      ctx.arc(fx, fy, (CELL / 2 - 2) * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // snake
    const len = snake.length;
    for (let i = len - 1; i >= 0; i--) {
      const s = snake[i];
      const t = len === 1 ? 0 : i / (len - 1);
      if (i === 0) {
        ctx.fillStyle = '#6B7F93';
      } else {
        const r = Math.round(129 + 50 * t);
        const g = Math.round(148 + 43 * t);
        const b = Math.round(165 + 36 * t);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
      }
      const pad = i === 0 ? 1 : 2;
      const r = i === 0 ? 5 : 4;
      ctx.beginPath();
      ctx.roundRect(s.x * CELL + pad, s.y * CELL + pad, CELL - pad * 2, CELL - pad * 2, r);
      ctx.fill();
    }

    // particles
    for (const p of particles) {
      ctx.fillStyle = `rgba(194, 122, 106, ${p.life})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 * p.life + 1, 0, Math.PI * 2);
      ctx.fill();
    }

    // game over overlay
    if (!running && gameoverTitle) {
      ctx.fillStyle = 'rgba(232, 225, 216, 0.85)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#5A5350';
      ctx.font = '600 28px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(gameoverTitle, canvas.width / 2, canvas.height / 2 - 10);
      ctx.font = '16px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = '#8A827D';
      ctx.fillText(gameoverSub, canvas.width / 2, canvas.height / 2 + 24);
      ctx.textAlign = 'start';
    }

    // paused overlay
    if (running && paused) {
      ctx.fillStyle = 'rgba(232, 225, 216, 0.7)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#8A827D';
      ctx.font = '600 22px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('已暂停', canvas.width / 2, canvas.height / 2);
      ctx.textAlign = 'start';
    }
  }

  /* ---- input ---- */
  function setDirection(d) {
    const opp = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
    if (opp[d] !== dir) nextDir = d;
  }

  document.addEventListener('keydown', e => {
    ensureAudio(); // warm up AudioContext on first keypress
    const k = e.key.toLowerCase();
    if (k === 'arrowup'    || k === 'w') { e.preventDefault(); setDirection('UP'); }
    if (k === 'arrowdown'  || k === 's') { e.preventDefault(); setDirection('DOWN'); }
    if (k === 'arrowleft'  || k === 'a') { e.preventDefault(); setDirection('LEFT'); }
    if (k === 'arrowright' || k === 'd') { e.preventDefault(); setDirection('RIGHT'); }
    if (k === ' ') { e.preventDefault(); togglePause(); }
  });

  document.querySelector('.dir-up').onclick    = () => setDirection('UP');
  document.querySelector('.dir-down').onclick  = () => setDirection('DOWN');
  document.querySelector('.dir-left').onclick  = () => setDirection('LEFT');
  document.querySelector('.dir-right').onclick = () => setDirection('RIGHT');

  let tsX, tsY;
  canvas.addEventListener('touchstart', e => { tsX = e.touches[0].clientX; tsY = e.touches[0].clientY; });
  canvas.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tsX;
    const dy = e.changedTouches[0].clientY - tsY;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
    setDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'RIGHT' : 'LEFT') : (dy > 0 ? 'DOWN' : 'UP'));
  });

  function togglePause() {
    if (!running) return;
    paused = !paused;
    btnPause.textContent = paused ? '继续' : '暂停';
    if (!paused) lastTickTime = performance.now();
  }

  btnPause.onclick = togglePause;
  btnRestart.onclick = () => init();

  try {
    const saved = localStorage.getItem('snake_highscore');
    highScore = (saved && parseInt(saved, 10)) || 0;
  } catch (e) { highScore = 0; }

  init();
})();
