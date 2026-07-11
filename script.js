/* ============================================================================
   RPS DUEL - 2 Player Local Combat Game
   Pure HTML5 / CSS3 / ES6 JavaScript, no external frameworks.

   GAME RULE SUMMARY
   - 2 characters, 10 HP each.
   - Each round both players secretly pick Rock / Paper / Scissors (Búa / Bao / Kéo).
   - The Rock-Paper-Scissors winner gets to attack this round: they fire a
     bullet at the opponent, who loses exactly 1 HP.
   - A tie means nobody attacks; the round is replayed immediately.
   - First player to reduce the opponent to 0 HP wins the match.

   CONTROLS (same keyboard, 2 players)
   - Player 1 (blue, left):  A = Búa (Rock)   S = Bao (Paper)   D = Kéo (Scissors)
   - Player 2 (red, right):  J = Búa (Rock)   K = Bao (Paper)   L = Kéo (Scissors)
   - Enter / Click / Tap = Start / Restart
   - P = Pause

   ARCHITECTURE (one class per responsibility)
     Game          -> main loop, state machine
     Fighter       -> a single character: HP, position, pick, simple animation
     Bullet        -> projectile flying from attacker to defender
     Particle      -> small hit-impact debris
     InputHandler  -> keyboard input for both players
     RPSRules      -> resolves Rock/Paper/Scissors
     SoundManager  -> WebAudio-generated placeholder sound effects
     UI            -> menu / HUD / choosing / reveal / game-over rendering
   ========================================================================= */

'use strict';

// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------
const WORLD_WIDTH = 720;
const WORLD_HEIGHT = 420;
const GROUND_Y = WORLD_HEIGHT - 90;

const MAX_HP = 10;
const REVEAL_TIME = 1.1;   // how long the "both moves revealed" pose is shown
const TIE_TIME = 1.0;      // how long the "HÒA" banner is shown
const BET_ENERGY_COST = 2; // energy points needed to unlock / use a bet

const MOVE = { ROCK: 'ROCK', PAPER: 'PAPER', SCISSORS: 'SCISSORS' };
const MOVE_ICON = { ROCK: '✊', PAPER: '✋', SCISSORS: '✌️' };
const MOVE_LABEL = { ROCK: 'Búa', PAPER: 'Bao', SCISSORS: 'Kéo' };

const GAME_STATE = {
  MENU: 'MENU',
  CHOOSING: 'CHOOSING',
  REVEAL: 'REVEAL',
  TIE: 'TIE',
  ATTACK: 'ATTACK',
  PAUSED: 'PAUSED',
  GAMEOVER: 'GAMEOVER',
};

const ATTACK_PHASE = {
  LEAN: 'LEAN',
  TRAVEL: 'TRAVEL',
  IMPACT: 'IMPACT',
  PAUSE: 'PAUSE',
};

// ---------------------------------------------------------------------------
// ASSET LOADING
// ---------------------------------------------------------------------------
// Optional character images. If a file is missing/fails to load, the game
// automatically falls back to the Canvas-drawn stick-robot, so it always
// works with zero external assets.
//
// TO ADD YOUR OWN CHARACTER IMAGES:
//   Drop PNG files into ./assets/ named exactly:
//     assets/player1.png   (used by Người 1, the blue fighter on the left)
//     assets/player2.png   (used by Người 2, the red fighter on the right)
//     assets/bullet.png    (used for the projectile fired by both players)
//   Recommended: transparent background, character facing RIGHT in the
//   artwork (Người 2's image is automatically mirrored to face left).
//   Any resolution works; it will be scaled to fit the character's height.
class AssetLoader {
  constructor() {
    this.images = {};
  }

  load(name, path) {
    const img = new Image();
    const record = { img, loaded: false, failed: false };
    img.onload = () => { record.loaded = true; };
    img.onerror = () => { record.failed = true; };
    img.src = path;
    this.images[name] = record;
    return record;
  }

  // Returns the HTMLImageElement only if it loaded successfully, else null.
  get(name) {
    const rec = this.images[name];
    if (rec && rec.loaded && !rec.failed) return rec.img;
    return null;
  }
}

const assets = new AssetLoader();
assets.load('player1', 'assets/player1.png');
assets.load('player2', 'assets/player2.png');
assets.load('bullet', 'assets/bullet.png');

// ---------------------------------------------------------------------------
// RPS RULES
// ---------------------------------------------------------------------------
class RPSRules {
  // Returns 1 if moveA beats moveB, -1 if moveB beats moveA, 0 if tie.
  static resolve(moveA, moveB) {
    if (moveA === moveB) return 0;
    const beats = {
      [MOVE.ROCK]: MOVE.SCISSORS,
      [MOVE.SCISSORS]: MOVE.PAPER,
      [MOVE.PAPER]: MOVE.ROCK,
    };
    return beats[moveA] === moveB ? 1 : -1;
  }
}

// ---------------------------------------------------------------------------
// SOUND MANAGER (WebAudio placeholder effects - no external files needed)
// ---------------------------------------------------------------------------
class SoundManager {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.unlocked = false;

