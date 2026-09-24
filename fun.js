'use strict';

// Just for fun: visual effects on YOUR screen only.
//
// Each effect adds a see-through layer on top of the game page, or animates
// the page itself, and then cleans up after itself. Nothing is sent to the
// game, nobody else sees anything, and clicks go straight through to the
// game while an effect plays. (Moving your character around would be sent to
// the server and seen by everyone, so that's deliberately not here.)
//
// No flashing: every effect changes slowly, so they're gentle on the eyes.

// Runs in the game page. Each effect is plain browser JavaScript.
function effects() {
  var ID = '__mgFun';

  function layer(ms) {
    var el = document.createElement('div');
    el.className = ID;
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:hidden;';
    document.documentElement.appendChild(el);
    setTimeout(function () { el.remove(); }, ms);
    return el;
  }

  function css(text, ms) {
    var st = document.createElement('style');
    st.textContent = text;
    document.head.appendChild(st);
    if (ms) setTimeout(function () { st.remove(); }, ms);
    return st;
  }

  // Things falling from the top of the screen: petals, confetti, hearts.
  function rain(chars, count, seconds, colors) {
    var box = layer((seconds + 6) * 1000);
    css('@keyframes ' + ID + 'fall{0%{transform:translate3d(0,-10vh,0) rotate(0)}100%{transform:translate3d(var(--dx),110vh,0) rotate(var(--r))}}', (seconds + 6) * 1000);
    for (var i = 0; i < count; i += 1) {
      var p = document.createElement('span');
      var size = 16 + Math.random() * 22;
      p.textContent = chars[Math.floor(Math.random() * chars.length)];
      p.style.cssText = 'position:absolute;top:0;left:' + (Math.random() * 100) + 'vw;font-size:' + size + 'px;' +
        '--dx:' + (Math.random() * 30 - 15) + 'vw;--r:' + (Math.random() * 720 - 360) + 'deg;' +
        'animation:' + ID + 'fall ' + (4 + Math.random() * 4) + 's linear ' + (Math.random() * seconds) + 's both;' +
        (colors ? 'color:' + colors[i % colors.length] + ';' : '') + 'opacity:.9;will-change:transform;';
      box.appendChild(p);
    }
  }

  // Animates the whole page (the game canvas included) for a while.
  function page(keyframes, animation, ms) {
    css('@keyframes ' + ID + 'pg{' + keyframes + '}html{animation:' + ID + 'pg ' + animation + ' !important;transform-origin:50% 50%;}html,body{overflow:hidden !important;}', ms);
  }

  var rainbowOn = null;

  return {
    flowers: function () { rain(['🌷', '🌸', '🌼', '🌺', '💮'], 70, 6); },
    confetti: function () { rain(['■', '●', '▲', '◆'], 110, 4, ['#f6dfa0', '#7fc98a', '#e8a95a', '#b58ae8', '#7ab0e8', '#f38ba8']); },
    hearts: function () { rain(['💜', '💖', '💗', '🩷'], 60, 5); },
    // Only you spin, and only on your screen. Clicks still work.
    spin: function () { page('0%{transform:rotate(0)}100%{transform:rotate(360deg)}', '1.6s ease-in-out 2', 3400); },
    flip: function () { page('0%{transform:rotate(0)}15%,85%{transform:rotate(180deg)}100%{transform:rotate(360deg)}', '6s ease-in-out 1', 6200); },
    wobble: function () { page('0%,100%{transform:scale(1,1)}20%{transform:scale(1.04,.96)}40%{transform:scale(.97,1.03)}60%{transform:scale(1.02,.98)}80%{transform:scale(.99,1.01)}', '0.9s ease-in-out 4', 3800); },
    // Slowly shifting colours; press again to stop.
    rainbow: function () {
      if (rainbowOn) {
        rainbowOn.remove();
        rainbowOn = null;
        return false;
      }
      rainbowOn = css('@keyframes ' + ID + 'hue{from{filter:hue-rotate(0)}to{filter:hue-rotate(360deg)}}html{animation:' + ID + 'hue 6s linear infinite !important;}');
      return true;
    },
    // A little disco: a mirror ball spinning at the top, coloured
    // spotlights sweeping across the garden, and light specks from the ball
    // drifting over everything. Slow changes only, no strobing.
    disco: function () {
      var ms = 14000;
      var box = layer(ms);
      box.style.transition = 'opacity 1s';
      box.style.opacity = '0';
      setTimeout(function () { box.style.opacity = '1'; }, 30);
      setTimeout(function () { box.style.opacity = '0'; }, ms - 1100);
      css(
        '@keyframes ' + ID + 'sweep{0%{transform:rotate(var(--a0))}50%{transform:rotate(var(--a1))}100%{transform:rotate(var(--a0))}}' +
        '@keyframes ' + ID + 'ballspin{from{background-position:0 0}to{background-position:72px 0}}' +
        '@keyframes ' + ID + 'specks{from{transform:rotate(0)}to{transform:rotate(360deg)}}' +
        '@keyframes ' + ID + 'twinkle{0%,100%{opacity:.25}50%{opacity:1}}' +
        '@keyframes ' + ID + 'drop{from{transform:translate(-50%,-140px)}to{transform:translate(-50%,0)}}',
        ms
      );
      // Dim the room a touch so the lights show.
      var dim = document.createElement('div');
      dim.style.cssText = 'position:absolute;inset:0;background:rgba(12,0,30,.42);';
      box.appendChild(dim);
      // Spotlights: tall soft beams from the bottom corners and the top,
      // swinging slowly back and forth.
      var beams = [
        { x: '6%', a0: '50deg', a1: '5deg', c: 'rgba(255,60,170,.8)', t: 5.5 },
        { x: '94%', a0: '-50deg', a1: '-5deg', c: 'rgba(60,170,255,.8)', t: 6.5 },
        { x: '28%', a0: '35deg', a1: '-20deg', c: 'rgba(110,255,130,.7)', t: 7.5 },
        { x: '72%', a0: '-35deg', a1: '20deg', c: 'rgba(255,210,70,.75)', t: 5 },
        { x: '50%', a0: '-22deg', a1: '22deg', c: 'rgba(190,100,255,.7)', t: 8.5 },
      ];
      beams.forEach(function (b) {
        // Each beam stands on the floor and swings from its base.
        var beam = document.createElement('div');
        beam.style.cssText = 'position:absolute;left:' + b.x + ';bottom:0;width:34vmin;height:140vmax;margin-left:-17vmin;' +
          'transform-origin:50% 100%;--a0:' + b.a0 + ';--a1:' + b.a1 + ';' +
          'background:linear-gradient(to top,' + b.c + ',rgba(0,0,0,0) 80%);' +
          'clip-path:polygon(0 0,100% 0,56% 100%,44% 100%);filter:blur(5px);mix-blend-mode:screen;' +
          'animation:' + ID + 'sweep ' + b.t + 's ease-in-out infinite;';
        box.appendChild(beam);
      });
      // The mirror ball on a string, spinning (its tiles slide sideways).
      var string = document.createElement('div');
      string.style.cssText = 'position:absolute;left:50%;top:0;width:2px;height:70px;background:rgba(220,220,230,.8);transform:translateX(-50%);animation:' + ID + 'drop 1.2s ease-out both;';
      box.appendChild(string);
      var ball = document.createElement('div');
      ball.style.cssText = 'position:absolute;left:50%;top:66px;width:84px;height:84px;border-radius:50%;' +
        'background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.95),rgba(255,255,255,0) 32%),' +
        'repeating-linear-gradient(90deg,#9aa3b5 0 7px,#e9edf5 7px 12px,#6c7488 12px 18px),' +
        'repeating-linear-gradient(0deg,rgba(0,0,0,.25) 0 1px,rgba(0,0,0,0) 1px 9px);' +
        'background-size:auto,72px 100%,100% 9px;box-shadow:0 0 30px rgba(255,255,255,.55),0 0 80px rgba(200,160,255,.45);' +
        'animation:' + ID + 'ballspin 2.4s linear infinite,' + ID + 'drop 1.2s ease-out both;';
      box.appendChild(ball);
      // Light specks thrown by the ball, turning slowly around it.
      var field = document.createElement('div');
      field.style.cssText = 'position:absolute;left:50%;top:108px;width:260vmax;height:260vmax;margin:-130vmax 0 0 -130vmax;animation:' + ID + 'specks 18s linear infinite;';
      var colors = ['#ffffff', '#ffd6f0', '#d6ecff', '#e6ffd9', '#fff3c4'];
      for (var i = 0; i < 140; i += 1) {
        var sp = document.createElement('i');
        var r = 8 + Math.random() * 46;
        var ang = Math.random() * Math.PI * 2;
        var size = 6 + Math.random() * 9;
        sp.style.cssText = 'position:absolute;left:' + (50 + Math.cos(ang) * r) + '%;top:' + (50 + Math.sin(ang) * r) + '%;width:' + size + 'px;height:' + size + 'px;border-radius:2px;' +
          'background:' + colors[i % colors.length] + ';box-shadow:0 0 8px ' + colors[i % colors.length] + ';' +
          'animation:' + ID + 'twinkle ' + (1.5 + Math.random() * 2.5) + 's ease-in-out ' + (Math.random() * 2) + 's infinite;';
        field.appendChild(sp);
      }
      box.appendChild(field);
    },

    // A glitchy look: the picture jitters and splits its colours for a few
    // seconds. On your screen only; your character isn't touched.
    glitch: function () {
      var ms = 3600;
      css(
        '@keyframes ' + ID + 'jit{' +
        '0%{transform:translate(-6px,2px) skewX(-3deg);filter:drop-shadow(5px 0 rgba(255,0,80,.75)) drop-shadow(-5px 0 rgba(0,220,255,.75))}' +
        '6%{transform:translate(5px,-3px);filter:drop-shadow(-7px 0 rgba(255,0,80,.7)) drop-shadow(7px 0 rgba(0,220,255,.7))}' +
        '12%{transform:translate(0,0);filter:none}' +
        '24%{transform:translate(9px,0) skewX(4deg);filter:drop-shadow(5px 0 rgba(255,0,80,.75)) drop-shadow(-5px 0 rgba(0,220,255,.75))}' +
        '28%{transform:translate(-4px,4px) scaleY(.98);filter:none}' +
        '34%{transform:translate(0,0);filter:none}' +
        '48%{transform:translate(-10px,-2px) skewY(1deg);filter:drop-shadow(-7px 0 rgba(255,0,80,.7)) drop-shadow(7px 0 rgba(0,220,255,.7))}' +
        '53%{transform:translate(3px,1px);filter:drop-shadow(5px 0 rgba(255,0,80,.75)) drop-shadow(-5px 0 rgba(0,220,255,.75))}' +
        '58%{transform:translate(0,0);filter:none}' +
        '70%{transform:translate(6px,5px) skewX(-5deg);filter:drop-shadow(5px 0 rgba(255,0,80,.75)) drop-shadow(-5px 0 rgba(0,220,255,.75))}' +
        '74%{transform:translate(0,0);filter:none}' +
        '86%{transform:translate(-5px,0);filter:drop-shadow(-7px 0 rgba(255,0,80,.7)) drop-shadow(7px 0 rgba(0,220,255,.7))}' +
        '92%,100%{transform:translate(0,0);filter:none}}' +
        'html{animation:' + ID + 'jit .9s steps(1,end) 4 !important;}html,body{overflow:hidden !important;}',
        ms
      );
      // A few scan-line bars sliding through.
      var box = layer(ms);
      for (var i = 0; i < 7; i += 1) {
        var bar = document.createElement('div');
        var h = 4 + Math.random() * 26;
        bar.style.cssText = 'position:absolute;left:0;right:0;top:' + (Math.random() * 100) + '%;height:' + h + 'px;' +
          'background:linear-gradient(90deg,rgba(255,0,90,.25),rgba(0,230,255,.25));mix-blend-mode:screen;' +
          'transform:translateX(' + (Math.random() * 40 - 20) + 'px);opacity:0;' +
          'transition:opacity .08s;';
        box.appendChild(bar);
        (function (el, delay) {
          setTimeout(function () { el.style.opacity = '1'; }, delay);
          setTimeout(function () { el.style.opacity = '0'; }, delay + 160 + Math.random() * 200);
        })(bar, Math.random() * (ms - 600));
      }
    },
  };
}

