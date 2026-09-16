/* Cadence — state, persistence, and the calendar maths.
 *
 * Everything lives in localStorage under one key. Nothing is sent anywhere;
 * there is no account and no network call in this app at all.
 */
(function (global) {
  'use strict';

  var R = global.CadenceRoutine;
  var KEY = 'cadence.v1';
  var DAY_MS = 86400000;

  var listeners = [];
  var state = null;

  /* ---------- dates: local-time throughout, ISO yyyy-mm-dd as the key ---------- */

  function toISO(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function fromISO(iso) {
    var p = String(iso).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function today() {
    var d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /* Monday is day 0 of a Cadence week. */
  function mondayOf(d) {
    var date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var shift = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - shift);
    return date;
  }

  function dayIndex(d) {
    return (d.getDay() + 6) % 7;
  }

  function addDays(d, n) {
    var out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    out.setDate(out.getDate() + n);
    return out;
  }

  /* Whole weeks between two Mondays, immune to DST (both are local midnight). */
  function weeksBetween(fromMonday, toMonday) {
    return Math.round((toMonday - fromMonday) / (7 * DAY_MS));
  }

  function weekNumber(d) {
    return weeksBetween(fromISO(state.anchorMonday), mondayOf(d)) + 1;
  }

  function formatDate(d, opts) {
    return d.toLocaleDateString(undefined, opts || { month: 'short', day: 'numeric' });
  }

  function weekLabel(monday) {
    var sunday = addDays(monday, 6);
    var sameMonth = monday.getMonth() === sunday.getMonth();
    return formatDate(monday) + ' – ' + (sameMonth ? sunday.getDate() : formatDate(sunday));
  }

  /* ---------- persistence ---------- */

  function blankState() {
    return {
      version: 1,
      anchorMonday: toISO(mondayOf(today())),
      phaseOffset: 0,
      routine: null,
      sessions: {},
      settings: { restDefault: 60, sound: true, vibrate: true, keepAwake: true, autoAdvance: true, theme: 'auto' }
    };
  }

  function load() {
    var raw = null;
    try {
      raw = global.localStorage.getItem(KEY);
    } catch (e) {
      raw = null; // private mode, blocked storage — run in memory
    }
    if (!raw) return blankState();
    try {
      return migrate(JSON.parse(raw));
    } catch (e) {
      return blankState();
    }
  }

  /* ---------- validation ----------
   * Everything that comes back from storage or a backup file is treated as
   * hostile. A backup is a file a person can hand-edit, truncate, or be sent
   * by someone else, and this app is the only copy of their data — so a bad
   * one must be survivable, not fatal. Every value below is type-checked and
   * range-clamped, and anything unrecognisable is dropped rather than kept.
   */

  function num(value, min, max, fallback) {
    var n = Number(value);
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function str(value, limit, fallback) {
    return typeof value === 'string' && value ? value.slice(0, limit) : fallback;
  }

  function sanitizeExercise(ex) {
    if (!ex || typeof ex !== 'object') return null;
    var id = str(ex.id, 60, null);
    if (!id) return null;
    var out = {
      id: id,
      name: str(ex.name, 80, id),
      mode: ex.mode === 'time' || ex.mode === 'none' ? ex.mode : 'reps',
      // An unclamped `sets` is not cosmetic: buildSteps loops over it, so a
      // large one hangs the renderer the moment you press Start.
      sets: Math.round(num(ex.sets, 1, 20, 1)),
      min: Math.round(num(ex.min, 0, 3600, 0)),
      max: Math.round(num(ex.max, 0, 3600, 0)),
      rest: Math.round(num(ex.rest, 0, 600, 0))
    };
    if (out.max < out.min) out.max = out.min;
    if (ex.perSide) {
      out.perSide = true;
      out.sideWord = ex.sideWord === 'leg' || ex.sideWord === 'arm' ? ex.sideWord : 'side';
    }
    return out;
  }

  function sanitizeRoutine(routine) {
    if (!routine || typeof routine !== 'object' || !Array.isArray(routine.workouts)) return null;
    var workouts = routine.workouts.map(function (w) {
      if (!w || typeof w !== 'object' || !Array.isArray(w.blocks)) return null;
      var id = str(w.id, 40, null);
      if (!id) return null;
      var blocks = w.blocks.map(function (b) {
        if (!b || typeof b !== 'object' || !Array.isArray(b.items)) return null;
        return { name: str(b.name, 60, ''), items: b.items.map(sanitizeExercise).filter(Boolean) };
      }).filter(Boolean);
      if (!blocks.length) return null;
      return {
        id: id,
        name: str(w.name, 60, id),
        kind: w.kind === 'mobility' || w.kind === 'rest' ? w.kind : 'strength',
        blocks: blocks
      };
    }).filter(Boolean);
    return workouts.length ? { version: 1, workouts: workouts } : null;
  }

  function sanitizeSessions(sessions) {
    var out = {};
    if (!sessions || typeof sessions !== 'object') return out;
    Object.keys(sessions).forEach(function (iso) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
      var raw = sessions[iso];
      if (!raw || typeof raw !== 'object') return;
      var items = {};
      var src = raw.items && typeof raw.items === 'object' ? raw.items : {};
      Object.keys(src).forEach(function (exId) {
        var log = src[exId];
        if (!log || typeof log !== 'object') return;
        items[exId] = {
          sets: (Array.isArray(log.sets) ? log.sets : []).slice(0, 20).map(function (n) {
            var v = Number(n);
            return isFinite(v) && v > 0 ? Math.min(100000, Math.round(v)) : 0;
          }),
          note: str(log.note, 500, ''),
          done: !!log.done
        };
      });
      var entry = {
        workoutId: str(raw.workoutId, 40, 'rest'),
        items: items,
        note: str(raw.note, 1000, ''),
        done: !!raw.done,
        startedAt: isFinite(Number(raw.startedAt)) ? Number(raw.startedAt) : Date.now()
      };
      if (isFinite(Number(raw.finishedAt))) entry.finishedAt = Number(raw.finishedAt);
      if (isFinite(Number(raw.workedAt))) entry.workedAt = Number(raw.workedAt);
      if (Array.isArray(raw.itemIds)) {
        entry.itemIds = raw.itemIds.filter(function (v) { return typeof v === 'string'; }).slice(0, 60);
      }
      out[iso] = entry;
    });
    return out;
  }

  /* Copied key by key from an allow-list: Object.assign would carry a JSON
   * `__proto__` key straight onto the live settings object. */
  function sanitizeSettings(raw) {
    var base = blankState().settings;
    var src = raw && typeof raw === 'object' ? raw : {};
    var out = { restDefault: Math.round(num(src.restDefault, 0, 600, base.restDefault)) };
    ['sound', 'vibrate', 'keepAwake', 'autoAdvance'].forEach(function (key) {
      out[key] = typeof src[key] === 'boolean' ? src[key] : base[key];
    });
    out.theme = src.theme === 'light' || src.theme === 'dark' ? src.theme : 'auto';
    return out;
  }

  function migrate(data) {
    var base = blankState();
    if (!data || typeof data !== 'object') return base;
    var out = {
      version: 1,
      anchorMonday: /^\d{4}-\d{2}-\d{2}$/.test(data.anchorMonday) ? data.anchorMonday : base.anchorMonday,
      phaseOffset: data.phaseOffset === 1 ? 1 : 0,
      routine: sanitizeRoutine(data.routine),
      sessions: sanitizeSessions(data.sessions),
      settings: sanitizeSettings(data.settings)
    };
    // The anchor must be a Monday, or every week number after it is off by a day.
    out.anchorMonday = toISO(mondayOf(fromISO(out.anchorMonday)));
    return out;
  }

  var saveTimer = null;
  var saveErrorHandler = null;
  var saveFailed = false;
  function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      try {
        global.localStorage.setItem(KEY, JSON.stringify(state));
        saveFailed = false;
      } catch (e) {
        /* A silent failure here loses a whole workout: the app keeps showing
         * the sets in memory and they are gone on the next reload. Note that
         * the 5 MB quota is shared with every other app on this origin, so
         * this can happen even though Cadence itself is nowhere near it. */
        if (!saveFailed && saveErrorHandler) saveErrorHandler(e);
        saveFailed = true;
      }
    }, 120);
  }

  function emit() {
    save();
    listeners.forEach(function (fn) { fn(state); });
  }

  /* ---------- schedule ---------- */

  function routine() {
    return state.routine || R.DEFAULT_ROUTINE;
  }

  /* Week 1 runs A/B/A, week 2 B/A/B, and so on — phaseOffset flips the pair. */
  function calPattern(weekNo) {
    var odd = (weekNo + state.phaseOffset) % 2 !== 0;
    return odd ? ['calA', 'calB', 'calA'] : ['calB', 'calA', 'calB'];
  }

  function workoutIdFor(date) {
    var day = R.DAYS[dayIndex(date)];
    if (day.slot === 'cal') return calPattern(weekNumber(date))[day.calIndex];
    if (day.slot === 'flex') return 'flex';
    return 'rest';
  }

  function workoutFor(date) {
    return R.findWorkout(routine(), workoutIdFor(date)) || R.findWorkout(routine(), 'rest');
  }

  /* ---------- sessions ---------- */

  function sessionFor(date) {
    return state.sessions[toISO(date)] || null;
  }

  function ensureSession(date) {
    var iso = toISO(date);
    if (!state.sessions[iso]) {
      state.sessions[iso] = { workoutId: workoutIdFor(date), items: {}, note: '', done: false, startedAt: Date.now() };
    }
    return state.sessions[iso];
  }

  function itemLog(date, exId) {
    var s = sessionFor(date);
    return (s && s.items[exId]) || null;
  }

  function isItemDone(date, exId) {
    var log = itemLog(date, exId);
    return !!(log && log.done);
  }

  /* A session's workout is pinned the first time you touch it, so flipping the
   * A/B phase later never rewrites what you already did. */
  function workoutForSession(date) {
    var s = sessionFor(date);
    var id = s ? s.workoutId : workoutIdFor(date);
    return R.findWorkout(routine(), id) || workoutFor(date);
  }

  function setItem(date, exId, patch) {
    var s = ensureSession(date);
    var log = s.items[exId] || (s.items[exId] = { sets: [], note: '', done: false });
    Object.assign(log, patch);
    if (!s.done && allItemsDone(date)) {
      s.done = true;
      s.finishedAt = Date.now();
    }
    emit();
    return log;
  }

  function toggleItem(date, exId) {
    var log = itemLog(date, exId);
    var next = !(log && log.done);
    setItem(date, exId, { done: next });
    if (!next) {
      var s = sessionFor(date);
      if (s) { s.done = false; delete s.finishedAt; emit(); }
    }
    return next;
  }

  function allItemsDone(date) {
    var workout = workoutForSession(date);
    if (!workout) return false;
    var items = R.flatten(workout);
    if (!items.length) return false;
    return items.every(function (row) { return isItemDone(date, row.ex.id); });
  }

  function sessionProgress(date) {
    var workout = workoutForSession(date);
    var items = workout ? R.flatten(workout) : [];
    var done = items.filter(function (row) { return isItemDone(date, row.ex.id); }).length;
    return { done: done, total: items.length };
  }

  function isSessionDone(date) {
    var s = sessionFor(date);
    return !!(s && s.done);
  }

  function finishSession(date) {
    var s = ensureSession(date);
    s.done = true;
    s.finishedAt = Date.now();
    emit();
  }

  function reopenSession(date) {
    var s = sessionFor(date);
    if (!s) return;
    s.done = false;
    delete s.finishedAt;
    emit();
  }

  function setSessionNote(date, note) {
    ensureSession(date).note = note;
    emit();
  }

  /* ---------- weekly counters & streak ---------- */

  function weekStats(monday) {
    var strength = 0;
    var mobility = 0;
    var planned = { strength: 0, mobility: 0 };
    for (var i = 0; i < 7; i++) {
      var date = addDays(monday, i);
      var plannedId = workoutIdFor(date);
      var plannedWorkout = R.findWorkout(routine(), plannedId);
      if (plannedWorkout && plannedWorkout.kind === 'strength') planned.strength++;
      if (plannedWorkout && plannedWorkout.kind === 'mobility') planned.mobility++;
      if (!isSessionDone(date)) continue;
      var done = workoutForSession(date);
      if (!done) continue;
      if (done.kind === 'strength') strength++;
      if (done.kind === 'mobility') mobility++;
    }
    return {
      strength: strength,
      mobility: mobility,
      strengthTarget: planned.strength || 3,
      mobilityTarget: planned.mobility || 3,
      complete: strength >= (planned.strength || 3) && mobility >= (planned.mobility || 3)
    };
  }

  /* Consecutive complete weeks ending with the last one that could still count.
   * The week in progress never breaks a streak — it just hasn't finished yet. */
  function streak() {
    var monday = mondayOf(today());
    var count = 0;
    if (weekStats(monday).complete) count++;
    var cursor = addDays(monday, -7);
    var anchor = fromISO(state.anchorMonday);
    while (cursor >= anchor) {
      if (!weekStats(cursor).complete) break;
      count++;
      cursor = addDays(cursor, -7);
    }
    return count;
  }

  /* ---------- history for the progress view ---------- */

  function bestOfSets(sets) {
    var nums = (sets || []).filter(function (n) { return typeof n === 'number' && n > 0; });
    if (!nums.length) return null;
    return Math.max.apply(null, nums);
  }

  function totalOfSets(sets) {
    var nums = (sets || []).filter(function (n) { return typeof n === 'number' && n > 0; });
    if (!nums.length) return null;
    return nums.reduce(function (a, b) { return a + b; }, 0);
  }

  function historyFor(exId, metric) {
    var out = [];
    Object.keys(state.sessions).sort().forEach(function (iso) {
      var log = state.sessions[iso].items[exId];
      if (!log) return;
      var value = metric === 'total' ? totalOfSets(log.sets) : bestOfSets(log.sets);
      if (value == null) return;
      out.push({ iso: iso, date: fromISO(iso), value: value, sets: (log.sets || []).slice(), note: log.note || '' });
    });
    return out;
  }

  /* Every exercise that has at least one logged number, newest activity first. */
  function loggedExercises() {
    var seen = {};
    Object.keys(state.sessions).forEach(function (iso) {
      var items = state.sessions[iso].items || {};
      Object.keys(items).forEach(function (exId) {
        if (bestOfSets(items[exId].sets) == null) return;
        if (!seen[exId] || seen[exId] < iso) seen[exId] = iso;
      });
    });
    return Object.keys(seen)
      .map(function (id) {
        var found = R.findExercise(routine(), id);
        return { id: id, last: seen[id], ex: found ? found.ex : null, workout: found ? found.workout : null };
      })
      .filter(function (row) { return row.ex; })
      .sort(function (a, b) { return a.last < b.last ? 1 : -1; });
  }

  function completedWeeks() {
    var isos = Object.keys(state.sessions).filter(function (iso) { return state.sessions[iso].done; }).sort();
    if (!isos.length) return [];
    var first = mondayOf(fromISO(isos[0]));
    var last = mondayOf(today());
    var out = [];
    for (var cursor = last; cursor >= first; cursor = addDays(cursor, -7)) {
      var stats = weekStats(cursor);
      if (!stats.strength && !stats.mobility) continue;
      out.push({ monday: cursor, weekNo: weekNumber(cursor), stats: stats });
    }
    return out;
  }

  /* ---------- settings, routine editing, backup ---------- */

  function setSetting(key, value) {
    state.settings[key] = value;
    emit();
  }

  function setPhaseOffset(value) {
    state.phaseOffset = value ? 1 : 0;
    emit();
  }

  function updateRoutine(mutator) {
    var next = state.routine ? R.clone(state.routine) : R.defaultRoutine();
    mutator(next);
    state.routine = next;
    emit();
  }

  function resetRoutine() {
    state.routine = null;
    emit();
  }

  function exportData() {
    return JSON.stringify({ app: 'cadence', exportedAt: new Date().toISOString(), data: state }, null, 2);
  }

  function importData(text) {
    var parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || parsed.app !== 'cadence' || !parsed.data || typeof parsed.data !== 'object') {
      throw new Error('That is not a Cadence backup file.');
    }
    state = migrate(parsed.data);
    emit();
  }

  function clearAll() {
    state = blankState();
    emit();
  }

  function init() {
    state = load();
    save();
  }

  init();

  global.CadenceStore = {
    get state() { return state; },
    subscribe: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    emit: emit,
    toISO: toISO,
    fromISO: fromISO,
    today: today,
    mondayOf: mondayOf,
    dayIndex: dayIndex,
    addDays: addDays,
    weekNumber: weekNumber,
    weekLabel: weekLabel,
    formatDate: formatDate,
    routine: routine,
    calPattern: calPattern,
    workoutIdFor: workoutIdFor,
    workoutFor: workoutFor,
    workoutForSession: workoutForSession,
    sessionFor: sessionFor,
    ensureSession: ensureSession,
    itemLog: itemLog,
    isItemDone: isItemDone,
    setItem: setItem,
    toggleItem: toggleItem,
    sessionProgress: sessionProgress,
    isSessionDone: isSessionDone,
    finishSession: finishSession,
    reopenSession: reopenSession,
    setSessionNote: setSessionNote,
    weekStats: weekStats,
    streak: streak,
    historyFor: historyFor,
    loggedExercises: loggedExercises,
    completedWeeks: completedWeeks,
    bestOfSets: bestOfSets,
    totalOfSets: totalOfSets,
    setSetting: setSetting,
    setPhaseOffset: setPhaseOffset,
    updateRoutine: updateRoutine,
    resetRoutine: resetRoutine,
    exportData: exportData,
    onSaveError: function (fn) { saveErrorHandler = fn; },
    importData: importData,
    clearAll: clearAll
  };
})(window);
