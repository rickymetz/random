/* Cadence — views, the guided session, and the routine editor. */
(function (global) {
  'use strict';

  var S = global.CadenceStore;
  var R = global.CadenceRoutine;
  var Charts = global.CadenceCharts;

  /* ---------- tiny DOM helper ---------- */

  function h(tag, attrs, kids) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      });
    }
    (kids || []).forEach(function (kid) {
      if (kid == null || kid === false) return;
      node.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  var toastTimer = null;
  function toast(message, action) {
    var el = document.getElementById('toast');
    clear(el);
    el.appendChild(document.createTextNode(message));
    if (action) {
      el.appendChild(h('button', {
        class: 'toast-action', type: 'button', text: action.label,
        onclick: function () { el.hidden = true; action.onClick(); }
      }));
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    // A toast with something to press has to wait for the press.
    if (!action) toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  /* Screen readers get nothing from a chime or a repainted screen, so every
   * step change, every finished timer and every toast is spoken here. */
  var liveTimer = null;
  function announce(message) {
    var el = document.getElementById('live');
    if (!el) return;
    el.textContent = '';                       // identical text is not re-announced
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { el.textContent = message; }, 60);
  }

  /* ---------- focus that survives a re-render ---------- */

  /* Views are rebuilt wholesale on every state change, which used to drop
   * focus to <body> after every single interaction — six exercises ticked off
   * meant six trips back from the top of the page. Interactive controls carry
   * a stable key so the equivalent node can be re-focused afterwards. */
  function activeFocusKey() {
    var el = document.activeElement;
    return el && el.getAttribute ? el.getAttribute('data-fkey') : null;
  }

  function findByKey(key) {
    var all = document.querySelectorAll('[data-fkey]');
    for (var i = 0; i < all.length; i++) {
      if (all[i].getAttribute('data-fkey') === key) return all[i];
    }
    return null;
  }

  function restoreFocus(key) {
    if (!key) return;
    var el = document.activeElement;
    if (el && el !== document.body && el.getAttribute && el.getAttribute('data-fkey') === key) return;
    var next = findByKey(key);
    if (next && next.focus) {
      try { next.focus(); } catch (e) { /* detached */ }
    }
  }

  /* ---------- formatting ---------- */

  function mmss(seconds) {
    var s = Math.max(0, Math.round(seconds));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function durationLabel(seconds) {
    return seconds >= 60 ? mmss(seconds) : Math.round(seconds) + 's';
  }

  function setsSummary(ex, sets) {
    var nums = (sets || []).filter(function (n) { return typeof n === 'number' && n > 0; });
    if (!nums.length) return '';
    return nums.map(function (n) { return ex.mode === 'time' ? durationLabel(n) : String(n); }).join(' · ') +
      (ex.perSide ? '/' + (ex.sideWord || 'side') : '');
  }

  /* ---------- feedback: sound, haptics, screen ---------- */

  var audioCtx = null;
  function beep(freqs) {
    if (!S.state.settings.sound) return;
    try {
      var Ctor = global.AudioContext || global.webkitAudioContext;
      if (!Ctor) return;
      audioCtx = audioCtx || new Ctor();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var t0 = audioCtx.currentTime;
      freqs.forEach(function (f, i) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        var at = t0 + i * 0.16;
        osc.type = 'sine';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(at);
        osc.stop(at + 0.2);
      });
    } catch (e) { /* audio is a nicety, never a blocker */ }
  }

  function buzz(pattern) {
    if (!S.state.settings.vibrate) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
  }

  var wakeLock = null;
  function keepAwake(on) {
    if (!navigator.wakeLock) return;
    if (on) {
      if (!S.state.settings.keepAwake || wakeLock) return;
      navigator.wakeLock.request('screen').then(function (lock) {
        wakeLock = lock;
        lock.addEventListener('release', function () { wakeLock = null; });
      }).catch(function () {});
    } else if (wakeLock) {
      wakeLock.release().catch(function () {});
      wakeLock = null;
    }
  }
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (!session.open) return;
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    keepAwake(true);
    if (hiddenAt) {
      session.discountSuspended(Date.now() - hiddenAt);
      hiddenAt = 0;
      session.paintTimer();
    }
  });

  /* ---------- theme ---------- */

  function applyTheme() {
    var theme = S.state.settings.theme;
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }

  document.getElementById('theme-btn').addEventListener('click', function () {
    var order = ['auto', 'light', 'dark'];
    var next = order[(order.indexOf(S.state.settings.theme) + 1) % order.length];
    S.setSetting('theme', next);
    applyTheme();
    toast('Theme: ' + next);
  });

  /* ---------- routing ---------- */

  var currentView = 'today';
  var views = {
    today: document.getElementById('view-today'),
    week: document.getElementById('view-week'),
    progress: document.getElementById('view-progress'),
    settings: document.getElementById('view-settings')
  };

  function show(view) {
    currentView = view;
    Object.keys(views).forEach(function (key) { views[key].hidden = key !== view; });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.classList.toggle('is-active', tab.dataset.view === view);
    });
    render();
    global.scrollTo(0, 0);
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    tab.addEventListener('click', function () { show(tab.dataset.view); });
  });

  /* ---------- shared pieces ---------- */

  function meter(label, value, max) {
    var pips = [];
    for (var i = 0; i < max; i++) {
      pips.push(h('div', { class: 'meter-pip' + (i < value ? ' is-on' : '') }));
    }
    return h('div', { class: 'meter' }, [
      h('div', { class: 'meter-label' }, [
        h('span', { text: label }),
        h('span', { class: 'value', text: value + ' / ' + max })
      ]),
      h('div', { class: 'meter-track', 'aria-hidden': true }, pips)
    ]);
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* Ticking a box used to store nothing at all, so the "I already know these
   * movements" path silently opted you out of the entire Progress tab with
   * nothing saying so. One stepper, prefilled from last time, fixes that. */
  var quickLog = null;
  var quickValue = 0;

  function suggestQuick(date, ex) {
    var history = S.historyFor(ex.id, 'best').filter(function (row) { return row.iso !== S.toISO(date); });
    if (history.length) return history[history.length - 1].value;
    return ex.mode === 'time' ? R.timerSeconds(ex, (S.workoutForSession(date) || {}).kind) : ex.min || 0;
  }

  function quickRow(date, ex) {
    var input = h('input', {
      type: 'number', min: 0, max: 999, class: 'quick-input',
      'aria-label': ex.name + ', ' + (ex.mode === 'time' ? 'seconds held' : 'reps'),
      oninput: function (e) { quickValue = Math.max(0, Math.min(999, Number(e.target.value) || 0)); }
    });
    input.value = String(quickValue);
    function step(by) {
      quickValue = Math.max(0, Math.min(999, quickValue + by));
      input.value = String(quickValue);
    }
    return h('div', { class: 'quick-row' }, [
      h('button', { class: 'quick-step', type: 'button', 'aria-label': 'One fewer', text: '−', onclick: function () { step(-1); } }),
      input,
      h('button', { class: 'quick-step', type: 'button', 'aria-label': 'One more', text: '+', onclick: function () { step(1); } }),
      h('span', { class: 'quick-unit', text: ex.mode === 'time' ? 'sec' : 'reps' }),
      h('button', {
        class: 'btn btn-sm btn-primary', type: 'button', text: 'Log',
        onclick: function () {
          S.setItem(date, ex.id, { sets: [quickValue], done: true });
          quickLog = null;
          buzz(12);
        }
      }),
      h('button', {
        class: 'btn btn-sm btn-ghost', type: 'button', text: 'No number',
        onclick: function () { quickLog = null; S.toggleItem(date, ex.id); }
      })
    ]);
  }

  function exerciseRows(date, workout) {
    var rows = [];
    var lastBlock = null;
    var sessionIds = S.sessionItemIds(date);
    var rendered = {};
    R.flatten(workout).forEach(function (row, index) {
      if (sessionIds.indexOf(row.ex.id) === -1) return;   // added to the routine after this day
      rendered[row.ex.id] = true;
      if (row.block && row.block !== lastBlock) {
        rows.push(h('div', { class: 'block-head', text: row.block }));
      }
      lastBlock = row.block;
      var ex = row.ex;
      var log = S.itemLog(date, ex.id);
      var done = !!(log && log.done);
      var actual = log ? setsSummary(ex, log.sets) : '';
      var note = log && log.note ? log.note : '';
      var detail = [actual, note].filter(Boolean).join(' — ');

      var iso = S.toISO(date);
      rows.push(h('div', { class: 'row' + (done ? ' is-done' : '') }, [
        h('button', {
          class: 'row-main',
          type: 'button',
          'data-fkey': 'row:' + iso + ':' + ex.id,
          onclick: function () { session.start(date, index); }
        }, [
          h('div', { class: 'row-name', text: ex.name }),
          detail ? h('div', { class: 'row-actual', text: detail }) : null
        ]),
        h('span', { class: 'row-target', text: R.targetLabel(ex) }),
        h('button', {
          class: 'check',
          type: 'button',
          'data-fkey': 'check:' + iso + ':' + ex.id,
          'aria-pressed': done ? 'true' : 'false',
          'aria-label': (done ? 'Mark not done: ' : 'Mark done: ') + ex.name,
          onclick: function () {
            if (done) { S.toggleItem(date, ex.id); return; }
            var hasNumbers = log && (log.sets || []).some(function (n) { return n > 0; });
            if (ex.mode === 'none' || hasNumbers) { S.toggleItem(date, ex.id); buzz(12); return; }
            quickLog = S.toISO(date) + ':' + ex.id;
            quickValue = suggestQuick(date, ex);
            render();
          }
        }, [h('span', { text: done ? '✓' : '' })])
      ]));
      if (quickLog === iso + ':' + ex.id) rows.push(quickRow(date, ex));
    });

    // Anything this session contained that the routine no longer does.
    sessionIds.forEach(function (id) {
      if (rendered[id]) return;
      var found = R.findExercise(S.routine(), id);
      var ex = found ? found.ex : S.state.retired[id];
      if (!ex) return;
      var log = S.itemLog(date, id);
      var done = !!(log && log.done);
      rows.push(h('div', { class: 'row' + (done ? ' is-done' : '') }, [
        h('span', { class: 'row-main' }, [
          h('div', { class: 'row-name', text: ex.name }),
          h('div', { class: 'row-actual', text: 'No longer in your routine' })
        ]),
        h('span', { class: 'row-target', text: R.targetLabel(ex) }),
        h('button', {
          class: 'check', type: 'button',
          'data-fkey': 'check:' + S.toISO(date) + ':' + id,
          'aria-pressed': done ? 'true' : 'false',
          'aria-label': (done ? 'Mark not done: ' : 'Mark done: ') + ex.name,
          onclick: function () { S.toggleItem(date, id); }
        }, [h('span', { text: done ? '✓' : '' })])
      ]));
    });
    return h('div', { class: 'rows' }, rows);
  }


  /* ---------- the demonstration panel ---------- */

  var Figures = global.CadenceFigures;
  var Media = global.CadenceMedia;

  var demoCache = { key: null, node: null, stop: null };
  var demoMode = {};   /* exId -> 'drawing' while you have a clip but want the figure */

  function prefersReducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function showingClip(ex) {
    return !!Media.info(ex.id) && demoMode[ex.id] !== 'drawing';
  }

  function resetDemo() {
    demoCache.key = null;
  }

  /* Rest and summary steps have no figure on screen, but the animation loop
   * kept running against a detached node — 8% of a core for every 45-second
   * rest, roughly a third of the session's whole animation budget. */
  function stopDemo() {
    if (demoCache.stop) demoCache.stop();
    demoCache = { key: null, node: null, stop: null };
  }

  /* One live demo at a time: rebuilding it on every repaint would restart the
   * animation (and leak a rAF loop) every time a set is logged. */
  function demoStage(ex) {
    var clip = Media.info(ex.id);
    var useClip = showingClip(ex);
    var key = ex.id + '|' + (useClip ? 'clip:' + clip.addedAt : 'drawing');
    if (demoCache.key === key && demoCache.node) return demoCache.node;
    if (demoCache.stop) demoCache.stop();
    demoCache = { key: key, node: null, stop: null };

    if (useClip) {
      var url = Media.url(ex.id);
      if (!url) {
        Media.load(ex.id).then(function () { resetDemo(); render(); });
        demoCache.key = null;   // rebuild once the blob has resolved
        return h('div', { class: 'demo-loading', text: 'Loading your clip…' });
      }
      if (/^video\//.test(clip.type)) {
        var video = h('video', { class: 'demo-media', src: url, loop: true, playsinline: true, preload: 'auto' });
        video.muted = true;
        if (prefersReducedMotion()) {
          video.controls = true;
        } else {
          video.autoplay = true;
          var playing = video.play();
          if (playing && playing.catch) playing.catch(function () { video.controls = true; });
        }
        demoCache.node = video;
        demoCache.stop = function () { try { video.pause(); } catch (e) {} };
        return video;
      }
      demoCache.node = h('img', { class: 'demo-media', src: url, alt: 'Your clip for ' + ex.name });
      return demoCache.node;
    }

    var fig = Figures.create(ex.id, {});
    demoCache.node = fig.node;
    demoCache.stop = fig.stop;
    return fig.node;
  }

  function pickClip(ex, onDone) {
    var input = h('input', { type: 'file', accept: 'image/*,video/*' });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      Media.save(ex.id, file).then(function () {
        demoMode[ex.id] = 'clip';
        resetDemo();
        toast('Saved a clip for ' + ex.name);
        if (onDone) onDone();
        render();
      }).catch(function (err) {
        toast(err.message || 'That clip could not be saved');
      });
    });
    input.click();
  }

  function removeClip(ex) {
    if (!global.confirm('Remove your clip for “' + ex.name + '”? The drawing comes back.')) return;
    Media.remove(ex.id).then(function () {
      resetDemo();
      toast('Clip removed');
      render();
    });
  }

  function demoPanel(ex) {
    var clip = Media.info(ex.id);
    var onClip = showingClip(ex);
    // A quarter of the screen, above the fold, on the 180th time you have
    // done push-ups. Putting it away is remembered.
    var hidden = !!S.state.demoHidden[ex.id];
    var controls = [h('button', {
      class: 'demo-btn', type: 'button',
      'aria-label': (hidden ? 'Show' : 'Hide') + ' the demonstration for ' + ex.name,
      text: hidden ? 'Show' : 'Hide',
      onclick: function () { stopDemo(); S.toggleDemoHidden(ex.id); }
    })];

    if (Media.supported) {
      if (clip) {
        controls.push(h('button', {
          class: 'demo-btn', type: 'button',
          'aria-label': onClip ? 'Show the drawing instead' : 'Show your clip instead',
          text: onClip ? 'Drawing' : 'My clip',
          onclick: function () {
            demoMode[ex.id] = onClip ? 'drawing' : 'clip';
            resetDemo();
            render();
          }
        }));
        controls.push(h('button', {
          class: 'demo-btn', type: 'button', 'aria-label': 'Remove your clip', text: '✕',
          onclick: function () { removeClip(ex); }
        }));
      } else {
        controls.push(h('button', {
          class: 'demo-btn', type: 'button', text: '＋ Your clip',
          onclick: function () { pickClip(ex); }
        }));
      }
    }

    return h('div', { class: 'demo' }, [
      hidden ? null : h('div', { class: 'demo-stage' }, [demoStage(ex)]),
      h('div', { class: 'demo-bar' }, [
        h('span', { class: 'demo-cue', text: Figures.cue(ex.id) }),
        h('span', { class: 'demo-controls' }, controls)
      ])
    ]);
  }

  /* ---------- today ---------- */

  function renderToday() {
    var root = views.today;
    clear(root);

    var date = S.today();
    var workout = S.workoutForSession(date);
    var progress = S.sessionProgress(date);
    var weekNo = S.weekNumber(date);
    var stats = S.weekStats(S.mondayOf(date));
    var isRest = workout.kind === 'rest';
    var done = S.isSessionDone(date);
    var pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

    var hero = h('section', { class: 'card hero' }, [
      h('div', { class: 'hero-day' }, [
        h('span', { class: 'eyebrow', text: date.toLocaleDateString(undefined, { weekday: 'long' }) }),
        h('span', { class: 'small muted', text: 'Week ' + weekNo + ' · ' + S.formatDate(date) })
      ]),
      h('div', { class: 'hero-workout', text: workout.name }),
      h('div', {
        class: 'hero-sub',
        text: isRest
          ? 'Nothing scheduled. Move gently if you feel like it.'
          : progress.total + ' exercises · about ' + estimateMinutes(workout) + ' min'
      }),
      isRest ? null : h('div', { class: 'progress-track' }, [
        h('div', { class: 'progress-fill', style: 'width:' + pct + '%' })
      ]),
      isRest ? null : h('div', { class: 'progress-legend' }, [
        h('span', { text: progress.done + ' of ' + progress.total + ' done' }),
        h('span', { text: done ? 'Session complete' : pct + '%' })
      ]),
      h('button', {
        class: 'btn btn-primary btn-block btn-lg',
        type: 'button',
        'data-fkey': 'hero:start',
        onclick: function () {
          if (isRest) {
            if (done) { S.reopenSession(date); toast('Rest day reopened'); }
            else { S.finishSession(date); S.setItem(date, 'recovery', { done: true }); buzz([18, 60, 18]); toast('Rest day logged'); }
            return;
          }
          session.start(date, done ? 0 : null);
        },
        text: isRest
          ? (done ? 'Rest day logged ✓' : 'Log the rest day')
          : done ? 'Review session' : progress.done ? 'Continue session' : 'Start session'
      })
    ]);
    root.appendChild(hero);

    var away = S.lastLoggedDate();
    var gapDays = away ? Math.round((date - away) / 86400000) : 0;
    if (gapDays > 10) {
      var lastWorkout = S.workoutForSession(away);
      root.appendChild(h('div', { class: 'banner' }, [
        h('span', { class: 'banner-glyph', 'aria-hidden': true, text: '↩' }),
        h('span', {
          text: Math.round(gapDays / 7) + ' weeks off. Your last session was ' +
            (lastWorkout ? lastWorkout.name + ' on ' : '') + S.formatDate(away) +
            '. Start a rep or two under what you were doing and you’ll be back inside a fortnight.'
        })
      ]));
    }

    var nudge = nudgeFor(date, stats);
    if (nudge) {
      var content = [
        h('span', { class: 'banner-glyph', 'aria-hidden': true, text: nudge.glyph }),
        h('span', { text: nudge.text })
      ];
      root.appendChild(nudge.date
        ? h('button', {
            class: 'banner banner-action', type: 'button',
            onclick: function () { session.start(nudge.date, null); }
          }, content)
        : h('div', { class: 'banner' }, content));
    }

    var streak = S.streakInfo();
    root.appendChild(h('div', { class: 'stat-grid' }, [
      h('section', { class: 'card' }, [
        h('div', { class: 'eyebrow', text: 'This week' }),
        h('div', { style: 'height:.6rem' }),
        meter('Calisthenics', stats.strength, stats.strengthTarget),
        meter('Mobility', stats.mobility, stats.mobilityTarget)
      ]),
      /* A bare zero under "a week counts when both targets are met" is the
       * same card a brand-new install shows — five good weeks and one missed
       * one rendered as though none of it had happened. The streak only
       * appears once there is one, and it always carries the best run. */
      streak.best > 0
        ? h('section', { class: 'card' }, [
            h('div', { class: 'eyebrow', text: 'Streak' }),
            h('div', { class: 'stat-value', text: String(streak.current) }),
            h('div', { class: 'stat-label', text: streak.current === 1 ? 'full week in a row' : 'full weeks in a row' }),
            h('div', { style: 'height:.5rem' }),
            h('div', { class: 'small muted', text: streakLine(streak, stats) })
          ])
        : h('section', { class: 'card' }, [
            h('div', { class: 'eyebrow', text: 'Week ' + weekNo }),
            h('div', { class: 'stat-value', text: (stats.strength + stats.mobility) + ' / ' + (stats.strengthTarget + stats.mobilityTarget) }),
            h('div', { class: 'stat-label', text: 'sessions this week' }),
            h('div', { style: 'height:.5rem' }),
            h('div', {
              class: 'small muted',
              text: stats.partial
                ? 'A part week — the target is only what was left of it when you started.'
                : 'Finish a full week and a streak starts here.'
            })
          ])
    ]));

    if (!isRest) {
      root.appendChild(h('section', { class: 'card' }, [
        h('div', { class: 'card-head' }, [
          h('h2', { text: 'Today’s list' }),
          h('button', {
            class: 'btn btn-sm btn-ghost', type: 'button',
            text: 'Open week →',
            onclick: function () { show('week'); }
          })
        ]),
        exerciseRows(date, workout)
      ]));
    }
  }

  function streakLine(streak, stats) {
    if (streak.current === 0) {
      return 'Your best run was ' + plural(streak.best, 'week', 'weeks') + '. ' +
        streak.sessionsDone + ' of your last ' + streak.sessionsPossible + ' sessions landed.';
    }
    if (stats.complete) return 'This week is already complete.';
    if (streak.best > streak.current) return 'Best run so far: ' + plural(streak.best, 'week', 'weeks') + '.';
    return 'A week counts when both targets are met.';
  }

  function firstUndone(date, workout) {
    var items = R.flatten(workout);
    for (var i = 0; i < items.length; i++) if (!S.isItemDone(date, items[i].ex.id)) return i;
    return 0;
  }

  function estimateMinutes(workout) {
    var seconds = 0;
    R.flatten(workout).forEach(function (row) {
      var ex = row.ex;
      var sets = ex.sets || 1;
      if (ex.mode === 'time') seconds += R.timerSeconds(ex, workout.kind) * sets * (ex.perSide ? 2 : 1);
      else if (ex.mode === 'reps') seconds += 30 * sets * (ex.perSide ? 2 : 1);
      seconds += (ex.rest || 0) * Math.max(0, sets - 1);
    });
    return Math.max(1, Math.round(seconds / 60));
  }

  /* It used to stay quiet from Monday to Wednesday — exactly while a catch-up
   * session could still save the week — then start counting your debt once
   * the week was already lost, including on the rest day, where it once read
   * "behind by 3 sessions with 1 days left" above a meter showing 3 of 3. */
  function nudgeFor(date, stats) {
    if (stats.complete) return { glyph: '✦', text: 'Both targets met this week. Anything else is a bonus.' };

    var workout = S.workoutForSession(date);
    if (workout && workout.kind === 'rest') return null;

    var short = (stats.strengthTarget - stats.strength) + (stats.mobilityTarget - stats.mobility);
    if (short <= 0) return null;

    var monday = S.mondayOf(date);
    var todayIdx = S.dayIndex(date);

    var open = null;
    for (var i = 0; i < todayIdx && !open; i++) {
      var past = S.addDays(monday, i);
      var pastWorkout = S.workoutForSession(past);
      if (!pastWorkout || pastWorkout.kind === 'rest' || S.isSessionDone(past)) continue;
      open = { date: past, workout: pastWorkout, day: R.DAYS[i] };
    }

    var remaining = 0;
    for (var j = todayIdx; j < 7; j++) {
      var day = S.addDays(monday, j);
      var dayWorkout = S.workoutForSession(day);
      if (dayWorkout && dayWorkout.kind !== 'rest' && !S.isSessionDone(day)) remaining++;
    }

    if (short > remaining) {
      return { glyph: '○', text: 'This one isn’t going to be a full week. Get one good session in and start clean on Monday.' };
    }
    if (open) {
      return {
        glyph: '◑', date: open.date,
        text: open.day.long + '’s ' + open.workout.name + ' is still open. Do it today and the week’s still on.'
      };
    }
    return { glyph: '◑', text: plural(short, 'session', 'sessions') + ' to go, with ' + plural(remaining, 'day', 'days') + ' scheduled to do ' + (short === 1 ? 'it' : 'them') + '.' };
  }

  /* ---------- week ---------- */

  var weekCursor = null;
  var expandedDays = {};

  function renderWeek() {
    var root = views.week;
    clear(root);

    var monday = weekCursor || S.mondayOf(S.today());
    var todayISO = S.toISO(S.today());
    var weekNo = S.weekNumber(monday);
    var stats = S.weekStats(monday);
    var pattern = S.calPattern(weekNo);

    root.appendChild(h('div', { class: 'week-nav' }, [
      h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'Previous week', text: '‹', 'data-fkey': 'week:prev',
        onclick: function () { weekCursor = S.addDays(monday, -7); render(); }
      }),
      h('div', { class: 'week-nav-title' }, [
        h('strong', { text: 'Week ' + weekNo }),
        h('span', { class: 'small muted', text: S.weekLabel(monday) })
      ]),
      h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'Next week', text: '›', 'data-fkey': 'week:next',
        onclick: function () { weekCursor = S.addDays(monday, 7); render(); }
      })
    ]));

    if (S.toISO(monday) !== S.toISO(S.mondayOf(S.today()))) {
      root.appendChild(h('button', {
        class: 'btn btn-sm btn-block', type: 'button', text: 'Back to this week',
        style: 'margin-bottom:.85rem',
        onclick: function () { weekCursor = null; render(); }
      }));
    }

    for (var i = 0; i < 7; i++) {
      (function (offset) {
        var date = S.addDays(monday, offset);
        var iso = S.toISO(date);
        var day = R.DAYS[offset];
        var workout = S.workoutForSession(date);
        var progress = S.sessionProgress(date);
        var isToday = iso === todayISO;
        var isOpen = expandedDays[iso] != null ? expandedDays[iso] : isToday;
        var done = S.isSessionDone(date);
        var missed = iso < todayISO && !done && workout.kind !== 'rest' && progress.done === 0;
        var session_ = S.sessionFor(date);

        var body = h('div', { class: 'day-body', hidden: !isOpen }, [
          exerciseRows(date, workout),
          h('textarea', {
            class: 'note-input',
            rows: 2,
            'aria-label': 'Notes for ' + S.formatDate(date, { weekday: 'long', month: 'short', day: 'numeric' }),
            placeholder: 'Notes for the day…',
            oninput: function (e) { S.setSessionNote(date, e.target.value); }
          }),
          h('div', { class: 'btn-row', style: 'margin-top:.6rem' }, [
            workout.kind === 'rest' ? null : h('button', {
              class: 'btn btn-sm btn-primary', type: 'button',
              'data-fkey': 'daystart:' + iso,
              text: progress.done ? 'Continue' : 'Start',
              onclick: function () { session.start(date, null); }
            }),
            h('button', {
              class: 'btn btn-sm', type: 'button',
              text: done ? 'Reopen' : 'Mark complete',
              onclick: function () { done ? S.reopenSession(date) : S.finishSession(date); }
            })
          ])
        ]);
        body.querySelector('textarea').value = session_ ? session_.note || '' : '';

        root.appendChild(h('article', { class: 'day' + (isToday ? ' is-today' : '') + (missed ? ' is-missed' : '') }, [
          h('button', {
            class: 'day-head', type: 'button',
            'data-fkey': 'day:' + iso,
            'aria-expanded': isOpen ? 'true' : 'false',
            onclick: function () { expandedDays[iso] = !isOpen; render(); }
          }, [
            h('span', { class: 'day-key', text: day.label }),
            h('span', {}, [
              h('div', { class: 'day-name', text: workout.name }),
              h('div', {
                class: 'day-meta',
                text: S.formatDate(date) + (missed ? ' · missed' : workout.kind === 'rest' ? '' : ' · about ' + estimateMinutes(workout) + ' min')
              })
            ]),
            h('span', { class: 'day-count' }, [
              done ? h('span', { class: 'day-done-dot', text: '●' }) : null,
              h('span', { text: progress.done + '/' + progress.total }),
              h('span', { 'aria-hidden': true, text: isOpen ? '▴' : '▾' })
            ])
          ]),
          body
        ]));
      })(i);
    }

    root.appendChild(h('section', { class: 'card', style: 'margin-top:1rem' }, [
      h('div', { class: 'card-head' }, [h('h2', { text: 'Week ' + weekNo + ' tally' }), h('span', { class: 'small muted', text: pattern.join(' · ').replace(/cal/g, '') })]),
      meter('Calisthenics sessions', stats.strength, stats.strengthTarget),
      meter('Mobility sessions', stats.mobility, stats.mobilityTarget)
    ]));
  }

  /* ---------- progress ---------- */

  var progressPick = { exId: null, metric: 'best' };

  function renderProgress() {
    var root = views.progress;
    clear(root);

    var logged = S.loggedExercises();
    if (!logged.length) {
      root.appendChild(h('section', { class: 'card' }, [
        h('h2', { text: 'Nothing to chart yet' }),
        h('p', { class: 'small muted', style: 'margin-top:.4rem', text: 'Log a few sets and this fills in: one line per exercise, with your target range shaded behind it.' })
      ]));
      root.appendChild(weeksCard());
      return;
    }

    if (!progressPick.exId || !logged.some(function (row) { return row.id === progressPick.exId; })) {
      /* Sorting by most-recent activity handed the default to whatever you
       * did last — usually the focus stretch, a fixed two-minute hold that
       * draws as a dead-flat line. Open on the one with something to show. */
      var interest = function (id) {
        var history = S.historyFor(id, 'best');
        if (history.length < 2) return 0;
        var values = history.map(function (row) { return row.value; });
        return (Math.max.apply(null, values) - Math.min.apply(null, values)) * 10 + history.length;
      };
      var pick = logged[0];
      logged.forEach(function (row) { if (interest(row.id) > interest(pick.id)) pick = row; });
      progressPick.exId = pick.id;
    }

    var picker = h('select', {
      'aria-label': 'Exercise', 'data-fkey': 'progress:exercise',
      onchange: function (e) { progressPick.exId = e.target.value; render(); }
    }, logged.map(function (row) {
      return h('option', {
        value: row.id, selected: row.id === progressPick.exId,
        text: row.ex.name + (row.removed ? ' (no longer in your routine)' : '')
      });
    }));

    var metric = h('select', {
      'aria-label': 'Measure', 'data-fkey': 'progress:metric',
      onchange: function (e) { progressPick.metric = e.target.value; render(); }
    }, [
      h('option', { value: 'best', selected: progressPick.metric === 'best', text: 'Best set' }),
      h('option', { value: 'total', selected: progressPick.metric === 'total', text: 'Session total' })
    ]);

    root.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'field-row' }, [
        h('div', { class: 'field' }, [h('label', { text: 'Exercise' }), picker]),
        h('div', { class: 'field' }, [h('label', { text: 'Measure' }), metric])
      ])
    ]));

    // Read the exercise off the picker row, not the routine: a deleted one
    // still has history to chart and is no longer in the routine at all.
    var picked = null;
    for (var li = 0; li < logged.length; li++) {
      if (logged[li].id === progressPick.exId) { picked = logged[li]; break; }
    }
    if (!picked) picked = logged[0];
    var ex = picked.ex;
    var history = S.historyFor(progressPick.exId, progressPick.metric);
    var unit = ex.mode === 'time' ? 'seconds' : 'reps';
    var isBest = progressPick.metric === 'best';

    var chartCard = h('section', { class: 'card' }, [
      h('div', { class: 'card-head' }, [
        h('div', {}, [
          h('h2', { text: ex.name }),
          h('div', {
            class: 'small muted',
            text: (isBest ? 'Best set' : 'Session total') + ', in ' + unit + ' · target ' + R.targetLabel(ex) +
              (picked.removed ? ' · no longer in your routine' : '')
          })
        ])
      ])
    ]);
    var chartHost = h('div', {});
    chartCard.appendChild(chartHost);
    root.appendChild(chartCard);

    var points = history.map(function (row) {
      return {
        date: row.date,
        value: row.value,
        label: S.formatDate(row.date),
        detail: setsSummary(ex, row.sets)
      };
    });

    Charts.lineChart(chartHost, {
      points: points,
      // Only the best-set view is comparable with a per-set target.
      band: isBest && ex.mode !== 'none' ? { min: ex.min, max: ex.max } : null,
      ariaLabel: ex.name + ', ' + (isBest ? 'best set' : 'session total') + ' in ' + unit,
      emptyText: 'No numbers logged for this one yet.',
      format: function (v, axis) {
        if (axis) return String(Math.round(v));
        return ex.mode === 'time' ? Math.round(v) + ' sec' : Math.round(v) + ' reps';
      }
    });

    if (points.length) {
      var first = history[0].value;
      var last = history[history.length - 1].value;
      var delta = last - first;
      chartCard.appendChild(h('p', {
        class: 'small muted',
        style: 'margin-top:.6rem',
        text: history.length < 2
          ? 'One session logged so far.'
          : (delta === 0 ? 'Level with your first session' : (delta > 0 ? 'Up ' : 'Down ') + Math.abs(delta) + ' ' + (ex.mode === 'time' ? 'sec' : 'reps')) +
            ' since ' + S.formatDate(history[0].date) + ' across ' + history.length + ' sessions.'
      }));
    }

    // The table twin: every value stays readable without hovering anything.
    var rows = history.slice().reverse().map(function (row) {
      return h('tr', {}, [
        h('td', { text: S.formatDate(row.date, { month: 'short', day: 'numeric', year: undefined }) }),
        h('td', { class: 'num', text: ex.mode === 'time' ? row.value + ' sec' : String(row.value) }),
        h('td', { text: setsSummary(ex, row.sets) || '—' })
      ]);
    });
    root.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card-head' }, [h('h2', { text: 'Every session' })]),
      h('table', { class: 'data' }, [
        h('thead', {}, [h('tr', {}, [
          h('th', { text: 'Date' }),
          h('th', { class: 'num', text: isBest ? 'Best' : 'Total' }),
          h('th', { text: 'Sets' })
        ])]),
        h('tbody', {}, rows.length ? rows : [h('tr', {}, [h('td', { colspan: 3, text: 'Nothing yet' })])])
      ])
    ]));

    root.appendChild(weeksCard());
  }

  function weeksCard() {
    var weeks = S.completedWeeks();
    return h('section', { class: 'card' }, [
      h('div', { class: 'card-head' }, [h('h2', { text: 'Weeks' })]),
      weeks.length
        ? h('table', { class: 'data' }, [
            h('thead', {}, [h('tr', {}, [
              h('th', { text: 'Week' }),
              h('th', { class: 'num', text: 'Calisthenics' }),
              h('th', { class: 'num', text: 'Mobility' })
            ])]),
            h('tbody', {}, weeks.map(function (w) {
              return h('tr', {}, [
                h('td', {}, [
                  h('strong', { text: 'Week ' + w.weekNo }),
                  h('div', { class: 'small muted', text: S.weekLabel(w.monday) })
                ]),
                h('td', { class: 'num', text: w.stats.strength + ' / ' + w.stats.strengthTarget }),
                h('td', { class: 'num', text: w.stats.mobility + ' / ' + w.stats.mobilityTarget })
              ]);
            }))
          ])
        : h('p', { class: 'small muted', text: 'Finish a session and the weekly tally starts here.' })
    ]);
  }

  /* ---------- settings ---------- */

  var editorOpen = {};
  var editingItem = null;
  var deferredInstall = null;

  function renderSettings() {
    var root = views.settings;
    clear(root);

    var weekNo = S.weekNumber(S.today());
    var pattern = S.calPattern(weekNo);

    root.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card-head' }, [h('h2', { text: 'This week’s pattern' })]),
      h('p', { class: 'small muted', text: 'Week ' + weekNo + ' runs ' + pattern.map(function (id) { return id === 'calA' ? 'A' : 'B'; }).join(' / ') + ' on Mon / Wed / Fri, then alternates every week.' }),
      h('div', { class: 'btn-row', style: 'margin-top:.7rem' }, [
        h('button', {
          class: 'btn btn-sm', type: 'button', text: 'Flip to ' + (pattern[0] === 'calA' ? 'B / A / B' : 'A / B / A'),
          onclick: function () { S.setPhaseOffset(!S.state.phaseOffset); toast('Pattern flipped'); }
        })
      ])
    ]));

    root.appendChild(h('section', { class: 'card' }, [
      h('div', { class: 'card-head' }, [h('h2', { text: 'During a session' })]),
      switchRow('Sound', 'A chime when a timer finishes.', 'sound'),
      switchRow('Vibration', 'A short buzz on every tick of progress.', 'vibrate'),
      switchRow('Keep the screen awake', 'Stops the phone sleeping mid-plank.', 'keepAwake'),
      switchRow('Auto-advance timers', 'Move on by itself when a hold finishes.', 'autoAdvance', true),
      h('div', { class: 'field', style: 'margin-top:.8rem' }, [
        h('label', { for: 'rest-default', text: 'Default rest between sets (seconds)' }),
        h('input', {
          id: 'rest-default', type: 'number', min: 0, max: 300, step: 5,
          value: S.state.settings.restDefault,
          onchange: function (e) { S.setSetting('restDefault', Math.max(0, Number(e.target.value) || 0)); }
        })
      ])
    ]));

    root.appendChild(routineEditor());

    var dataCard = h('section', { class: 'card' }, [
      h('div', { class: 'card-head' }, [h('h2', { text: 'Your data' })]),
      h('p', { class: 'small muted', text: 'Cadence never uploads anything and talks to no third party — it only fetches its own files from the site it is served from. Your data is stored in this browser, which also means any other page published on this same domain can read it. Clearing site data wipes it, so keep a backup file if the history matters to you.' }),
      Media.supported ? h('p', { class: 'small muted', style: 'margin-top:.5rem' }, [
        Media.count()
          ? 'Your own clips (' + Media.count() + ', ' + Media.formatBytes(Media.totalBytes()) + ') are stored separately and are too big for the backup file — they stay on this device.'
          : 'Clips you add to an exercise are stored on this device only, and are not included in the backup file.'
      ]) : null,
      h('div', { class: 'btn-row', style: 'margin-top:.8rem' }, [
        h('button', { class: 'btn btn-sm', type: 'button', text: 'Export backup', onclick: doExport }),
        h('button', { class: 'btn btn-sm', type: 'button', text: 'Import backup', onclick: doImport }),
        h('button', {
          class: 'btn btn-sm btn-danger', type: 'button', text: 'Erase everything',
          onclick: function () {
            if (!global.confirm('Erase every logged session and any routine edits? This cannot be undone.')) return;
            S.clearAll();
            weekCursor = null;
            expandedDays = {};
            toast('Everything erased');
          }
        })
      ])
    ]);
    if (deferredInstall) {
      dataCard.appendChild(h('div', { class: 'btn-row', style: 'margin-top:.6rem' }, [
        h('button', {
          class: 'btn btn-sm btn-primary', type: 'button', text: 'Install Cadence',
          onclick: function () {
            deferredInstall.prompt();
            deferredInstall.userChoice.finally(function () { deferredInstall = null; render(); });
          }
        })
      ]));
    }
    root.appendChild(dataCard);

    root.appendChild(h('p', { class: 'small muted', style: 'text-align:center;margin:1.2rem 0' }, [
      'Cadence · ',
      h('a', { href: '../../', style: 'color:var(--accent)', text: 'random' })
    ]));
  }

  function switchRow(title, detail, key, defaultOn) {
    var value = S.state.settings[key];
    if (value === undefined) value = !!defaultOn;
    var input = h('input', {
      type: 'checkbox',
      onchange: function (e) { S.setSetting(key, e.target.checked); }
    });
    input.checked = value;
    return h('label', { class: 'switch' }, [
      h('span', { class: 'switch-text' }, [title, h('small', { text: detail })]),
      input
    ]);
  }

  function doExport() {
    var blob = new Blob([S.exportData()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: 'cadence-backup-' + S.toISO(S.today()) + '.json' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Backup downloaded');
  }

  /* Blob.text() is the one modern API without a guard elsewhere; older Safari
   * would have thrown here and the import would have done nothing at all. */
  function readFile(file) {
    if (file.text) return file.text();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsText(file);
    });
  }

  function doImport() {
    var input = h('input', { type: 'file', accept: 'application/json,.json' });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      readFile(file).then(function (text) {
        try {
          S.importData(text);
          weekCursor = null;
          expandedDays = {};
          applyTheme();
          toast('Backup restored');
        } catch (e) {
          toast(e.message || 'That file could not be read');
        }
      });
    });
    input.click();
  }

  /* ---------- routine editor ---------- */

  function routineEditor() {
    var routine = S.routine();
    var card = h('section', { class: 'card' }, [
      h('div', { class: 'card-head' }, [
        h('h2', { text: 'Your routine' }),
        S.state.routine ? h('button', {
          class: 'btn btn-sm btn-ghost', type: 'button', text: 'Reset',
          onclick: function () {
            if (!global.confirm('Throw away your edits and go back to the original routine? Logged sessions are kept.')) return;
            S.resetRoutine();
            toast('Routine reset');
          }
        }) : null
      ]),
      h('p', { class: 'small muted', text: 'Edit targets, add exercises, reorder them. Past sessions keep whatever you logged at the time.' })
    ]);

    routine.workouts.forEach(function (workout, wIdx) {
      if (workout.kind === 'rest') return;
      var open = !!editorOpen[workout.id];
      var count = R.flatten(workout).length;
      var wrap = h('div', { class: 'editor-workout' }, [
        h('button', {
          class: 'editor-head', type: 'button', 'aria-expanded': open ? 'true' : 'false',
          'data-fkey': 'editor:' + workout.id,
          onclick: function () { editorOpen[workout.id] = !open; render(); }
        }, [
          h('span', { text: workout.name }),
          h('span', { class: 'small muted', text: count + ' exercises ' + (open ? '▴' : '▾') })
        ])
      ]);

      if (open) {
        workout.blocks.forEach(function (block, bIdx) {
          if (workout.blocks.length > 1) {
            var nameInput = h('input', {
              type: 'text', value: block.name, placeholder: 'Section name', 'aria-label': 'Section name',
              onchange: function (e) {
                var value = e.target.value;
                S.updateRoutine(function (next) { next.workouts[wIdx].blocks[bIdx].name = value; });
              }
            });
            wrap.appendChild(h('div', { class: 'field', style: 'margin:.5rem 0 .2rem' }, [
              h('label', { text: 'Section' }), nameInput
            ]));
          }
          block.items.forEach(function (ex, iIdx) {
            wrap.appendChild(editorItem(workout, wIdx, bIdx, iIdx, ex, block.items.length));
          });
          wrap.appendChild(h('button', {
            class: 'btn btn-sm btn-ghost', type: 'button', text: '+ Add exercise',
            style: 'margin:.4rem 0 .8rem',
            onclick: function () {
              var id = 'custom-' + Date.now().toString(36);
              var at = block.items.length;
              // Adding one used to schedule it after the cool-down.
              if (at && block.items[at - 1].id === 'cooldown') at -= 1;
              S.updateRoutine(function (next) {
                next.workouts[wIdx].blocks[bIdx].items.splice(at, 0, {
                  id: id, name: 'New exercise', mode: 'reps', sets: 3, min: 8, max: 12, rest: S.state.settings.restDefault
                });
              });
              editingItem = workout.id + ':' + bIdx + ':' + at;
            }
          }));
        });
      }
      card.appendChild(wrap);
    });

    return card;
  }

  function editorItem(workout, wIdx, bIdx, iIdx, ex, siblingCount) {
    var key = workout.id + ':' + bIdx + ':' + iIdx;
    var isEditing = editingItem === key;

    function mutate(fn) {
      S.updateRoutine(function (next) { fn(next.workouts[wIdx].blocks[bIdx].items[iIdx], next); });
    }

    function move(delta) {
      S.updateRoutine(function (next) {
        var items = next.workouts[wIdx].blocks[bIdx].items;
        var target = iIdx + delta;
        if (target < 0 || target >= items.length) return;
        var moved = items.splice(iIdx, 1)[0];
        items.splice(target, 0, moved);
      });
      editingItem = null;
    }

    var head = h('div', { class: 'editor-item-head' }, [
      h('button', {
        class: 'row-main', type: 'button', 'data-fkey': 'edit:' + key,
        onclick: function () { editingItem = isEditing ? null : key; render(); }
      }, [
        h('div', { class: 'editor-item-name', text: ex.name }),
        h('div', { class: 'editor-item-target', text: R.targetLabel(ex) })
      ]),
      h('div', { class: 'editor-tools' }, [
        h('button', { type: 'button', 'aria-label': 'Move ' + ex.name + ' up', text: '↑', 'data-fkey': 'up:' + workout.id + ':' + bIdx + ':' + Math.max(0, iIdx - 1), disabled: iIdx === 0, onclick: function () { move(-1); } }),
        h('button', { type: 'button', 'aria-label': 'Move ' + ex.name + ' down', text: '↓', 'data-fkey': 'down:' + workout.id + ':' + bIdx + ':' + Math.min(siblingCount - 1, iIdx + 1), disabled: iIdx === siblingCount - 1, onclick: function () { move(1); } }),
        h('button', {
          type: 'button', 'aria-label': 'Delete ' + ex.name, text: '✕',
          onclick: function () {
            var logged = S.historyFor(ex.id, 'best').length;
            var warning = logged
              ? '\n\nYou have ' + logged + ' session' + (logged > 1 ? 's' : '') + ' logged for it. The history is kept and stays in Progress under “no longer in your routine”.'
              : '';
            if (!global.confirm('Remove “' + ex.name + '” from ' + workout.name + '?' + warning)) return;
            S.retireExercise(ex);
            S.updateRoutine(function (next) { next.workouts[wIdx].blocks[bIdx].items.splice(iIdx, 1); });
            editingItem = null;
          }
        })
      ])
    ]);

    var node = h('div', { class: 'editor-item' }, [head]);
    if (!isEditing) return node;

    var isTime = ex.mode === 'time';
    var unitWord = isTime ? 'seconds' : 'reps';

    var form = h('div', { class: 'editor-form' }, [
      h('div', { class: 'field' }, [
        h('label', { text: 'Name' }),
        h('input', {
          type: 'text', value: ex.name, 'aria-label': 'Exercise name',
          onchange: function (e) { var v = e.target.value.trim() || 'Untitled'; mutate(function (item) { item.name = v; }); }
        })
      ]),
      h('div', { class: 'field-row' }, [
        h('div', { class: 'field' }, [
          h('label', { text: 'Measured in' }),
          (function () {
            var sel = h('select', {
              'aria-label': 'Measured in',
              onchange: function (e) {
                var v = e.target.value;
                mutate(function (item) {
                  item.mode = v;
                  if (v === 'time' && item.max < 10) { item.min = 30; item.max = 30; }
                  if (v === 'reps' && item.max > 60) { item.min = 8; item.max = 12; }
                });
              }
            }, [
              h('option', { value: 'reps', selected: ex.mode === 'reps', text: 'Reps' }),
              h('option', { value: 'time', selected: ex.mode === 'time', text: 'Time' }),
              h('option', { value: 'none', selected: ex.mode === 'none', text: 'Just a checkbox' })
            ]);
            return sel;
          })()
        ]),
        h('div', { class: 'field' }, [
          h('label', { text: 'Sets' }),
          h('input', {
            type: 'number', min: 1, max: 10, value: ex.sets || 1, 'aria-label': 'Sets',
            onchange: function (e) { var v = Math.max(1, Number(e.target.value) || 1); mutate(function (item) { item.sets = v; }); }
          })
        ])
      ]),
      ex.mode === 'none' ? null : h('div', { class: 'field-row' }, [
        h('div', { class: 'field' }, [
          h('label', { text: 'Low (' + unitWord + ')' }),
          h('input', {
            type: 'number', min: 0, value: ex.min, 'aria-label': 'Low, in ' + unitWord,
            onchange: function (e) {
              var v = Math.max(0, Number(e.target.value) || 0);
              mutate(function (item) { item.min = v; if (item.max < v) item.max = v; });
            }
          })
        ]),
        h('div', { class: 'field' }, [
          h('label', { text: 'High (' + unitWord + ')' }),
          h('input', {
            type: 'number', min: 0, value: ex.max, 'aria-label': 'High, in ' + unitWord,
            onchange: function (e) {
              var v = Math.max(0, Number(e.target.value) || 0);
              mutate(function (item) { item.max = v; if (item.min > v) item.min = v; });
            }
          })
        ])
      ]),
      ex.mode === 'none' ? null : h('div', { class: 'field' }, [
        h('label', { text: 'Rest after each set (seconds)' }),
        h('input', {
          type: 'number', min: 0, max: 300, step: 5, value: ex.rest || 0,
          'aria-label': 'Rest after each set, in seconds',
          onchange: function (e) { var v = Math.max(0, Number(e.target.value) || 0); mutate(function (item) { item.rest = v; }); }
        })
      ]),
      ex.mode === 'none' ? null : (function () {
        var input = h('input', {
          type: 'checkbox',
          onchange: function (e) { var on = e.target.checked; mutate(function (item) { item.perSide = on; if (on && !item.sideWord) item.sideWord = 'side'; }); }
        });
        input.checked = !!ex.perSide;
        return h('label', { class: 'switch' }, [
          h('span', { class: 'switch-text' }, ['Per side', h('small', { text: 'The target counts for each side separately.' })]),
          input
        ]);
      })(),
      ex.perSide && ex.mode !== 'none' ? h('div', { class: 'field', style: 'margin-top:.6rem' }, [
        h('label', { text: 'Word for a side' }),
        h('select', {
          'aria-label': 'Word for a side',
          onchange: function (e) { var v = e.target.value; mutate(function (item) { item.sideWord = v; }); }
        }, [
          h('option', { value: 'side', selected: (ex.sideWord || 'side') === 'side', text: 'side' }),
          h('option', { value: 'leg', selected: ex.sideWord === 'leg', text: 'leg' }),
          h('option', { value: 'arm', selected: ex.sideWord === 'arm', text: 'arm' })
        ])
      ]) : null,
      Media.supported ? h('div', { class: 'field' }, [
        h('label', { text: 'Demonstration' }),
        h('div', { class: 'editor-demo' }, [
          h('div', { class: 'editor-demo-thumb' }, [Figures.create(ex.id, { still: true }).node]),
          h('div', { class: 'editor-demo-body' }, [
            h('div', {
              class: 'small muted',
              text: (function () {
                var clip = Media.info(ex.id);
                return clip
                  ? clip.name + ' · ' + Media.formatBytes(clip.size)
                  : 'Showing the built-in drawing.';
              })()
            }),
            h('div', { class: 'btn-row', style: 'margin-top:.45rem' }, (function () {
              var clip = Media.info(ex.id);
              var buttons = [h('button', {
                class: 'btn btn-sm', type: 'button',
                text: clip ? 'Replace clip' : 'Add a clip',
                onclick: function () { pickClip(ex); }
              })];
              if (clip) {
                buttons.push(h('button', {
                  class: 'btn btn-sm btn-ghost', type: 'button', text: 'Remove',
                  onclick: function () { removeClip(ex); }
                }));
              }
              return buttons;
            })())
          ])
        ])
      ]) : null,
      h('button', {
        class: 'btn btn-sm', type: 'button', text: 'Done', style: 'margin-top:.4rem',
        onclick: function () { editingItem = null; render(); }
      })
    ]);

    node.appendChild(form);
    return node;
  }

  /* ---------- the guided session ---------- */

  var session = {
    open: false,
    date: null,
    workout: null,
    items: [],
    steps: [],
    index: 0,
    value: 0,
    timer: null,
    tick: null,
    chimed: false,

    start: function (date, itemIndex) {
      var workout = S.workoutForSession(date);
      if (!workout) return;
      this.date = date;
      this.workout = workout;
      this.items = R.flatten(workout);
      this.steps = buildSteps(this.items);
      this.index = itemIndex == null ? this.firstIncompleteStep() : this.stepForItem(itemIndex);
      this.open = true;
      S.ensureSession(date);
      requestPersistence();
      this.returnFocusKey = activeFocusKey();

      /* It looked modal and behaved like a sheet of glass: focus never entered
       * it, Tab walked straight through to the covered page, and people could
       * operate controls they could not see. */
      var root = document.getElementById('session-root');
      root.hidden = false;
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-label', workout.name + ' — guided session');
      var app = document.querySelector('.app');
      app.setAttribute('inert', '');
      app.setAttribute('aria-hidden', 'true');

      document.body.style.overflow = 'hidden';
      document.body.classList.add('is-session');
      keepAwake(true);
      beep([0]); // unlocks the audio context on the starting tap
      this.enter();
      root.focus();
    },

    /* "Continue" used to land on set 1 of 3 with the number you already did
     * sitting in the counter and nothing saying it was banked, so you either
     * repeated it or assumed the app had lost it. */
    firstIncompleteStep: function () {
      for (var i = 0; i < this.steps.length; i++) {
        var step = this.steps[i];
        if (step.kind !== 'work') continue;
        var ex = this.items[step.i].ex;
        if (ex.mode === 'none') {
          if (!S.isItemDone(this.date, ex.id)) return i;
          continue;
        }
        if (!this.loggedValue(ex, step)) return i;
      }
      return 0;
    },

    loggedValue: function (ex, step) {
      var log = S.itemLog(this.date, ex.id);
      if (!log) return 0;
      if (step.sides > 1) {
        var pair = (log.sides || [])[step.set] || [];
        return pair[step.side] || 0;
      }
      return (log.sets || [])[step.set] || 0;
    },

    stepForItem: function (itemIndex) {
      for (var i = 0; i < this.steps.length; i++) {
        if (this.steps[i].kind === 'work' && this.steps[i].i === itemIndex) return i;
      }
      return 0;
    },

    close: function () {
      this.stopTimer();
      this.open = false;
      stopDemo();

      var root = document.getElementById('session-root');
      root.hidden = true;
      root.removeAttribute('role');
      root.removeAttribute('aria-modal');
      root.removeAttribute('aria-label');
      var app = document.querySelector('.app');
      app.removeAttribute('inert');
      app.removeAttribute('aria-hidden');

      document.body.style.overflow = '';
      document.body.classList.remove('is-session');
      keepAwake(false);
      render();
      restoreFocus(this.returnFocusKey);
      this.returnFocusKey = null;
    },

    stopTimer: function () {
      if (this.tick) clearInterval(this.tick);
      this.tick = null;
      this.timer = null;
    },

    /* Set up whatever the current step needs, then paint it. */
    enter: function () {
      this.stopTimer();
      this.chimed = false;
      var step = this.steps[this.index];
      if (!step) return this.close();

      if (step.kind === 'done') keepAwake(false);   // nothing left to keep awake for
      if (step.kind === 'work') {
        var ex = this.items[step.i].ex;
        if (ex.mode === 'time') {
          this.startTimer(R.timerSeconds(ex, this.workout && this.workout.kind));
        } else if (ex.mode === 'reps') {
          this.value = this.suggestedReps(ex, step.set);
        }
      } else if (step.kind === 'rest') {
        this.startTimer(step.seconds);
      }
      this.paint();
      this.announceStep();
    },

    announceStep: function () {
      var step = this.steps[this.index];
      if (!step) return;
      if (step.kind === 'done') {
        var progress = S.sessionProgress(this.date);
        announce(progress.done === progress.total
          ? 'Session complete. ' + progress.done + ' of ' + progress.total + ' exercises.'
          : 'Session paused. ' + progress.done + ' of ' + progress.total + ' exercises logged.');
        return;
      }
      if (step.kind === 'rest') {
        var nextStep = this.steps[this.index + 1];
        var nextEx = nextStep && nextStep.kind === 'work' ? this.items[nextStep.i].ex : null;
        announce('Rest, ' + step.seconds + ' seconds' + (nextEx ? '. Next: ' + nextEx.name : '') + '.');
        return;
      }
      var ex = this.items[step.i].ex;
      var parts = [ex.name];
      if ((ex.sets || 1) > 1) parts.push('set ' + (step.set + 1) + ' of ' + ex.sets);
      if (step.sides > 1) parts.push('side ' + (step.side + 1) + ' of 2');
      if (ex.mode !== 'none') parts.push('target ' + R.targetLabel(ex));
      announce(parts.join(', ') + '.');
    },

    /* Start from what you managed last time — that is the whole point of logging. */
    suggestedReps: function (ex, setIndex) {
      var log = S.itemLog(this.date, ex.id);
      if (log && typeof (log.sets || [])[setIndex] === 'number' && log.sets[setIndex] > 0) return log.sets[setIndex];
      var history = S.historyFor(ex.id, 'best');
      var previous = history.filter(function (row) { return row.iso !== S.toISO(session.date); });
      if (previous.length) {
        var lastSets = previous[previous.length - 1].sets;
        if (typeof lastSets[setIndex] === 'number' && lastSets[setIndex] > 0) return lastSets[setIndex];
      }
      return ex.min || 0;
    },

    startTimer: function (seconds) {
      var self = this;
      this.timer = {
        target: seconds, accumulated: 0, startedAt: Date.now(),
        running: true, suspended: 0, lastTick: Date.now()
      };
      this.tick = setInterval(function () { self.onTick(); }, 200);
    },

    elapsed: function () {
      if (!this.timer) return 0;
      var t = this.timer;
      if (!t.running) return t.accumulated;
      return t.accumulated + Math.max(0, Date.now() - t.startedAt - t.suspended) / 1000;
    },

    /* Time the phone spent asleep, or the tab spent hidden, is not time you
     * spent holding the position. Without discounting it, a 40-second plank
     * interrupted by a ten-minute screen-off logs 606 seconds — and since the
     * chart takes your best set, that wrong number is permanent. */
    discountSuspended: function (ms) {
      if (this.timer && ms > 0) {
        this.timer.suspended += ms;
        this.timer.lastTick = Date.now();
      }
    },

    onTick: function () {
      if (!this.timer) return; // a tick can outlive its step
      var now = Date.now();
      // The interval is 200ms. A gap far beyond that means we were frozen,
      // which visibilitychange does not always report (a locked phone often
      // suspends the page without firing it).
      var gap = now - this.timer.lastTick;
      if (gap > 2000) this.timer.suspended += gap - 200;
      this.timer.lastTick = now;
      var remaining = this.timer.target - this.elapsed();
      if (remaining <= 0 && !this.chimed) {
        this.chimed = true;
        beep([660, 880]);
        buzz([60, 80, 60]);
        announce('Time.');
        var auto = S.state.settings.autoAdvance;
        if (auto === undefined || auto) {
          var self = this;
          setTimeout(function () { if (self.chimed && self.timer) self.complete(); }, 700);
          return;
        }
      }
      this.paintTimer();
    },

    toggleTimer: function () {
      if (!this.timer) return;
      if (this.timer.running) {
        this.timer.accumulated = this.elapsed();
        this.timer.running = false;
      } else {
        this.timer.startedAt = Date.now();
        this.timer.suspended = 0;
        this.timer.lastTick = Date.now();
        this.timer.running = true;
      }
      this.paint();
    },

    addTime: function (seconds) {
      if (!this.timer) return;
      this.timer.target += seconds;
      this.chimed = false;
      this.paint();
    },

    /* Record this step and move on. */
    complete: function () {
      var step = this.steps[this.index];
      if (step.kind === 'work') {
        var row = this.items[step.i];
        var ex = row.ex;
        var log = S.itemLog(this.date, ex.id) || { sets: [], note: '', done: false };
        var sets = (log.sets || []).slice();
        var patchSides = null;

        if (ex.mode === 'time') {
          var elapsed = this.elapsed();
          var target = this.timer ? this.timer.target : 0;
          // Landing within a couple of seconds of the target counts as the
          // target — otherwise auto-advance would log 31s for a 30s hold.
          var held = Math.abs(elapsed - target) <= 2 ? target : Math.round(elapsed);
          if (step.sides > 1) {
            /* Each side is kept separately. Taking a running max meant going
             * back to redo a mis-logged side one was silently ignored, and
             * going back to side zero wiped the other side's value. */
            var sides = Array.isArray(log.sides) ? log.sides.map(function (pair) { return (pair || []).slice(); }) : [];
            sides[step.set] = sides[step.set] || [];
            sides[step.set][step.side] = held;
            patchSides = sides;
            sets[step.set] = Math.max(sides[step.set][0] || 0, sides[step.set][1] || 0);
          } else {
            sets[step.set] = held;
          }
        } else if (ex.mode === 'reps') {
          var reps = Math.max(0, Math.min(999, Math.round(this.value) || 0));
          if (step.sides > 1) {
            var repSides = Array.isArray(log.sides) ? log.sides.map(function (pair) { return (pair || []).slice(); }) : [];
            repSides[step.set] = repSides[step.set] || [];
            repSides[step.set][step.side] = reps;
            patchSides = repSides;
            sets[step.set] = Math.max(repSides[step.set][0] || 0, repSides[step.set][1] || 0);
          } else {
            sets[step.set] = reps;
          }
        }
        // Reducing an exercise's set count used to leave orphans behind that
        // "Session total" kept adding up.
        if (sets.length > (ex.sets || 1)) sets.length = ex.sets || 1;

        var isLastStepOfItem = !this.steps.slice(this.index + 1).some(function (s) { return s.kind === 'work' && s.i === step.i; });
        var patch = { sets: sets };
        if (patchSides) patch.sides = patchSides;
        if (isLastStepOfItem) patch.done = true;
        S.setItem(this.date, ex.id, patch);
        if (isLastStepOfItem) buzz(14);
      }
      this.go(1);
    },

    skip: function () { this.go(1); },

    go: function (delta) {
      var next = this.index + delta;
      // Clamping used to re-enter the current step, throwing away an
      // in-progress hold when someone pressed Back on the first exercise.
      if (next < 0 || next >= this.steps.length) return;
      this.index = next;
      this.enter();
    },

    paintTimer: function () {
      var root = document.getElementById('session-root');
      var time = root.querySelector('.dial-time');
      var fill = root.querySelector('.dial-fill');
      if (!time || !this.timer) return;
      var elapsed = this.elapsed();
      var remaining = this.timer.target - elapsed;
      time.textContent = remaining >= 0 ? mmss(remaining) : '+' + mmss(-remaining);
      if (fill) {
        var frac = Math.max(0, Math.min(1, remaining / this.timer.target));
        var circumference = Number(fill.dataset.circumference);
        fill.style.strokeDashoffset = String(circumference * (1 - frac));
        fill.classList.toggle('is-over', remaining <= 0);
      }
    },

    paint: function () {
      var root = document.getElementById('session-root');
      clear(root);
      var step = this.steps[this.index];
      var self = this;

      var workDone = this.items.filter(function (row) { return S.isItemDone(self.date, row.ex.id); }).length;
      var pct = this.steps.length > 1 ? Math.round((this.index / (this.steps.length - 1)) * 100) : 0;

      root.appendChild(h('div', { class: 'session-bar' }, [
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close session', text: '✕', onclick: function () { self.close(); } }),
        h('div', { class: 'session-bar-title', text: this.workout.name + ' · ' + workDone + '/' + this.items.length }),
        h('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Skip to the end', text: '⤓',
          onclick: function () { self.index = self.steps.length - 1; self.enter(); }
        })
      ]));
      root.appendChild(h('div', { class: 'session-progress' }, [h('span', { style: 'width:' + pct + '%' })]));

      if (step.kind === 'done') return this.paintSummary(root);
      if (step.kind === 'rest') return this.paintRest(root, step);
      this.paintWork(root, step);
    },

    paintWork: function (root, step) {
      var self = this;
      var row = this.items[step.i];
      var ex = row.ex;
      var sets = ex.sets || 1;
      var body = h('div', { class: 'session-body has-demo' });

      body.appendChild(demoPanel(ex));
      if (row.block) body.appendChild(h('div', { class: 'session-block', text: row.block }));
      body.appendChild(h('div', { class: 'session-name', text: ex.name }));
      body.appendChild(h('div', { class: 'session-target', text: R.targetLabel(ex) }));

      if (sets > 1 || step.sides > 1) {
        var line = [];
        if (sets > 1) line.push('Set ' + (step.set + 1) + ' of ' + sets);
        if (step.sides > 1) line.push('Side ' + (step.side + 1) + ' of 2');
        body.appendChild(h('div', { class: 'session-setline', text: line.join(' · ') }));
      }

      if (sets > 1) {
        var pips = [];
        for (var i = 0; i < sets; i++) {
          pips.push(h('div', { class: 'set-pip' + (i < step.set ? ' is-done' : i === step.set ? ' is-current' : '') }));
        }
        body.appendChild(h('div', { class: 'set-pips' }, pips));
      }

      var actions = h('div', { class: 'session-actions' });

      if (ex.mode === 'time') {
        body.appendChild(this.dial());
        body.appendChild(h('div', {
          class: 'session-hint',
          text: this.timer && !this.timer.running ? 'Paused' : ex.perSide ? 'Hold, then swap sides.' : ''
        }));
        actions.appendChild(h('button', {
          class: 'btn btn-primary btn-lg btn-block', type: 'button',
          text: step.side === 0 && step.sides > 1 ? 'Next side' : 'Done',
          onclick: function () { self.complete(); }
        }));
        actions.appendChild(h('div', { class: 'btn-row' }, [
          h('button', { class: 'btn btn-sm', type: 'button', text: this.timer && this.timer.running ? 'Pause' : 'Resume', onclick: function () { self.toggleTimer(); } }),
          h('button', { class: 'btn btn-sm', type: 'button', text: '+15s', onclick: function () { self.addTime(15); } }),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Skip', onclick: function () { self.skip(); } })
        ]));
      } else if (ex.mode === 'reps') {
        var input = h('input', {
          type: 'number', inputmode: 'numeric', min: 0, max: 999,
          'aria-label': 'Reps completed',
          oninput: function (e) { self.value = Math.max(0, Math.min(999, Number(e.target.value) || 0)); }
        });
        input.value = String(this.value);
        body.appendChild(h('div', { class: 'counter' }, [
          h('button', {
            type: 'button', 'aria-label': 'One fewer', text: '−',
            onclick: function () { self.value = Math.max(0, self.value - 1); input.value = String(self.value); buzz(8); }
          }),
          input,
          h('button', {
            type: 'button', 'aria-label': 'One more', text: '+',
            onclick: function () { self.value = Math.min(999, self.value + 1); input.value = String(self.value); buzz(8); }
          })
        ]));
        body.appendChild(h('div', {
          class: 'counter-unit',
          text: step.sides > 1 ? 'reps this ' + (ex.sideWord || 'side') : 'reps'
        }));
        body.appendChild(h('div', { class: 'session-hint', text: this.lastTimeHint(ex, step) }));
        actions.appendChild(h('button', {
          class: 'btn btn-primary btn-lg btn-block', type: 'button', text: 'Log set',
          onclick: function () { self.complete(); }
        }));
        actions.appendChild(h('div', { class: 'btn-row' }, [
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Skip', onclick: function () { self.skip(); } })
        ]));
      } else {
        body.appendChild(h('div', { class: 'session-hint', text: 'Nothing to count today.' }));
        actions.appendChild(h('button', {
          class: 'btn btn-primary btn-lg btn-block', type: 'button', text: 'Mark done',
          onclick: function () { self.complete(); }
        }));
      }

      var noteBtn = h('button', {
        class: 'btn btn-sm btn-ghost', type: 'button', text: 'Add a note',
        onclick: function () {
          var log = S.itemLog(self.date, ex.id);
          var next = global.prompt('Note for ' + ex.name, (log && log.note) || '');
          if (next != null) S.setItem(self.date, ex.id, { note: next });
        }
      });
      actions.appendChild(h('div', { class: 'btn-row' }, [
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: '‹ Back', onclick: function () { self.go(-1); } }),
        noteBtn
      ]));

      root.appendChild(body);
      root.appendChild(actions);
      if (ex.mode === 'time') this.paintTimer();
    },

    lastTimeHint: function (ex, step) {
      var banked = this.loggedValue(ex, step);
      if (banked) return 'Already logged: ' + banked + '. Logging again replaces it.';
      var history = S.historyFor(ex.id, 'best').filter(function (row) { return row.iso !== S.toISO(session.date); });
      if (!history.length) return 'Aim for ' + R.amountLabel(ex) + '.';
      var previous = history[history.length - 1];
      var value = previous.sets[step.set];
      if (typeof value !== 'number' || !value) return 'Aim for ' + R.amountLabel(ex) + '.';
      return 'Last time, set ' + (step.set + 1) + ': ' + value + '. Add one if the last rep moved clean.';
    },

    paintRest: function (root, step) {
      var self = this;
      stopDemo();
      var nextStep = this.steps[this.index + 1];
      var nextEx = nextStep && nextStep.kind === 'work' ? this.items[nextStep.i].ex : null;

      var justLogged = '';
      var previous = this.steps[this.index - 1];
      if (previous && previous.kind === 'work') {
        var prevEx = this.items[previous.i].ex;
        var value = this.loggedValue(prevEx, previous);
        if (value) justLogged = prevEx.name + ': ' + value + (prevEx.mode === 'time' ? ' sec' : '') + ' logged';
      }

      var body = h('div', { class: 'session-body' }, [
        h('div', { class: 'session-block', text: 'Rest' }),
        justLogged ? h('div', { class: 'session-target', text: justLogged }) : null,
        this.dial(),
        h('div', {
          class: 'session-hint',
          text: nextEx ? 'Next: ' + nextEx.name + (nextStep.set != null && (nextEx.sets || 1) > 1 ? ' · set ' + (nextStep.set + 1) : '') : 'Almost there.'
        }),
        nextEx ? h('div', { class: 'demo-rest' }, [Figures.create(nextEx.id, { still: true }).node]) : null
      ]);
      /* The primary used to read "Skip rest", in the same place "Log set" had
       * been a second earlier — so tapping twice, which is what you do at
       * 6am, cut every prescribed rest to nothing. */
      var actions = h('div', { class: 'session-actions' }, [
        h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'button', text: 'Next set', onclick: function () { self.go(1); } }),
        h('div', { class: 'btn-row' }, [
          h('button', { class: 'btn btn-sm', type: 'button', text: '+15s', onclick: function () { self.addTime(15); } }),
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: '‹ Back', onclick: function () { self.go(-1); } })
        ])
      ]);
      root.appendChild(body);
      root.appendChild(actions);
      this.paintTimer();
    },

    dial: function () {
      var size = 200;
      var r = 88;
      var circumference = 2 * Math.PI * r;
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
      svg.setAttribute('aria-hidden', 'true');
      var track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      track.setAttribute('class', 'dial-track');
      track.setAttribute('cx', size / 2); track.setAttribute('cy', size / 2); track.setAttribute('r', r);
      var fill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      fill.setAttribute('class', 'dial-fill');
      fill.setAttribute('cx', size / 2); fill.setAttribute('cy', size / 2); fill.setAttribute('r', r);
      fill.setAttribute('stroke-dasharray', String(circumference));
      fill.setAttribute('stroke-dashoffset', '0');
      fill.dataset.circumference = String(circumference);
      svg.appendChild(track);
      svg.appendChild(fill);

      return h('div', { class: 'dial' }, [
        svg,
        h('div', {}, [
          h('div', { class: 'dial-time', role: 'timer', 'aria-live': 'off', text: this.timer ? mmss(this.timer.target) : '0:00' }),
          h('div', { class: 'dial-sub', text: this.timer ? 'of ' + mmss(this.timer.target) : '' })
        ])
      ]);
    },

    /* Three sessions at or above the top of the range means the range is out
     * of date. The app had all of this and never said anything. */
    progressionCandidates: function () {
      var self = this;
      if (!this.workout || this.workout.kind !== 'strength') return [];
      var out = [];
      this.items.forEach(function (row) {
        var ex = row.ex;
        if ((ex.mode !== 'reps' && ex.mode !== 'time') || !ex.max) return;
        var hist = S.historyFor(ex.id, 'best');
        if (hist.length < 3) return;
        var last3 = hist.slice(-3);
        var atTop = last3.every(function (entry) { return entry.value >= ex.max; });
        if (atTop) out.push(ex);
      });
      return out;
    },

    paintSummary: function (root) {
      var self = this;
      stopDemo();
      var progress = S.sessionProgress(this.date);
      var complete = progress.done === progress.total;
      var stats = S.weekStats(S.mondayOf(this.date));
      var entry = S.sessionFor(this.date);
      /* Timed from the first set actually logged. It used to run from the
       * moment the record was created — which is a checkbox tapped over
       * breakfast — so training at six in the evening reported 780 minutes. */
      var minutes = entry && entry.workedAt ? Math.round((Date.now() - entry.workedAt) / 60000) : null;
      if (minutes != null && (minutes < 1 || minutes > 180)) minutes = null;

      var logged = this.items.filter(function (row) {
        var log = S.itemLog(self.date, row.ex.id);
        return log && (log.sets || []).some(function (n) { return n > 0; });
      });

      var body = h('div', { class: 'session-body' }, [
        h('div', { class: 'session-block', text: complete ? 'Session complete' : 'Stopped for now' }),
        h('div', {
          class: 'summary-figure',
          text: complete ? this.workout.name : plural(logged.length, 'exercise', 'exercises')
        }),
        h('div', {
          class: 'session-target',
          text: complete
            ? (minutes ? 'done in about ' + plural(minutes, 'minute', 'minutes') : 'done')
            : 'logged — that counts.'
        })
      ]);

      if (logged.length) {
        body.appendChild(h('div', { class: 'summary-list' }, logged.map(function (row) {
          var ex = row.ex;
          var log = S.itemLog(self.date, ex.id);
          var history = S.historyFor(ex.id, 'best').filter(function (r) { return r.iso !== S.toISO(self.date); });
          var previous = history.length ? history[history.length - 1].value : null;
          var best = S.bestOfSets(log.sets);
          var delta = previous != null && best != null ? best - previous : 0;
          return h('div', { class: 'summary-row' }, [
            h('span', { class: 'summary-name', text: ex.name }),
            h('span', { class: 'summary-sets', text: setsSummary(ex, log.sets) }),
            delta ? h('span', {
              class: 'summary-delta' + (delta > 0 ? ' is-up' : ''),
              text: (delta > 0 ? '+' : '−') + Math.abs(delta) + ' on last time'
            }) : null
          ]);
        })));
      }

      // The weekly meters on a session you bailed out of only twist the knife.
      if (complete) {
        body.appendChild(h('div', { style: 'text-align:left;margin-top:1rem' }, [
          meter('Calisthenics', stats.strength, stats.strengthTarget),
          meter('Mobility', stats.mobility, stats.mobilityTarget)
        ]));
      }

      this.progressionCandidates().forEach(function (ex) {
        var step = ex.mode === 'time' ? 5 : 2;
        body.appendChild(h('div', { class: 'banner', style: 'text-align:left;margin-top:.9rem' }, [
          h('span', { class: 'banner-glyph', 'aria-hidden': true, text: '↗' }),
          h('span', {}, [
            h('div', { text: ex.name + ': three sessions at or above ' + R.amountLabel(ex) + '.' }),
            h('button', {
              class: 'btn btn-sm', type: 'button', style: 'margin-top:.5rem',
              text: 'Raise the target to ' + (ex.min + step) + '–' + (ex.max + step) + (ex.mode === 'time' ? ' sec' : ''),
              onclick: function () {
                S.bumpTarget(ex.id, step);
                toast(ex.name + ' target raised');
              }
            })
          ])
        ]));
      });

      var actions = h('div', { class: 'session-actions' }, [
        h('button', {
          class: 'btn btn-primary btn-lg btn-block', type: 'button',
          text: complete ? 'Finish' : 'Done for now',
          onclick: function () {
            if (complete) S.finishSession(self.date);
            buzz([20, 70, 20]);
            self.close();
          }
        }),
        h('div', { class: 'btn-row' }, [
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: '‹ Back', onclick: function () { self.go(-1); } })
        ])
      ]);

      root.appendChild(body);
      root.appendChild(actions);
    }
  };

  function buildSteps(items) {
    var steps = [];
    items.forEach(function (row, i) {
      var ex = row.ex;
      if (ex.mode === 'none') {
        steps.push({ kind: 'work', i: i, set: 0, side: 0, sides: 1 });
        return;
      }
      var sets = ex.sets || 1;
      // Every per-side exercise gets a pass each side, not just the timed
      // ones — otherwise a left/right difference, which is the most useful
      // thing a home trainee can spot, never reaches the log at all.
      var sides = ex.perSide ? 2 : 1;
      for (var s = 0; s < sets; s++) {
        for (var sd = 0; sd < sides; sd++) steps.push({ kind: 'work', i: i, set: s, side: sd, sides: sides });
        if ((ex.rest || 0) > 0 && s < sets - 1) steps.push({ kind: 'rest', i: i, set: s, seconds: ex.rest });
      }
      // …and a rest before the next exercise. The third set of squats used to
      // run straight into the first set of lunges with no pause at all.
      var next = items[i + 1];
      if (next && (ex.rest || 0) > 0 && next.ex.mode !== 'none') {
        steps.push({ kind: 'rest', i: i, set: sets - 1, seconds: ex.rest });
      }
    });
    steps.push({ kind: 'done' });
    return steps;
  }

  function trapTab(e) {
    var root = document.getElementById('session-root');
    var candidates = root.querySelectorAll('button:not([disabled]), input, select, textarea, a[href]');
    var list = Array.prototype.slice.call(candidates);
    if (!list.length) { e.preventDefault(); root.focus(); return; }
    var first = list[0];
    var last = list[list.length - 1];
    var el = document.activeElement;
    if (!root.contains(el)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
    if (e.shiftKey && (el === first || el === root)) { e.preventDefault(); last.focus(); return; }
    if (!e.shiftKey && el === last) { e.preventDefault(); first.focus(); }
  }

  document.addEventListener('keydown', function (e) {
    if (!session.open) return;
    if (e.key === 'Escape') { session.close(); return; }
    if (e.key === 'Tab') { trapTab(e); return; }
    if (e.key === ' ' || e.key === 'Enter') {
      /* Only when focus is on the dialog itself. Anywhere else, Space is
       * either activating the focused control or scrolling the page — both
       * of which the person meant, and neither of which should log a set. */
      if (document.activeElement !== document.getElementById('session-root')) return;
      e.preventDefault();
      session.complete();
    }
  });

  /* ---------- render loop ---------- */

  var renderQueued = false;
  function render() {
    var focusKey = activeFocusKey();
    try {
      /* While the session covers the screen, rebuilding the view behind it is
       * pure waste — and not cheap: with Progress open behind a long history
       * it measured ~142ms per "Log set", about nine dropped frames, on a
       * mid-range phone. close() renders the view again on the way out. */
      if (session.open) {
        session.paint();
        restoreFocus(focusKey);
        return;
      }
      if (currentView === 'today') renderToday();
      else if (currentView === 'week') renderWeek();
      else if (currentView === 'progress') renderProgress();
      else renderSettings();
      if (session.open) session.paint();
      restoreFocus(focusKey);
    } catch (err) {
      renderRecovery(err);
    }
  }

  /* If bad data makes a view throw, the app still has to offer a way out.
   * The erase button used to live inside the routine editor — which is the
   * thing that throws on a corrupt routine — so a bad backup left no route
   * back except clearing site data, taking every logged session with it. */
  function renderRecovery(err) {
    try { if (session.open) session.close(); } catch (e) { /* best effort */ }
    var root = views[currentView] || views.today;
    Object.keys(views).forEach(function (key) { views[key].hidden = views[key] !== root; });
    clear(root);
    root.appendChild(h('section', { class: 'card' }, [
      h('h2', { text: 'Cadence could not draw this screen' }),
      h('p', {
        class: 'small muted', style: 'margin-top:.45rem',
        text: 'Something in the stored data is wrong: ' + ((err && err.message) || 'unknown error') +
          '. Export a backup first if you want a copy of it, then reset the routine — that keeps your logged sessions.'
      }),
      h('div', { class: 'btn-row', style: 'margin-top:.9rem' }, [
        h('button', { class: 'btn btn-sm', type: 'button', text: 'Export backup', onclick: doExport }),
        h('button', {
          class: 'btn btn-sm', type: 'button', text: 'Reset the routine',
          onclick: function () { S.resetRoutine(); toast('Routine reset'); }
        }),
        h('button', {
          class: 'btn btn-sm btn-danger', type: 'button', text: 'Erase everything',
          onclick: function () {
            if (!global.confirm('Erase every logged session and any routine edits? This cannot be undone.')) return;
            S.clearAll();
          }
        })
      ])
    ]));
  }

  S.subscribe(function () {
    /* Don't yank a field out from under someone mid-type — but a <select> or
     * a checkbox fires `change` only once the value is committed, and
     * swallowing that repaint left the editor showing "(seconds)" next to a
     * reps exercise until some unrelated click repainted it. Focus is
     * restored by key afterwards, so repainting these is safe. */
    var el = document.activeElement;
    var tag = el && el.tagName;
    var typing = tag === 'TEXTAREA' || (tag === 'INPUT' && (el.type === 'text' || el.type === 'file'));
    if (typing) return;
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () { renderQueued = false; render(); });
  });

  /* ---------- service worker & install ---------- */

  global.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstall = e;
    if (currentView === 'settings') render();
  });

  /* An update is offered rather than swapped in: the service worker no longer
   * calls skipWaiting, so a new version cannot replace the code under a
   * session that is halfway through a set without the person knowing. */
  function announceUpdate(worker) {
    toast('A new version of Cadence is ready.', {
      label: 'Reload',
      onClick: function () { worker.postMessage('skip-waiting'); }
    });
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    global.addEventListener('load', function () {
      // Only Cadence's own worker counts: on a first visit the random hub's
      // worker (whose scope contains this folder) may control the page, and
      // Cadence claiming it then is a first install, not an update to reload for.
      var own = navigator.serviceWorker.controller;
      var hadController = !!own && /\/ideas\/cadence\/sw\.js$/.test(own.scriptURL);
      var reloading = false;

      navigator.serviceWorker.register('sw.js').then(function (reg) {
        function watch(worker) {
          if (!worker) return;
          worker.addEventListener('statechange', function () {
            // A controller already present means this is an update, not a
            // first install — only then is there anything to announce.
            if (worker.state === 'installed' && navigator.serviceWorker.controller) announceUpdate(worker);
          });
        }
        if (reg.waiting && navigator.serviceWorker.controller) announceUpdate(reg.waiting);
        reg.addEventListener('updatefound', function () { watch(reg.installing); });
      }).catch(function () { /* offline support is optional */ });

      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!hadController || reloading) return;   // not the first install
        reloading = true;
        global.location.reload();
      });
    });
  }

  /* Without this, iOS evicts an uninstalled site's storage after a week
   * without a visit, and Android may evict it under disk pressure — which for
   * this app means the entire training history. Asked once, on first use. */
  var persistenceAsked = false;
  function requestPersistence() {
    if (persistenceAsked || !navigator.storage || !navigator.storage.persist) return;
    persistenceAsked = true;
    try {
      navigator.storage.persisted().then(function (already) {
        if (!already) navigator.storage.persist();
      }).catch(function () {});
    } catch (e) { /* not available */ }
  }

  S.onSaveError(function (err) {
    toast(err && err.name === 'QuotaExceededError'
      ? 'Storage is full — this session was not saved.'
      : 'Could not save to this browser’s storage.');
  });

  applyTheme();
  show('today');

  if (Media.supported) {
    Media.ready().then(function () {
      if (Media.count()) { resetDemo(); render(); }
    });
  }
})(window);