// The secret rainbow celebration's banner: big shimmering words across the
// middle of the screen for a few seconds.
function bannerScript(text) {
  return `(() => {
    const ms = 9000;
    const box = document.createElement('div');
    box.className = '__mgFun';
    box.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;display:flex;align-items:center;justify-content:center;';
    const st = document.createElement('style');
    st.textContent = '@keyframes __mgBannerIn{0%{transform:scale(.2) rotate(-8deg);opacity:0}60%{transform:scale(1.12) rotate(2deg);opacity:1}100%{transform:scale(1) rotate(0)}}' +
      '@keyframes __mgBannerHue{from{background-position:0% 50%}to{background-position:200% 50%}}' +
      '@keyframes __mgBannerBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}';
    document.head.appendChild(st);
    const words = document.createElement('div');
    words.textContent = ${JSON.stringify(String(text || '').slice(0, 60))};
    words.style.cssText = 'font:900 clamp(34px,7vw,96px)/1.05 system-ui,sans-serif;text-align:center;padding:0 4vw;letter-spacing:.02em;' +
      'background:linear-gradient(90deg,#ff5f6d,#ffc371,#fff36b,#6bff95,#6bd5ff,#a96bff,#ff6bd6,#ff5f6d);background-size:200% 100%;' +
      '-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-stroke:2px rgba(255,255,255,.85);' +
      'filter:drop-shadow(0 6px 18px rgba(0,0,0,.45));animation:__mgBannerIn .9s cubic-bezier(.2,1.4,.4,1) both,__mgBannerHue 2.2s linear infinite;';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'animation:__mgBannerBob 1.6s ease-in-out .9s infinite;transition:opacity .8s;';
    wrap.appendChild(words);
    box.appendChild(wrap);
    document.documentElement.appendChild(box);
    setTimeout(() => { wrap.style.opacity = '0'; }, ms - 900);
    setTimeout(() => { box.remove(); st.remove(); }, ms);
  })()`;
}

const NAMES = ['flowers', 'confetti', 'hearts', 'spin', 'flip', 'wobble', 'rainbow', 'disco', 'glitch'];

// The code to run in the game page for one effect.
function script(name) {
  if (!NAMES.includes(name)) return null;
  return `(() => {
    if (!window.__mgFunFx) window.__mgFunFx = (${effects.toString()})();
    return window.__mgFunFx[${JSON.stringify(name)}]();
  })()`;
}

module.exports = { script, bannerScript, NAMES };
