/* Cadence — the routine itself, and the labels derived from it.
 *
 * A program's kind is 'strength' (shown as Calisthenics) or 'mobility', each
 * counting toward its own weekly goal; 'habit', offered every day and counted
 * toward nothing; or 'rest', which only old logs still use. A calisthenics
 * program with `rotate` takes turns in the alternating slot. A block with
 * `circuit` runs one set of each exercise in turn, round after round.
 *
 * An exercise is described by what you have to do, not by a display string:
 *   mode     'reps' | 'time' | 'none'
 *   sets     how many rounds
 *   min/max  reps per set, or seconds per set (min === max means a fixed target)
 *   perSide  the target applies to each side; sideWord picks "side", "leg" or "arm"
 *   rest     seconds of rest after each set (0 = flow straight on)
 *
 * Everything the UI prints — "6–12/leg × 3" — is computed from those fields, so
 * editing a target in Settings can never leave the printed target lying.
 */
(function (global) {
  'use strict';

  var WARMUP = { id: 'warmup', name: 'Warm-up', mode: 'time', sets: 1, min: 180, max: 180, rest: 0 };
  var COOLDOWN = { id: 'cooldown', name: 'Cooldown', mode: 'time', sets: 1, min: 180, max: 180, rest: 0 };

  var DEFAULT_ROUTINE = {
    version: 1,
    workouts: [
      {
        id: 'calA',
        name: 'Calisthenics A',
        kind: 'strength',
        rotate: true,
        blocks: [
          {
            name: '',
            items: [
              Object.assign({}, WARMUP),
              { id: 'pushups', name: 'Push-ups', mode: 'reps', sets: 3, min: 8, max: 15, rest: 60 },
              { id: 'table-rows', name: 'Table rows', mode: 'reps', sets: 3, min: 6, max: 12, rest: 60 },
              { id: 'squats', name: 'Bodyweight squats', mode: 'reps', sets: 3, min: 12, max: 20, rest: 60 },
              { id: 'reverse-lunges', name: 'Reverse lunges', mode: 'reps', sets: 3, min: 6, max: 12, perSide: true, sideWord: 'leg', rest: 60 },
              { id: 'plank', name: 'Plank', mode: 'time', sets: 3, min: 20, max: 40, rest: 45 },
              Object.assign({}, COOLDOWN)
            ]
          }
        ]
      },
      {
        id: 'calB',
        name: 'Calisthenics B',
        kind: 'strength',
        rotate: true,
        blocks: [
          {
            name: '',
            items: [
              Object.assign({}, WARMUP),
              { id: 'pike-pushups', name: 'Pike push-ups', mode: 'reps', sets: 3, min: 6, max: 12, rest: 60 },
              { id: 'prone-ytw', name: 'Prone Y-T-W', mode: 'reps', sets: 3, min: 8, max: 12, rest: 45 },
              { id: 'glute-bridges', name: 'Glute bridges', mode: 'reps', sets: 3, min: 8, max: 15, rest: 60 },
              { id: 'split-squats', name: 'Split squats', mode: 'reps', sets: 3, min: 6, max: 10, perSide: true, sideWord: 'leg', rest: 60 },
              { id: 'bird-dogs', name: 'Bird-dogs', mode: 'reps', sets: 3, min: 6, max: 12, perSide: true, sideWord: 'side', rest: 60 },
              Object.assign({}, COOLDOWN)
            ]
          }
        ]
      },
      {
        id: 'upper',
        name: 'Upper body',
        kind: 'strength',
        blocks: [
          {
            name: '',
            items: [
              Object.assign({}, WARMUP),
              { id: 'pushups', name: 'Push-ups', mode: 'reps', sets: 3, min: 8, max: 15, rest: 60 },
              { id: 'table-rows', name: 'Table rows', mode: 'reps', sets: 3, min: 6, max: 12, rest: 60 },
              { id: 'pike-pushups', name: 'Pike push-ups', mode: 'reps', sets: 3, min: 6, max: 10, rest: 60 },
              { id: 'chair-dips', name: 'Chair dips', mode: 'reps', sets: 3, min: 6, max: 12, rest: 60 },
              { id: 'shoulder-taps', name: 'Plank shoulder taps', mode: 'reps', sets: 2, min: 10, max: 16, perSide: true, sideWord: 'side', rest: 45 },
              Object.assign({}, COOLDOWN)
            ]
          }
        ]
      },
      {
        id: 'lower',
        name: 'Lower body',
        kind: 'strength',
        blocks: [
          {
            name: '',
            items: [
              Object.assign({}, WARMUP),
              { id: 'bulgarian-split-squats', name: 'Bulgarian split squats', mode: 'reps', sets: 3, min: 6, max: 10, perSide: true, sideWord: 'leg', rest: 60 },
              { id: 'single-leg-bridges', name: 'Single-leg glute bridges', mode: 'reps', sets: 3, min: 8, max: 12, perSide: true, sideWord: 'leg', rest: 45 },
              { id: 'towel-leg-curls', name: 'Sliding towel leg curls', mode: 'reps', sets: 3, min: 6, max: 10, rest: 60 },
              { id: 'step-ups', name: 'Step-ups', mode: 'reps', sets: 3, min: 8, max: 12, perSide: true, sideWord: 'leg', rest: 60 },
              { id: 'wall-sit', name: 'Wall sit', mode: 'time', sets: 2, min: 30, max: 60, rest: 60 },
              { id: 'calf-raises', name: 'Single-leg calf raises', mode: 'reps', sets: 2, min: 10, max: 15, perSide: true, sideWord: 'leg', rest: 30 },
              Object.assign({}, COOLDOWN)
            ]
          }
        ]
      },
      {
        id: 'core',
        name: 'Core',
        kind: 'strength',
        blocks: [
          {
            name: '',
            items: [
              { id: 'dead-bugs', name: 'Dead bugs', mode: 'reps', sets: 3, min: 6, max: 10, perSide: true, sideWord: 'side', rest: 30 },
              { id: 'hollow-hold', name: 'Hollow hold', mode: 'time', sets: 3, min: 15, max: 30, rest: 30 },
              { id: 'side-plank', name: 'Side plank', mode: 'time', sets: 2, min: 20, max: 40, perSide: true, sideWord: 'side', rest: 30 },
              { id: 'reverse-crunch', name: 'Reverse crunches', mode: 'reps', sets: 3, min: 8, max: 12, rest: 30 },
              { id: 'bird-dogs', name: 'Bird-dogs', mode: 'reps', sets: 2, min: 6, max: 12, perSide: true, sideWord: 'side', rest: 30 }
            ]
          }
        ]
      },
      /* The next step once A and B's ranges have been raised a few times. */
      {
        id: 'calC',
        name: 'Calisthenics C',
        kind: 'strength',
        blocks: [
          {
            name: '',
            items: [
              Object.assign({}, WARMUP),
              { id: 'archer-pushups', name: 'Archer push-ups', mode: 'reps', sets: 3, min: 4, max: 8, perSide: true, sideWord: 'side', rest: 90 },
              { id: 'box-pistols', name: 'Box pistol squats', mode: 'reps', sets: 3, min: 4, max: 8, perSide: true, sideWord: 'leg', rest: 90 },
              { id: 'planche-lean', name: 'Pseudo-planche lean', mode: 'time', sets: 3, min: 15, max: 30, rest: 60 },
              { id: 'nordic-negatives', name: 'Nordic curl negatives', mode: 'reps', sets: 3, min: 3, max: 6, rest: 90 },
              { id: 'tuck-l-sit', name: 'Tuck L-sit', mode: 'time', sets: 3, min: 10, max: 20, rest: 60 },
              Object.assign({}, COOLDOWN)
            ]
          }
        ]
      },
      /* Retired: no longer offered, but kept (archived) so days already
       * logged with it still read right, and so an edited routine that
       * still has it is archived too rather than added back. */
      {
        id: 'bar',
        name: 'Pull-up bar',
        kind: 'strength',
        archived: true,
        blocks: [
          {
            name: '',
            items: [
              Object.assign({}, WARMUP),
              { id: 'dead-hang', name: 'Dead hang', mode: 'time', sets: 3, min: 20, max: 40, rest: 60 },
              { id: 'scapular-pulls', name: 'Scapular pulls', mode: 'reps', sets: 3, min: 6, max: 10, rest: 60 },
              { id: 'pullup-negatives', name: 'Pull-up negatives', mode: 'reps', sets: 3, min: 3, max: 5, rest: 90 },
              { id: 'chin-ups', name: 'Chin-ups', mode: 'reps', sets: 3, min: 3, max: 8, rest: 90 },
              { id: 'hanging-knee-raises', name: 'Hanging knee raises', mode: 'reps', sets: 3, min: 8, max: 12, rest: 60 },
              Object.assign({}, COOLDOWN)
            ]
          }
        ]
      },
      /* A circuit: one round is forty seconds of each, and there are two. Its
       * exercises are timed, so they're kept apart from the rep-counted
       * push-ups and squats elsewhere — one chart can't mix seconds and reps. */
      {
        id: 'express',
        name: 'Express 15',
        kind: 'strength',
        blocks: [
          {
            name: 'Circuit',
            circuit: true,
            items: [
              { id: 'express-squats', name: 'Squats', mode: 'time', sets: 2, min: 40, max: 40, rest: 20 },
              { id: 'express-pushups', name: 'Push-ups', mode: 'time', sets: 2, min: 40, max: 40, rest: 20 },
              { id: 'express-lunges', name: 'Alternating lunges', mode: 'time', sets: 2, min: 40, max: 40, rest: 20 },
              { id: 'mountain-climbers', name: 'Mountain climbers', mode: 'time', sets: 2, min: 40, max: 40, rest: 20 },
              { id: 'express-plank', name: 'Plank', mode: 'time', sets: 2, min: 40, max: 40, rest: 20 }
            ]
          }
        ]
      },
      {
        id: 'flex',
        name: 'Flexibility',
        kind: 'mobility',
        blocks: [
          { name: '', items: [Object.assign({}, WARMUP)] },
          {
            name: 'Hips',
            items: [
              { id: 'hip-switches', name: '90/90 hip switches', mode: 'reps', sets: 1, min: 8, max: 8, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'hip-flexor', name: 'Hip-flexor stretch', mode: 'time', sets: 1, min: 30, max: 45, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'adductor-rock-backs', name: 'Adductor rock-backs', mode: 'reps', sets: 1, min: 8, max: 10, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'straddle', name: 'Straddle/butterfly', mode: 'time', sets: 1, min: 30, max: 45, rest: 0 }
            ]
          },
          {
            name: 'Ankles',
            items: [
              { id: 'knee-to-wall-rocks', name: 'Knee-to-wall rocks', mode: 'reps', sets: 1, min: 10, max: 10, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'knee-to-wall-hold', name: 'Knee-to-wall hold', mode: 'time', sets: 1, min: 30, max: 30, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'calf-stretch', name: 'Calf stretch', mode: 'time', sets: 1, min: 30, max: 30, perSide: true, sideWord: 'side', rest: 0 }
            ]
          },
          {
            name: 'Back',
            items: [
              { id: 'cat-cow', name: 'Cat-cow', mode: 'reps', sets: 1, min: 8, max: 10, rest: 0 },
              { id: 'open-book', name: 'Open-book rotations', mode: 'reps', sets: 1, min: 6, max: 8, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'childs-pose', name: 'Child’s-pose/lat stretch', mode: 'time', sets: 1, min: 30, max: 45, rest: 0 },
              { id: 'focus-stretch', name: 'Focus stretch', mode: 'time', sets: 1, min: 120, max: 120, rest: 0 }
            ]
          }
        ]
      },
      /* A physio's neck-and-shoulder programme: chin tucks and band work
       * lying down, then posture work sitting and standing. Slow, controlled
       * reps, with a short pause between sets. */
      {
        id: 'neck',
        name: 'Neck & shoulders',
        kind: 'mobility',
        blocks: [
          {
            name: 'On your back',
            items: [
              { id: 'cervical-retraction', name: 'Supine cervical retraction with towel', mode: 'reps', sets: 1, min: 10, max: 10, rest: 0 },
              { id: 'horizontal-abduction', name: 'Supine horizontal abduction with chin tuck', mode: 'reps', sets: 2, min: 10, max: 10, rest: 20 },
              { id: 'supine-external-rotation', name: 'Supine shoulder external rotation with resistance', mode: 'reps', sets: 2, min: 10, max: 10, rest: 20 },
              { id: 'pnf-d2-flexion', name: 'Supine PNF D2 flexion with resistance', mode: 'reps', sets: 2, min: 10, max: 10, perSide: true, sideWord: 'arm', rest: 20 }
            ]
          },
          {
            name: 'Sitting and standing',
            items: [
              { id: 'thoracic-extension', name: 'Seated thoracic lumbar extension', mode: 'reps', sets: 1, min: 10, max: 10, rest: 0 },
              { id: 'scaption', name: 'Scaption with dumbbells', mode: 'reps', sets: 2, min: 10, max: 10, rest: 20 },
              { id: 'row-head-turn', name: 'Single arm row with opposite head turn', mode: 'reps', sets: 2, min: 10, max: 10, perSide: true, sideWord: 'arm', rest: 20 },
              { id: 'touchdowns', name: 'Touchdowns', mode: 'reps', sets: 2, min: 10, max: 10, rest: 20 }
            ]
          }
        ]
      },
      /* The backs of the legs and the hips, for anyone who sits all day. */
      {
        id: 'hips',
        name: 'Hips & hamstrings',
        kind: 'mobility',
        blocks: [
          { name: '', items: [Object.assign({}, WARMUP)] },
          {
            name: 'Front and back',
            items: [
              { id: 'hip-flexor', name: 'Hip-flexor stretch', mode: 'time', sets: 1, min: 30, max: 45, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'half-splits', name: 'Half splits', mode: 'time', sets: 1, min: 30, max: 45, perSide: true, sideWord: 'leg', rest: 0 },
              { id: 'seated-fold', name: 'Seated forward fold', mode: 'time', sets: 1, min: 45, max: 60, rest: 0 }
            ]
          },
          {
            name: 'Out and around',
            items: [
              { id: 'adductor-rock-backs', name: 'Adductor rock-backs', mode: 'reps', sets: 1, min: 8, max: 10, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'pigeon', name: 'Pigeon pose', mode: 'time', sets: 1, min: 45, max: 60, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'straddle', name: 'Straddle/butterfly', mode: 'time', sets: 1, min: 30, max: 45, rest: 0 },
              { id: 'malasana', name: 'Deep squat (malasana)', mode: 'time', sets: 1, min: 30, max: 45, rest: 0 }
            ]
          }
        ]
      },
      /* Ten minutes for the desk-bound: neck, upper back and hips, mostly
       * standing, no mat needed. */
      {
        id: 'desk',
        name: 'Desk reset',
        kind: 'mobility',
        blocks: [
          {
            name: '',
            items: [
              { id: 'neck-circles', name: 'Neck half-circles', mode: 'reps', sets: 1, min: 5, max: 5, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'shoulder-rolls', name: 'Shoulder rolls', mode: 'reps', sets: 1, min: 10, max: 10, rest: 0 },
              { id: 'thoracic-extension', name: 'Seated thoracic lumbar extension', mode: 'reps', sets: 1, min: 10, max: 10, rest: 0 },
              { id: 'touchdowns', name: 'Touchdowns', mode: 'reps', sets: 1, min: 10, max: 10, rest: 0 },
              { id: 'reach-side-bend', name: 'Overhead reach and side bend', mode: 'reps', sets: 1, min: 5, max: 5, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'hip-flexor', name: 'Hip-flexor stretch', mode: 'time', sets: 1, min: 30, max: 30, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'ragdoll', name: 'Ragdoll forward fold', mode: 'time', sets: 1, min: 30, max: 45, rest: 0 }
            ]
          }
        ]
      },
      /* Slow floor stretches to wind down before bed: long holds, nothing
       * that wakes you up. */
      {
        id: 'evening',
        name: 'Evening wind-down',
        kind: 'mobility',
        blocks: [
          {
            name: '',
            items: [
              { id: 'cat-cow', name: 'Cat-cow', mode: 'reps', sets: 1, min: 6, max: 8, rest: 0 },
              { id: 'thread-needle', name: 'Thread the needle', mode: 'time', sets: 1, min: 30, max: 45, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'childs-pose', name: 'Child’s-pose/lat stretch', mode: 'time', sets: 1, min: 45, max: 60, rest: 0 },
              { id: 'seated-twist', name: 'Seated spinal twist', mode: 'time', sets: 1, min: 30, max: 45, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'butterfly-fold', name: 'Butterfly fold', mode: 'time', sets: 1, min: 45, max: 60, rest: 0 },
              { id: 'happy-baby', name: 'Happy baby', mode: 'time', sets: 1, min: 45, max: 60, rest: 0 }
            ]
          }
        ]
      },
      /* About eight minutes and no warm-up: the gentle moves are the warm-up.
       * Half of it standing, half on a mat. A habit: offered every day, ticked
       * off, but never counted toward the weekly goals, or a week of
       * eight-minute stretches would stand in for the real sessions. */
      {
        id: 'morning',
        name: 'Morning stretch',
        kind: 'habit',
        blocks: [
          {
            name: 'Standing',
            items: [
              { id: 'neck-circles', name: 'Neck half-circles', mode: 'reps', sets: 1, min: 5, max: 5, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'shoulder-rolls', name: 'Shoulder rolls', mode: 'reps', sets: 1, min: 10, max: 10, rest: 0 },
              { id: 'reach-side-bend', name: 'Overhead reach and side bend', mode: 'reps', sets: 1, min: 5, max: 5, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'hip-circles', name: 'Hip circles', mode: 'reps', sets: 1, min: 8, max: 8, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'ragdoll', name: 'Ragdoll forward fold', mode: 'time', sets: 1, min: 30, max: 45, rest: 0 }
            ]
          },
          {
            name: 'On the mat',
            items: [
              { id: 'cat-cow', name: 'Cat-cow', mode: 'reps', sets: 1, min: 8, max: 10, rest: 0 },
              { id: 'worlds-greatest', name: 'World’s greatest stretch', mode: 'reps', sets: 1, min: 4, max: 4, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'hip-flexor', name: 'Hip-flexor stretch', mode: 'time', sets: 1, min: 30, max: 30, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'childs-pose', name: 'Child’s-pose/lat stretch', mode: 'time', sets: 1, min: 30, max: 45, rest: 0 }
            ]
          }
        ]
      },
      /* Not on the suggested week — pick it from Today, or put it on a day in
       * Plan. Hips, folds, twists and arches: the range that makes the more
       * ambitious pages of the Kama Sutra feel less like a dare. */
      {
        id: 'kama',
        name: 'Kama Stretcha 🌶',
        kind: 'mobility',
        blocks: [
          { name: '', items: [Object.assign({}, WARMUP)] },
          {
            name: 'Open the hips',
            items: [
              { id: 'frog', name: 'Frog stretch', mode: 'time', sets: 1, min: 45, max: 60, rest: 0 },
              { id: 'pigeon', name: 'Pigeon pose', mode: 'time', sets: 1, min: 45, max: 60, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'happy-baby', name: 'Happy baby', mode: 'time', sets: 1, min: 45, max: 60, rest: 0 },
              { id: 'malasana', name: 'Deep squat (malasana)', mode: 'time', sets: 1, min: 45, max: 60, rest: 0 },
              { id: 'hip-switches', name: '90/90 hip switches', mode: 'reps', sets: 1, min: 8, max: 8, perSide: true, sideWord: 'side', rest: 0 }
            ]
          },
          {
            name: 'Fold in half',
            items: [
              { id: 'seated-fold', name: 'Seated forward fold', mode: 'time', sets: 1, min: 45, max: 60, rest: 0 },
              { id: 'butterfly-fold', name: 'Butterfly fold', mode: 'time', sets: 1, min: 45, max: 60, rest: 0 },
              { id: 'straddle-fold', name: 'Wide-leg straddle fold', mode: 'time', sets: 1, min: 45, max: 60, rest: 0 },
              { id: 'half-splits', name: 'Half splits', mode: 'time', sets: 1, min: 30, max: 45, perSide: true, sideWord: 'leg', rest: 0 }
            ]
          },
          {
            name: 'The human pretzel',
            items: [
              { id: 'seated-twist', name: 'Seated spinal twist', mode: 'time', sets: 1, min: 30, max: 30, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'half-lotus', name: 'Figure-4 to half lotus', mode: 'time', sets: 1, min: 30, max: 45, perSide: true, sideWord: 'side', rest: 0 },
              { id: 'thread-needle', name: 'Thread the needle', mode: 'time', sets: 1, min: 30, max: 30, perSide: true, sideWord: 'side', rest: 0 }
            ]
          },
          {
            name: 'Arch and invert',
            items: [
              { id: 'cobra', name: 'Cobra to upward dog', mode: 'time', sets: 2, min: 20, max: 30, rest: 10 },
              { id: 'camel', name: 'Camel pose', mode: 'time', sets: 2, min: 20, max: 30, rest: 15 },
              { id: 'plow', name: 'Plow pose', mode: 'time', sets: 1, min: 30, max: 30, rest: 0 }
            ]
          },
          {
            name: 'Pelvic floor',
            items: [
              { id: 'pelvic-floor', name: 'Pelvic-floor squeezes', mode: 'reps', sets: 2, min: 10, max: 10, rest: 30 },
              Object.assign({}, COOLDOWN)
            ]
          }
        ]
      },
      {
        id: 'rest',
        name: 'Rest',
        kind: 'rest',
        blocks: [
          { name: '', items: [{ id: 'recovery', name: 'Recovery', mode: 'none', sets: 1, min: 0, max: 0, rest: 0 }] }
        ]
      }
    ]
  };

  /* Mon..Sun. */
  var DAYS = [
    { key: 'mon', label: 'Mon', long: 'Monday' },
    { key: 'tue', label: 'Tue', long: 'Tuesday' },
    { key: 'wed', label: 'Wed', long: 'Wednesday' },
    { key: 'thu', label: 'Thu', long: 'Thursday' },
    { key: 'fri', label: 'Fri', long: 'Friday' },
    { key: 'sat', label: 'Sat', long: 'Saturday' },
    { key: 'sun', label: 'Sun', long: 'Sunday' }
  ];

  /* The suggested week: what Today offers each day. It's a suggestion, not
   * the goal — any program on any day counts toward the week. ROTATION is a
   * stand-in for "calisthenics, alternating": whichever rotating program you
   * did least recently (see store.js). Habits aren't on it; they're every
   * day by definition. An empty day is a rest day. */
  var ROTATION = 'rotation';
  var DEFAULT_SCHEDULE = [[ROTATION], ['flex'], [ROTATION], ['flex'], [ROTATION], ['flex'], []];

  function formatSeconds(s) {
    if (s >= 60 && s % 60 === 0) return s / 60 + ' min';
    return s + ' sec';
  }

  /* "8–15", "20–40 sec", "3 min" — the amount, without side or set count. */
  function amountLabel(ex) {
    if (ex.mode === 'none') return '—';
    if (ex.mode === 'time') {
      if (ex.max > ex.min) {
        if (ex.min % 60 === 0 && ex.max % 60 === 0) return ex.min / 60 + '–' + ex.max / 60 + ' min';
        return ex.min + '–' + ex.max + ' sec';
      }
      return formatSeconds(ex.min);
    }
    return ex.max > ex.min ? ex.min + '–' + ex.max : String(ex.min);
  }

  /* The full target as it appears in the table: "6–12/leg × 3". */
  function targetLabel(ex) {
    if (ex.mode === 'none') return '—';
    var t = amountLabel(ex);
    if (ex.perSide) t += '/' + (ex.sideWord || 'side');
    if (ex.sets > 1) t += ' × ' + ex.sets;
    return t;
  }

  /* A stretch counts down from the top of its range: holding longer is free.
   * A strength hold counts down from the bottom, because a dial reading "18
   * seconds left" while your hips are already sagging is an invitation to
   * grind past the point the hold stops being worth doing. */
  function timerSeconds(ex, kind) {
    if (kind === 'strength') return ex.min || ex.max || 0;
    return ex.max || ex.min || 0;
  }

  function unitLabel(ex) {
    return ex.mode === 'time' ? 'sec' : 'reps';
  }

  function flatten(workout) {
    var out = [];
    (workout.blocks || []).forEach(function (block, b) {
      (block.items || []).forEach(function (ex, i) {
        out.push({ ex: ex, block: block.name || '', blockIndex: b, circuit: !!block.circuit, firstOfBlock: i === 0 });
      });
    });
    return out;
  }

  function findWorkout(routine, id) {
    var list = (routine && routine.workouts) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function findExercise(routine, exId) {
    var list = (routine && routine.workouts) || [];
    for (var i = 0; i < list.length; i++) {
      var blocks = list[i].blocks || [];
      for (var b = 0; b < blocks.length; b++) {
        var items = blocks[b].items || [];
        for (var j = 0; j < items.length; j++) {
          if (items[j].id === exId) return { workout: list[i], block: blocks[b], ex: items[j] };
        }
      }
    }
    return null;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  global.CadenceRoutine = {
    DEFAULT_ROUTINE: DEFAULT_ROUTINE,
    DAYS: DAYS,
    ROTATION: ROTATION,
    DEFAULT_SCHEDULE: DEFAULT_SCHEDULE,
    defaultSchedule: function () { return clone(DEFAULT_SCHEDULE); },
    defaultRoutine: function () { return clone(DEFAULT_ROUTINE); },
    amountLabel: amountLabel,
    targetLabel: targetLabel,
    formatSeconds: formatSeconds,
    timerSeconds: timerSeconds,
    unitLabel: unitLabel,
    flatten: flatten,
    findWorkout: findWorkout,
    findExercise: findExercise,
    clone: clone
  };
})(window);
