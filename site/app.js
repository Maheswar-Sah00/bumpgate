// Bumpgate site: theme (circular reveal), product-window timeline, reveals, data-driven proof.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;

  // nav border on scroll
  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // theme with circular reveal
  const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  $('#theme')?.addEventListener('click', (e) => {
    const next = isDark() ? 'light' : 'dark';
    const apply = () => { root.dataset.theme = next; try { localStorage.setItem('bg-theme', next); } catch (err) { /* private mode */ } };
    if (!document.startViewTransition || reduce) return apply();
    const r = e.currentTarget.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(apply).ready.then(() => {
      root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(.7,0,.2,1)', pseudoElement: '::view-transition-new(root)' });
    });
  });

  // copy
  const yaml = $('#yaml')?.textContent || '';
  const copy = async (btn) => {
    const label = btn.innerHTML;
    try { await navigator.clipboard.writeText(yaml); btn.textContent = 'Copied ✓'; setTimeout(() => { btn.innerHTML = label; }, 1600); }
    catch (err) { location.hash = '#install'; }
  };
  $('#copy-yaml')?.addEventListener('click', (e) => copy(e.currentTarget));
  $('#copy-hero')?.addEventListener('click', (e) => copy(e.currentTarget));

  // product window timeline
  const timers = [];
  const at = (s, fn) => timers.push(setTimeout(fn, s * 1000));
  const set = (sel, cls, txt) => { const el = $(sel); if (!el) return; if (cls != null) el.className = cls; if (txt != null) el.textContent = txt; };
  function reset() {
    timers.splice(0).forEach(clearTimeout);
    $$('#thread .msg, #thread .ex').forEach((m) => m.classList.remove('on'));
    $$('#thread .cell').forEach((c) => c.classList.remove('on', 'fixed'));
    const h1 = $('[data-k="h1"]');
    h1.querySelector('i').className = 'lt r'; h1.querySelector('em').textContent = 'broke · step 3';
    set('#pr-state', 'state', 'open');
    set('#side-dot', 'dot');
    set('#ex1', 'st', 'status: running');
    set('#ex3', 'st', 'status: running');
    $('#m2-text').innerHTML = 'CI says it builds. Kane is replaying 3 journeys on <b>main</b> and on <b>this bump</b>…';
    $('#m2-rule').innerHTML = '<span class="mut">rule</span> every journey that passes on main must pass on the bump';
    set('#m3-foot', null, 'auto-merge after re-verify · evidence stays on the PR');
    set('#m3-text', null, "The checkout broke, so I blocked the merge. Claude Code is migrating it from Kane's evidence…");
  }
  function finalState() {
    $$('#thread .msg, #thread .ex, #thread .cell').forEach((m) => m.classList.add('on'));
    blocked(); fixed();
  }
  function blocked() {
    set('#pr-state', 'state blocked', 'merge blocked');
    set('#side-dot', 'dot r');
    $('#m2-text').innerHTML = 'CI says it builds. <b>Kane says the checkout broke.</b> Errors never appear after “Place order”.';
    $('#m2-rule').innerHTML = '<span class="mut">rule</span> every journey that passes on main must pass on the bump → <b class="red">1 broke · blocked</b>';
  }
  function fixed() {
    const h1 = $('[data-k="h1"]');
    h1.classList.add('fixed'); h1.querySelector('i').className = 'lt g'; h1.querySelector('em').textContent = 'pass after fix';
    set('#ex1', 'st done', 'status: done');
    set('#ex3', 'st pass', 'status: 3/3 pass');
    set('#pr-state', 'state merged', 'merged');
    set('#side-dot', 'dot g');
    $('#m2-rule').innerHTML = '<span class="mut">rule</span> every journey that passes on main must pass on the bump → <b class="green">3/3 · merged</b>';
    set('#m3-foot', null, 'auto-merged · no human needed · evidence kept');
    set('#m3-text', null, "The checkout broke, so I blocked the merge. Claude Code migrated it from Kane's evidence, and Kane re-verified every journey.");
  }
  function play() {
    reset();
    $$('#thread .msg').forEach((m) => at(Number(m.dataset.at), () => m.classList.add('on')));
    ['b0', 'b1', 'b2'].forEach((k, i) => at(2.4 + i * 0.45, () => $(`[data-k="${k}"]`).classList.add('on')));
    ['h0', 'h1', 'h2'].forEach((k, i) => at(4.2 + i * 0.6, () => $(`[data-k="${k}"]`).classList.add('on')));
    at(6.2, blocked);
    $$('#thread .ex').forEach((x) => at(Number(x.dataset.at), () => x.classList.add('on')));
    at(9.0, () => set('#ex1', 'st done', 'status: done'));
    at(11.6, fixed);
  }
  $('#replay')?.addEventListener('click', () => (reduce ? finalState() : play()));
  const app = $('#app');
  if (app) {
    if (reduce) finalState();
    else {
      const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { play(); io.disconnect(); } }, { threshold: 0.3 });
      io.observe(app);
    }
  }

  // reveals
  const rio = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('seen'); rio.unobserve(e.target); } }), { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  const watch = () => $$('.reveal:not(.seen)').forEach((el) => rio.observe(el));
  watch();

  // data
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  fetch('data.json', { cache: 'no-store' }).then((r) => r.json()).then(render).catch(() => {});

  function render(d) {
    const rv = $('#reverts');
    if (rv && d.reverts) {
      rv.innerHTML = d.reverts.map((r) => `
        <a class="rv" href="${esc(r.revert_url || r.pr_url)}" target="_blank" rel="noopener">
          <span class="n">${esc(r.repo.split('/')[1] || r.repo)}</span>
          <span class="r">${esc(r.short || r.title)}<br>CI: ${esc(r.ci)}</span>
          <span class="x">REVERTED</span>
        </a>`).join('');
    }
    const st = $('#stats');
    const s = d.backtest?.summary;
    if (st) {
      const cells = s ? [
        [`${s.ciPassed}/${s.ciPassed}`, 'reverted bot bumps had passing CI'],
        [String(s.stopped), `stopped by Kane before merge${s.flagged ? ` (+${s.flagged} amber)` : ''}`],
        [`${s.falseAlarms}/${s.controls}`, 'false alarms on bumps that were never reverted'],
      ] : (d.stats || []).map((x) => [x.v, x.l]);
      st.innerHTML = cells.map(([v, l]) => `<div class="stat${v === '…' ? ' pending' : ''}"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('');
      if (!cells.length) st.remove();
    }
    if (d.proofIntro) $('#proof-intro').textContent = d.proofIntro;
    const cs = $('#cases');
    const lightLabel = { green: 'green', red: 'red → fixed', amber: 'amber', blocked: 'red · blocked' };
    if (cs && d.cases) {
      cs.innerHTML = d.cases.map((c) => `
        <div class="case reveal">
          <div class="case-h"><div><h4>${esc(c.title)}</h4><div class="src">${esc(c.source)}</div></div>
            <span class="light-tag"><i class="lt ${c.light === 'green' ? 'g' : c.light === 'amber' ? 'a' : 'r'}"></i>${esc(lightLabel[c.light] || c.light || '')}</span></div>
          <dl>
            <dt>Bump</dt><dd>${esc(c.bump)}</dd>
            <dt>CI</dt><dd>${esc(c.ci)}</dd>
            <dt>Kane</dt><dd>${esc(c.kane)}</dd>
            ${c.fix ? `<dt>Fix</dt><dd>${esc(c.fix)}</dd>` : ''}
            ${c.result ? `<dt>Merge</dt><dd>${esc(c.result)}</dd>` : ''}
          </dl>
          ${c.links?.length ? `<div class="lnk">${c.links.map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('')}</div>` : ''}
        </div>`).join('');
      watch();
    }
  }
})();
