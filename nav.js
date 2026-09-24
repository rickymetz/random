/* random has moved to https://rickymetz.com/.
 *
 * This file used to be the hub's bottom navbar. The ideas still served here
 * (Ledger, Cadence, Container Compound) keep data in this browser, tied to
 * this address, so instead of redirecting them it shows a "moved" bar with a
 * link to the same page at the new address. Everything else redirects
 * (404.html). The bar sets --random-nav-h like the old navbar did, so bottom
 * UI that offsets by it still clears the bar.
 */
(function () {
  if (window.__randomMoved) return;
  window.__randomMoved = true;

  var NEW = 'https://rickymetz.com/';
  var rel = location.pathname.replace(/^\/random\//, '');
  var target = NEW + rel + location.search + location.hash;

  var mode = (document.querySelector('meta[name="random-nav"]') || {}).content || '';
  if (mode === 'off') return;

  function mount() {
    var bar = document.createElement('div');
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'This page has moved');
    bar.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:2147483000',
      'box-sizing:border-box', 'padding:10px 16px calc(10px + env(safe-area-inset-bottom))',
      'background:#141414', 'color:#f5f3ee', 'font:14px/1.4 system-ui,-apple-system,sans-serif',
      'display:flex', 'flex-wrap:wrap', 'gap:6px 14px', 'align-items:center', 'justify-content:center',
      'text-align:center', 'border-top:1px solid #333'
    ].join(';');
    var text = document.createElement('span');
    text.textContent = 'This moved to rickymetz.com. Anything you saved here stays at this address, so export or back it up here first, then import it there.';
    var link = document.createElement('a');
    link.href = target;
    link.textContent = 'Open the new address →';
    link.style.cssText = 'color:#f5f3ee;font-weight:700;text-decoration:underline;text-underline-offset:0.2em;padding:6px 0;';
    bar.appendChild(text);
    bar.appendChild(link);
    document.body.appendChild(bar);

    function size() {
      var h = bar.offsetHeight + 'px';
      document.documentElement.style.setProperty('--random-nav-h', h);
      if (mode !== 'overlay') spacer.style.height = h;
    }
    var spacer = document.createElement('div');
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.cssText = 'flex:none;pointer-events:none;';
    if (mode !== 'overlay') document.body.appendChild(spacer);
    size();
    window.addEventListener('resize', size);
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
