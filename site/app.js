// Bumpgate site: theme, rotor, demo timeline, step carousel, scroll reveals, data-driven proof.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // theme
  $('#theme')?.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    try { localStorage.setItem('bg-theme', next); } catch (e) { /* private mode */ }
  });

  // rotor
  const rotor = $('#rotor');
  if (rotor && !reduce) {
    const words = $$('span', rotor);
    let i = 0;
    setInterval(() => {
      const cur = words[i];
      const nxt = words[(i + 1) % words.length];
      cur.className = 'out';
      nxt.className = '';
      setTimeout(() => { cur.className = 'in'; }, 650);
      i = (i + 1) % words.length;
    }, 2400);
  }

  // copy
  const yaml = $('#yaml')?.textContent || '';
  const copy = async (btn) => {
    try { await navigator.clipboard.writeText(yaml); const t = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = t; }, 1600); }
    catch (e) { location.hash = '#install'; }
  };
  $('#copy-yaml')?.addEventListener('click', (e) => copy(e.currentTarget));
  $('#copy-hero')?.addEventListener('click', (e) => copy(e.currentTarget));

  // demo timeline
  const term = $('#term');
  const lines = [];
  const say = (html) => { lines.push(html); term.innerHTML = lines.slice(-6).join('<br>'); };
  const timers = [];
  let t0 = 0;
  function reset() {
    timers.splice(0).forEach(clearTimeout);
    lines.length = 0;
    term.innerHTML = '';
    $$('.check').forEach((c) => c.classList.remove('on'));
    $$('.cell').forEach((c) => c.classList.remove('on'));
    $('#gate-ic').className = 'ic run'; $('#gate-ic').textContent = '';
    $('#gate-st').textContent = 'replaying 3 journeys…';
    $('#pr-state').className = 'state'; $('#pr-state').textContent = '● Open';
    $('#cm-title').className = 'cm-title'; $('#cm-title').textContent = 'Kane is checking this bump';
    $('#fix').classList.remove('on');
    const h1 = $('[data-k="h1"]');
    h1.querySelector('i').className = 'light r';
    h1.querySelector('em').textContent = 'broke · step 3';
    $('#rule-line').innerHTML = '<b>The rule (code, not a prompt):</b> every journey that passes on main must pass on the bump.';
  }
  const at = (s, fn) => timers.push(setTimeout(fn, s * 1000));
  function play() {
    reset();
    t0 = performance.now();
    $$('.check').forEach((c) => at(Number(c.dataset.at), () => c.classList.add('on')));
    at(1.6, () => say('<span class="y">▸</span> Building main and the bump <span class="d">(npm ci · vite build)</span>'));
    at(2.6, () => say('<span class="y">▸</span> Kane on main · <span class="d">localhost:4319</span>'));
    ['b0', 'b1', 'b2'].forEach((k, i) => at(3.0 + i * 0.45, () => $(`[data-k="${k}"]`).classList.add('on')));
    at(4.4, () => say('<span class="g">✓</span> main · 3/3 journeys passed'));
    at(4.9, () => say('<span class="y">▸</span> Kane on the bump'));
    at(5.4, () => $('[data-k="h0"]').classList.add('on'));
    at(6.0, () => { $('[data-k="h1"]').classList.add('on'); say('<span class="r">✗</span> "See the errors": clicking Place order shows no messages'); });
    at(6.5, () => $('[data-k="h2"]').classList.add('on'));
    at(7.0, () => say('<span class="r">console</span> <span class="d">TypeError: Cannot read properties of undefined (reading \'forEach\')</span>'));
    at(7.8, () => {
      $('#cm-title').className = 'cm-title red'; $('#cm-title').textContent = '🔴 Blocked: the app broke on this bump';
      $('#gate-ic').className = 'ic bad'; $('#gate-ic').textContent = '✕'; $('#gate-st').textContent = '1 journey broke';
      $('#pr-state').className = 'state blocked'; $('#pr-state').textContent = '● Merge blocked';
      $('#rule-line').innerHTML = '<b>The rule:</b> every journey that passes on main must pass on the bump → <b style="color:var(--red)">❌ 1 broke. Merge blocked.</b>';
    });
    at(9.0, () => { $('#fix').classList.add('on'); say('<span class="y">▸</span> Claude Code, attempt 1/3: Kane\'s evidence + zod 4 release notes'); });
    at(10.6, () => say('<span class="g">✓</span> guardrails: .kane/ untouched, zod kept at 4.6.7'));
    at(11.3, () => { say('<span class="y">▸</span> Kane re-runs all 3 journeys on the migrated code'); $('#gate-ic').className = 'ic run'; $('#gate-ic').textContent = ''; $('#gate-st').textContent = 're-verifying…'; });
    at(12.6, () => {
      const h1 = $('[data-k="h1"]');
      h1.querySelector('i').className = 'light g';
      h1.querySelector('em').textContent = 'passed after fix';
      say('<span class="g">✓</span> 3/3 pass · committed "Migrate to zod 4.6.7 (verified by Kane CLI)"');
    });
    at(13.4, () => {
      $('#cm-title').className = 'cm-title green'; $('#cm-title').textContent = '🟢 Fixed and re-verified';
      $('#gate-ic').className = 'ic ok'; $('#gate-ic').textContent = '✓'; $('#gate-st').textContent = 'passed after fix';
      $('#pr-state').className = 'state merged'; $('#pr-state').textContent = '✓ Merged';
      $('#rule-line').innerHTML = '<b>The rule:</b> every journey that passes on main must pass on the bump → <b style="color:var(--green)">✅ 3/3 still pass. Auto-merged.</b>';
      say('<span class="g">🟢 merged</span> <span class="d">no human needed; the comment keeps the evidence</span>');
    });
  }
  const clock = $('#clock');
  setInterval(() => {
    if (!t0) return;
    const s = Math.min(99, Math.floor((performance.now() - t0) / 1000));
    clock.textContent = `00:${String(s).padStart(2, '0')}`;
  }, 250);
  $('#play')?.addEventListener('click', play);
  const demo = $('#demo');
  if (demo) {
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { play(); io.disconnect(); }
    }, { threshold: 0.25 });
    io.observe(demo);
  }

  // steps carousel
  const steps = $$('#steps .step');
  let si = 0;
  let auto = null;
  function show(i) {
    si = i;
    steps.forEach((s, j) => s.classList.toggle('on', j === i));
    $('#step-of').textContent = `0${i + 1} / 0${steps.length}`;
    $('#step-bar').style.width = `${((i + 1) / steps.length) * 100}%`;
    $('#step-name').textContent = steps[i].dataset.name;
  }
  steps.forEach((s, i) => s.addEventListener('click', () => { clearInterval(auto); show(i); }));
  if (!reduce && steps.length) auto = setInterval(() => show((si + 1) % steps.length), 3200);

  // reveals
  const rio = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('seen'); rio.unobserve(e.target); } }), { threshold: 0.12 });
  $$('.reveal').forEach((el) => rio.observe(el));

  // data
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  fetch('data.json', { cache: 'no-store' }).then((r) => r.json()).then(render).catch(() => {});

  function render(d) {
    const rv = $('#reverts');
    if (rv && d.reverts) {
      rv.innerHTML = d.reverts.map((r) => `
        <a class="revert" href="${esc(r.revert_url || r.pr_url)}" target="_blank" rel="noopener">
          <span class="x">REVERTED</span>
          <span><span class="t">${esc(r.repo)} · ${esc(r.title)}</span>
          <span class="m">CI on the bot PR: ${esc(r.ci)} · merged ${esc(r.merged)} · reverted ${esc(r.reverted)}</span></span>
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
    if (cs && d.cases) {
      cs.innerHTML = d.cases.map((c) => `
        <div class="case reveal seen">
          <h4>${esc(c.title)}</h4>
          <div class="src">${esc(c.source)}</div>
          <div class="lab">Bump</div><div class="row"><span>⬆</span><span>${esc(c.bump)}</span></div>
          <div class="lab">CI</div><div class="row"><span class="ok">✓</span><span>${esc(c.ci)}</span></div>
          <div class="lab">Kane</div><div class="row"><span class="${c.kaneClass || 'bad'}">${c.kaneClass === 'ok' ? '✓' : c.kaneClass === 'y' ? '…' : '✗'}</span><span>${esc(c.kane)}</span></div>
          ${c.fix ? `<div class="lab">Fix</div><div class="row"><span class="ok">✓</span><span>${esc(c.fix)}</span></div>` : ''}
          ${c.links?.length ? `<div class="row" style="margin-top:14px"><span>↗</span><span>${c.links.map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(' · ')}</span></div>` : ''}
        </div>`).join('');
    }
  }
})();
