(function () {
  var cfg = window.APP_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var listEl = $('list'), dlg = $('dlg'), loginDlg = $('login');
  var loans = [], filter = 'all', editingId = null, canEdit = false, ready = false;
  var CACHE_KEY = 'loans-cache-v1';

  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fmt(s) { if (!s) return '-'; var d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function field(label, val, cls) { var d = el('div'); d.appendChild(el('b', null, label)); d.appendChild(el('span', cls || '', val)); return d; }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});

  var LS_TOKEN = 'gh-token', LS_REPO = 'gh-repo';
  var token = localStorage.getItem(LS_TOKEN) || '';
  function guessRepo() {
    if (cfg && cfg.GITHUB_REPO) return cfg.GITHUB_REPO;
    var saved = localStorage.getItem(LS_REPO); if (saved) return saved;
    var m = location.hostname.match(/^(.+)\.github\.io$/), seg = location.pathname.split('/')[1];
    return m && seg ? m[1] + '/' + seg : '';
  }
  var repo = guessRepo();
  function b64enc(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64dec(b) { return decodeURIComponent(escape(atob(b.replace(/\n/g, '')))); }
  function api(path, opt) {
    opt = opt || {}; opt.headers = Object.assign({ 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token }, opt.headers || {});
    return fetch('https://api.github.com/repos/' + repo + path, opt);
  }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // อ่านไฟล์ล่าสุด: เจ้าของอ่านผ่าน API (สดเสมอ) ผู้ยืมอ่านผ่านหน้าเว็บ
  async function readRemote() {
    if (canEdit) {
      var r = await api('/contents/loans.json?ref=main&t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('read');
      var j = await r.json();
      return { list: (JSON.parse(b64dec(j.content)).loans) || [], sha: j.sha };
    }
    var r2 = await fetch('loans.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r2.ok) throw new Error('read');
    return { list: ((await r2.json()).loans) || [], sha: null };
  }

  async function load() {
    try {
      var d = await readRemote();
      loans = d.list; $('offline').hidden = true;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(loans)); } catch (e) {}
    } catch (e) {
      try { loans = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); } catch (e2) { loans = []; }
      $('offline').hidden = false;
    }
    ready = true; render();
  }

  // แก้ข้อมูล: ดึงล่าสุด → แก้ → บันทึกกลับ (ถ้ามีคนแก้ซ้อนจะลองใหม่ 1 ครั้ง)
  async function mutate(fn, attempt) {
    attempt = attempt || 0;
    var d = await readRemote();
    var next = fn(d.list.slice());
    var body = { message: 'update loans', content: b64enc(JSON.stringify({ loans: next }, null, 2)), sha: d.sha, branch: 'main' };
    var r = await api('/contents/loans.json', { method: 'PUT', body: JSON.stringify(body) });
    if (r.status === 409 && attempt < 1) return mutate(fn, attempt + 1);
    if (!r.ok) throw new Error('write');
    loans = next;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(loans)); } catch (e) {}
    render();
  }

  function render() {
    var q = $('q').value.trim().toLowerCase();
    var rows = loans.filter(function (r) {
      if (filter !== 'all' && r.status !== filter) return false;
      return !q || (r.item || '').toLowerCase().indexOf(q) > -1 || (r.borrower || '').toLowerCase().indexOf(q) > -1;
    }).sort(function (a, b) { return (b.dateBorrowed || '') > (a.dateBorrowed || '') ? 1 : -1; });
    listEl.textContent = '';
    if (!ready) return;
    renderHome(buildCard);
    if (!rows.length) {
      var e = el('div', 'empty');
      e.appendChild(el('div', null, loans.length ? 'ไม่พบรายการที่ตรงกับการค้นหา' : 'ยังไม่มีรายการยืม'));
      e.appendChild(el('div', null, canEdit ? 'กด "+ เพิ่มรายการ" เพื่อบันทึกการยืมครั้งแรก' : 'รอเจ้าของสินค้าเพิ่มรายการ'));
      listEl.appendChild(e); return;
    }
    function buildCard(r) {
      var c = el('div', 'item' + (r.status === 'returned' ? ' returned' : ''));
      var top = el('div', 'top');
      top.appendChild(el('h3', 'name', r.item));
      top.appendChild(el('div', 'stamp', r.status === 'returned' ? 'คืนแล้ว' : 'ยืมอยู่'));
      c.appendChild(top);
      var m = el('div', 'meta');
      m.appendChild(field('จำนวน', r.qty + ' ' + (r.unit || 'ชิ้น')));
      m.appendChild(field('ผู้ยืม', r.borrower));
      m.appendChild(field('วันที่ยืม', fmt(r.dateBorrowed)));
      if (r.dueDate) {
        var late = r.status !== 'returned' && r.dueDate < today();
        m.appendChild(field('กำหนดคืน', fmt(r.dueDate) + (late ? ' (เลยกำหนด)' : ''), late ? 'overdue' : ''));
      }
      if (r.status === 'returned' && r.dateReturned) m.appendChild(field('คืนเมื่อ', fmt(r.dateReturned)));
      c.appendChild(m);
      if (r.note) c.appendChild(el('div', 'note', 'หมายเหตุ: ' + r.note));
      if (canEdit) {
        var a = el('div', 'actions');
        var t = el('button', r.status === 'returned' ? 'ghost' : 'ok', r.status === 'returned' ? 'ยกเลิกการคืน' : 'คืนแล้ว');
        t.onclick = function () { toggle(r); }; a.appendChild(t);
        var ed = el('button', 'ghost', 'แก้ไข'); ed.onclick = function () { openForm(r); }; a.appendChild(ed);
        var del = el('button', 'danger right', 'ลบ');
        del.onclick = function () { if (confirm('ลบรายการ "' + r.item + '" ?')) remove(r); };
        a.appendChild(del); c.appendChild(a);
      }
      return c;
    }
    rows.forEach(function (r) { listEl.appendChild(buildCard(r)); });
  }

  function renderHome(buildCard) {
    var t = today(), open = loans.filter(function (r) { return r.status !== 'returned'; });
    var late = open.filter(function (r) { return r.dueDate && r.dueDate < t; });
    var who = {}; loans.forEach(function (r) { who[(r.borrower || '').trim().toLowerCase()] = 1; });
    $('hero-n').textContent = open.length;
    $('hero-sub').textContent = late.length ? 'เลยกำหนดคืน ' + late.length + ' รายการ' : (open.length ? 'ไม่มีรายการเลยกำหนด' : 'ไม่มีรายการค้างคืน');
    $('s-all').textContent = loans.length; $('s-ret').textContent = loans.length - open.length;
    $('s-late').textContent = late.length; $('s-who').textContent = Object.keys(who).length;
    var rc = $('recent'); rc.textContent = '';
    var recent = loans.slice().sort(function (a, b) { return (b.dateBorrowed || '') > (a.dateBorrowed || '') ? 1 : -1; }).slice(0, 5);
    if (!recent.length) {
      var e = el('div', 'empty', canEdit ? 'ยังไม่มีรายการ กดปุ่ม "เพิ่ม" ด้านล่างเพื่อบันทึกการยืมครั้งแรก' : 'ยังไม่มีรายการ รอเจ้าของสินค้าเพิ่มรายการ');
      rc.appendChild(e); return;
    }
    recent.forEach(function (r) { rc.appendChild(buildCard(r)); });
  }

  function setBadge() {
    var b = $('badge');
    if (canEdit) {
      b.className = 'role edit'; b.textContent = 'โหมดเจ้าของสินค้า (แก้ไขได้)';
      $('pilltxt').innerHTML = 'บันทึกออนไลน์แล้ว ✓ <u id="out">ออกจากระบบ</u>';
      $('out').onclick = function () { $('auth').click(); };
      $('add').hidden = false; $('export').hidden = false; $('auth').textContent = 'ออกจากระบบ';
      $('hint').textContent = 'ส่งลิงก์หน้านี้ให้ผู้ยืม เขาจะเห็นแบบดูอย่างเดียวโดยไม่ต้องล็อกอิน';
    } else {
      b.className = 'role'; b.textContent = 'โหมดผู้ยืม (ดูอย่างเดียว)';
      $('pilltxt').textContent = 'โหมดดูอย่างเดียว';
      $('add').hidden = true; $('export').hidden = true; $('auth').textContent = 'เข้าสู่ระบบเจ้าของสินค้า';
      $('hint').textContent = 'ผู้ยืมดูข้อมูลได้อย่างเดียว ส่วนเจ้าของสินค้าต้องเข้าสู่ระบบก่อนจึงจะแก้ไขได้';
    }
  }

  function fail() { alert('บันทึกไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตหรือสิทธิ์ของ token'); }

  async function toggle(r) {
    var ret = r.status !== 'returned';
    try {
      await mutate(function (l) { return l.map(function (x) { return x.id === r.id ? Object.assign({}, x, { status: ret ? 'returned' : 'borrowed', dateReturned: ret ? today() : null }) : x; }); });
    } catch (e) { fail(); }
  }
  async function remove(r) {
    try { await mutate(function (l) { return l.filter(function (x) { return x.id !== r.id; }); }); } catch (e) { fail(); }
  }

  function openForm(r) {
    editingId = r ? r.id : null;
    $('dtitle').textContent = r ? 'แก้ไขรายการยืม' : 'เพิ่มรายการยืม';
    $('f-item').value = r ? r.item : ''; $('f-qty').value = r ? r.qty : 1; $('f-unit').value = r && r.unit ? r.unit : 'กล่อง'; $('f-who').value = r ? r.borrower : '';
    $('f-date').value = r ? r.dateBorrowed : today(); $('f-due').value = r && r.dueDate ? r.dueDate : ''; $('f-note').value = r ? (r.note || '') : '';
    $('err').textContent = ''; dlg.showModal();
  }
  $('add').onclick = function () { openForm(null); };
  $('cancel').onclick = function () { dlg.close(); };
  $('save').onclick = async function () {
    var item = $('f-item').value.trim(), who = $('f-who').value.trim(), date = $('f-date').value;
    if (!item || !who || !date) { $('err').textContent = 'กรอกชื่อสินค้า ผู้ยืม และวันที่ยืมให้ครบ'; return; }
    var data = { item: item, qty: Math.max(1, parseInt($('f-qty').value, 10) || 1), unit: $('f-unit').value, borrower: who, dateBorrowed: date, dueDate: $('f-due').value || null, note: $('f-note').value.trim() || null };
    try {
      await mutate(function (l) {
        if (editingId) return l.map(function (x) { return x.id === editingId ? Object.assign({}, x, data) : x; });
        data.id = newId(); data.status = 'borrowed'; data.dateReturned = null; l.push(data); return l;
      });
    } catch (e) { $('err').textContent = 'บันทึกไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตหรือสิทธิ์ของ token'; return; }
    dlg.close();
  };

  $('auth').onclick = function () {
    if (canEdit) { localStorage.removeItem(LS_TOKEN); token = ''; canEdit = false; setBadge(); load(); return; }
    $('l-repo').value = repo; $('l-token').value = ''; $('l-err').textContent = ''; loginDlg.showModal();
  };
  $('l-cancel').onclick = function () { loginDlg.close(); };
  $('l-go').onclick = async function () {
    var r = $('l-repo').value.trim(), t = $('l-token').value.trim();
    if (!/^[^\/\s]+\/[^\/\s]+$/.test(r) || !t) { $('l-err').textContent = 'กรอก repo (ชื่อผู้ใช้/ชื่อ repo) และ token ให้ครบ'; return; }
    repo = r; token = t;
    try {
      var res = await api('', { cache: 'no-store' }); var j = await res.json();
      if (!res.ok || !j.permissions || !j.permissions.push) throw new Error('perm');
    } catch (e) { token = ''; $('l-err').textContent = 'ตรวจสอบไม่ผ่าน: token ต้องมีสิทธิ์เขียนใน repo นี้'; return; }
    localStorage.setItem(LS_TOKEN, token); localStorage.setItem(LS_REPO, repo);
    canEdit = true; setBadge(); loginDlg.close(); load();
  };
  $('export').onclick = function () {
    var blob = new Blob([JSON.stringify({ loans: loans }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'loans-backup-' + today() + '.json'; a.click();
  };

  $('q').oninput = render;
  document.querySelectorAll('[data-tab]').forEach(function (b) {
    b.onclick = function () {
      var t = b.getAttribute('data-tab');
      document.querySelectorAll('.tab').forEach(function (x) { x.hidden = x.id !== 'tab-' + t; });
      document.querySelectorAll('[data-tab]').forEach(function (x) { x.classList.toggle('on', x === b); });
      window.scrollTo(0, 0);
    };
  });
  document.querySelectorAll('[data-f]').forEach(function (b) {
    b.onclick = function () {
      filter = b.getAttribute('data-f');
      document.querySelectorAll('[data-f]').forEach(function (x) { x.classList.toggle('on', x === b); });
      render();
    };
  });

  async function init() {
    canEdit = !!(token && repo);
    setBadge(); await load();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
    window.addEventListener('online', load);
    setInterval(function () { if (!document.hidden && !dlg.open) load(); }, 30000);
  }
  init();
})();
