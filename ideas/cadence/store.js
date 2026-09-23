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

  var DEFAULT_GOALS = { strength: 3, mobility: 3 };

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
      routine: null,
      schedules: [],
      goals: [{ from: toISO(mondayOf(today())), strength: DEFAULT_GOALS.strength, mobility: DEFAULT_GOALS.mobility }],
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
        var block = { name: str(b.name, 60, ''), items: b.items.map(sanitizeExercise).filter(Boolean) };
        if (b.circuit) block.circuit = true;
        return block;
      }).filter(Boolean);
      if (!blocks.length) return null;
      var out = {
        id: id,
        name: str(w.name, 60, id),
        kind: w.kind === 'mobility' || w.kind === 'habit' || w.kind === 'rest' ? w.kind : 'strength',
        blocks: blocks
      };
      if (w.archived) out.archived = true;
      // In the alternating calisthenics. A and B were, before there was a
      // flag to say so.
      if (typeof w.rotate === 'boolean' ? w.rotate : id === 'calA' || id === 'calB') out.rotate = true;
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

  /* Weekly goals, versioned by the Monday they took effect like the plan is.
   * A week with no goals entry predates goals: its target is what its plan
   * scheduled, which is how it was scored at the time. */
  function sanitizeGoals(raw) {
    if (!Array.isArray(raw)) return null;
    var byWeek = {};
    raw.forEach(function (entry) {
      if (!entry || typeof entry !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.from)) return;
      byWeek[toISO(mondayOf(fromISO(entry.from)))] = {
        strength: Math.round(num(entry.strength, 0, 7, DEFAULT_GOALS.strength)),
        mobility: Math.round(num(entry.mobility, 0, 7, DEFAULT_GOALS.mobility))
      };
    });
    return Object.keys(byWeek).sort().slice(-200).map(function (from) {
      return { from: from, strength: byWeek[from].strength, mobility: byWeek[from].mobility };
    });
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
      routine: sanitizeRoutine(data.routine),
      schedules: sanitizeSchedules(data.schedules),
      goals: sanitizeGoals(data.goals) || [{ from: toISO(mondayOf(today())), strength: DEFAULT_GOALS.strength, mobility: DEFAULT_GOALS.mobility }],
      sessions: sanitizeSessions(data.sessions),
      retired: sanitizeRetired(data.retired),
      settings: sanitizeSettings(data.settings)
    };
    // The anchor must be a Monday, or every week number after it is off by a day.
    out.anchorMonday = toISO(mondayOf(fromISO(out.anchorMonday)));
    // A routine you've edited is a stored copy, so a program added to the app
    // later wouldn't reach it. Built-ins are never removed (deleting one
    // archives it), so a missing one is new.
    if (out.routine) {
      R.DEFAULT_ROUTINE.workouts.forEach(function (w) {
        var have = R.findWorkout(out.routine, w.id);
        // A retired built-in comes off an edited routine too (archived, so
        // its logged days still read right).
        if (have) { if (w.archived) have.archived = true; return; }
        if (w.archived) return;
        var at = out.routine.workouts.map(function (v) { return v.id; }).indexOf('rest');
        out.routine.workouts.splice(at < 0 ? out.routine.workouts.length : at, 0, R.clone(w));
      });
    }
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

  /* ---------- programs and the suggested week ---------- */

  function routine() {
    return state.routine || R.DEFAULT_ROUTINE;
  }

  function findWorkout(id) {
    return R.findWorkout(routine(), id);
  }

  function counts(w) {
    return !!w && (w.kind === 'strength' || w.kind === 'mobility');
  }

  /* Everything you can pick: not Rest, and not the ones you deleted (which
   * are kept, archived, only so the days you did them still read right). */
  function programs() {
    return routine().workouts.filter(function (w) { return w.kind !== 'rest' && !w.archived; });
  }

  function habits() {
    return programs().filter(function (w) { return w.kind === 'habit'; });
  }

  /* The suggested week in force for the week containing `date`. */
  function scheduleAt(date) {
    var monday = toISO(mondayOf(date));
    var days = null;
    state.schedules.forEach(function (entry) { if (entry.from <= monday) days = entry.days; });
    return days || R.DEFAULT_SCHEDULE;
  }

  function schedule() {
    return scheduleAt(today());
  }

  /* From this week on: a week behind you keeps the plan it was scored by. */
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

  /* The day each program was last finished, before `beforeISO`. */
  function lastDone(beforeISO) {
    var out = {};
    Object.keys(state.sessions).forEach(function (iso) {
      if (iso >= beforeISO) return;
      Object.keys(state.sessions[iso]).forEach(function (id) {
        if (state.sessions[iso][id].done && (!out[id] || out[id] < iso)) out[id] = iso;
      });
    });
    return out;
  }

  /* Programs of a kind, the one you've gone longest without first. */
  function byStaleness(list, last) {
    return list.slice().sort(function (a, b) {
      var x = last[a.id] || '';
      var y = last[b.id] || '';
      return x < y ? -1 : x > y ? 1 : list.indexOf(a) - list.indexOf(b);
    });
  }

  function rotationPool() {
    return programs().filter(function (w) { return w.kind === 'strength' && w.rotate; });
  }

  /* "Calisthenics, alternating" is whichever rotating program you did least
   * recently — not a pattern fixed by week number, which kept offering A
   * the day after you'd swapped one in. Days ahead are worked out by
   * assuming you do what's suggested in between. */
  function alternatingFor(date) {
    var pool = rotationPool();
    var todayISO = toISO(today());
    var target = toISO(date);
    if (target < todayISO) {
      // A week behind you only needs the slot's kind to be scored, even if
      // nothing takes turns any more.
      var any = pool[0] || routine().workouts.filter(function (w) { return w.kind === 'strength'; })[0];
      return any ? any.id : null;
    }
    if (!pool.length) return null;
    var last = lastDone(todayISO);
    for (var d = today(); toISO(d) <= target; d = addDays(d, 1)) {
      if (scheduleAt(d)[dayIndex(d)].indexOf(R.ROTATION) < 0) continue;
      var pick = null;
      if (toISO(d) === todayISO) {
        pool.forEach(function (w) { if (!pick && isSessionDone(d, w.id)) pick = w; });
      }
      pick = pick || byStaleness(pool, last)[0];
      last[pick.id] = toISO(d);
      if (toISO(d) === target) return pick.id;
    }
    return byStaleness(pool, last)[0].id;
  }

  /* What the suggested week has on a date: calisthenics and mobility only. */
  function scheduledIds(date) {
    var out = [];
    scheduleAt(date)[dayIndex(date)].forEach(function (token) {
      var id = token === R.ROTATION ? alternatingFor(date) : token;
      if (id && counts(findWorkout(id)) && out.indexOf(id) < 0) out.push(id);
    });
    return out;
  }

  /* One thing to do today. The plan's next program, unless you've already
   * done that kind today; with nothing planned and nothing done yet, the goal
   * you're furthest behind on. Null when there's nothing worth suggesting. */
  function suggestionFor(date) {
    var sessions = daySessions(date).filter(function (e) { return counts(findWorkout(e.workoutId)); });
    var doneKinds = sessions.filter(function (e) { return e.done; }).map(function (e) { return findWorkout(e.workoutId).kind; });
    var planned = scheduledIds(date).map(findWorkout).filter(function (w) { return w && !w.archived; });
    for (var i = 0; i < planned.length; i++) {
      var w = planned[i];
      if (!sessionFor(date, w.id) && doneKinds.indexOf(w.kind) < 0) return { workout: w, reason: 'plan' };
    }
    if (sessions.length) return null;
    var stats = weekStats(mondayOf(date));
    var needS = stats.strengthTarget - stats.strength;
    var needM = stats.mobilityTarget - stats.mobility;
    if (needS <= 0 && needM <= 0) return null;
    var kind = needS >= needM ? 'strength' : 'mobility';
    var id = kind === 'strength' ? alternatingFor(date) : null;
    var pick = id ? findWorkout(id) : byStaleness(programs().filter(function (p) { return p.kind === kind; }), lastDone(toISO(date)))[0];
    return pick ? { workout: pick, reason: 'goal' } : null;
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

  /* The programs you started on a date, in the order you started them. */
  function sessionsOn(date) {
    return daySessions(date)
      .map(function (entry) { return { entry: entry, workout: findWorkout(entry.workoutId) }; })
      .filter(function (row) { return row.workout; })
      .sort(function (a, b) { return a.entry.startedAt - b.entry.startedAt; });
  }

  /* Anything you'd lose by discarding a session. */
  function hasLoggedWork(date, workoutId) {
    var s = sessionFor(date, workoutId);
    if (!s) return false;
    if (s.done || s.note) return true;
    return Object.keys(s.items).some(function (exId) {
      var log = s.items[exId];
      return log.done || log.note || (log.sets || []).some(function (n) { return n > 0; });
    });
  }

  function discardSession(date, workoutId) {
    var iso = toISO(date);
    if (!state.sessions[iso]) return;
    delete state.sessions[iso][workoutId];
    if (!Object.keys(state.sessions[iso]).length) delete state.sessions[iso];
    emit();
  }

  function ensureSession(date, workoutId) {
    var iso = toISO(date);
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

  function goalsAt(date) {
    var monday = toISO(mondayOf(date));
    var found = null;
    state.goals.forEach(function (entry) { if (entry.from <= monday) found = entry; });
    return found;
  }

  function goals() {
    return goalsAt(today()) || DEFAULT_GOALS;
  }

  /* From this week on — changing a goal never re-scores a week behind you. */
  function setGoals(strength, mobility) {
    var from = toISO(mondayOf(today()));
    state.goals = state.goals.filter(function (entry) { return entry.from < from; });
    state.goals.push({
      from: from,
      strength: Math.round(num(strength, 0, 7, DEFAULT_GOALS.strength)),
      mobility: Math.round(num(mobility, 0, 7, DEFAULT_GOALS.mobility))
    });
    emit();
  }

  /* Any program on any day counts toward the goal for its kind; habits and
   * rest count toward nothing. Which day it was planned for doesn't matter.
   *
   * A week you only had part of — you installed on a Wednesday — asks for its
   * share of the goal, not all of it: the old scoring left a perfect first
   * week ending on a streak of zero. Weeks from before goals existed keep the
   * target their plan gave them. */
  function weekStats(monday) {
    var strength = 0;
    var mobility = 0;
    var available = 0;
    var planned = { strength: 0, mobility: 0 };
    for (var i = 0; i < 7; i++) {
      var date = addDays(monday, i);
      var open = !state.startedISO || toISO(date) >= state.startedISO;
      if (open) available++;
      scheduledIds(date).forEach(function (id) {
        var plannedWorkout = findWorkout(id);
        if (open && plannedWorkout && (plannedWorkout.kind === 'strength' || plannedWorkout.kind === 'mobility')) {
          planned[plannedWorkout.kind]++;
        }
      });
      daySessions(date).forEach(function (entry) {
        var done = entry.done && findWorkout(entry.workoutId);
        if (!done) return;
        if (done.kind === 'strength') strength++;
        if (done.kind === 'mobility') mobility++;
      });
    }
    var goal = goalsAt(monday);
    var target = goal
      ? { strength: Math.round(goal.strength * available / 7), mobility: Math.round(goal.mobility * available / 7) }
      : planned;
    var total = target.strength + target.mobility;
    // Goals of nothing are a choice to go without; such a week isn't failed.
    var optedOut = goal && goal.strength + goal.mobility === 0;
    return {
      strength: strength,
      mobility: mobility,
      strengthTarget: target.strength,
      mobilityTarget: target.mobility,
      partial: available < 7,
      complete: optedOut || (total > 0 && strength >= target.strength && mobility >= target.mobility)
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

  /* A new program starts from a copy of another — exercise ids and all, so a
   * hip-flexor stretch is one line in Progress whichever program it was in —
   * or from just a warm-up and a cool-down. */
  function createProgram(name, kind, copyFromId) {
    var id = 'prog-' + Date.now().toString(36);
    var source = copyFromId ? findWorkout(copyFromId) : null;
    var workout = {
      id: id,
      name: str(String(name || '').trim(), 60, 'New program'),
      kind: kind === 'mobility' || kind === 'habit' ? kind : 'strength',
      blocks: source
        ? R.clone(source.blocks)
        : [{ name: '', items: [R.clone(R.findExercise(R.DEFAULT_ROUTINE, 'warmup').ex), R.clone(R.findExercise(R.DEFAULT_ROUTINE, 'cooldown').ex)] }]
    };
    updateRoutine(function (next) { next.workouts.push(workout); });
    return id;
  }

  /* A program with logged days is archived rather than removed, so those days
   * still say what they were. Built-ins are always archived, so an edited
   * routine can tell one you deleted from one the app has added since. It
   * comes off the suggested week from this week on. */
  function deleteProgram(id) {
    var used = Object.keys(state.sessions).some(function (iso) { return state.sessions[iso][id]; });
    var days = schedule().map(function (list) { return list.filter(function (v) { return v !== id; }); });
    var from = toISO(mondayOf(today()));
    state.schedules = state.schedules.filter(function (entry) { return entry.from < from; });
    state.schedules.push({ from: from, days: days });
    updateRoutine(function (next) {
      next.workouts = next.workouts.map(function (w) {
        if (w.id !== id) return w;
        if (!used && !R.findWorkout(R.DEFAULT_ROUTINE, id)) return null;
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
    counts: counts,
    programs: programs,
    habits: habits,
    schedule: schedule,
    scheduleAt: scheduleAt,
    setSchedule: setSchedule,
    resetSchedule: resetSchedule,
    scheduledIds: scheduledIds,
    alternatingFor: alternatingFor,
    suggestionFor: suggestionFor,
    sessionsOn: sessionsOn,
    hasLoggedWork: hasLoggedWork,
    discardSession: discardSession,
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
    finishSession: finishSession,
    reopenSession: reopenSession,
    setSessionNote: setSessionNote,
    weekStats: weekStats,
    goals: goals,
    goalsAt: goalsAt,
    setGoals: setGoals,
    streakInfo: streakInfo,
    lastLoggedDate: lastLoggedDate,
    toggleDemoHidden: toggleDemoHidden,
    historyFor: historyFor,
    loggedExercises: loggedExercises,
    completedWeeks: completedWeeks,
    bestOfSets: bestOfSets,
    totalOfSets: totalOfSets,
    setSetting: setSetting,
    updateRoutine: updateRoutine,
    bumpTarget: bumpTarget,
    resetRoutine: resetRoutine,
    exportData: exportData,
    onSaveError: function (fn) { saveErrorHandler = fn; },
    importData: importData,
    clearAll: clearAll
  };
})(window);
