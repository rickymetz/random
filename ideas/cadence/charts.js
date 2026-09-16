/* Cadence — the progress chart.
 *
 * One exercise, one series, over time: a trend, so it is a line. A single
 * series needs no legend (the card's title names it), so identity costs
 * nothing and the only colour in the plot is the accent. The target range
 * rides underneath as a wash, because "did I stay in 8–15" is the actual
 * question. Values are never hover-only — the endpoint is labelled, the axis
 * carries the rest, and the card below the chart holds the full table.
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  function niceStep(span, targetTicks) {
    var raw = span / Math.max(1, targetTicks);
    var mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    var norm = raw / mag;
    var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return Math.max(1, step * mag);
  }

  function ticksFor(min, max) {
    var step = niceStep(max - min || 1, 4);
    var start = Math.floor(min / step) * step;
    var out = [];
    for (var v = start; v <= max + step / 2; v += step) if (v >= min - 0.001) out.push(Math.round(v * 100) / 100);
    return out;
  }

  /* points: [{ date: Date, value: Number, label: String, detail: String }] */
  function lineChart(container, opts) {
    var points = opts.points || [];
    var band = opts.band || null;
    var format = opts.format || function (v) { return String(v); };

    container.innerHTML = '';
    if (!points.length) {
      var empty = document.createElement('p');
      empty.className = 'chart-empty';
      empty.textContent = opts.emptyText || 'Nothing logged yet.';
      container.appendChild(empty);
      return;
    }

    var wrap = document.createElement('div');
    wrap.className = 'chart-wrap';
    container.appendChild(wrap);

    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    // Mutating aria-label on a static role="img" is not re-announced, so the
    // keyboard walk through the points was silent. This is.
    tip.setAttribute('role', 'status');
    tip.hidden = true;
    wrap.appendChild(tip);

    var active = -1;
    var svg, geom;

    function draw() {
      var width = Math.max(260, wrap.clientWidth || container.clientWidth || 320);
      var height = opts.height || 220;
      var values = points.map(function (p) { return p.value; });

      // The end label is the only direct label, so the right gutter is sized to
      // hold it rather than left to crop it.
      var endText = format(values[values.length - 1], true);
      var pad = { top: 18, right: Math.max(24, endText.length * 8 + 14), bottom: 30, left: 38 };
      var plotW = width - pad.left - pad.right;
      var plotH = height - pad.top - pad.bottom;

      var lo = Math.min.apply(null, values);
      var hi = Math.max.apply(null, values);
      if (band) { lo = Math.min(lo, band.min); hi = Math.max(hi, band.max); }
      var padY = (hi - lo) * 0.15 || Math.max(1, hi * 0.1);
      var yMin = Math.max(0, Math.floor(lo - padY));
      var yMax = Math.ceil(hi + padY);
      if (yMax === yMin) yMax = yMin + 1;

      var ticks = ticksFor(yMin, yMax);
      yMax = Math.max(yMax, ticks[ticks.length - 1]);

      var n = points.length;
      function x(i) { return n === 1 ? pad.left + plotW / 2 : pad.left + (plotW * i) / (n - 1); }
      function y(v) { return pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH; }
      geom = { x: x, y: y, pad: pad, plotW: plotW, plotH: plotH, height: height };

      svg = el('svg', {
        width: width, height: height, viewBox: '0 0 ' + width + ' ' + height,
        role: 'img', tabindex: '0', class: 'chart-svg',
        'aria-label': opts.ariaLabel || 'Progress over time'
      });

      // Target range: a wash, so a point sitting inside it reads at a glance.
      if (band) {
        var bandTop = y(band.max);
        var bandBottom = y(band.min);
        svg.appendChild(el('rect', {
          x: pad.left, y: bandTop, width: plotW, height: Math.max(2, bandBottom - bandTop),
          class: 'chart-band'
        }));
        // A 12%-opacity wash is about 1.1:1 against the card — not a boundary
        // anyone can see. The edges carry it.
        svg.appendChild(el('line', { x1: pad.left, x2: pad.left + plotW, y1: bandTop, y2: bandTop, class: 'chart-band-edge' }));
        svg.appendChild(el('line', { x1: pad.left, x2: pad.left + plotW, y1: bandBottom, y2: bandBottom, class: 'chart-band-edge' }));
      }

      ticks.forEach(function (t) {
        svg.appendChild(el('line', { x1: pad.left, x2: pad.left + plotW, y1: y(t), y2: y(t), class: 'chart-grid' }));
        var label = el('text', { x: pad.left - 8, y: y(t) + 4, class: 'chart-axis', 'text-anchor': 'end' });
        label.textContent = format(t, true);
        svg.appendChild(label);
      });

      // x labels: first, last, and the middle one if there is room.
      var xIdx = n === 1 ? [0] : n < 4 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1];
      xIdx.forEach(function (i) {
        var t = el('text', {
          x: x(i), y: pad.top + plotH + 20, class: 'chart-axis',
          'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'
        });
        t.textContent = points[i].label;
        svg.appendChild(t);
      });

      if (n > 1) {
        var d = points.map(function (p, i) { return (i ? 'L' : 'M') + x(i) + ' ' + y(p.value); }).join(' ');
        svg.appendChild(el('path', { d: d, class: 'chart-line', fill: 'none' }));
      }

      var crosshair = el('line', { class: 'chart-crosshair', y1: pad.top, y2: pad.top + plotH, x1: 0, x2: 0 });
      crosshair.style.display = 'none';
      svg.appendChild(crosshair);

      points.forEach(function (p, i) {
        svg.appendChild(el('circle', { cx: x(i), cy: y(p.value), r: 5, class: 'chart-dot' }));
      });

      // The last value is the one the reader came for, so it is the only
      // direct label; the axis and the table carry everything else.
      var last = points[n - 1];
      var endLabel = el('text', { x: x(n - 1) + 9, y: y(last.value) + 4, class: 'chart-endlabel' });
      endLabel.textContent = endText;
      svg.appendChild(endLabel);

      var hit = el('rect', { x: 0, y: 0, width: width, height: height, fill: 'transparent', class: 'chart-hit' });
      svg.appendChild(hit);

      wrap.appendChild(svg);
      svg.__crosshair = crosshair;
      svg.__dots = Array.prototype.slice.call(svg.querySelectorAll('.chart-dot'));
      if (active >= 0) highlight(active);
    }

    function highlight(i) {
      if (!svg) return;
      active = i;
      svg.__dots.forEach(function (dot, j) { dot.classList.toggle('is-active', j === i); });
      if (i < 0) {
        svg.__crosshair.style.display = 'none';
        tip.hidden = true;
        return;
      }
      var p = points[i];
      var px = geom.x(i);
      svg.__crosshair.setAttribute('x1', px);
      svg.__crosshair.setAttribute('x2', px);
      svg.__crosshair.style.display = '';
      tip.innerHTML = '';
      var strong = document.createElement('strong');
      strong.textContent = format(p.value);
      var small = document.createElement('span');
      small.textContent = p.label + (p.detail ? ' · ' + p.detail : '');
      tip.appendChild(strong);
      tip.appendChild(small);
      tip.hidden = false;
      var tipW = tip.offsetWidth;
      var left = Math.min(Math.max(px - tipW / 2, 4), (svg.getAttribute('width') - tipW - 4));
      tip.style.left = left + 'px';
      tip.style.top = Math.max(0, geom.y(p.value) - tip.offsetHeight - 12) + 'px';
      svg.setAttribute('aria-label', (opts.ariaLabel || 'Progress') + '. ' + p.label + ': ' + format(p.value));
    }

    function nearest(clientX) {
      var rect = svg.getBoundingClientRect();
      var localX = clientX - rect.left;
      var best = 0;
      var bestD = Infinity;
      for (var i = 0; i < points.length; i++) {
        var d = Math.abs(geom.x(i) - localX);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    wrap.addEventListener('pointermove', function (e) {
      if (!svg) return;
      highlight(nearest(e.clientX));
    });
    wrap.addEventListener('pointerleave', function () { highlight(-1); });
    wrap.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      var next = active < 0 ? points.length - 1 : active + (e.key === 'ArrowRight' ? 1 : -1);
      highlight(Math.min(points.length - 1, Math.max(0, next)));
    });
    wrap.addEventListener('focusout', function () { highlight(-1); });

    draw();

    if (global.ResizeObserver) {
      var lastWidth = wrap.clientWidth;
      var ro = new ResizeObserver(function () {
        if (Math.abs(wrap.clientWidth - lastWidth) < 2) return;
        lastWidth = wrap.clientWidth;
        if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
        draw();
      });
      ro.observe(wrap);
    }
  }

  global.CadenceCharts = { lineChart: lineChart };
})(window);
