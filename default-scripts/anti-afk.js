/*
 * anti-afk.js
 *
 * Stops the page from being treated as idle or backgrounded while the window
 * sits behind your work. It takes no gameplay actions: it does not buy, sell,
 * harvest, feed, or click anything in the game. All it does is keep the tab
 * reporting itself as awake.
 *
 * Four independent techniques, each switchable below. Turn on the fewest that
 * do the job for you.
 *
 * Console controls, once it is running:
 *   antiAfk.status()   what is active, and how many ticks have fired
 *   antiAfk.stop()     undo everything and restore the original behaviour
 *   antiAfk.start()    start again
 */

const CONFIG = {
  // How often to emit a tick, in milliseconds. 45s is a reasonable starting
  // point. Some jitter is added so the interval is not perfectly robotic.
  intervalMs: 45_000,
  jitterMs: 15_000,

  // Report the page as visible even when the window is buried. This is what
  // stops "you went idle" logic that hangs off the Page Visibility API.
  reportVisible: true,

  // Report the window as focused even when it is not.
  reportFocused: true,

  // Emit a small synthetic pointer movement over the game canvas on each
  // tick. Only needed if the game tracks real input rather than visibility.
  syntheticPointer: true,

  // Run the tick from a Web Worker, which browsers do not throttle the way
  // they throttle timers in a backgrounded page. Leave this on unless you
  // see something odd.
  workerTimer: true,

  // Log each tick to the console. Useful while you are working out whether
  // this is doing anything; noisy afterwards.
  verbose: false,
};

const state = {
  running: false,
  ticks: 0,
  startedAt: null,
  undo: [],
  worker: null,
  intervalId: null,
};

function log(...args) {
  if (CONFIG.verbose) console.log('[anti-afk]', ...args);
}

/* ---- Technique 1: always report the page as visible ---------------- */

function holdVisible() {
  const doc = Document.prototype;
  const hiddenDesc = Object.getOwnPropertyDescriptor(doc, 'hidden');
  const stateDesc = Object.getOwnPropertyDescriptor(doc, 'visibilityState');

  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => false,
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });

  // Swallow the event itself, in the capture phase, before the game's own
  // listeners can see it.
  const swallow = (event) => {
    event.stopImmediatePropagation();
    log('suppressed visibilitychange');
  };
  document.addEventListener('visibilitychange', swallow, true);
  window.addEventListener('pagehide', swallow, true);

  state.undo.push(() => {
    document.removeEventListener('visibilitychange', swallow, true);
    window.removeEventListener('pagehide', swallow, true);
    delete document.hidden;
    delete document.visibilityState;
    if (hiddenDesc) Object.defineProperty(doc, 'hidden', hiddenDesc);
    if (stateDesc) Object.defineProperty(doc, 'visibilityState', stateDesc);
  });
}

/* ---- Technique 2: always report the window as focused -------------- */

function holdFocus() {
  const originalHasFocus = document.hasFocus.bind(document);
  document.hasFocus = () => true;

  const swallowBlur = (event) => {
    event.stopImmediatePropagation();
    log('suppressed blur');
  };
  window.addEventListener('blur', swallowBlur, true);

  state.undo.push(() => {
    window.removeEventListener('blur', swallowBlur, true);
    document.hasFocus = originalHasFocus;
  });
}

/* ---- Technique 3: a small synthetic pointer nudge ------------------ */

function nudgePointer() {
  // Prefer the game canvas; fall back to the body if there is not one.
  const target = document.querySelector('canvas') || document.body;
  if (!target) return;

  const box = target.getBoundingClientRect();
  const x = box.left + box.width / 2 + (Math.random() * 40 - 20);
  const y = box.top + box.height / 2 + (Math.random() * 40 - 20);

  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: Math.round(x),
    clientY: Math.round(y),
    view: window,
  };

  target.dispatchEvent(new PointerEvent('pointermove', init));
  target.dispatchEvent(new MouseEvent('mousemove', init));
  log('pointer nudge at', init.clientX, init.clientY);
}

/* ---- Technique 4: an unthrottled timer ----------------------------- */

function nextDelay() {
  return CONFIG.intervalMs + Math.floor(Math.random() * CONFIG.jitterMs);
}

function tick() {
  state.ticks += 1;
  if (CONFIG.syntheticPointer) nudgePointer();
  log('tick', state.ticks);
}

function startWorkerTimer() {
  // A worker's timers keep running at full rate while the page is buried.
  const source = `
    let id = null;
    onmessage = (e) => {
      if (e.data.stop) { clearTimeout(id); return; }
      clearTimeout(id);
      id = setTimeout(() => postMessage('tick'), e.data.delay);
    };
  `;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const worker = new Worker(url);
  URL.revokeObjectURL(url);

  worker.onmessage = () => {
    tick();
    worker.postMessage({ delay: nextDelay() });
  };
  worker.postMessage({ delay: nextDelay() });

  state.worker = worker;
  state.undo.push(() => {
    worker.postMessage({ stop: true });
    worker.terminate();
    state.worker = null;
  });
}

function startPlainTimer() {
  const loop = () => {
    tick();
    state.intervalId = setTimeout(loop, nextDelay());
  };
  state.intervalId = setTimeout(loop, nextDelay());

  state.undo.push(() => {
    clearTimeout(state.intervalId);
    state.intervalId = null;
  });
}

/* ---- Control -------------------------------------------------------- */

function start() {
  if (state.running) {
    console.log('[anti-afk] Already running.');
    return;
  }

  state.running = true;
  state.ticks = 0;
  state.startedAt = new Date();

  if (CONFIG.reportVisible) holdVisible();
  if (CONFIG.reportFocused) holdFocus();
  if (CONFIG.workerTimer) startWorkerTimer();
  else startPlainTimer();

  const on = Object.entries(CONFIG)
    .filter(([key, value]) => value === true && key !== 'verbose')
    .map(([key]) => key);

  console.log(
    `[anti-afk] Running. Active: ${on.join(', ')}. ` +
    `Tick every ${Math.round(CONFIG.intervalMs / 1000)}s (+ up to ` +
    `${Math.round(CONFIG.jitterMs / 1000)}s). Type antiAfk.stop() to end it.`
  );
}

function stop() {
  while (state.undo.length) {
    try {
      state.undo.pop()();
    } catch (err) {
      console.error('[anti-afk] Could not undo one change:', err);
    }
  }
  state.running = false;
  console.log('[anti-afk] Stopped, and the page is back to normal.');
}

function status() {
  return {
    running: state.running,
    ticks: state.ticks,
    startedAt: state.startedAt,
    minutesRunning: state.startedAt
      ? Math.round((Date.now() - state.startedAt.getTime()) / 60_000)
      : 0,
    config: { ...CONFIG },
  };
}

// If the script is injected twice, clean up the previous run first.
if (window.antiAfk && window.antiAfk.isRunning()) window.antiAfk.stop();

window.antiAfk = { start, stop, status, isRunning: () => state.running, config: CONFIG };

start();