    // ---- REAL AUDIO FILES (optional) ----
    // Drop files into ./assets/sounds/ using these exact base names - any of
    // .mp3, .m4a, .ogg or .wav works, the game tries each extension in turn
    // and uses whichever one it finds. Missing files simply fail silently
    // and the placeholder tone is used instead.
    this.soundBaseNames = {
      select: 'assets/sounds/select',
      reveal: 'assets/sounds/reveal',
      tie: 'assets/sounds/tie',
      fire: 'assets/sounds/fire',
      hit: 'assets/sounds/hit',
      win: 'assets/sounds/win',
      lose: 'assets/sounds/lose',
      attackP1: 'assets/sounds/attack_p1',
      attackP2: 'assets/sounds/attack_p2',
      // Distinct victory sounds per player (optional). If missing, falls
      // back to the generic 'win' file, then to a placeholder tone.
      winP1: 'assets/sounds/win_p1',
      winP2: 'assets/sounds/win_p2',
    };
    this.supportedExtensions = ['mp3', 'm4a', 'ogg', 'wav'];
    this.audioElements = {};
    this._preloadRealFiles();
  }

  _preloadRealFiles() {
    for (const [name, basePath] of Object.entries(this.soundBaseNames)) {
      const record = { audio: new Audio(), available: false };
      this.audioElements[name] = record;
      this._tryExtensions(name, basePath, 0);
    }
  }

  // Tries basePath + '.' + extensions[index]; on failure, moves on to the
  // next extension; on success, marks that sound as available for playback.
  _tryExtensions(name, basePath, index) {
    if (index >= this.supportedExtensions.length) return; // none of the formats found - stays unavailable
    const ext = this.supportedExtensions[index];
    const audio = new Audio();
    audio.addEventListener('canplaythrough', () => {
      const record = this.audioElements[name];
      record.audio = audio;
      record.available = true;
    }, { once: true });
    audio.addEventListener('error', () => {
      this._tryExtensions(name, basePath, index + 1);
    }, { once: true });
    audio.src = `${basePath}.${ext}`;
    audio.preload = 'auto';
  }

  // Plays a real audio file if it loaded successfully; returns true if it did.
  _playRealFile(name, volume = 1) {
    const record = this.audioElements[name];
    if (!record || !record.available) return false;
    // Clone the node so overlapping plays (e.g. rapid select clicks) don't
    // cut each other off.
    const instance = record.audio.cloneNode();
    instance.volume = volume;
    instance.play().catch(() => {});
    return true;
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // Call this from the very first click/keydown/touchstart in the page.
  // Browsers only allow audio to start after a real user gesture, so this
  // "wakes up" the AudioContext as early as possible instead of waiting
  // for the first in-game sound effect to trigger it.
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    try {
      this.ensureContext();
      // Play a near-silent blip - this is what actually satisfies the
      // browser's "audio was started from a user gesture" requirement.
      this.playTone(1, 0.01, 'sine', 0.0001);
    } catch (e) {
      // Ignore - will simply retry unlocking on the next gesture.
      this.unlocked = false;
    }
  }

  playTone(freq, duration, type = 'sine', volume = 0.15) {
    if (this.muted) return;
    try {
      this.ensureContext();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(volume, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      // Ignore - audio may be blocked before first user gesture.
    }
  }

  // Each play* method first tries the real audio file, and only falls back
  // to the generated placeholder tone if no file was provided/loaded.
  playSelect() {
    if (this.muted) return;
    if (this._playRealFile('select', 0.5)) return;
    this.playTone(440, 0.06, 'square', 0.15);
  }

  playReveal() {
    if (this.muted) return;
    if (this._playRealFile('reveal', 0.6)) return;
    this.playTone(300, 0.15, 'triangle', 0.2);
  }

  playTie() {
    if (this.muted) return;
    if (this._playRealFile('tie', 0.6)) return;
    this.playTone(220, 0.2, 'sine', 0.2);
  }

  playFire() {
    if (this.muted) return;
    if (this._playRealFile('fire', 0.6)) return;
    this.playTone(700, 0.08, 'square', 0.22);
  }

  playHit() {
    if (this.muted) return;
    if (this._playRealFile('hit', 0.7)) return;
    this.playTone(120, 0.25, 'sawtooth', 0.3);
  }

  playWin() {
    if (this.muted) return;
    if (this._playRealFile('win', 0.8)) return;
    this.playTone(660, 0.3, 'sine', 0.28);
  }

  playLose() {
    if (this.muted) return;
    if (this._playRealFile('lose', 0.8)) return;
    this.playTone(110, 0.5, 'triangle', 0.28);
  }

  // Distinct victory stings so each player's win feels different. Tries the
  // player-specific file first, then the generic 'win' file, then a tone.
  playWinP1() {
    if (this.muted) return;
    if (this._playRealFile('winP1', 0.8)) return;
    if (this._playRealFile('win', 0.8)) return;
    this.playTone(660, 0.3, 'sine', 0.28);
  }

  playWinP2() {
    if (this.muted) return;
    if (this._playRealFile('winP2', 0.8)) return;
    if (this._playRealFile('win', 0.8)) return;
    this.playTone(587, 0.3, 'square', 0.28);
  }

  // Distinct "battle cry" sound played the instant each fighter attacks,
  // so it's audibly clear who is on the offensive this round.
  playAttackP1() {
    if (this.muted) return;
    if (this._playRealFile('attackP1', 0.7)) return;
    this.playTone(500, 0.14, 'square', 0.25);
  }

  playAttackP2() {
    if (this.muted) return;
    if (this._playRealFile('attackP2', 0.7)) return;
    this.playTone(340, 0.14, 'square', 0.25);
  }
}

