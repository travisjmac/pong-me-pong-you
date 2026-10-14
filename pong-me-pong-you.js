/* Pong Me, Pong You
   First to 11, win by 2. The ball returns to center after each point.
   Where the ball meets the paddle sets the bounce angle.
   The right paddle is a speed-capped computer until someone takes it. */
(function () {
  "use strict";

  const VW = 960;
  const VH = 540;
  const TOP = 78;
  const BOT = 486;
  const BALL_R = 8;
  const P_W = 14;
  const P_H = 96;
  const P_X_L = 46;
  const P_X_R = 914;
  const BASE_SPEED = 430;
  const MAX_SPEED = 760;
  const SPEED_UP = 18;
  const HUMAN_SPEED = 560;
  const AI_MAX_SPEED = 160;
  const MAX_BOUNCE = Math.PI / 3;
  const WIN_SCORE = 11;
  const WIN_MARGIN = 2;

  const COL = {
    bg: "#1a1028",
    left: "#ff5d6c",
    leftDeep: "#c4324a",
    right: "#3ddecb",
    rightDeep: "#148f86",
    human2: "#ffd15c",
    human2Deep: "#d08918",
    ball: "#fff6ea",
    ink: "#fff6ea",
    dim: "#f0d7b0",
    plum: "#2a1438"
  };

  function mount(el) {
    if (!el) throw new Error("mount expects an element");

    const prevPosition = el.style.position;
    const prevMinHeight = el.style.minHeight;
    if (window.getComputedStyle(el).position === "static") el.style.position = "relative";
    if (el.clientHeight < 2) el.style.minHeight = "100vh";

    const shell = document.createElement("div");
    shell.style.cssText = "position:absolute;inset:0;overflow:hidden;background:#1a1028;user-select:none;touch-action:none;";
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Pong Me, Pong You");
    shell.appendChild(canvas);
    el.appendChild(shell);
    shell.tabIndex = 0;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas is unavailable");

    const midY = (TOP + BOT) / 2;
    const ball = { x: VW / 2, y: midY, vx: 0, vy: 0, speed: BASE_SPEED };
    const left = { x: P_X_L, y: midY, glow: 0 };
    const right = { x: P_X_R, y: midY, glow: 0 };
    const trail = [];
    const held = new Set();

    let scoreL = 0;
    let scoreR = 0;
    let serveDir = -1;
    let state = "stopped";
    let pausedFrom = "play";
    let rightHuman = false;
    let whoWon = "";
    let muted = false;
    let flash = 0;
    let flashSide = "";
    let shake = 0;
    let hitLock = 0;
    let dead = false;
    let lastT = 0;
    let raf = 0;
    let cssW = 960;
    let cssH = 540;
    let dpr = 1;
    let audioCtx = null;

    const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const ac = new AbortController();
    const listen = { signal: ac.signal };

    function centerBall() {
      ball.x = VW / 2;
      ball.y = midY;
      ball.vx = 0;
      ball.vy = 0;
      ball.speed = BASE_SPEED;
      trail.length = 0;
    }

    function centerPaddles() {
      left.y = midY;
      right.y = midY;
    }

    function matchWinner() {
      if (scoreL >= WIN_SCORE && scoreL - scoreR >= WIN_MARGIN) return "left";
      if (scoreR >= WIN_SCORE && scoreR - scoreL >= WIN_MARGIN) return "right";
      return "";
    }

    function audio() {
      if (muted) return null;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
      return audioCtx;
    }

    function beep(freq, dur, type, vol, delay) {
      try {
        const actx = audio();
        if (!actx) return;
        const t0 = actx.currentTime + (delay || 0);
        const osc = actx.createOscillator();
        const gain = actx.createGain();
        osc.type = type || "square";
        osc.frequency.setValueAtTime(freq, t0);
        gain.gain.setValueAtTime(Math.max(0.0001, vol), t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain);
        gain.connect(actx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      } catch (err) {
        /* Autoplay policies and missing outputs should not stop the match. */
      }
    }

    function clampPaddle(p) {
      const half = P_H / 2;
      const min = TOP + half;
      const max = BOT - half;
      if (p.y < min) p.y = min;
      if (p.y > max) p.y = max;
    }

    function launch() {
      const mag = 0.17 + Math.random() * 0.06;
      const angle = (Math.random() < 0.5 ? -1 : 1) * mag;
      ball.speed = BASE_SPEED;
      ball.vx = Math.cos(angle) * ball.speed * serveDir;
      ball.vy = Math.sin(angle) * ball.speed;
      state = "play";
      beep(660, 0.045, "square", 0.03);
    }

    function award(side) {
      if (side === "left") scoreL += 1;
      else scoreR += 1;
      flash = 1;
      flashSide = side;
      if (!reduceMotion) shake = 8;
      beep(220, 0.12, "sawtooth", 0.04);
      beep(146, 0.18, "square", 0.03, 0.09);
      centerBall();
      const champ = matchWinner();
      if (champ) {
        state = "over";
        whoWon = champ;
        beep(523, 0.12, "square", 0.04, 0.12);
        beep(659, 0.12, "square", 0.04, 0.22);
        beep(784, 0.22, "square", 0.045, 0.34);
        return;
      }
      serveDir *= -1;
      state = "serve";
    }

    function beginMatch(andServe) {
      if (held.has("p2-up") || held.has("p2-down")) rightHuman = true;
      scoreL = 0;
      scoreR = 0;
      serveDir = -1;
      whoWon = "";
      flash = 0;
      shake = 0;
      hitLock = 0;
      centerBall();
      centerPaddles();
      state = "serve";
      if (andServe) launch();
    }

    function quit() {
      scoreL = 0;
      scoreR = 0;
      serveDir = -1;
      whoWon = "";
      rightHuman = false;
      flash = 0;
      shake = 0;
      hitLock = 0;
      centerBall();
      centerPaddles();
      state = "stopped";
    }

    function togglePause() {
      if (state === "play" || state === "serve") {
        pausedFrom = state;
        state = "paused";
        beep(180, 0.05, "square", 0.028);
      } else if (state === "paused") {
        state = pausedFrom;
        beep(320, 0.05, "square", 0.028);
      }
    }

    function toggleMute() {
      muted = !muted;
      if (!muted) beep(880, 0.05, "square", 0.03);
    }

    function onSpace() {
      if (state === "stopped" || state === "over") beginMatch(true);
      else if (state === "serve") launch();
    }

    function typingTarget(target) {
      if (!target || !target.tagName) return false;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
    }

    function actionOf(e) {
      const key = e.key;
      if (key === "w" || key === "W") return "p1-up";
      if (key === "s" || key === "S") return "p1-down";
      if (key === "ArrowUp") return "p2-up";
      if (key === "ArrowDown") return "p2-down";
      if (key === " " || key === "Spacebar") return "serve";
      if (key === "p" || key === "P") return "pause";
      if (key === "r" || key === "R") return "restart";
      if (key === "m" || key === "M") return "mute";
      if (key === "Escape") return "quit";
      return "";
    }

    function onDown(e) {
      if (dead) return;
      const act = actionOf(e);
      if (!act || typingTarget(e.target)) return;
      e.preventDefault();
      const already = held.has(act);
      held.add(act);
      if (already || e.repeat) return;
      if ((act === "p2-up" || act === "p2-down") && (state === "play" || state === "serve" || state === "paused")) {
        rightHuman = true;
      }
      if (act === "serve") onSpace();
      else if (act === "pause") togglePause();
      else if (act === "restart") beginMatch(false);
      else if (act === "mute") toggleMute();
      else if (act === "quit") quit();
    }

    function onUp(e) {
      const act = actionOf(e);
      if (act) held.delete(act);
    }

    window.addEventListener("keydown", onDown, listen);
    window.addEventListener("keyup", onUp, listen);
    window.addEventListener("blur", function () { held.clear(); }, listen);

    function moveHuman(paddle, upAct, downAct, dt) {
      let dir = 0;
      if (held.has(upAct)) dir -= 1;
      if (held.has(downAct)) dir += 1;
      paddle.y += dir * HUMAN_SPEED * dt;
    }

    function moveAI(dt) {
      const target = state === "play" && ball.vx > 0 ? ball.y : midY;
      const dy = target - right.y;
      const step = AI_MAX_SPEED * dt;
      if (Math.abs(dy) <= step) right.y = target;
      else right.y += Math.sign(dy) * step;
    }

    function bounceFrom(paddle, dir, crossY) {
      const rel = (crossY - paddle.y) / (P_H / 2);
      const clamped = Math.max(-1, Math.min(1, rel));
      const angle = clamped * MAX_BOUNCE;
      ball.speed = Math.min(MAX_SPEED, ball.speed + SPEED_UP);
      ball.vx = Math.cos(angle) * ball.speed * dir;
      ball.vy = Math.sin(angle) * ball.speed;
      ball.y = crossY;
      const front = dir > 0 ? paddle.x + P_W / 2 : paddle.x - P_W / 2;
      ball.x = front + dir * (BALL_R + 0.75);
      paddle.glow = 1;
      hitLock = 0.08;
      beep(dir > 0 ? 523 : 392, 0.06, "square", 0.04);
    }

    function tryFace(paddle, dir) {
      if (hitLock > 0) return false;
      if (dir > 0 && ball.vx >= 0) return false;
      if (dir < 0 && ball.vx <= 0) return false;
      const front = dir > 0 ? paddle.x + P_W / 2 : paddle.x - P_W / 2;
      const prevEdge = dir > 0 ? ball.prevX - BALL_R : ball.prevX + BALL_R;
      const nextEdge = dir > 0 ? ball.x - BALL_R : ball.x + BALL_R;
      const crossed = dir > 0 ? prevEdge >= front && nextEdge <= front : prevEdge <= front && nextEdge >= front;
      if (!crossed) return false;
      const span = nextEdge - prevEdge;
      const u = span === 0 ? 0 : (front - prevEdge) / span;
      const crossY = ball.prevY + (ball.y - ball.prevY) * u;
      const reach = P_H / 2 + BALL_R;
      if (crossY < paddle.y - reach || crossY > paddle.y + reach) return false;
      bounceFrom(paddle, dir, crossY);
      return true;
    }

    function walls() {
      const minY = TOP + BALL_R;
      const maxY = BOT - BALL_R;
      if (ball.y < minY) {
        ball.y = minY + (minY - ball.y);
        ball.vy = Math.abs(ball.vy);
        if (ball.y > maxY) ball.y = minY;
        beep(196, 0.04, "square", 0.025);
      } else if (ball.y > maxY) {
        ball.y = maxY - (ball.y - maxY);
        ball.vy = -Math.abs(ball.vy);
        if (ball.y < minY) ball.y = maxY;
        beep(196, 0.04, "square", 0.025);
      }
    }

    function update(dt) {
      const frozen = state === "paused" || state === "over";
      if (!frozen) {
        moveHuman(left, "p1-up", "p1-down", dt);
        if (rightHuman || state === "stopped") moveHuman(right, "p2-up", "p2-down", dt);
        else moveAI(dt);
        clampPaddle(left);
        clampPaddle(right);
      }

      left.glow = Math.max(0, left.glow - dt * 4);
      right.glow = Math.max(0, right.glow - dt * 4);
      if (shake > 0) shake = Math.max(0, shake - dt * 22);
      if (flash > 0) flash = Math.max(0, flash - dt * 1.6);
      if (hitLock > 0) hitLock = Math.max(0, hitLock - dt);
      if (state !== "play") return;

      ball.prevX = ball.x;
      ball.prevY = ball.y;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      const hit = tryFace(left, 1) || tryFace(right, -1);
      walls();
      if (!hit && state === "play") {
        if (ball.x < 0) award("right");
        else if (ball.x > VW) award("left");
      }
      if (state === "play") {
        trail.push({ x: ball.x, y: ball.y });
        if (trail.length > 7) trail.shift();
      }
    }

    function layout() {
      const rect = shell.getBoundingClientRect();
      cssW = Math.max(1, rect.width);
      cssH = Math.max(1, rect.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
    }

    function roundRect(x, y, w, h, r) {
      const rad = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rad, y);
      ctx.arcTo(x + w, y, x + w, y + h, rad);
      ctx.arcTo(x + w, y + h, x, y + h, rad);
      ctx.arcTo(x, y + h, x, y, rad);
      ctx.arcTo(x, y, x + w, y, rad);
      ctx.closePath();
    }

    function star(x, y, r, color) {
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const rad = i % 2 === 0 ? r : r * 0.42;
        const a = (Math.PI / 4) * i - Math.PI / 2;
        const px = Math.cos(a) * rad;
        const py = Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    function paint(text, x, y, size, color, align, font) {
      ctx.textAlign = align || "center";
      ctx.textBaseline = "middle";
      ctx.font = "700 " + size + "px " + (font || "Georgia, 'Times New Roman', serif");
      if (size >= 16) {
        ctx.lineWidth = Math.max(3, size / 9);
        ctx.strokeStyle = "rgba(24, 10, 36, 0.8)";
        ctx.strokeText(text, x, y);
      }
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    }

    function moodFor(side) {
      if (state === "over") return whoWon === side ? "win" : "lose";
      if (state === "paused") return "pause";
      const coming = side === "left" ? ball.vx < 0 : ball.vx > 0;
      const px = side === "left" ? left.x : right.x;
      if (state === "play" && coming && Math.abs(ball.x - px) < 160) return "focus";
      if (flash > 0 && flashSide === side) return "cheer";
      return "smile";
    }

    function drawSky(now) {
      const g = ctx.createLinearGradient(0, 0, 0, VH);
      g.addColorStop(0, "#6d3a98");
      g.addColorStop(0.42, "#3a1864");
      g.addColorStop(1, "#1a1028");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VW, VH);

      const stars = [[48, 18], [210, 14], [430, 16], [690, 12], [900, 20], [120, 34], [560, 22]];
      for (let i = 0; i < stars.length; i++) {
        const tw = reduceMotion ? 0.8 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now / 380 + i));
        ctx.globalAlpha = tw;
        star(stars[i][0], stars[i][1], 2.4 + (i % 3), "#fff6ea");
      }
      ctx.globalAlpha = 1;

      ctx.strokeStyle = "#1a1028";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 8);
      for (let x = 0; x <= VW; x += 36) ctx.quadraticCurveTo(x + 18, 18, x + 36, 8);
      ctx.stroke();
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = ["#ff5d6c", "#ffd15c", "#3ddecb", "#fff6ea"][i % 4];
        ctx.globalAlpha = reduceMotion ? 0.9 : 0.65 + 0.35 * Math.sin(now / 170 + i);
        ctx.beginPath();
        ctx.arc(18 + i * 36, 12, 4.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function drawCrowd(now) {
      const spots = [250, 310, 650, 710];
      for (let i = 0; i < spots.length; i++) {
        const bob = reduceMotion ? 0 : Math.sin(now / 280 + i * 0.8) * 2.2;
        const x = spots[i];
        const y = 50 + bob;
        ctx.fillStyle = ["#ffb085", "#ffe08a", "#9fd4ff", "#e2b6ff"][i];
        ctx.beginPath();
        ctx.arc(x, y, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#2a1838";
        ctx.beginPath();
        ctx.arc(x - 3.2, y - 1, 1.3, 0, Math.PI * 2);
        ctx.arc(x + 3.2, y - 1, 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#2a1838";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(x, y + 3, 3, 0.2, Math.PI - 0.2);
        ctx.stroke();
      }
    }

    function drawCourt() {
      ctx.fillStyle = "#6a3b22";
      ctx.fillRect(0, BOT + 6, VW, VH - BOT);
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 === 0 ? "#7a4628" : "#5c3218";
        ctx.fillRect(i * 120, BOT + 8, 120, VH);
        ctx.strokeStyle = "rgba(36, 16, 8, 0.35)";
        ctx.lineWidth = 1;
        ctx.strokeRect(i * 120, BOT + 8, 120, VH);
      }
      for (let i = 0; i < 4; i++) {
        const x = 70 + i * 270;
        ctx.fillStyle = "#c47a32";
        ctx.fillRect(x, BOT + 4, 16, 26);
        ctx.fillStyle = "#8d4e1e";
        ctx.fillRect(x - 6, BOT + 28, 28, 6);
      }

      roundRect(16, TOP - 22, VW - 32, BOT - TOP + 44, 18);
      ctx.fillStyle = "#e39a45";
      ctx.fill();
      ctx.strokeStyle = "#8a4e16";
      ctx.lineWidth = 3;
      ctx.stroke();
      for (let x = 32; x < VW - 32; x += 16) {
        ctx.fillStyle = ((x / 16) | 0) % 2 === 0 ? "rgba(120, 60, 18, 0.22)" : "rgba(255, 236, 190, 0.2)";
        ctx.fillRect(x, TOP - 16, 8, 11);
        ctx.fillRect(x, BOT + 1, 8, 11);
      }

      const felt = ctx.createLinearGradient(0, TOP, 0, BOT);
      felt.addColorStop(0, "#2ed194");
      felt.addColorStop(1, "#0c8f66");
      roundRect(32, TOP, VW - 64, BOT - TOP, 12);
      ctx.fillStyle = felt;
      ctx.fill();

      ctx.strokeStyle = "rgba(255, 246, 234, 0.28)";
      ctx.lineWidth = 2;
      roundRect(52, TOP + 16, VW - 104, BOT - TOP - 32, 8);
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(230, midY + 36, 46, 0.3, 1.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(730, midY - 28, 38, 2.1, 3.8);
      ctx.stroke();

      star(96, TOP + 34, 7, "rgba(255, 246, 234, 0.8)");
      star(VW - 96, TOP + 34, 7, "rgba(255, 246, 234, 0.8)");
      star(96, BOT - 34, 7, "rgba(255, 246, 234, 0.8)");
      star(VW - 96, BOT - 34, 7, "rgba(255, 246, 234, 0.8)");

      ctx.strokeStyle = "rgba(255, 246, 234, 0.92)";
      ctx.lineWidth = 3;
      ctx.setLineDash([2, 9]);
      ctx.beginPath();
      ctx.moveTo(VW / 2, TOP + 18);
      ctx.lineTo(VW / 2, BOT - 18);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff6ea";
      ctx.beginPath();
      ctx.arc(VW / 2, TOP + 18, 4, 0, Math.PI * 2);
      ctx.arc(VW / 2, BOT - 18, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 246, 234, 0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(VW / 2, midY, 22, 0, Math.PI * 2);
      ctx.stroke();
      star(VW / 2, midY, 5, "rgba(255, 246, 234, 0.55)");
    }

    function drawFace(x, y, side, robot, now) {
      const mood = moodFor(side);
      const dx = ball.x - x;
      const dy = ball.y - y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const lx = (dx / len) * 1.3;
      const ly = (dy / len) * 1.3;
      if (robot) {
        roundRect(x - 16, y - 9, 32, 18, 5);
        ctx.fillStyle = "#102824";
        ctx.fill();
        const blink = !reduceMotion && Math.sin(now / 190) > 0.94;
        ctx.fillStyle = mood === "win" ? "#ffe14a" : mood === "lose" ? "#ff7a88" : "#8dffe4";
        if (!blink) {
          ctx.fillRect(x - 10, y - 3, 7, 6);
          ctx.fillRect(x + 3, y - 3, 7, 6);
        }
        return;
      }
      const blink = state !== "paused" && !reduceMotion && Math.sin(now / 250 + (side === "left" ? 0 : 1.4)) > 0.97;
      ctx.fillStyle = "#2a1838";
      if (blink || mood === "pause") {
        ctx.strokeStyle = "#2a1838";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x - 9, y);
        ctx.lineTo(x - 3, y);
        ctx.moveTo(x + 3, y);
        ctx.lineTo(x + 9, y);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x - 6, y, 2.5, 0, Math.PI * 2);
        ctx.arc(x + 6, y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff6ea";
        ctx.beginPath();
        ctx.arc(x - 6 + lx, y + ly, 0.9, 0, Math.PI * 2);
        ctx.arc(x + 6 + lx, y + ly, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(255, 93, 108, 0.55)";
      ctx.beginPath();
      ctx.arc(x - 12, y + 5, 2.4, 0, Math.PI * 2);
      ctx.arc(x + 12, y + 5, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#2a1838";
      ctx.lineWidth = 1.7;
      ctx.lineCap = "round";
      ctx.beginPath();
      if (mood === "focus") ctx.arc(x, y + 9, 2.6, 0, Math.PI * 2);
      else if (mood === "lose") ctx.arc(x, y + 13, 5, Math.PI * 1.15, Math.PI * 1.85);
      else if (mood === "win" || mood === "cheer") ctx.arc(x, y + 6, 6, 0.15, Math.PI - 0.15);
      else ctx.arc(x, y + 6, 5, 0.25, Math.PI - 0.25);
      ctx.stroke();
    }

    function drawMascot(p, side, now) {
      const inward = side === "left" ? 1 : -1;
      const edge = p.x + inward * (P_W / 2);
      const bodyW = 50;
      const bodyH = P_H;
      const bodyX = inward === 1 ? edge - bodyW : edge;
      const bodyY = p.y - bodyH / 2;
      const robot = side === "right" && !rightHuman;
      const color = side === "left" ? COL.left : (rightHuman ? COL.human2 : COL.right);
      const deep = side === "left" ? COL.leftDeep : (rightHuman ? COL.human2Deep : COL.rightDeep);
      const mood = moodFor(side);

      ctx.save();
      if (!reduceMotion && flash > 0 && flashSide === side) ctx.translate(0, Math.sin(now * 0.03) * 4 * flash);

      ctx.save();
      ctx.translate(edge - inward * 24, bodyY + bodyH - 2);
      ctx.scale(1, 0.35);
      ctx.fillStyle = "rgba(16, 8, 20, 0.28)";
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      const r = 18;
      if (inward === 1) {
        ctx.moveTo(bodyX + r, bodyY);
        ctx.lineTo(edge, bodyY);
        ctx.lineTo(edge, bodyY + bodyH);
        ctx.lineTo(bodyX + r, bodyY + bodyH);
        ctx.arcTo(bodyX, bodyY + bodyH, bodyX, bodyY, r);
        ctx.arcTo(bodyX, bodyY, edge, bodyY, r);
      } else {
        ctx.moveTo(edge, bodyY);
        ctx.lineTo(bodyX + bodyW - r, bodyY);
        ctx.arcTo(bodyX + bodyW, bodyY, bodyX + bodyW, bodyY + bodyH, r);
        ctx.arcTo(bodyX + bodyW, bodyY + bodyH, edge, bodyY + bodyH, r);
        ctx.lineTo(edge, bodyY + bodyH);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = deep;
      ctx.lineWidth = 2;
      ctx.stroke();

      roundRect(bodyX + (inward === 1 ? 8 : 14), bodyY + 34, bodyW - 26, bodyH - 52, 12);
      ctx.fillStyle = robot ? "#d9fff6" : "#fff1dc";
      ctx.fill();

      ctx.fillStyle = deep;
      ctx.fillRect(p.x - 2, bodyY + 10, 3, P_H - 20);
      ctx.fillStyle = "#fff6ea";
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(p.x - 0.5, p.y - 22 + i * 22, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }

      const faceX = bodyX + bodyW / 2 - inward * 4;
      const faceY = bodyY + 24;
      if (!robot && side === "left") {
        ctx.fillStyle = "#6b3a2a";
        ctx.beginPath();
        ctx.arc(faceX - 4, bodyY + 10, 9, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(faceX + 6, bodyY + 7, 6, 0, Math.PI * 2);
        ctx.fill();
      } else if (!robot) {
        ctx.fillStyle = "#3d6eae";
        roundRect(faceX - 16, bodyY + 4, 34, 10, 4);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(faceX + inward * -14, bodyY + 10, 5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const ax = bodyX + (inward === 1 ? 14 : bodyW - 14);
        ctx.strokeStyle = "#d9fff6";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ax, bodyY + 12);
        ctx.lineTo(ax - inward * 10, bodyY + 6);
        ctx.stroke();
        ctx.fillStyle = mood === "focus" ? "#ff5d6c" : "#ffe14a";
        ctx.beginPath();
        ctx.arc(ax - inward * 10, bodyY + 6, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = deep;
        ctx.beginPath();
        ctx.arc(bodyX + 16, bodyY + bodyH - 18, 2, 0, Math.PI * 2);
        ctx.arc(bodyX + bodyW - 16, bodyY + bodyH - 18, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      drawFace(faceX, faceY, side, robot, now);
      paint(side === "left" ? "ME" : (robot ? "BOT" : "YOU"), faceX, bodyY + bodyH - 18, 12, deep);

      if (p.glow > 0) {
        ctx.globalAlpha = 0.28 * p.glow;
        ctx.fillStyle = "#fff6ea";
        ctx.fillRect(edge - (inward === 1 ? 8 : 0), bodyY + 8, 8, bodyH - 16);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    function drawBall(now) {
      for (let i = 0; i < trail.length; i++) {
        const t = trail[i];
        const k = (i + 1) / (trail.length + 1);
        ctx.globalAlpha = 0.22 * k;
        star(t.x, t.y, 4 * k, i % 2 ? "#ffd15c" : "#fff6ea");
      }
      ctx.globalAlpha = 1;

      ctx.save();
      ctx.translate(ball.x + 2, ball.y + 6);
      ctx.scale(1, 0.4);
      ctx.fillStyle = "rgba(8, 40, 28, 0.35)";
      ctx.beginPath();
      ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (state === "serve") {
        ctx.globalAlpha = 0.35 + 0.25 * Math.sin(now / 200);
        ctx.strokeStyle = "#fff6ea";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.fillStyle = COL.ball;
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#e4d3b4";
      ctx.lineWidth = 1;
      ctx.stroke();

      const look = state === "play" ? Math.atan2(ball.vy, ball.vx) : (serveDir < 0 ? Math.PI : 0);
      const ex = Math.cos(look) * 1.4;
      const ey = Math.sin(look) * 1.4;
      const shut = state === "paused" || state === "over";
      ctx.fillStyle = "#2a1838";
      if (shut) {
        ctx.strokeStyle = "#2a1838";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(ball.x - 3.4, ball.y - 1);
        ctx.lineTo(ball.x - 1.2, ball.y - 1);
        ctx.moveTo(ball.x + 1.2, ball.y - 1);
        ctx.lineTo(ball.x + 3.4, ball.y - 1);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(ball.x - 2.4, ball.y - 1.2, 1.3, 0, Math.PI * 2);
        ctx.arc(ball.x + 2.4, ball.y - 1.2, 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(ball.x - 2.4 + ex * 0.4, ball.y - 1.2 + ey * 0.4, 0.45, 0, Math.PI * 2);
        ctx.arc(ball.x + 2.4 + ex * 0.4, ball.y - 1.2 + ey * 0.4, 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "#2a1838";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (state === "over" && whoWon) ctx.arc(ball.x, ball.y + 1.2, 2.4, 0.2, Math.PI - 0.2);
      else if (shut) ctx.arc(ball.x, ball.y + 3.2, 2, Math.PI * 1.2, Math.PI * 1.8);
      else ctx.arc(ball.x, ball.y + 1.4, 2.2, 0.25, Math.PI - 0.25);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(ball.x - 3, ball.y - 3.2, 1.5, 0, Math.PI * 2);
      ctx.fill();

      if (state === "paused") {
        paint("z", ball.x + 12, ball.y - 12, 12, "#fff6ea");
        paint("z", ball.x + 22, ball.y - 22, 10, "#ffe08a");
      }
    }

    function drawScores(now) {
      const lColor = flashSide === "left" && flash > 0 ? "#ffe1d8" : COL.left;
      const rColor = flashSide === "right" && flash > 0 ? "#e7fffb" : COL.right;
      function ticket(cx) {
        roundRect(cx - 58, 8, 116, 60, 14);
        ctx.fillStyle = COL.plum;
        ctx.fill();
        ctx.strokeStyle = "#f2c14e";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = "#f2c14e";
        ctx.beginPath();
        ctx.arc(cx - 44, 38, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ticket(168);
      ticket(VW - 168);
      paint(String(scoreL), 176, 30, 36, lColor, "center", "Impact, 'Arial Black', sans-serif");
      paint(String(scoreR), VW - 160, 30, 36, rColor, "center", "Impact, 'Arial Black', sans-serif");
      paint(rightHuman ? "P1" : "YOU", 176, 52, 12, COL.dim);
      paint(rightHuman ? "P2" : "AI", VW - 160, 52, 12, COL.dim);

      roundRect(VW / 2 - 132, 10, 264, 46, 12);
      ctx.fillStyle = "#f2c14e";
      ctx.fill();
      ctx.strokeStyle = "#8a4e16";
      ctx.lineWidth = 3;
      ctx.stroke();
      paint("PONG ME, PONG YOU", VW / 2, 26, 16, "#3a1838");
      const rule = scoreL >= 10 && scoreR >= 10 && !whoWon ? "WIN BY 2" : "FIRST TO 11  ·  WIN BY 2";
      paint(rule, VW / 2, 44, 11, "#6a3a16");

      if (flash > 0 && !reduceMotion) {
        const x = flashSide === "left" ? 168 : VW - 168;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + now * 0.004;
          const dist = 18 + (1 - flash) * 36;
          star(x + Math.cos(a) * dist, 36 + Math.sin(a) * dist * 0.55, 4, ["#ffd15c", "#ff5d6c", "#3ddecb", "#fff6ea"][i % 4]);
        }
      }
    }

    function drawKeys(y) {
      paint("W S  LEFT     ↑ ↓  RIGHT     SPACE  SERVE     P  PAUSE     R  RESTART     M  MUTE     ESC  QUIT", VW / 2, y, 12, "#ffe7c2");
    }

    function ribbon(y, h) {
      ctx.fillStyle = "rgba(28, 12, 42, 0.78)";
      roundRect(190, y, 580, h, 18);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(190, y + 12);
      ctx.lineTo(158, y + h / 2);
      ctx.lineTo(190, y + h - 12);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(770, y + 12);
      ctx.lineTo(802, y + h / 2);
      ctx.lineTo(770, y + h - 12);
      ctx.closePath();
      ctx.fill();
    }

    function miniHead(x, y, color) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff1dc";
      ctx.beginPath();
      ctx.arc(x, y + 3, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#2a1838";
      ctx.beginPath();
      ctx.arc(x - 4, y + 1, 1.7, 0, Math.PI * 2);
      ctx.arc(x + 4, y + 1, 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#2a1838";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y + 6, 4, 0.2, Math.PI - 0.2);
      ctx.stroke();
    }

    function draw(now) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#1a1028";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const s = Math.min(cssW / VW, cssH / VH);
      const ox = (cssW - VW * s) / 2;
      const oy = (cssH - VH * s) / 2;
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (!reduceMotion && shake > 0.2) {
        ctx.translate(Math.sin(now * 0.05) * shake, Math.cos(now * 0.07) * shake);
      }

      drawSky(now);
      drawCrowd(now);
      drawCourt();
      drawMascot(left, "left", now);
      drawMascot(right, "right", now);
      drawBall(now);

      if (state !== "stopped") drawScores(now);

      if (state === "stopped") {
        roundRect(128, 112, 704, 312, 22);
        ctx.fillStyle = "rgba(32, 16, 52, 0.92)";
        ctx.fill();
        ctx.strokeStyle = "#f2c14e";
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.setLineDash([4, 6]);
        roundRect(142, 126, 676, 284, 16);
        ctx.strokeStyle = "rgba(242, 193, 78, 0.7)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        star(156, 140, 8, "#ffd15c");
        star(804, 140, 8, "#ff5d6c");
        star(156, 396, 8, "#3ddecb");
        star(804, 396, 8, "#fff6ea");
        miniHead(188, 230, COL.left);
        miniHead(772, 230, rightHuman ? COL.human2 : COL.right);
        paint("PONG ME, PONG YOU", VW / 2, 158, 34, COL.ink);
        paint("First to 11. Win by 2.", VW / 2, 196, 16, COL.dim);
        paint("W / S", 280, 238, 16, COL.ink, "left");
        paint("left paddle up / down", 390, 238, 16, COL.dim, "left");
        paint("↑ / ↓", 280, 266, 16, COL.ink, "left");
        paint("right paddle up / down", 390, 266, 16, COL.dim, "left");
        paint("SPACE", 280, 294, 16, COL.ink, "left");
        paint("serve / start", 390, 294, 16, COL.dim, "left");
        paint("P pause    R restart    M mute    ESC quit", VW / 2, 332, 15, COL.dim);
        const friend = rightHuman || held.has("p2-up") || held.has("p2-down");
        paint(friend ? "Right paddle: player 2" : "Right paddle: beatable computer", VW / 2, 364, 15, friend ? COL.right : "#f2c14e");
        paint("Hold ↑ or ↓ and press Space for two players.", VW / 2, 390, 13, COL.dim);
      } else if (state === "serve") {
        const pulse = 0.55 + 0.45 * Math.sin(now / 220);
        ctx.globalAlpha = pulse;
        const dirWord = serveDir < 0 ? "←  SPACE TO SERVE" : "SPACE TO SERVE  →";
        paint(dirWord, VW / 2, midY + 52, 18, COL.ink);
        ctx.globalAlpha = 1;
        drawKeys(518);
      } else if (state === "paused") {
        ribbon(midY - 54, 108);
        paint("PAUSED", VW / 2, midY - 16, 40, COL.ink);
        paint("P to resume", VW / 2, midY + 22, 16, COL.dim);
        drawKeys(518);
      } else if (state === "over") {
        ribbon(midY - 70, 140);
        const name = whoWon === "left" ? (rightHuman ? "PLAYER 1 WINS" : "YOU WIN") : (rightHuman ? "PLAYER 2 WINS" : "COMPUTER WINS");
        paint(name, VW / 2, midY - 28, 32, whoWon === "left" ? COL.left : COL.right);
        paint(scoreL + "  –  " + scoreR, VW / 2, midY + 12, 22, COL.ink);
        paint("SPACE new match    R restart    ESC quit", VW / 2, midY + 46, 14, COL.dim);
      } else {
        drawKeys(518);
        if (muted) paint("MUTED", VW - 78, 518, 12, "#f2c14e", "right");
      }

      if (muted && state !== "play") paint("MUTED", VW - 78, state === "stopped" ? 104 : 518, 12, "#f2c14e", "right");
    }

    function frame(t) {
      if (dead) return;
      if (!lastT) lastT = t;
      const dt = Math.min(0.034, (t - lastT) / 1000);
      lastT = t;
      update(dt);
      draw(t);
      raf = requestAnimationFrame(frame);
    }

    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(shell);
    window.addEventListener("resize", layout, listen);
    raf = requestAnimationFrame(frame);

    function destroy() {
      if (dead) return;
      dead = true;
      ac.abort();
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      held.clear();
      if (audioCtx) {
        const closing = audioCtx;
        audioCtx = null;
        closing.close().catch(function () {});
      }
      shell.remove();
      el.style.position = prevPosition;
      el.style.minHeight = prevMinHeight;
    }

    return { destroy: destroy };
  }

  globalThis.DESKTOP_GAMES = globalThis.DESKTOP_GAMES || {};
  globalThis.DESKTOP_GAMES["pong-me-pong-you"] = {
    id: "pong-me-pong-you",
    title: "Pong Me, Pong You",
    mount: mount
  };

  function bootPlayer() {
    if (bootPlayer.done || typeof document === "undefined") return;
    const body = document.body;
    if (!body || !body.hasAttribute("data-game-player")) return;
    bootPlayer.done = true;
    const rootStyle = document.documentElement.style;
    rootStyle.background = "#1a1028";
    rootStyle.height = "100%";
    body.style.margin = "0";
    body.style.height = "100%";
    body.style.overflow = "hidden";
    body.style.background = "#1a1028";
    const root = document.createElement("div");
    root.style.cssText = "position:fixed;inset:0;width:100%;height:100%;";
    body.appendChild(root);
    globalThis.DESKTOP_GAMES["pong-me-pong-you"].mount(root);
  }

  if (typeof document !== "undefined") {
    bootPlayer();
    document.addEventListener("DOMContentLoaded", bootPlayer);
  }
})();
