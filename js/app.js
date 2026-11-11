/* 小账本 · 逻辑 */
(function () {
  'use strict';

  var STORE_KEY = 'pocket-ledger.v1';

  var CATEGORIES = {
    expense: [
      { id: 'food',      name: '餐饮', icon: '🍜', color: '#f2994a' },
      { id: 'transport', name: '交通', icon: '🚇', color: '#56ccf2' },
      { id: 'shopping',  name: '购物', icon: '🛍️', color: '#bb6bd9' },
      { id: 'daily',     name: '日用', icon: '🧴', color: '#6fcf97' },
      { id: 'fun',       name: '娱乐', icon: '🎮', color: '#f78fb3' },
      { id: 'housing',   name: '住房', icon: '🏠', color: '#9b8cff' },
      { id: 'health',    name: '医疗', icon: '💊', color: '#eb5757' },
      { id: 'study',     name: '学习', icon: '📚', color: '#2f80ed' },
      { id: 'social',    name: '人情', icon: '🎁', color: '#f2c94c' },
      { id: 'other',     name: '其他', icon: '✨', color: '#95a5a6' }
    ],
    income: [
      { id: 'salary',    name: '工资', icon: '💰', color: '#27ae60' },
      { id: 'bonus',     name: '奖金', icon: '🏆', color: '#f2994a' },
      { id: 'invest',    name: '理财', icon: '📈', color: '#2d9cdb' },
      { id: 'redpacket', name: '红包', icon: '🧧', color: '#eb5757' },
      { id: 'refund',    name: '退款', icon: '↩️', color: '#9b51e0' },
      { id: 'other',     name: '其他', icon: '✨', color: '#95a5a6' }
    ]
  };

  var TITLES = { home: '小账本', list: '明细', stats: '统计', settings: '设置' };
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  var state = loadState();
  var ui = {
    tab: 'home',
    listMonth: currentYM(),
    statMonth: currentYM(),
    filter: 'all',
    query: '',
    statType: 'expense',
    editId: null,
    draft: null
  };

  /* ---------- 基础工具 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function uid() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function currentYM() { return todayISO().slice(0, 7); }
  function ymLabel(ym) { return ym.slice(0, 4) + '年' + (+ym.slice(5, 7)) + '月'; }
  function shiftMonth(ym, delta) {
    var parts = ym.split('-'), d = new Date(+parts[0], +parts[1] - 1 + delta, 1);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }
  function daysInMonth(ym) {
    var parts = ym.split('-');
    return new Date(+parts[0], +parts[1], 0).getDate();
  }
  function dateFromISO(iso) {
    var p = iso.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function weekdayOf(iso) { return WEEKDAYS[dateFromISO(iso).getDay()]; }

  var nf = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function money(cents) { return nf.format(cents / 100); }
  function yuan(cents) { return '¥' + money(cents); }
  function sum(arr) { return arr.reduce(function (a, b) { return a + b; }, 0); }
  function byMonth(ym) { return state.records.filter(function (r) { return r.date.slice(0, 7) === ym; }); }
  function newestFirst(arr) {
    return arr.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.ts || 0) - (a.ts || 0);
    });
  }
  function shortestDate(iso) {
    if (iso === todayISO()) return '今天';
    var d = dateFromISO(iso);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  function dateLabel(iso) {
    var t = todayISO();
    if (iso === t) return '今天';
    var d = dateFromISO(iso);
    var y = new Date();
    y.setDate(y.getDate() - 1);
    var yStr = y.getFullYear() + '-' + pad(y.getMonth() + 1) + '-' + pad(y.getDate());
    if (iso === yStr) return '昨天';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEKDAYS[d.getDay()];
  }
  function fullToday() {
    var d = new Date();
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEKDAYS[d.getDay()];
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function catOf(type, id) {
    var list = CATEGORIES[type] || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return list[list.length - 1];
  }

  /* ---------- 数据 ---------- */
  function isValidRecord(r) {
    return r && typeof r === 'object' &&
      (r.type === 'expense' || r.type === 'income') &&
      typeof r.amount === 'number' && isFinite(r.amount) && r.amount > 0 &&
      typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date);
  }

  function loadState() {
    var fallback = { records: [], budget: 0, theme: 'auto' };
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return fallback;
      var data = JSON.parse(raw);
      var recs = Array.isArray(data.records) ? data.records.filter(isValidRecord) : [];
      return {
        records: recs,
        budget: Math.max(0, Math.round(+data.budget || 0)),
        theme: ['auto', 'light', 'dark'].indexOf(data.theme) >= 0 ? data.theme : 'auto'
      };
    } catch (e) {
      return fallback;
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        v: 1, records: state.records, budget: state.budget, theme: state.theme
      }));
    } catch (e) {
      toast('保存失败：浏览器存储空间不足或被禁用');
    }
  }

  /* ---------- 提示 ---------- */
  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1900);
  }

  /* ---------- 主题 ---------- */
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function applyTheme() {
    var effective = state.theme;
    if (effective === 'auto') effective = mq && mq.matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', effective);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', effective === 'dark' ? '#0f1513' : '#0f9d76');
    var sel = $('#themeSelect');
    if (sel) sel.value = state.theme;
    var icon = $('#themeIcon');
    if (icon) {
      icon.setAttribute('d', effective === 'dark'
        ? 'M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z'
        : 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z');
    }
  }

  function toggleTheme() {
    var effective = state.theme;
    if (effective === 'auto') effective = mq && mq.matches ? 'dark' : 'light';
    state.theme = effective === 'dark' ? 'light' : 'dark';
    persist();
    applyTheme();
  }

  /* ---------- 渲染：首页 ---------- */
  function renderHome() {
    var ym = currentYM();
    var recs = byMonth(ym);
    var exp = sum(recs.filter(function (r) { return r.type === 'expense'; }).map(function (r) { return r.amount; }));
    var inc = sum(recs.filter(function (r) { return r.type === 'income'; }).map(function (r) { return r.amount; }));
    var today = recs.filter(function (r) { return r.date === todayISO(); });
    var todayExp = sum(today.filter(function (r) { return r.type === 'expense'; }).map(function (r) { return r.amount; }));
    var days = {};
    recs.forEach(function (r) { days[r.date] = true; });

    $('#homeExpense').textContent = money(exp);
    $('#homeIncome').textContent = yuan(inc);
    $('#homeBalance').textContent = (inc - exp < 0 ? '-' : '') + yuan(Math.abs(inc - exp));
    $('#todayExpense').textContent = yuan(todayExp);
    $('#todayCount').textContent = today.length + ' 笔';
    $('#monthCount').textContent = String(recs.length);
    $('#monthDays').textContent = Object.keys(days).length + ' 天有记账';

    var box = $('#budgetBox');
    if (state.budget > 0) {
      box.hidden = false;
      var pct = exp / state.budget;
      var bar = $('#budgetBar');
      bar.style.width = Math.min(100, pct * 100).toFixed(1) + '%';
      bar.classList.toggle('over', pct > 1);
      $('#budgetText').textContent = pct > 1
        ? '超支 ' + yuan(exp - state.budget)
        : '剩 ' + yuan(state.budget - exp);
    } else {
      box.hidden = true;
    }

    var recent = newestFirst(state.records).slice(0, 5);
    $('#recentList').innerHTML = recent.length
      ? recent.map(recordHTML).join('')
      : emptyHTML('📝', '还没有记录，点下面的 + 记第一笔');
  }

  /* ---------- 渲染：记录行 ---------- */
  function recordHTML(r) {
    var cat = catOf(r.type, r.cat);
    var sign = r.type === 'expense' ? '-' : '+';
    var title = r.note || cat.name;
    var sub = r.note ? cat.name : (r.type === 'expense' ? '支出' : '收入');
    return '<li class="record" data-id="' + esc(r.id) + '" role="button" tabindex="0">' +
      '<span class="cat-icon" style="--c:' + cat.color + '">' + cat.icon + '</span>' +
      '<div class="record-main"><b>' + esc(title) + '</b><span>' + esc(sub) + ' · ' + shortestDate(r.date) + '</span></div>' +
      '<div class="record-right"><b class="' + r.type + '">' + sign + yuan(r.amount) + '</b></div>' +
      '</li>';
  }

  function emptyHTML(icon, text) {
    return '<li class="empty"><span class="big">' + icon + '</span>' + text + '</li>';
  }

  /* ---------- 渲染：明细 ---------- */
  function renderList() {
    $('#listMonth').textContent = ymLabel(ui.listMonth);
    var recs = byMonth(ui.listMonth);
    if (ui.filter !== 'all') {
      recs = recs.filter(function (r) { return r.type === ui.filter; });
    }
    var q = ui.query.trim().toLowerCase();
    if (q) {
      recs = recs.filter(function (r) {
        var cat = catOf(r.type, r.cat);
        return (r.note || '').toLowerCase().indexOf(q) >= 0 || cat.name.indexOf(q) >= 0;
      });
    }
    recs = newestFirst(recs);

    var exp = sum(recs.filter(function (r) { return r.type === 'expense'; }).map(function (r) { return r.amount; }));
    var inc = sum(recs.filter(function (r) { return r.type === 'income'; }).map(function (r) { return r.amount; }));
    $('#listSummary').innerHTML = recs.length
      ? '共 <b>' + recs.length + '</b> 笔 · 支出 <b>¥' + money(exp) + '</b> · 收入 <b>¥' + money(inc) + '</b>'
      : '';

    var body = $('#listBody');
    if (!recs.length) {
      body.innerHTML = '<div class="empty"><span class="big">🔍</span>' +
        (ui.query || ui.filter !== 'all' ? '没有符合条件的记录' : '这个月还没有记账') + '</div>';
      return;
    }

    var groups = {}, order = [];
    recs.forEach(function (r) {
      if (!groups[r.date]) { groups[r.date] = []; order.push(r.date); }
      groups[r.date].push(r);
    });

    var html = '';
    order.forEach(function (date) {
      var list = groups[date];
      var dayExp = sum(list.filter(function (r) { return r.type === 'expense'; }).map(function (r) { return r.amount; }));
      var dayInc = sum(list.filter(function (r) { return r.type === 'income'; }).map(function (r) { return r.amount; }));
      var meta = [];
      if (dayExp > 0) meta.push('支出 ¥' + money(dayExp));
      if (dayInc > 0) meta.push('收入 ¥' + money(dayInc));
      html += '<div class="day-head"><b>' + dateLabel(date) + '</b><span>' + meta.join(' · ') + '</span></div>' +
        '<ul class="record-list">' + list.map(recordHTML).join('') + '</ul>';
    });
    body.innerHTML = html;
  }

  /* ---------- 渲染：统计 ---------- */
  function renderStats() {
    $('#statMonth').textContent = ymLabel(ui.statMonth);
    var type = ui.statType;
    var recs = byMonth(ui.statMonth).filter(function (r) { return r.type === type; });
    var total = sum(recs.map(function (r) { return r.amount; }));
    var days = daysInMonth(ui.statMonth);
    if (ui.statMonth === currentYM()) {
      days = Math.max(1, new Date().getDate());
    }
    $('#statTotalLabel').textContent = type === 'expense' ? '合计支出' : '合计收入';
    $('#statTotal').textContent = yuan(total);
    $('#statSub').textContent = '日均 ' + yuan(Math.round(total / days)) + ' · 共 ' + recs.length + ' 笔';

    // 每日柱状图
    var perDay = {};
    recs.forEach(function (r) {
      var d = +r.date.slice(8, 10);
      perDay[d] = (perDay[d] || 0) + r.amount;
    });
    var totalDays = daysInMonth(ui.statMonth);
    var max = Math.max(1, Math.max.apply(null, Object.keys(perDay).map(function (d) { return perDay[d]; })));
    var bars = '';
    for (var d = 1; d <= totalDays; d++) {
      var v = perDay[d] || 0;
      var h = (v / max * 100).toFixed(1);
      var showLabel = d === 1 || d % 5 === 0 || d === totalDays;
      bars += '<div class="bar-col' + (v ? ' has' : '') + '" title="' + (ui.statMonth.slice(5, 7)) + '月' + d + '日 ' + yuan(v) + '">' +
        '<i style="height:' + (v ? h : 0) + '%"></i>' +
        (showLabel ? '<span class="bar-label">' + d + '</span>' : '') +
        '</div>';
    }
    $('#barChart').innerHTML = bars;

    // 分类聚合
    var agg = {};
    recs.forEach(function (r) {
      if (!agg[r.cat]) agg[r.cat] = 0;
      agg[r.cat] += r.amount;
    });
    var groups = Object.keys(agg).map(function (id) {
      var cat = catOf(type, id);
      return { id: id, name: cat.name, icon: cat.icon, color: cat.color, value: agg[id] };
    }).sort(function (a, b) { return b.value - a.value; });

    var C = 2 * Math.PI * 44;
    var offset = 0;
    var svg = '<circle cx="60" cy="60" r="44" fill="none" stroke="var(--line)" stroke-width="13"></circle>';
    groups.forEach(function (g) {
      var len = total ? g.value / total * C : 0;
      svg += '<circle cx="60" cy="60" r="44" fill="none" stroke="' + g.color + '" stroke-width="13" ' +
        'stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" ' +
        'stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 60 60)"></circle>';
      offset += len;
    });
    $('#donut').innerHTML = svg;
    $('#donutTotal').textContent = total >= 1000000
      ? '¥' + (total / 1000000).toFixed(1) + '万'
      : '¥' + Math.round(total / 100);

    $('#catRank').innerHTML = groups.length
      ? groups.map(function (g) {
        var pct = total ? Math.round(g.value / total * 100) : 0;
        return '<li><span class="icon">' + g.icon + '</span>' +
          '<div><div class="name"><span>' + esc(g.name) + '</span><span>' + pct + '%</span></div>' +
          '<div class="track"><i style="width:' + pct + '%;background:' + g.color + '"></i></div></div>' +
          '<span class="amount">' + yuan(g.value) + '</span></li>';
      }).join('')
      : '<li class="hint" style="margin:0">这个月还没有' + (type === 'expense' ? '支出' : '收入') + '记录</li>';
  }

  /* ---------- 渲染：设置 ---------- */
  function renderSettings() {
    $('#budgetInput').value = state.budget ? String(state.budget / 100) : '';
    var size = 0;
    try { size = (localStorage.getItem(STORE_KEY) || '').length; } catch (e) {}
    $('#dataHint').textContent = '已保存 ' + state.records.length + ' 条记录' +
      (size ? '（约 ' + (size / 1024).toFixed(1) + ' KB）' : '') +
      '。数据只存在当前设备，建议每月导出一次备份。';
  }

  function renderAll() {
    renderHome();
    renderList();
    renderStats();
    renderSettings();
    $('#viewSub').textContent = ui.tab === 'home'
      ? fullToday()
      : (ui.tab === 'list' ? '按日期查看每一笔' : ui.tab === 'stats' ? '看看钱花在哪了' : '预算、外观与数据');
  }

  /* ---------- 导航 ---------- */
  function switchTab(tab) {
    if (!TITLES[tab]) tab = 'home';
    ui.tab = tab;
    if (location.hash !== '#' + tab) {
      try { history.replaceState(null, '', '#' + tab); } catch (e) {}
    }
    $$('.tab').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + tab); });
    $('#viewTitle').textContent = TITLES[tab] || '小账本';
    renderAll();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* ---------- 记账面板 ---------- */
  var closeTimer = null;

  function amountStr(cents) {
    return (cents / 100).toFixed(2).replace(/\.?0+$/, '');
  }

  function renderSheet() {
    var d = ui.draft;
    $$('#typeSeg button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.type === d.type);
    });
    $('#amountText').textContent = d.amount;
    $('#dateInput').value = d.date;
    $('#noteInput').value = d.note || '';

    $('#catsGrid').innerHTML = CATEGORIES[d.type].map(function (c) {
      return '<button type="button" class="cat' + (c.id === d.cat ? ' on' : '') + '" data-cat="' + c.id + '">' +
        '<span>' + c.icon + '</span><span>' + c.name + '</span></button>';
    }).join('');

    $('#sheetTitle').textContent = ui.editId ? '编辑记录' : '记一笔';
    $('#saveBtn').textContent = ui.editId ? '保存修改' : '保存';
    $('#deleteBtn').hidden = !ui.editId;
  }

  function openSheet(id) {
    var rec = id ? state.records.filter(function (r) { return r.id === id; })[0] : null;
    ui.editId = rec ? rec.id : null;
    ui.draft = rec
      ? { type: rec.type, cat: rec.cat, amount: amountStr(rec.amount), date: rec.date, note: rec.note || '' }
      : { type: 'expense', cat: 'food', amount: '0', date: todayISO(), note: '' };
    renderSheet();
    clearTimeout(closeTimer);
    var sheet = $('#sheet');
    sheet.hidden = false;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { sheet.classList.add('open'); });
    });
    document.body.classList.add('lock');
  }

  function closeSheet() {
    var sheet = $('#sheet');
    sheet.classList.remove('open');
    document.body.classList.remove('lock');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {
      sheet.hidden = true;
      ui.editId = null;
      ui.draft = null;
    }, 280);
  }

  function pressKey(key) {
    if (!ui.draft) return;
    var a = ui.draft.amount;
    if (key === 'back') {
      a = a.length > 1 ? a.slice(0, -1) : '0';
      if (a === '' || a === '.') a = '0';
    } else if (key === '.') {
      if (a.indexOf('.') < 0) a += '.';
    } else {
      var dot = a.indexOf('.');
      if (dot >= 0) {
        if (a.length - dot - 1 >= 2) return; // 最多两位小数
        a += key;
      } else if (a === '0') {
        a = key;
      } else if (a.length >= 8) {
        return;
      } else {
        a += key;
      }
    }
    ui.draft.amount = a;
    $('#amountText').textContent = a;
  }

  function commitRecord() {
    var d = ui.draft;
    if (!d) return;
    var cents = Math.round(parseFloat(d.amount || '0') * 100);
    if (!isFinite(cents) || cents <= 0) { toast('请输入金额'); return; }
    if (!d.cat) { toast('请选择分类'); return; }
    var note = (d.note || '').trim().slice(0, 30);
    var rec = {
      id: ui.editId || uid(),
      type: d.type,
      cat: d.cat,
      amount: cents,
      note: note,
      date: d.date || todayISO(),
      ts: Date.now()
    };
    var index = -1;
    if (ui.editId) {
      for (var i = 0; i < state.records.length; i++) {
        if (state.records[i].id === ui.editId) { index = i; break; }
      }
    }
    var wasEdit = !!ui.editId;
    if (index >= 0) state.records[index] = rec;
    else state.records.push(rec);
    persist();
    closeSheet();
    renderAll();
    toast(wasEdit ? '已更新' : '已记一笔');
  }

  function deleteRecord(id) {
    if (!window.confirm('删除这条记录？')) return;
    state.records = state.records.filter(function (r) { return r.id !== id; });
    persist();
    closeSheet();
    renderAll();
    toast('已删除');
  }

  /* ---------- 导出 / 导入 ---------- */
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }

  function exportJSON() {
    var data = {
      app: '小账本',
      version: 1,
      exportedAt: new Date().toISOString(),
      budget: state.budget,
      records: newestFirst(state.records)
    };
    download('小账本备份-' + stamp() + '.json', JSON.stringify(data, null, 2), 'application/json');
    toast('备份已导出');
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCSV() {
    var rows = [['日期', '类型', '分类', '金额', '备注']];
    newestFirst(state.records).reverse().forEach(function (r) {
      rows.push([r.date, r.type === 'expense' ? '支出' : '收入', catOf(r.type, r.cat).name, (r.amount / 100).toFixed(2), r.note || '']);
    });
    var csv = '\uFEFF' + rows.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n');
    download('小账本明细-' + stamp() + '.csv', csv, 'text/csv;charset=utf-8');
    toast('CSV 已导出');
  }

  function importJSON(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { toast('文件格式不对，不是有效的备份'); return; }
    var list = Array.isArray(data) ? data : (data && data.records);
    if (!Array.isArray(list)) { toast('备份里没有找到记录'); return; }
    var incoming = list.filter(isValidRecord).map(function (r) {
      var amount = r.amount;
      if (!Number.isInteger(amount)) amount = Math.round(amount * 100);
      return {
        id: typeof r.id === 'string' && r.id ? r.id : uid(),
        type: r.type,
        cat: typeof r.cat === 'string' ? r.cat : 'other',
        amount: amount,
        note: typeof r.note === 'string' ? r.note.slice(0, 30) : '',
        date: r.date,
        ts: +r.ts || Date.now()
      };
    });
    if (!incoming.length) { toast('备份里没有有效记录'); return; }
    var map = {};
    state.records.forEach(function (r) { map[r.id] = r; });
    var added = 0, updated = 0;
    incoming.forEach(function (r) {
      if (map[r.id]) updated++; else added++;
      map[r.id] = r;
    });
    state.records = Object.keys(map).map(function (k) { return map[k]; });
    if (data && typeof data.budget === 'number' && data.budget >= 0) {
      state.budget = Math.round(data.budget);
    }
    persist();
    renderAll();
    toast('导入完成：新增 ' + added + ' 条' + (updated ? '，覆盖 ' + updated + ' 条' : ''));
  }

  function clearAll() {
    if (!window.confirm('确定清空所有记账数据吗？此操作无法撤销，建议先导出备份。')) return;
    state.records = [];
    state.budget = 0;
    persist();
    renderAll();
    toast('数据已清空');
  }

  /* ---------- 事件绑定 ---------- */
  function bind() {
    $$('.tab').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab); });
    });

    document.addEventListener('click', function (e) {
      var go = e.target.closest('[data-go]');
      if (go) { switchTab(go.dataset.go); return; }

      var row = e.target.closest('.record');
      if (row && row.dataset.id) {
        openSheet(row.dataset.id);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && $('#sheet').classList.contains('open')) closeSheet();
      var row = e.target.closest && e.target.closest('.record');
      if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openSheet(row.dataset.id); }
    });

    $('#themeBtn').addEventListener('click', toggleTheme);
    $('#addBtn').addEventListener('click', function () { openSheet(null); });
    $('#sheetClose').addEventListener('click', closeSheet);
    $('#sheetMask').addEventListener('click', closeSheet);
    $('#saveBtn').addEventListener('click', commitRecord);
    $('#deleteBtn').addEventListener('click', function () {
      if (ui.editId) deleteRecord(ui.editId);
    });

    $('#typeSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-type]');
      if (!b || !ui.draft) return;
      ui.draft.type = b.dataset.type;
      var list = CATEGORIES[ui.draft.type];
      var ok = list.some(function (c) { return c.id === ui.draft.cat; });
      if (!ok) ui.draft.cat = list[0].id;
      renderSheet();
    });

    $('#catsGrid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cat]');
      if (!b || !ui.draft) return;
      ui.draft.cat = b.dataset.cat;
      renderSheet();
    });

    $('#keypad').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-key]');
      if (b) pressKey(b.dataset.key);
    });

    $('#dateInput').addEventListener('change', function (e) {
      if (ui.draft) ui.draft.date = e.target.value || todayISO();
    });
    $('#noteInput').addEventListener('input', function (e) {
      if (ui.draft) ui.draft.note = e.target.value;
    });

    $('#listPrev').addEventListener('click', function () {
      ui.listMonth = shiftMonth(ui.listMonth, -1);
      renderList();
    });
    $('#listNext').addEventListener('click', function () {
      var next = shiftMonth(ui.listMonth, 1);
      if (next > currentYM()) return;
      ui.listMonth = next;
      renderList();
    });

    $('#listChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-filter]');
      if (!b) return;
      ui.filter = b.dataset.filter;
      $$('#listChips .chip').forEach(function (c) { c.classList.toggle('on', c === b); });
      renderList();
    });

    var searchTimer = null;
    $('#searchInput').addEventListener('input', function (e) {
      clearTimeout(searchTimer);
      var value = e.target.value;
      searchTimer = setTimeout(function () { ui.query = value; renderList(); }, 120);
    });

    $('#statPrev').addEventListener('click', function () {
      ui.statMonth = shiftMonth(ui.statMonth, -1);
      renderStats();
    });
    $('#statNext').addEventListener('click', function () {
      var next = shiftMonth(ui.statMonth, 1);
      if (next > currentYM()) return;
      ui.statMonth = next;
      renderStats();
    });

    $('#statChips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-stype]');
      if (!b) return;
      ui.statType = b.dataset.stype;
      $$('#statChips .chip').forEach(function (c) { c.classList.toggle('on', c === b); });
      renderStats();
    });

    $('#saveBudget').addEventListener('click', function () {
      var value = parseFloat($('#budgetInput').value);
      if (!isFinite(value) || value < 0) { toast('请输入正确的预算金额'); return; }
      state.budget = Math.round(value * 100);
      persist();
      renderAll();
      toast(state.budget ? '预算已设置为 ¥' + money(state.budget) : '已取消预算');
    });

    $('#themeSelect').addEventListener('change', function (e) {
      state.theme = e.target.value;
      persist();
      applyTheme();
    });

    $('#exportJson').addEventListener('click', exportJSON);
    $('#exportCsv').addEventListener('click', exportCSV);
    $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { importJSON(String(reader.result || '')); };
      reader.onerror = function () { toast('读取文件失败'); };
      reader.readAsText(file);
      e.target.value = '';
    });
    $('#clearBtn').addEventListener('click', clearAll);

    if (mq) {
      var onScheme = function () { if (state.theme === 'auto') applyTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', onScheme);
      else if (mq.addListener) mq.addListener(onScheme);
    }

    window.addEventListener('storage', function (e) {
      if (e.key !== STORE_KEY) return;
      state = loadState();
      applyTheme();
      renderAll();
    });

    window.addEventListener('hashchange', function () {
      var tab = (location.hash || '').replace('#', '');
      if (TITLES[tab] && tab !== ui.tab) switchTab(tab);
    });
  }

  /* ---------- 启动 ---------- */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  function init() {
    applyTheme();
    bind();
    var startTab = (location.hash || '').replace('#', '');
    switchTab(TITLES[startTab] ? startTab : 'home');
    registerSW();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();