// ---------------------------------------------------------------------------
// PARTICLE (hit-impact debris)
// ---------------------------------------------------------------------------
class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.color = color;
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 160;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.life = 1;
    this.decay = 1.2 + Math.random();
    this.size = 2 + Math.random() * 3;
  }

  update(dt) {
    this.vy += 500 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= this.decay * dt;
  }

  draw(ctx) {
    if (this.life <= 0) return;
    ctx.globalAlpha = Math.max(0, this.life);
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// BULLET (projectile flying from attacker to defender)
// ---------------------------------------------------------------------------
class Bullet {
  constructor(startX, startY, endX, endY, color, duration) {
    this.startX = startX;
    this.startY = startY;
    this.endX = endX;
    this.endY = endY;
    this.color = color;
    this.duration = duration;
    this.t = 0; // 0 -> 1 progress
    this.direction = endX >= startX ? 1 : -1; // used to flip the bullet image
  }

  update(dt) {
    this.t = Math.min(1, this.t + dt / this.duration);
  }

  get x() { return this.startX + (this.endX - this.startX) * this.t; }
  get y() { return this.startY + (this.endY - this.startY) * this.t - Math.sin(this.t * Math.PI) * 30; }

  get finished() { return this.t >= 1; }

  draw(ctx) {
    const img = assets.get('bullet');

    if (img) {
      // ---- Draw the user-supplied bullet image, oriented toward travel ----
      const size = 100;
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.scale(this.direction, 1);
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
      ctx.restore();
      return;
    }

    // ---- Canvas-drawn fallback: glowing circle with a short tail ----
    ctx.save();
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.35;
    const tailT = Math.max(0, this.t - 0.08);
    ctx.beginPath();
    ctx.arc(
      this.startX + (this.endX - this.startX) * tailT,
      this.startY + (this.endY - this.startY) * tailT - Math.sin(tailT * Math.PI) * 30,
      5, 0, Math.PI * 2
    );
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// FIGHTER (one of the two characters)
// ---------------------------------------------------------------------------
class Fighter {
  constructor(id, x, color, name, facing, imageKey) {
    this.id = id;
    this.x = x;
    this.y = GROUND_Y;
    this.color = color;
    this.name = name;
    this.facing = facing; // 1 = faces right, -1 = faces left
    this.imageKey = imageKey; // e.g. 'player1' -> looks up assets/player1.png
    this.hp = MAX_HP;
    this.chosenMove = null;
    this.leanOffset = 0;   // animated forward lean when attacking
    this.flinch = 0;       // animated recoil when hit
    this.bounce = 0;       // idle breathing animation timer

    // ---- Betting / energy system ----
    // energy: +1 per round won, resets to 0 per round lost, unchanged on tie.
    // betActive: true once the player has toggled "cược" ON for the round
    // about to be resolved (only allowed once energy >= BET_ENERGY_COST).
    this.energy = 0;
    this.betActive = false;
  }

  reset() {
    this.hp = MAX_HP;
    this.chosenMove = null;
    this.leanOffset = 0;
    this.flinch = 0;
    this.energy = 0;
    this.betActive = false;
  }

  update(dt) {
    this.bounce += dt;
    if (this.leanOffset !== 0) {
      this.leanOffset *= Math.max(0, 1 - dt * 6);
      if (Math.abs(this.leanOffset) < 0.5) this.leanOffset = 0;
    }
    if (this.flinch !== 0) {
      this.flinch *= Math.max(0, 1 - dt * 8);
      if (Math.abs(this.flinch) < 0.5) this.flinch = 0;
    }
  }

  startLean() { this.leanOffset = 18 * this.facing; }
  startFlinch() { this.flinch = 14 * this.facing; }

  draw(ctx) {
    const bob = Math.sin(this.bounce * 3) * 3;
    const drawX = this.x + this.leanOffset - this.flinch;
    const drawY = this.y + bob;

    ctx.save();
    ctx.translate(drawX, drawY);
    ctx.scale(this.facing, 1);

    const img = assets.get(this.imageKey);
    if (img) {
      // ---- Draw the user-supplied character image ----
      // Scaled so the character is roughly the same height as the
      // Canvas-drawn fallback (about 130px tall), preserving aspect ratio.
      const targetHeight = 130;
      const targetWidth = targetHeight * (img.width / img.height);
      ctx.drawImage(img, -targetWidth / 2, -targetHeight - 10, targetWidth, targetHeight);
    } else {
      // ---- Simple humanoid robot-ish body, drawn entirely with shapes ----
      // Legs
      ctx.fillStyle = '#333';
      ctx.fillRect(-14, -10, 10, 40);
      ctx.fillRect(4, -10, 10, 40);

      // Torso
      ctx.fillStyle = this.color;
      ctx.fillRect(-18, -60, 36, 55);

      // Arm (forward-pointing, used as the "gun arm")
      ctx.fillStyle = this.shadeColor(this.color, -20);
      ctx.fillRect(14, -50, 26, 12);

      // Head
      ctx.fillStyle = '#f0c896';
      ctx.beginPath();
      ctx.arc(0, -78, 16, 0, Math.PI * 2);
      ctx.fill();

      // Eye (facing direction)
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(7, -80, 2.6, 0, Math.PI * 2);
      ctx.fill();

      // Headband with player color accent
      ctx.fillStyle = this.shadeColor(this.color, 20);
      ctx.fillRect(-16, -86, 32, 6);
    }

    ctx.restore();

    // Name label + chosen-move indicator above the head
    /*
ctx.save();
ctx.textAlign = 'center';
ctx.fillStyle = '#fff';
ctx.font = 'bold 15px Arial';
ctx.fillText(this.name, this.x, this.y - 110);
ctx.restore();
*/
  }

  shadeColor(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    let r = (num >> 16) + percent;
    let g = ((num >> 8) & 0x00ff) + percent;
    let b = (num & 0x0000ff) + percent;
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return `rgb(${r},${g},${b})`;
  }
}

// ---------------------------------------------------------------------------
// INPUT HANDLER
// ---------------------------------------------------------------------------
class InputHandler {
  constructor(callbacks) {
    this.callbacks = callbacks; // { onP1Move, onP2Move, onP1Bet, onP2Bet, onConfirm, onPause, onRestart, onAnyInput }

    window.addEventListener('keydown', (e) => {
      if (this.callbacks.onAnyInput) this.callbacks.onAnyInput();
      this._onKeyDown(e);
    });

    const canvas = document.getElementById('gameCanvas');
    canvas.addEventListener('click', () => {
      if (this.callbacks.onAnyInput) this.callbacks.onAnyInput();
      this.callbacks.onConfirm();
    });
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.callbacks.onAnyInput) this.callbacks.onAnyInput();
      this.callbacks.onConfirm();
    }, { passive: false });
  }

  _onKeyDown(e) {
    switch (e.code) {
      case 'KeyA': this.callbacks.onP1Move(MOVE.ROCK); break;
      case 'KeyS': this.callbacks.onP1Move(MOVE.PAPER); break;
      case 'KeyD': this.callbacks.onP1Move(MOVE.SCISSORS); break;
      case 'KeyQ': this.callbacks.onP1Bet(); break;

      case 'KeyJ': this.callbacks.onP2Move(MOVE.ROCK); break;
      case 'KeyK': this.callbacks.onP2Move(MOVE.PAPER); break;
      case 'KeyL': this.callbacks.onP2Move(MOVE.SCISSORS); break;
      case 'KeyU': this.callbacks.onP2Bet(); break;

      case 'Enter':
      case 'Space':
        e.preventDefault();
        this.callbacks.onConfirm();
        break;

      case 'KeyP': this.callbacks.onPause(); break;
      case 'KeyR': this.callbacks.onRestart(); break;
    }
  }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
class UI {
  drawArena(ctx) {
    // Sky gradient
    const grad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    grad.addColorStop(0, '#2b2d5c');
    grad.addColorStop(1, '#4a4a78');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WORLD_WIDTH, GROUND_Y);

    // Ground
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(0, GROUND_Y, WORLD_WIDTH, WORLD_HEIGHT - GROUND_Y);
    ctx.fillStyle = '#4d4d4d';
    ctx.fillRect(0, GROUND_Y, WORLD_WIDTH, 6);
  }

  drawHUD(ctx, p1, p2) {
    this._hpBar(ctx, 24, 24, 260, p1, false);
    this._hpBar(ctx, WORLD_WIDTH - 24 - 260, 24, 260, p2, true);
    this._energyStatus(ctx, 24, 74, p1, false, '#8ecbff');
    this._energyStatus(ctx, WORLD_WIDTH - 24 - 260, 74, p2, true, '#ff9a9a');
  }

  // Small energy dots (filled = accumulated point) plus a "CƯỢC" label once
  // unlocked, glowing brighter if the bet is currently toggled ON.
  _energyStatus(ctx, x, y, fighter, alignRight, color) {
    ctx.save();
    const dotRadius = 7;
    const gap = 20;
    const dotCount = Math.max(fighter.energy, BET_ENERGY_COST);

    for (let i = 0; i < dotCount; i++) {
      const filled = i < fighter.energy;
      const dotX = alignRight ? x + 260 - gap * (i + 1) + gap / 2 : x + gap * i + gap / 2;
      ctx.beginPath();
      ctx.arc(dotX, y, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = filled ? color : 'rgba(255,255,255,0.15)';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const unlocked = fighter.energy >= BET_ENERGY_COST;
    if (unlocked) {
      ctx.textAlign = alignRight ? 'right' : 'left';
      ctx.font = 'bold 13px Arial';
      const label = fighter.betActive ? '⚡ ĐANG CƯỢC!' : '⚡ Cược sẵn sàng';
      ctx.fillStyle = fighter.betActive ? '#ffe066' : '#5ec95e';
      const textX = alignRight ? x + 260 : x;
      ctx.fillText(label, textX, y + 22);
    }
    ctx.restore();
  }

  _hpBar(ctx, x, y, w, fighter, alignRight) {
    const h = 26;
    const ratio = Math.max(0, fighter.hp / MAX_HP);

    ctx.save();
    ctx.fillStyle = '#00000088';
    ctx.fillRect(x, y, w, h);

    const barColor = ratio > 0.5 ? '#5ec95e' : ratio > 0.25 ? '#e0b03a' : '#e05a5a';
    ctx.fillStyle = barColor;
    if (alignRight) {
      ctx.fillRect(x + w * (1 - ratio), y, w * ratio, h);
    } else {
      ctx.fillRect(x, y, w * ratio, h);
    }

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = alignRight ? 'right' : 'left';
    ctx.fillText(`${fighter.name}  ${fighter.hp}/${MAX_HP} HP`, alignRight ? x + w - 6 : x + 6, y + h + 16);
    ctx.restore();
  }

  drawMenu(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffcc33';
    ctx.strokeStyle = '#8a5a00';
    ctx.lineWidth = 3;
    ctx.font = 'bold 42px Arial';
    ctx.strokeText('RPS DUEL', WORLD_WIDTH / 2, 100);
    ctx.fillText('RPS DUEL', WORLD_WIDTH / 2, 100);

    ctx.font = '15px Arial';
    ctx.fillStyle = '#fff';
    ctx.fillText('Đối kháng 2 người - Kéo Búa Bao quyết định lượt tấn công', WORLD_WIDTH / 2, 132);

    ctx.font = 'bold 15px Arial';
    ctx.fillStyle = '#8ecbff';
    ctx.fillText('Người 1 (xanh):  A = Búa   S = Bao   D = Kéo   Q = Cược', WORLD_WIDTH / 2, 168);
    ctx.fillStyle = '#ff9a9a';
    ctx.fillText('Người 2 (đỏ):    J = Búa   K = Bao   L = Kéo   U = Cược', WORLD_WIDTH / 2, 192);

    ctx.fillStyle = '#ddd';
    ctx.font = '13px Arial';
    ctx.fillText('Mỗi nhân vật 10 HP. Thắng kéo-búa-bao thì được bắn, đối thủ mất 1 HP.', WORLD_WIDTH / 2, 224);

    ctx.fillStyle = '#ffe066';
    ctx.font = 'bold 13px Arial';
    ctx.fillText('CƯỢC: Thắng ván +1 năng lượng, thua về 0, hòa giữ nguyên.', WORLD_WIDTH / 2, 250);
    ctx.font = '13px Arial';
    ctx.fillStyle = '#ddd';
    ctx.fillText('Đủ 2 điểm có thể bật cược: thắng ván đó bắn 2 lần, thua bị trừ 2 HP.', WORLD_WIDTH / 2, 270);

    ctx.fillStyle = '#5ec95e';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('Nhấn Enter / Space / Click để bắt đầu', WORLD_WIDTH / 2, 330);
    ctx.restore();
  }

  drawChoosing(ctx, p1, p2) {
    ctx.save();
    ctx.textAlign = 'center';

    ctx.font = 'bold 20px Arial';
    ctx.fillStyle = '#fff';
    ctx.fillText('Chọn: Búa / Bao / Kéo!', WORLD_WIDTH / 2, 68);

    // Status text per player: chosen move icon (hidden) or "waiting"
    this._choiceStatus(ctx, 130, 100, p1, '#8ecbff');
    this._choiceStatus(ctx, WORLD_WIDTH - 130, 100, p2, '#ff9a9a');

    // Reminder hint for whichever player currently has a bet available.
    ctx.font = '13px Arial';
    ctx.fillStyle = '#ccc';
    if (p1.energy >= BET_ENERGY_COST) ctx.fillText('Người 1: Q để bật/tắt cược', 130, 140);
    if (p2.energy >= BET_ENERGY_COST) ctx.fillText('Người 2: U để bật/tắt cược', WORLD_WIDTH - 130, 140);

    ctx.restore();
  }

  _choiceStatus(ctx, x, y, fighter, color) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 32px Arial';
    if (fighter.chosenMove) {
      ctx.fillStyle = color;
      ctx.fillText('✔ Đã chọn', x, y);
    } else {
      ctx.fillStyle = '#999';
      ctx.font = '18px Arial';
      ctx.fillText('Đang chọn...', x, y);
    }
    ctx.restore();
  }

  drawReveal(ctx, p1, p2, popScale) {
    ctx.save();
    ctx.textAlign = 'center';

    ctx.save();
    ctx.translate(130, 90);
    ctx.scale(popScale, popScale);
    ctx.font = '54px Arial';
    ctx.fillText(MOVE_ICON[p1.chosenMove], 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(WORLD_WIDTH - 130, 90);
    ctx.scale(popScale, popScale);
    ctx.font = '54px Arial';
    ctx.fillText(MOVE_ICON[p2.chosenMove], 0, 0);
    ctx.restore();

    ctx.font = 'bold 30px Arial';
    ctx.fillStyle = '#ffcc33';
    ctx.fillText('VS', WORLD_WIDTH / 2, 100);

    ctx.font = '16px Arial';
    ctx.fillStyle = '#fff';
    ctx.fillText(`${MOVE_LABEL[p1.chosenMove]}  ⚔️  ${MOVE_LABEL[p2.chosenMove]}`, WORLD_WIDTH / 2, 140);
    ctx.restore();
  }

  drawTie(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 34px Arial';
    ctx.fillStyle = '#ffe066';
    ctx.fillText('HÒA! Chọn lại...', WORLD_WIDTH / 2, 130);
    ctx.restore();
  }

  drawAttackBanner(ctx, attackerName, hadBet) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px Arial';
    ctx.fillStyle = '#ffcc33';
    ctx.fillText(`${attackerName} tấn công!`, WORLD_WIDTH / 2, 130);

    if (hadBet) {
      ctx.font = 'bold 16px Arial';
      ctx.fillStyle = '#ffe066';
      ctx.fillText('⚡ CƯỢC! ⚡', WORLD_WIDTH / 2, 156);
    }
    ctx.restore();
  }

  drawPause(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px Arial';
    ctx.fillText('TẠM DỪNG', WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 10);
    ctx.font = '15px Arial';
    ctx.fillText('Nhấn P để tiếp tục', WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 20);
    ctx.restore();
  }

  // winner: the winning Fighter instance. zoomT: seconds elapsed since the
  // GAMEOVER state started (drives the zoom-in / pulse animation).
  drawGameOver(ctx, winner, zoomT) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // ---- Zoom animation: quick ease-out pop-in, then a gentle idle pulse ----
    const POP_DURATION = 0.55;
    const FINAL_SCALE = 1.6;
    const t = Math.min(1, zoomT / POP_DURATION);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    let scale = eased * FINAL_SCALE;
    if (t >= 1) {
      scale = FINAL_SCALE + Math.sin(zoomT * 3) * 0.05; // idle "breathing" pulse
    }
    const fade = Math.min(1, zoomT / 0.25);

    const centerX = WORLD_WIDTH / 2;
    const centerY = WORLD_HEIGHT / 2 + 30;

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(centerX, centerY);
    ctx.scale(scale, scale);

    // Glow behind the character, tinted with the winner's color.
    ctx.shadowColor = winner.color;
    ctx.shadowBlur = 45;

    const img = assets.get(winner.imageKey);
    if (img) {
      const targetHeight = 150;
      const targetWidth = targetHeight * (img.width / img.height);
      ctx.drawImage(img, -targetWidth / 2, -targetHeight - 10, targetWidth, targetHeight);
    } else {
      // Fallback silhouette matching the in-battle Canvas-drawn look.
      ctx.fillStyle = winner.color;
      ctx.fillRect(-18, -60, 36, 55);
      ctx.beginPath();
      ctx.arc(0, -78, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffcc33';
    ctx.font = 'bold 38px Arial';
    ctx.fillText(`${winner.name} CHIẾN THẮNG!`, WORLD_WIDTH / 2, 55);

    ctx.fillStyle = '#fff';
    ctx.font = '18px Arial';
    ctx.fillText('Nhấn R hoặc Enter / Click để chơi lại', WORLD_WIDTH / 2, WORLD_HEIGHT - 25);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// GAME (main loop + state machine)
// ---------------------------------------------------------------------------
class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.p1 = new Fighter('p1', 150, '#2e6fd6', 'Người 1', 1, 'player1');
    this.p2 = new Fighter('p2', WORLD_WIDTH - 150, '#d63a3a', 'Người 2', -1, 'player2');

    this.ui = new UI();
    this.sound = new SoundManager();
    this.bullets = [];
    this.particles = [];

    this.state = GAME_STATE.MENU;
    this.stateBeforePause = null;

    this.revealTimer = 0;
    this.tieTimer = 0;
    this.popScale = 0;

    this.attacker = null;
    this.defender = null;
    this.attackPhase = null;
    this.attackPhaseTimer = 0;
    this.attackHitsRemaining = 1;
    this.damagePerHit = 1;
    this.roundHadBet = false;

    this.shakeTime = 0;
    this.shakeIntensity = 0;

    this.roundNumber = 1;

    this.winner = null;   // set the instant the match ends, used by the zoom effect
    this.winZoomT = 0;    // seconds elapsed since GAMEOVER started

    this.input = new InputHandler({
      onP1Move: (move) => this._chooseMove(this.p1, move),
      onP2Move: (move) => this._chooseMove(this.p2, move),
      onP1Bet: () => this._toggleBet(this.p1),
      onP2Bet: () => this._toggleBet(this.p2),
      onConfirm: () => this._handleConfirm(),
      onPause: () => this._togglePause(),
      onRestart: () => this._restart(),
      onAnyInput: () => this.sound.unlock(),
    });

    this._resize();
    window.addEventListener('resize', () => this._resize());

    this.lastTime = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  // --- Responsive canvas scaling -------------------------------------------
  _resize() {
    const wrapper = document.getElementById('game-wrapper');
    const maxW = wrapper.clientWidth;
    const maxH = wrapper.clientHeight;
    const scale = Math.min(maxW / WORLD_WIDTH, maxH / WORLD_HEIGHT);
    this.canvas.style.width = `${WORLD_WIDTH * scale}px`;
    this.canvas.style.height = `${WORLD_HEIGHT * scale}px`;
  }

  // --- Input handling -------------------------------------------------------
  _chooseMove(fighter, move) {
    if (this.state !== GAME_STATE.CHOOSING) return;
    if (fighter.chosenMove) return; // already locked in this round
    fighter.chosenMove = move;
    this.sound.playSelect();
  }

  // Toggles a fighter's pending bet on/off. Only allowed while choosing a
  // move, and only if they've accumulated enough energy to unlock it. The
  // bet itself is only consumed once the round actually resolves to a
  // win/lose (see _updateReveal) - a tie leaves it armed for the replay.
  _toggleBet(fighter) {
    if (this.state !== GAME_STATE.CHOOSING) return;
    if (fighter.energy < BET_ENERGY_COST) return;
    fighter.betActive = !fighter.betActive;
    this.sound.playSelect();
  }

  _handleConfirm() {
    if (this.state === GAME_STATE.MENU) this._startMatch();
    else if (this.state === GAME_STATE.GAMEOVER) this._restart();
  }

  _togglePause() {
    if (this.state === GAME_STATE.PAUSED) {
      this.state = this.stateBeforePause;
      this.stateBeforePause = null;
    } else if (
      this.state === GAME_STATE.CHOOSING ||
      this.state === GAME_STATE.REVEAL ||
      this.state === GAME_STATE.ATTACK ||
      this.state === GAME_STATE.TIE
    ) {
      this.stateBeforePause = this.state;
      this.state = GAME_STATE.PAUSED;
    }
  }

  _startMatch() {
    this.p1.reset();
    this.p2.reset();
    this.bullets = [];
    this.particles = [];
    this.roundNumber = 1;
    this.winner = null;
    this.winZoomT = 0;
    this.roundHadBet = false;
    this._startChoosingPhase();
  }

  _restart() { this._startMatch(); }

  _startChoosingPhase() {
    this.p1.chosenMove = null;
    this.p2.chosenMove = null;
    this.state = GAME_STATE.CHOOSING;
  }

  // --- Main loop --------------------------------------------------------
  _loop(now) {
    const dt = Math.min(0.033, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this._update(dt);
    this._draw();
    requestAnimationFrame((t) => this._loop(t));
  }

  _update(dt) {
    this.p1.update(dt);
    this.p2.update(dt);

    for (const p of this.particles) p.update(dt);
    this.particles = this.particles.filter((p) => p.life > 0);

    if (this.shakeTime > 0) this.shakeTime -= dt;

    switch (this.state) {
      case GAME_STATE.CHOOSING:
        this._updateChoosing();
        break;
      case GAME_STATE.REVEAL:
        this._updateReveal(dt);
        break;
      case GAME_STATE.TIE:
        this._updateTie(dt);
        break;
      case GAME_STATE.ATTACK:
        this._updateAttack(dt);
        break;
      case GAME_STATE.GAMEOVER:
        this.winZoomT += dt; // drives the winner zoom-in / pulse animation
        break;
      default:
        break; // MENU, PAUSED need no per-frame logic
    }
  }

  _updateChoosing() {
    const bothChosen = this.p1.chosenMove && this.p2.chosenMove;
    if (bothChosen) {
      this.state = GAME_STATE.REVEAL;
      this.revealTimer = REVEAL_TIME;
      this.popScale = 0;
      this.sound.playReveal();
    }
  }

  _updateReveal(dt) {
    this.popScale = Math.min(1, this.popScale + dt * 6);
    this.revealTimer -= dt;
    if (this.revealTimer <= 0) {
      const result = RPSRules.resolve(this.p1.chosenMove, this.p2.chosenMove);
      if (result === 0) {
        // Tie: energy stays the same for both, and any pending bet remains
        // armed for the replayed round (nothing was actually resolved yet).
        this.state = GAME_STATE.TIE;
        this.tieTimer = TIE_TIME;
        this.sound.playTie();
      } else {
        this.attacker = result === 1 ? this.p1 : this.p2;
        this.defender = result === 1 ? this.p2 : this.p1;

        // ---- Energy accumulation ----
        // Win a round: +1 energy. Lose a round: energy resets to 0.
        this.attacker.energy += 1;
        this.defender.energy = 0;

        // ---- Bet resolution ----
        // A bet is "used" the moment its round actually resolves (never on
        // a tie). Using it always consumes 100% of that fighter's energy,
        // regardless of what the win/lose rule above just set it to.
        this.attackHitsRemaining = this.attacker.betActive ? 2 : 1;
        this.damagePerHit = this.defender.betActive ? 2 : 1;
        this.roundHadBet = this.attacker.betActive || this.defender.betActive;

        if (this.attacker.betActive) {
          this.attacker.betActive = false;
          this.attacker.energy = 0;
        }
        if (this.defender.betActive) {
          this.defender.betActive = false;
          this.defender.energy = 0;
        }

        this._startAttackSequence();
      }
    }
  }

  _updateTie(dt) {
    this.tieTimer -= dt;
    if (this.tieTimer <= 0) this._startChoosingPhase();
  }

  _startAttackSequence() {
    this.state = GAME_STATE.ATTACK;
    this.attackPhase = ATTACK_PHASE.LEAN;
    this.attackPhaseTimer = 0.25;
    this.attacker.startLean();

    // Distinct battle-cry sound so it's clear which player is attacking.
    if (this.attacker === this.p1) this.sound.playAttackP1();
    else this.sound.playAttackP2();
  }

  _updateAttack(dt) {
    this.attackPhaseTimer -= dt;

    for (const b of this.bullets) b.update(dt);

    if (this.attackPhase === ATTACK_PHASE.LEAN && this.attackPhaseTimer <= 0) {
      // Fire the bullet toward the defender.
      const startX = this.attacker.x + 30 * this.attacker.facing;
      const startY = this.attacker.y - 95;
      const endX = this.defender.x - 10 * this.attacker.facing;
      const endY = this.defender.y - 95;
      this.bullets.push(new Bullet(startX, startY, endX, endY, this.attacker.color, 2));
      this.sound.playFire();

      this.attackPhase = ATTACK_PHASE.TRAVEL;
      this.attackPhaseTimer = 2;
    } else if (this.attackPhase === ATTACK_PHASE.TRAVEL && this.attackPhaseTimer <= 0) {
      // Impact: apply damage (doubled if the defender had an active bet),
      // spawn particles, flinch + camera shake.
      this.bullets = [];
      const damage = this.damagePerHit;
      this.defender.hp = Math.max(0, this.defender.hp - damage);
      this.defender.startFlinch();
      this.sound.playHit();

      this.shakeTime = damage > 1 ? 0.35 : 0.25;
      this.shakeIntensity = damage > 1 ? 11 : 7;

      const particleCount = damage > 1 ? 28 : 18;
      for (let i = 0; i < particleCount; i++) {
        this.particles.push(new Particle(this.defender.x, this.defender.y - 95, this.defender.color));
      }

      this.attackHitsRemaining -= 1;
      this.attackPhase = ATTACK_PHASE.IMPACT;
      this.attackPhaseTimer = 0.3;
    } else if (this.attackPhase === ATTACK_PHASE.IMPACT && this.attackPhaseTimer <= 0) {
      if (this.attackHitsRemaining > 0 && this.defender.hp > 0) {
        // Bet-fueled double attack: fire a second shot before pausing.
        this.attackPhase = ATTACK_PHASE.LEAN;
        this.attackPhaseTimer = 0.15;
        this.attacker.startLean();
      } else {
        this.attackPhase = ATTACK_PHASE.PAUSE;
        this.attackPhaseTimer = 0.5;
      }
    } else if (this.attackPhase === ATTACK_PHASE.PAUSE && this.attackPhaseTimer <= 0) {
      if (this.defender.hp <= 0) {
        this.state = GAME_STATE.GAMEOVER;
        this.winner = this.attacker;
        this.winZoomT = 0;
        if (this.winner === this.p1) this.sound.playWinP1();
        else this.sound.playWinP2();
      } else {
        this.roundNumber += 1;
        this._startChoosingPhase();
      }
    }
  }

  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    ctx.save();
    if (this.shakeTime > 0) {
      const dx = (Math.random() - 0.5) * this.shakeIntensity;
      const dy = (Math.random() - 0.5) * this.shakeIntensity;
      ctx.translate(dx, dy);
    }

    this.ui.drawArena(ctx);

    this.p1.draw(ctx);
    this.p2.draw(ctx);

    for (const b of this.bullets) b.draw(ctx);
    for (const p of this.particles) p.draw(ctx);

    if (this.state !== GAME_STATE.MENU) {
      this.ui.drawHUD(ctx, this.p1, this.p2);
    }

    ctx.restore(); // end camera shake

    switch (this.state) {
      case GAME_STATE.MENU:
        this.ui.drawMenu(ctx);
        break;
      case GAME_STATE.CHOOSING:
        this.ui.drawChoosing(ctx, this.p1, this.p2);
        break;
      case GAME_STATE.REVEAL:
        this.ui.drawReveal(ctx, this.p1, this.p2, this.popScale);
        break;
      case GAME_STATE.TIE:
        this.ui.drawTie(ctx);
        break;
      case GAME_STATE.ATTACK:
        this.ui.drawAttackBanner(ctx, this.attacker.name, this.roundHadBet);
        break;
      case GAME_STATE.PAUSED:
        this.ui.drawPause(ctx);
        break;
      case GAME_STATE.GAMEOVER: {
        this.ui.drawGameOver(ctx, this.winner, this.winZoomT);
        break;
      }
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// BOOTSTRAP
// ---------------------------------------------------------------------------
window.addEventListener('load', () => {
  const canvas = document.getElementById('gameCanvas');
  canvas.width = WORLD_WIDTH;
  canvas.height = WORLD_HEIGHT;
  new Game(canvas);
});
