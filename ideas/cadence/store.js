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
      version: 2,
      anchorMonday: toISO(mondayOf(today())),
      phaseOffset: 0,
      routine: null,
      schedules: [],
      dayPlans: {},
      startedISO: toISO(today()),
      sessions: {},
      retired: {},
      demoHidden: {},
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
      var out = {
        id: id,
        name: str(w.name, 60, id),
        kind: w.kind === 'mobility' || w.kind === 'rest' ? w.kind : 'strength',
        blocks: blocks
      };
      if (w.archived) out.archived = true;
      return out;
    }).filter(Boolean);
    return workouts.length ? { version: 1, workouts: workouts } : null;
  }

  var MAX_PER_DAY = 6;

  function sanitizeEntry(raw, workoutId) {
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
      workoutId: workoutId,
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
    return entry;
  }

  /* sessions[iso][workoutId] — a day can hold more than one program. Version 1
   * kept a single session per day, sessions[iso] = { workoutId, items, … },
   * which is read here as a day with one program in it. */
  function sanitizeSessions(sessions) {
    var out = {};
    if (!sessions || typeof sessions !== 'object') return out;
    Object.keys(sessions).forEach(function (iso) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
      var raw = sessions[iso];
      if (!raw || typeof raw !== 'object') return;
      var day = {};
      if (typeof raw.workoutId === 'string' && raw.items && typeof raw.items === 'object') {
        day[str(raw.workoutId, 40, 'rest')] = sanitizeEntry(raw, str(raw.workoutId, 40, 'rest'));
      } else {
        Object.keys(raw).slice(0, MAX_PER_DAY).forEach(function (key) {
          var id = str(key, 40, null);
          if (id && raw[key] && typeof raw[key] === 'object') day[id] = sanitizeEntry(raw[key], id);
        });
      }
      if (Object.keys(day).length) out[iso] = day;
    });
    return out;
  }

  function idList(raw) {
    if (!Array.isArray(raw)) return null;
    var out = [];
    raw.forEach(function (v) {
      var id = str(v, 40, null);
      if (id && out.indexOf(id) < 0 && out.length < MAX_PER_DAY) out.push(id);
    });
    return out;
  }

  /* The weekly plan, versioned by the Monday it took effect. Editing it only
   * changes this week and later: rewriting it backwards would re-score every
   * past week against a plan that wasn't the one you were following. */
  function sanitizeSchedules(raw) {
    if (!Array.isArray(raw)) return [];
    var byWeek = {};
    raw.forEach(function (entry) {
      if (!entry || typeof entry !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.from)) return;
      if (!Array.isArray(entry.days) || entry.days.length !== 7) return;
      var days = entry.days.map(function (d) { return idList(d) || []; });
      byWeek[toISO(mondayOf(fromISO(entry.from)))] = days;
    });
    return Object.keys(byWeek).sort().slice(-200).map(function (from) { return { from: from, days: byWeek[from] }; });
  }

  function sanitizeDayPlans(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (iso) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
      var list = idList(raw[iso]);
      if (list && list.length) out[iso] = list;
    });
    return out;
  }

  /* Exercises deleted from the routine, kept so months of logged history stay
   * reachable in Progress instead of vanishing with the routine entry. */
  function sanitizeRetired(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (id) {
      var ex = sanitizeExercise(raw[id]);
      if (ex) out[ex.id] = ex;
    });
    return out;
  }

  function sanitizeFlags(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (key) { if (raw[key]) out[String(key).slice(0, 60)] = true; });
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
      version: 2,
      anchorMonday: /^\d{4}-\d{2}-\d{2}$/.test(data.anchorMonday) ? data.anchorMonday : base.anchorMonday,
      startedISO: /^\d{4}-\d{2}-\d{2}$/.test(data.startedISO) ? data.startedISO : base.startedISO,
      demoHidden: sanitizeFlags(data.demoHidden),
      phaseOffset: data.phaseOffset === 1 ? 1 : 0,
      routine: sanitizeRoutine(data.routine),
      schedules: sanitizeSchedules(data.schedules),
      dayPlans: sanitizeDayPlans(data.dayPlans),
      sessions: sanitizeSessions(data.sessions),
      retired: sanitizeRetired(data.retired),
      settings: sanitizeSettings(data.settings)
    };
    // The anchor must be a Monday, or every week number after it is off by a day.
    out.anchorMonday = toISO(mondayOf(fromISO(out.anchorMonday)));
    // A day you've touched keeps the programs it had — a version 1 backup
    // carries no plans, and its days would otherwise follow today's schedule.
    Object.keys(out.sessions).forEach(function (iso) {
      var ids = Object.keys(out.sessions[iso]);
      var plan = out.dayPlans[iso];
      if (!plan) { out.dayPlans[iso] = ids.slice(0, MAX_PER_DAY); return; }
      ids.forEach(function (id) { if (plan.indexOf(id) < 0 && plan.length < MAX_PER_DAY) plan.push(id); });
    });
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

  function findWorkout(id) {
    return R.findWorkout(routine(), id);
  }

  /* The programs you can pick: everything but Rest and the ones you deleted
   * (which are kept, archived, only so the days you did them still read right). */
  function programs() {
    return routine().workouts.filter(function (w) { return w.kind !== 'rest' && !w.archived; });
  }

  /* The weekly plan in force for the week containing `date`. */
  function scheduleAt(date) {
    var monday = toISO(mondayOf(date));
    var days = null;
    state.schedules.forEach(function (entry) { if (entry.from <= monday) days = entry.days; });
    return days || R.DEFAULT_SCHEDULE;
  }

  function schedule() {
    return scheduleAt(today());
  }

  /* The nth rotation day of a week: week 1 runs A/B/A, week 2 B/A/B, and so
   * on — phaseOffset flips the pair. */
  function rotationPick(weekNo, n) {
    var odd = (weekNo + state.phaseOffset) % 2 !== 0;
    return odd === (n % 2 === 0) ? 'calA' : 'calB';
  }

  function calPattern(weekNo, days) {
    var out = [];
    (days || schedule()).forEach(function (list) {
      if (list.indexOf(R.ROTATION) >= 0) out.push(rotationPick(weekNo, out.length));
    });
    return out;
  }

  /* What the weekly plan says a date should run. Never empty: a day with
   * nothing on it is a rest day. */
  function scheduledIds(date) {
    var days = scheduleAt(date);
    var idx = dayIndex(date);
    var n = 0;
    for (var i = 0; i < idx; i++) if (days[i].indexOf(R.ROTATION) >= 0) n++;
    var out = [];
    days[idx].forEach(function (token) {
      var id = token === R.ROTATION ? rotationPick(weekNumber(date), n) : token;
      var w = findWorkout(id);
      if (w && w.kind !== 'rest' && out.indexOf(id) < 0) out.push(id);
    });
    return out.length ? out : ['rest'];
  }

  /* What a date actually runs: the schedule, unless you changed that day. */
  function planIds(date) {
    var plan = state.dayPlans[toISO(date)];
    if (plan) {
      var list = plan.filter(function (id) { return findWorkout(id); });
      if (list.length) return list;
    }
    return scheduledIds(date);
  }

  function workoutsFor(date) {
    return planIds(date).map(findWorkout).filter(Boolean);
  }

  function isRestDay(date) {
    var list = workoutsFor(date);
    return !list.length || (list.length === 1 && list[0].kind === 'rest');
  }

  function isPlanChanged(date) {
    return planIds(date).join('|') !== scheduledIds(date).join('|');
  }

  function setSchedule(days) {
    var from = toISO(mondayOf(today()));
    var clean = days.map(function (d) { return idList(d) || []; });
    state.schedules = state.schedules.filter(function (entry) { return entry.from < from; });
    state.schedules.push({ from: from, days: clean });
    emit();
  }

  function resetSchedule() {
    setSchedule(R.defaultSchedule());
  }

  /* ---------- the programs on one day ---------- */

  /* Anything you'd lose by taking a program off a day. A rest day's tick is
   * not worth a confirm. */
  function hasLoggedWork(date, workoutId) {
    var s = sessionFor(date, workoutId);
    if (!s || workoutId === 'rest') return false;
    if (s.done || s.note) return true;
    return Object.keys(s.items).some(function (exId) {
      var log = s.items[exId];
      return log.done || log.note || (log.sets || []).some(function (n) { return n > 0; });
    });
  }

  function setPlan(date, ids) {
    var iso = toISO(date);
    var list = [];
    ids.forEach(function (id) { if (list.indexOf(id) < 0 && findWorkout(id)) list.push(id); });
    if (list.length > 1) list = list.filter(function (id) { return id !== 'rest'; });
    if (!list.length) list = ['rest'];
    list = list.slice(0, MAX_PER_DAY);
    state.dayPlans[iso] = list;
    var day = state.sessions[iso];
    if (day) {
      Object.keys(day).forEach(function (id) { if (list.indexOf(id) < 0) delete day[id]; });
      if (!Object.keys(day).length) delete state.sessions[iso];
    }
    emit();
  }

  function addProgram(date, workoutId) {
    var list = planIds(date).slice();
    if (list.indexOf(workoutId) < 0) list.push(workoutId);
    setPlan(date, list);
  }

  /* Swapping in a program the day already has just drops the other one. */
  function swapProgram(date, fromId, toId) {
    var list = planIds(date).slice();
    var at = list.indexOf(fromId);
    if (at < 0) return addProgram(date, toId);
    if (list.indexOf(toId) >= 0) list.splice(at, 1);
    else list[at] = toId;
    setPlan(date, list);
  }

  function removeProgram(date, workoutId) {
    setPlan(date, planIds(date).filter(function (id) { return id !== workoutId; }));
  }

  function resetDay(date) {
    setPlan(date, scheduledIds(date));
    delete state.dayPlans[toISO(date)];
    emit();
  }

  /* ---------- sessions ---------- */

  function sessionFor(date, workoutId) {
    var day = state.sessions[toISO(date)];
    return (day && day[workoutId]) || null;
  }

  function daySessions(date) {
    var day = state.sessions[toISO(date)] || {};
    return Object.keys(day).map(function (id) { return day[id]; });
  }

  /* Touching a day pins its programs, so a phase flip or a schedule edit
   * later never rewrites what you already did. */
  function ensureSession(date, workoutId) {
    var iso = toISO(date);
    if (!state.dayPlans[iso]) state.dayPlans[iso] = planIds(date).slice();
    if (state.dayPlans[iso].indexOf(workoutId) < 0) state.dayPlans[iso].push(workoutId);
    var day = state.sessions[iso] || (state.sessions[iso] = {});
    if (!day[workoutId]) {
      day[workoutId] = { workoutId: workoutId, items: {}, note: '', done: false, startedAt: Date.now() };
    }
    return day[workoutId];
  }

  /* The ids a session actually contained. Without this, adding an exercise
   * made every finished day in the past read 6/7 with a "done" tick beside
   * it, and deleting one silently re-scored them all from 6/6 to 5/5. */
  function currentItemIds(date, workoutId) {
    var workout = findWorkout(workoutId);
    return workout ? R.flatten(workout).map(function (row) { return row.ex.id; }) : [];
  }

  function sessionItemIds(date, workoutId) {
    var s = sessionFor(date, workoutId);
    if (s && Array.isArray(s.itemIds) && s.itemIds.length) return s.itemIds;
    return currentItemIds(date, workoutId);
  }

  function itemLog(date, workoutId, exId) {
    var s = sessionFor(date, workoutId);
    return (s && s.items[exId]) || null;
  }

  function isItemDone(date, workoutId, exId) {
    var log = itemLog(date, workoutId, exId);
    return !!(log && log.done);
  }

  function setItem(date, workoutId, exId, patch) {
    var s = ensureSession(date, workoutId);
    var log = s.items[exId] || (s.items[exId] = { sets: [], note: '', done: false });
    Object.assign(log, patch);
    // When the work actually started, as opposed to when the record was first
    // touched — which could be a checkbox tapped over breakfast.
    if (patch.sets && !s.workedAt) s.workedAt = Date.now();
    if (!s.done && allItemsDone(date, workoutId)) {
      s.done = true;
      s.finishedAt = Date.now();
      s.itemIds = currentItemIds(date, workoutId);
    }
    emit();
    return log;
  }

  function toggleItem(date, workoutId, exId) {
    var log = itemLog(date, workoutId, exId);
    var next = !(log && log.done);
    setItem(date, workoutId, exId, { done: next });
    if (!next) {
      var s = sessionFor(date, workoutId);
      if (s) { s.done = false; delete s.finishedAt; emit(); }
    }
    return next;
  }

  function allItemsDone(date, workoutId) {
    var workout = findWorkout(workoutId);
    if (!workout) return false;
    var items = R.flatten(workout);
    if (!items.length) return false;
    return items.every(function (row) { return isItemDone(date, workoutId, row.ex.id); });
  }

  function sessionProgress(date, workoutId) {
    var ids = sessionItemIds(date, workoutId);
    var done = ids.filter(function (id) { return isItemDone(date, workoutId, id); }).length;
    return { done: done, total: ids.length };
  }

  function isSessionDone(date, workoutId) {
    var s = sessionFor(date, workoutId);
    return !!(s && s.done);
  }

  /* Every program the day holds, finished. */
  function isDayDone(date) {
    return planIds(date).every(function (id) { return isSessionDone(date, id); });
  }

  function finishSession(date, workoutId) {
    var s = ensureSession(date, workoutId);
    s.done = true;
    s.finishedAt = Date.now();
    s.itemIds = currentItemIds(date, workoutId);
    emit();
  }

  function reopenSession(date, workoutId) {
    var s = sessionFor(date, workoutId);
    if (!s) return;
    s.done = false;
    delete s.finishedAt;
    emit();
  }

  function setSessionNote(date, workoutId, note) {
    ensureSession(date, workoutId).note = note;
    emit();
  }

  /* ---------- weekly counters & streak ---------- */

  /* A week's target is only the sessions that were actually available in it.
   * Installing on a Wednesday used to leave week one needing 3 + 3 with four
   * days gone, so a perfect first week still ended on a streak of zero.
   *
   * The target comes from the weekly plan alone. A program you add to a day
   * counts once it's done, but never raises the bar — an extra stretch on a
   * Sunday shouldn't make the week harder to finish. */
  function weekStats(monday) {
    var strength = 0;
    var mobility = 0;
    var planned = { strength: 0, mobility: 0 };
    var partial = false;
    for (var i = 0; i < 7; i++) {
      var date = addDays(monday, i);
      var available = !state.startedISO || toISO(date) >= state.startedISO;
      scheduledIds(date).forEach(function (id) {
        var plannedWorkout = findWorkout(id);
        if (!plannedWorkout || plannedWorkout.kind === 'rest') return;
        if (available) planned[plannedWorkout.kind === 'strength' ? 'strength' : 'mobility']++;
        else partial = true;
      });
      daySessions(date).forEach(function (entry) {
        var done = entry.done && findWorkout(entry.workoutId);
        if (!done) return;
        if (done.kind === 'strength') strength++;
        if (done.kind === 'mobility') mobility++;
      });
    }
    var total = planned.strength + planned.mobility;
    return {
      strength: strength,
      mobility: mobility,
      strengthTarget: planned.strength,
      mobilityTarget: planned.mobility,
      partial: partial,
      complete: total > 0 && strength >= planned.strength && mobility >= planned.mobility
    };
  }

  /* The current run, the best run ever, and how many sessions of the last six
   * weeks landed. A bare zero after five good weeks reads as "you failed";
   * the best run is what stops it saying that. */
  function streakInfo() {
    var monday = mondayOf(today());
    var anchor = mondayOf(fromISO(state.anchorMonday));
    var flags = [];
    for (var c = new Date(anchor.getTime()); c <= monday; c = addDays(c, 7)) {
      flags.push(weekStats(c).complete);
    }
    var best = 0;
    var run = 0;
    flags.forEach(function (ok) { run = ok ? run + 1 : 0; best = Math.max(best, run); });

    var i = flags.length - 1;
    if (i >= 0 && !flags[i]) i--;          // the week in progress hasn't failed yet
    var current = 0;
    for (; i >= 0 && flags[i]; i--) current++;

    var done = 0;
    var possible = 0;
    for (var w = Math.max(0, flags.length - 6); w < flags.length; w++) {
      var stats = weekStats(addDays(anchor, w * 7));
      done += stats.strength + stats.mobility;
      possible += stats.strengthTarget + stats.mobilityTarget;
    }
    return { current: current, best: best, weeks: flags.length, sessionsDone: done, sessionsPossible: possible };
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

  /* One point per day. Two programs can share an exercise — the warm-up is in
   * all of them — and a day that did it twice keeps its better go. */
  function historyFor(exId, metric) {
    var out = [];
    Object.keys(state.sessions).sort().forEach(function (iso) {
      var pick = null;
      daySessions(fromISO(iso)).forEach(function (entry) {
        var log = entry.items[exId];
        if (!log) return;
        var value = metric === 'total' ? totalOfSets(log.sets) : bestOfSets(log.sets);
        if (value == null || (pick && pick.value >= value)) return;
        pick = { iso: iso, date: fromISO(iso), value: value, sets: (log.sets || []).slice(), note: log.note || '' };
      });
      if (pick) out.push(pick);
    });
    return out;
  }

  /* Every exercise that has at least one logged number, newest activity first. */
  function loggedExercises() {
    var seen = {};
    Object.keys(state.sessions).forEach(function (iso) {
      daySessions(fromISO(iso)).forEach(function (entry) {
        var items = entry.items || {};
        Object.keys(items).forEach(function (exId) {
          if (bestOfSets(items[exId].sets) == null) return;
          if (!seen[exId] || seen[exId] < iso) seen[exId] = iso;
        });
      });
    });
    return Object.keys(seen)
      .map(function (id) {
        var found = R.findExercise(routine(), id);
        var retired = state.retired[id];
        return {
          id: id,
          last: seen[id],
          ex: found ? found.ex : retired || null,
          workout: found ? found.workout : null,
          removed: !found
        };
      })
      .filter(function (row) { return row.ex; })
      .sort(function (a, b) { return a.last < b.last ? 1 : -1; });
  }

  function completedWeeks() {
    var isos = Object.keys(state.sessions).filter(function (iso) {
      return daySessions(fromISO(iso)).some(function (entry) { return entry.done; });
    }).sort();
    if (!isos.length) return [];
    var first = mondayOf(fromISO(isos[0]));
    var last = mondayOf(today());
    var out = [];
    // Empty weeks stay in the table. Dropping them hid the gap while the
    // streak was busy punishing you for it.
    for (var cursor = last; cursor >= first; cursor = addDays(cursor, -7)) {
      out.push({ monday: cursor, weekNo: weekNumber(cursor), stats: weekStats(cursor) });
    }
    return out;
  }

  /* ---------- settings, routine editing, backup ---------- */

  /* Called before an exercise is spliced out of the routine. */
  function retireExercise(ex) {
    if (!ex || !ex.id) return;
    state.retired[ex.id] = R.clone(ex);
  }

  function lastLoggedDate() {
    var isos = Object.keys(state.sessions).filter(function (iso) {
      return daySessions(fromISO(iso)).some(function (entry) {
        return entry.done || Object.keys(entry.items || {}).length;
      });
    }).sort();
    return isos.length ? fromISO(isos[isos.length - 1]) : null;
  }

  function toggleDemoHidden(exId) {
    if (state.demoHidden[exId]) delete state.demoHidden[exId];
    else state.demoHidden[exId] = true;
    emit();
  }

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

  /* Raise an exercise's whole range. The app records what you did but never
   * told you when to make it harder, so the ranges never moved and a chart
   * could sit above its own target band for months. */
  function bumpTarget(exId, delta) {
    updateRoutine(function (next) {
      next.workouts.forEach(function (w) {
        w.blocks.forEach(function (b) {
          b.items.forEach(function (item) {
            if (item.id !== exId) return;
            item.min = Math.max(0, Math.round(item.min + delta));
            item.max = Math.max(item.min, Math.round(item.max + delta));
          });
        });
      });
    });
  }

  /* Puts the built-in programs back as they were. Programs you made are
   * yours, not an edit to the original, so they stay. */
  function resetRoutine() {
    var builtIn = R.DEFAULT_ROUTINE.workouts.map(function (w) { return w.id; });
    var own = (state.routine ? state.routine.workouts : []).filter(function (w) { return builtIn.indexOf(w.id) < 0; });
    if (own.length) {
      var next = R.defaultRoutine();
      next.workouts = next.workouts.concat(R.clone(own));
      state.routine = next;
    } else {
      state.routine = null;
    }
    emit();
  }

  /* ---------- your own programs ---------- */

  var ROTATION_IDS = ['calA', 'calB'];

  function isRotationProgram(id) {
    return ROTATION_IDS.indexOf(id) >= 0;
  }

  /* A new program starts from a copy of another — exercise ids and all, so a
   * hip-flexor stretch is one line in Progress whichever program it was in —
   * or from just a warm-up and a cool-down. */
  function createProgram(name, kind, copyFromId) {
    var id = 'prog-' + Date.now().toString(36);
    var source = copyFromId ? findWorkout(copyFromId) : null;
    var workout = {
      id: id,
      name: str(String(name || '').trim(), 60, 'New program'),
      kind: kind === 'mobility' ? 'mobility' : 'strength',
      blocks: source
        ? R.clone(source.blocks)
        : [{ name: '', items: [R.clone(R.findExercise(R.DEFAULT_ROUTINE, 'warmup').ex), R.clone(R.findExercise(R.DEFAULT_ROUTINE, 'cooldown').ex)] }]
    };
    updateRoutine(function (next) { next.workouts.push(workout); });
    return id;
  }

  /* A program with logged days is archived rather than removed, so those days
   * still say what they were. It comes off the weekly plan from this week on,
   * and off any day ahead that you'd added it to. */
  function deleteProgram(id) {
    if (isRotationProgram(id)) return;
    var used = Object.keys(state.sessions).some(function (iso) { return state.sessions[iso][id]; });
    var todayISO = toISO(today());
    Object.keys(state.dayPlans).forEach(function (iso) {
      if (iso < todayISO || (iso === todayISO && hasLoggedWork(fromISO(iso), id))) return;
      var list = state.dayPlans[iso].filter(function (v) { return v !== id; });
      if (list.length) state.dayPlans[iso] = list;
      else delete state.dayPlans[iso];
      if (state.sessions[iso]) delete state.sessions[iso][id];
    });
    var days = schedule().map(function (list) { return list.filter(function (v) { return v !== id; }); });
    var from = toISO(mondayOf(today()));
    state.schedules = state.schedules.filter(function (entry) { return entry.from < from; });
    state.schedules.push({ from: from, days: days });
    updateRoutine(function (next) {
      next.workouts = next.workouts.map(function (w) {
        if (w.id !== id) return w;
        if (!used) return null;
        w.archived = true;
        return w;
      }).filter(Boolean);
    });
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
    findWorkout: findWorkout,
    programs: programs,
    schedule: schedule,
    scheduleAt: scheduleAt,
    setSchedule: setSchedule,
    resetSchedule: resetSchedule,
    calPattern: calPattern,
    scheduledIds: scheduledIds,
    planIds: planIds,
    workoutsFor: workoutsFor,
    isRestDay: isRestDay,
    isPlanChanged: isPlanChanged,
    hasLoggedWork: hasLoggedWork,
    addProgram: addProgram,
    swapProgram: swapProgram,
    removeProgram: removeProgram,
    resetDay: resetDay,
    isRotationProgram: isRotationProgram,
    createProgram: createProgram,
    deleteProgram: deleteProgram,
    sessionFor: sessionFor,
    ensureSession: ensureSession,
    itemLog: itemLog,
    isItemDone: isItemDone,
    setItem: setItem,
    toggleItem: toggleItem,
    sessionProgress: sessionProgress,
    sessionItemIds: sessionItemIds,
    retireExercise: retireExercise,
    isSessionDone: isSessionDone,
    isDayDone: isDayDone,
    finishSession: finishSession,
    reopenSession: reopenSession,
    setSessionNote: setSessionNote,
    weekStats: weekStats,
    streakInfo: streakInfo,
    lastLoggedDate: lastLoggedDate,
    toggleDemoHidden: toggleDemoHidden,
    historyFor: historyFor,
    loggedExercises: loggedExercises,
    completedWeeks: completedWeeks,
    bestOfSets: bestOfSets,
    totalOfSets: totalOfSets,
    setSetting: setSetting,
    setPhaseOffset: setPhaseOffset,
    updateRoutine: updateRoutine,
    bumpTarget: bumpTarget,
    resetRoutine: resetRoutine,
    exportData: exportData,
    onSaveError: function (fn) { saveErrorHandler = fn; },
    importData: importData,
    clearAll: clearAll
  };
})(window);
