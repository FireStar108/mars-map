'use strict';
// Интерфейс: телеметрия, кнопки приборов, журнал, результаты с графиками.
(function (PG) {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const TOOL_HINTS = {
    chemcam: 'ChemCam: кликните по цели не дальше 7 м от мачты',
    mahli: 'MAHLI: кликните по камню или грунту прямо перед ровером (до ~1.5 м от носа)',
    apxs: 'APXS: кликните по цели прямо перед ровером (до ~1.5 м) — прибор прижмётся к ней',
    drt: 'DRT: кликните по камню перед ровером — щётка снимет пыль',
    drill: 'Бур: кликните по камню или плите аргиллита перед ровером',
    nav: 'AutoNav: кликните точку на поверхности — ровер проложит путь сам',
  };

  PG.Hud = class {
    constructor(app) {
      this.app = app;
      this.results = [];
      this.logLines = [];
      $$('.vbtn').forEach((b) => b.addEventListener('click', () => app.setActive(b.dataset.vehicle)));
      $$('#warp button').forEach((b) => b.addEventListener('click', () => app.setWarp(+b.dataset.warp)));
      $$('.tab').forEach((b) => b.addEventListener('click', () => {
        $$('.tab').forEach((x) => x.classList.toggle('on', x === b));
        $$('.pane').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
      }));
      $$('[data-tool]').forEach((b) => b.addEventListener('click', () => app.setTool(app.tool === b.dataset.tool ? null : b.dataset.tool)));
      $$('[data-act]').forEach((b) => b.addEventListener('click', () => app.action(b.dataset.act)));
      const cg = $('#cam-grid');
      for (const k of ['chase', 'navcam', 'mastcam34', 'mastcam100', 'chemcam', 'fhaz', 'rhaz', 'mahli', 'mardi']) {
        const short = { chase: 'Снаружи', navcam: 'Navcam', mastcam34: 'Mastcam 34', mastcam100: 'Mastcam 100', chemcam: 'ChemCam RMI', fhaz: 'Hazcam пер.', rhaz: 'Hazcam зад.', mahli: 'MAHLI', mardi: 'MARDI' }[k];
        const b = document.createElement('button');
        b.className = 'tb cut'; b.dataset.cam = k; b.textContent = short;
        b.addEventListener('click', () => app.views.setMode(k));
        cg.appendChild(b);
      }
      $('#delay-toggle').addEventListener('click', () => {
        app.comms.delayMode = !app.comms.delayMode;
        $('#delay-toggle').classList.toggle('on', app.comms.delayMode);
        app.ops.log(app.comms.delayMode ? 'Режим реальной связи: команды идут с задержкой света' : 'Прямое управление без задержки', 'info');
      });
      $('#modal-close').addEventListener('click', () => $('#modal').classList.remove('on'));
      $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').classList.remove('on'); });

      // фокус не оставляем на кнопках: иначе пробел («стоп») нажмёт кнопку ещё раз
      document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) b.blur(); });
      app.bus.on('log', (l) => this.addLog(l));
      app.bus.on('result', (r) => this.addResult(r));
      app.bus.on('camera', (m) => this.onCamera(m));
      app.bus.on('sample', (s) => { $('#b-sam').disabled = !(s && s.portions.SAM); $('#b-chemin').disabled = !(s && s.portions.CheMin); });
      app.bus.on('tool', (t) => {
        $$('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
        $('#toolhint').textContent = TOOL_HINTS[t] || '';
        $('#toolhint').classList.toggle('on', !!t);
      });
      this.onCamera('chase');
      this.setVehicle('rover');
      this.timer = 0;
    }

    setVehicle(kind) {
      document.body.classList.toggle('m-rover', kind === 'rover');
      document.body.classList.toggle('m-buggy', kind === 'buggy');
      $$('.vbtn').forEach((b) => b.classList.toggle('on', b.dataset.vehicle === kind));
      $('#keys').innerHTML = kind === 'rover'
        ? '<kbd>W</kbd><kbd>S</kbd> вперёд/назад · <kbd>A</kbd><kbd>D</kbd> дуга / разворот на месте<br><kbd>Space</kbd> стоп · <kbd>C</kbd> камера · <kbd>T</kbd> время · <kbd>Tab</kbd> багги · <kbd>R</kbd> поднять'
        : '<kbd>W</kbd><kbd>S</kbd> газ/тормоз · <kbd>A</kbd><kbd>D</kbd> руль · <kbd>Shift</kbd> РАКЕТА<br><kbd>Space</kbd> ручник · <kbd>C</kbd> камера · <kbd>R</kbd> перевернуть · <kbd>Tab</kbd> Curiosity';
    }
    setWarp(w) { $$('#warp button').forEach((b) => b.classList.toggle('on', +b.dataset.warp === w)); }

    onCamera(m) {
      $$('[data-cam]').forEach((b) => b.classList.toggle('on', b.dataset.cam === m));
      const def = PG.CAMS[m];
      const inst = m !== 'chase' && m !== 'hood';
      $('#camlabel').textContent = def.label;
      $('#camlabel').classList.toggle('on', inst);
      $('#reticle').classList.toggle('on', ['chemcam', 'mastcam34', 'mastcam100', 'navcam'].includes(m));
    }

    addLog({ msg, kind, sol, lmst }) {
      this.logLines.push({ msg, kind, t: `${sol} ${lmst.slice(0, 5)}` });
      if (this.logLines.length > 7) this.logLines.shift();
      $('#log').innerHTML = this.logLines.map((l) => `<p class="${l.kind}"><em>${l.t}</em>${escapeHtml(l.msg)}</p>`).join('');
    }

    update(dt) {
      const A = this.app, R = A.rover, ops = A.ops;
      // прогресс операции — каждый кадр
      const p = ops.progress;
      $('#progress').classList.toggle('on', !!p);
      if (p) {
        const frac = p.total ? PG.clamp((A.clock.elapsed - p.start) / p.total, 0, 1) : 0;
        const left = p.total ? ` · осталось ${PG.fmtDur(p.total - (A.clock.elapsed - p.start))}` : '';
        $('#prog-label').textContent = p.label + left;
        $('#prog-fill').style.width = p.total ? `${frac * 100}%` : '100%';
      }
      const pr = A.views.pipRect;
      $('#pip').classList.toggle('on', !!pr);
      if (pr) Object.assign($('#pip').style, { left: pr.x + 'px', top: pr.y + 'px', width: pr.w + 'px', height: pr.h + 'px' }), ($('#pip span').textContent = pr.label);
      if (A.active.kind === 'buggy') {
        const B = A.buggy;
        $('#b-speed').innerHTML = `${Math.abs(B.speed * 3.6).toFixed(0)}<small>км/ч</small>`;
        $('#b-boost').style.width = `${B.boost * 100}%`;
        $('#b-joy').style.width = `${B.joy * 100}%`;
      }
      this.timer -= dt;
      if (this.timer > 0) return;
      this.timer = 0.12;
      $('#t-sol').textContent = A.clock.sol;
      $('#t-lmst').textContent = A.clock.lmst();
      const warpEff = A.warpEffective;
      $('#warp-note').innerHTML = A.warp > 1
        ? `время ×${warpEff.toFixed(0)} · ровер на экране ≈ <b>${(PG.ROVER_TOP_SPEED * warpEff * 100).toFixed(0)} см/с</b>`
        : 'скорость ровера <b>4 см/с</b> — как у настоящего';
      if (A.active.kind !== 'rover') return;
      const W = A.wx, P = A.power, C = A.comms;
      const deg = (r) => `${(r / PG.DEG).toFixed(1)}°`;
      const q = R.group.quaternion, e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
      const mode = ops.nav ? 'AutoNav' : R.steering ? 'Поворот колёс' : Math.abs(R.cmd.v) > 0 ? (Math.abs(R.cmd.w) > 0 ? 'Дуга' : 'Прямо') : Math.abs(R.cmd.w) > 0 ? 'Разворот на месте' : 'Стоит';
      const passes = A.passes || [];
      const next = passes.find((x) => !x.active) || passes[0];
      const owlt = C.owlt();
      const socCls = P.soc < 0.2 ? 'err' : P.soc < 0.4 ? 'warn' : 'ok';
      const loads = [...P.loads.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, w]) => `${n} ${w.toFixed(0)}`).join(' · ');
      const rad = A.radState || { rate: 0, total: 0 };
      $('#tele').innerHTML = `
        <div class="sec">ХОДОВАЯ</div>
        <dl>
          <dt>Скорость</dt><dd>${(R.speed * 100).toFixed(2)} см/с</dd>
          <dt>Режим</dt><dd>${mode}</dd>
          <dt>Одометр</dt><dd>${R.odometer.toFixed(2)} м</dd>
          <dt>Курс</dt><dd>${((360 - R.heading() / PG.DEG) % 360).toFixed(1)}°</dd>
          <dt>Тангаж / крен</dt><dd class="${R.tilt > 0.4 ? 'warn' : ''}">${deg(e.x)} / ${deg(e.z)}</dd>
          <dt>Пробуксовка</dt><dd class="${R.slip > 0.4 ? 'warn' : ''}">${(R.slip * 100).toFixed(0)} %</dd>
          <dt>Рука</dt><dd>${ops.armStowed() ? 'уложена' : 'развёрнута'}</dd>
          <dt>Образец</dt><dd>${ops.sample ? '№' + ops.sample.id + ' в CHIMRA' : '—'}</dd>
        </dl>
        <div class="sec">ПИТАНИЕ · MMRTG</div>
        <dl>
          <dt>RTG</dt><dd>${P.rtg.toFixed(0)} Вт</dd>
          <dt>Потребление</dt><dd>${P.draw.toFixed(0)} Вт</dd>
          <dt>Батареи</dt><dd class="${socCls}">${(P.soc * 100).toFixed(1)} %</dd>
        </dl>
        <div class="bar"><i style="width:${P.soc * 100}%;background:${P.soc < 0.2 ? 'var(--err)' : ''}"></i></div>
        <dl><dt>Нагрузка</dt><dd style="font-size:10px;color:var(--muted)">${loads}</dd></dl>
        <div class="sec">REMS · МЕТЕО</div>
        <dl>
          <dt>Воздух / грунт</dt><dd>${W.air.toFixed(0)} / ${W.ground.toFixed(0)} °C</dd>
          <dt>Давление</dt><dd>${W.pressure.toFixed(0)} Па</dd>
          <dt>Ветер</dt><dd>${W.wind.toFixed(1)} м/с · ${W.windDir.toFixed(0)}°</dd>
          <dt>Влажность</dt><dd>${W.rh.toFixed(1)} %</dd>
          <dt>УФ</dt><dd>${W.uvIndex} · ${(W.uvA + W.uvB + W.uvC).toFixed(1)} Вт/м²</dd>
        </dl>
        <div class="sec">RAD · DAN</div>
        <dl>
          <dt>Доза</dt><dd class="${rad.sep ? 'err' : ''}">${rad.rate.toFixed(0)} мкГр/сут${rad.sep ? ' · ВСПЫШКА' : ''}</dd>
          <dt>Накоплено</dt><dd>${(rad.total / 1000).toFixed(3)} мГр</dd>
          <dt>Вода (DAN пасс.)</dt><dd>${A.danPassive.toFixed(1)} ± 0.8 %</dd>
        </dl>
        <div class="sec">СВЯЗЬ</div>
        <dl>
          <dt>До Земли</dt><dd>${owlt.au.toFixed(2)} а.е. · ${PG.fmtDur(owlt.seconds)}</dd>
          <dt>Канал</dt><dd class="${C.active ? 'ok' : ''}">${C.active || (next ? `${next.name} через ${PG.fmtDur(next.inH * 3600)}` : '—')}</dd>
          <dt>В памяти</dt><dd>${C.buffer.toFixed(1)} Мбит</dd>
        </dl>`;
      $('#comm-dl').innerHTML = `
        <dt>Расстояние</dt><dd>${(owlt.au * 149.6).toFixed(0)} млн км</dd>
        <dt>Задержка (в одну сторону)</dt><dd>${PG.fmtDur(owlt.seconds)}</dd>
        <dt>Прямой канал HGA</dt><dd class="${C.dte(A.clock) ? 'ok' : ''}">${C.dte(A.clock) ? 'Земля над горизонтом' : '08:30–11:30 LMST'}</dd>
        ${passes.slice(0, 5).map((x) => `<dt>${x.name}</dt><dd class="${x.active ? 'ok' : ''}">${x.active ? 'СЕАНС · ' + x.rate + ' Мбит/с' : 'через ' + PG.fmtDur(x.inH * 3600)}</dd>`).join('')}
        <dt>В памяти / передано</dt><dd>${C.buffer.toFixed(1)} / ${C.sent.toFixed(1)} Мбит</dd>
        <dt>Команд в пути</dt><dd>${A.ops.pending.length}</dd>`;
      const busy = !!ops.busy;
      $$('[data-tool],[data-act]').forEach((b) => { if (!['b-sam', 'b-chemin'].includes(b.id)) b.disabled = busy && b.dataset.act !== 'stop'; });
      if (!busy) { $('#b-sam').disabled = !(ops.sample && ops.sample.portions.SAM); $('#b-chemin').disabled = !(ops.sample && ops.sample.portions.CheMin); }
      $('#inst-hint').innerHTML = busy ? `Идёт: <b>${ops.busy}</b>. <b>Esc</b> — прервать.` :
        ops.analyses.length ? `В работе: ${ops.analyses.map((a) => `<b>${a.to}</b> ${PG.fmtDur(a.done - A.clock.elapsed)}`).join(', ')}` :
          'Выберите прибор и кликните по камню или грунту. <b>Esc</b> — отмена/стоп.';
    }

    addResult(r) {
      const box = $('#results');
      if (!this.results.length) box.innerHTML = '';
      this.results.push(r);
      $('#res-count').textContent = this.results.length;
      const el = document.createElement('div');
      el.className = 'res cut';
      const sub = `сол ${this.app.clock.sol} · ${this.app.clock.lmst().slice(0, 5)} LMST`;
      el.innerHTML = `<h4>${escapeHtml(r.title)}<small>${sub}${r.target ? ' · ' + escapeHtml(r.target.name) : ''}</small></h4>`;
      const canvas = () => { const c = document.createElement('canvas'); c.width = 640; c.height = 240; el.appendChild(c); return c; };
      const oxGrid = (ox, keys) => {
        const d = document.createElement('div'); d.className = 'ox';
        d.innerHTML = keys.filter((k) => ox[k] !== undefined).map((k) => `<div><span>${k}</span><b>${ox[k].toFixed(1)}</b></div>`).join('');
        el.appendChild(d);
      };
      const img = (url) => {
        const i = document.createElement('img'); i.src = url;
        i.addEventListener('click', () => this.showImage(url, r.download || 'mars.jpg'));
        el.appendChild(i);
      };
      if (r.kind === 'chemcam') {
        img(r.image);
        const s = r.spec, xs = [], ys = [];
        for (let i = 0; i < s.y.length; i++) { xs.push(s.lo + i * s.step); ys.push(s.y[i]); }
        plot(canvas(), [{ x: xs, y: ys, color: '#b98cff' }], {
          xmin: 240, xmax: 860, xlabel: 'нм', ticks: [250, 300, 400, 500, 600, 700, 800],
          marks: [[288.2, 'Si'], [279.6, 'Mg'], [259.9, 'Fe'], [393.4, 'Ca'], [396.2, 'Al'], [334.9, 'Ti'], [589, 'Na'], [656.3, 'H'], [766.5, 'K'], [777.4, 'O']],
        });
        oxGrid(r.ox, ['SiO2', 'TiO2', 'Al2O3', 'FeOT', 'MgO', 'CaO', 'Na2O', 'K2O']);
      } else if (r.kind === 'apxs') {
        const s = r.spec, xs = [], ys = [];
        for (let i = 0; i < s.y.length; i++) { xs.push(i * s.de); ys.push(Math.log10(1 + s.y[i])); }
        plot(canvas(), [{ x: xs, y: ys, color: '#4fe3ff' }], {
          xmin: 0.6, xmax: 16, xlabel: 'кэВ', ticks: [1, 2, 4, 6, 8, 10, 12, 14],
          marks: [[1.04, 'Na'], [1.25, 'Mg'], [1.49, 'Al'], [1.74, 'Si'], [2.31, 'S'], [2.62, 'Cl'], [3.31, 'K'], [3.69, 'Ca'], [4.51, 'Ti'], [6.40, 'Fe'], [7.48, 'Ni']],
          ylabel: 'lg счёт',
        });
        oxGrid(r.ox, ['SiO2', 'TiO2', 'Al2O3', 'FeOT', 'MgO', 'CaO', 'Na2O', 'K2O', 'SO3', 'Cl']);
      } else if (r.kind === 'image') {
        img(r.image);
        if (r.note) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = r.note; el.appendChild(p); }
        if (r.download) this.showImage(r.image, r.download);
      } else if (r.kind === 'chemin') {
        const d = r.data, xs = [], ys = [];
        for (let i = 0; i < d.y.length; i++) { xs.push(d.lo + (d.hi - d.lo) * i / d.y.length); ys.push(d.y[i]); }
        plot(canvas(), [{ x: xs, y: ys, color: '#b8ff4f' }], { xmin: 5, xmax: 50, xlabel: '2θ, Co-Kα', ticks: [10, 20, 30, 40, 50] });
        const l = document.createElement('div'); l.className = 'minl';
        l.innerHTML = d.minerals.map(([n, w]) => `<span>${n}</span><span>${w} %</span>`).join('');
        el.appendChild(l);
      } else if (r.kind === 'sam') {
        const d = r.data, colors = ['#4fe3ff', '#ff5a2c', '#b8ff4f', '#ffc24f', '#ff7ad9', '#ffffff'];
        const series = Object.entries(d.gases).map(([n, y], i) => ({ x: d.T, y, color: colors[i], name: n }));
        plot(canvas(), series, { xmin: 30, xmax: 870, xlabel: '°C', ticks: [100, 300, 500, 700], legend: true });
        const p = document.createElement('p'); p.className = 'hint';
        p.innerHTML = `Органика: <b>${d.organics}</b><br>Вода: ${d.water} % масс. · δD = ${d.dD} ‰ · δ¹³C = ${d.d13C} ‰`;
        el.appendChild(p);
      } else if (r.kind === 'dan') {
        plot(canvas(), [{ x: r.t, y: r.th, color: '#4fe3ff', name: 'тепловые' }, { x: r.t, y: r.ep, color: '#ffc24f', name: 'эпитепловые' }],
          { xmin: 0, xmax: 1900, xlabel: 'мкс после импульса', ticks: [0, 500, 1000, 1500], legend: true });
        const p = document.createElement('p'); p.className = 'hint';
        p.innerHTML = `Водородный эквивалент воды: <b>${r.weh.toFixed(1)} % масс.</b> · хлор-экв.: ${r.cl.toFixed(2)} %`;
        el.appendChild(p);
      }
      box.prepend(el);
    }

    showImage(url, name) {
      $('#modal-img').src = url;
      $('#modal-dl').href = url;
      $('#modal-dl').download = name;
      $('#modal').classList.add('on');
    }
  };

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Мини-график: серии, деления, подписи линий (разрывы — NaN).
  function plot(cv, series, o) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, L = 36, R = 10, T = 14, B = 26;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, W, H);
    let ymin = Infinity, ymax = -Infinity;
    for (const s of series) for (const v of s.y) if (isFinite(v)) { ymin = Math.min(ymin, v); ymax = Math.max(ymax, v); }
    ymin = Math.min(0, ymin); ymax = ymax * 1.08 || 1;
    const X = (x) => L + ((x - o.xmin) / (o.xmax - o.xmin)) * (W - L - R);
    const Y = (y) => H - B - ((y - ymin) / (ymax - ymin)) * (H - T - B);
    g.strokeStyle = 'rgba(255,228,210,.12)'; g.lineWidth = 1;
    g.font = '10px JetBrains Mono, monospace'; g.fillStyle = '#5f5650';
    for (const t of o.ticks || []) { g.beginPath(); g.moveTo(X(t), T); g.lineTo(X(t), H - B); g.stroke(); g.fillText(String(t), X(t) - 8, H - 10); }
    g.fillText(o.xlabel || '', W - R - 70, H - 10);
    if (o.ylabel) g.fillText(o.ylabel, 2, T + 2);
    for (const s of series) {
      g.strokeStyle = s.color; g.lineWidth = 1.4; g.beginPath();
      let pen = false;
      for (let i = 0; i < s.x.length; i++) {
        const x = s.x[i], y = s.y[i];
        if (!isFinite(y) || x < o.xmin || x > o.xmax) { pen = false; continue; }
        if (!pen) { g.moveTo(X(x), Y(y)); pen = true; } else g.lineTo(X(x), Y(y));
      }
      g.stroke();
    }
    if (o.marks) {
      g.fillStyle = '#f2ebe6';
      for (const [x, label] of o.marks) {
        let best = -Infinity;
        const s = series[0];
        for (let i = 0; i < s.x.length; i++) if (Math.abs(s.x[i] - x) < (o.xmax - o.xmin) / 200 && isFinite(s.y[i])) best = Math.max(best, s.y[i]);
        if (!isFinite(best)) continue;
        g.fillText(label, X(x) - 5, Math.max(T + 8, Y(best) - 4));
      }
    }
    if (o.legend) {
      let lx = L + 6;
      for (const s of series) { g.fillStyle = s.color; g.fillRect(lx, T - 2, 10, 3); g.fillText(s.name, lx + 14, T + 2); lx += 18 + g.measureText(s.name).width + 10; }
    }
  }
  PG.plot = plot;
})(window.PG);
