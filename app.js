(function () {
  var cfg = window.APP_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var listEl = $('list'), dlg = $('dlg'), loginDlg = $('login');
  var loans = [], filter = 'all', editingId = null, canEdit = false, ready = false;
  var CACHE_KEY = 'loans-cache-v1';
  var localImg = {}, pendingImg = null, removeImg = false, currentImg = null;
  var viewer = $('viewer');

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
  // ย่อรูปก่อนอัปโหลด (ด้านยาวสุด 800px, JPEG) เพื่อไม่ให้ repo บวม
  function compress(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var s = Math.min(1, 800 / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('img')); };
      img.src = url;
    });
  }
  async function uploadImage(dataUrl) {
    var path = 'images/' + newId() + '.jpg';
    var r = await api('/contents/' + path, { method: 'PUT', body: JSON.stringify({ message: 'add image', content: dataUrl.split(',')[1], branch: 'main' }) });
    if (!r.ok) throw new Error('upload');
    localImg[path] = dataUrl; return path;
  }
  async function deleteImage(path) { // ลบไฟล์รูปเก่า (ถ้าพลาดก็ข้าม)
    if (!path) return;
    try {
      var g = await api('/contents/' + path + '?ref=main'); if (!g.ok) return;
      var j = await g.json();
      await api('/contents/' + path, { method: 'DELETE', body: JSON.stringify({ message: 'remove image', sha: j.sha, branch: 'main' }) });
    } catch (e) {}
  }
  function imgSrc(path) { return localImg[path] || path; }
  function loadImg(img, path) {
    img.onerror = function () {
      img.onerror = null;
      if (!canEdit) { img.style.display = 'none'; return; } // ผู้ยืม: รอ GitHub Pages อัปเดตรูปใหม่
      api('/contents/' + path + '?ref=main', { headers: { 'Accept': 'application/vnd.github.raw+json' } })
        .then(function (res) { if (!res.ok) throw 0; return res.blob(); })
        .then(function (b) { img.src = URL.createObjectURL(b); })
        .catch(function () { img.style.display = 'none'; });
    };
    img.src = imgSrc(path);
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
      return !q || (r.item || '').toLowerCase().indexOf(q) > -1 || (r.borrower || '').toLowerCase().indexOf(q) > -1 || (r.lender || '').toLowerCase().indexOf(q) > -1;
    }).sort(function (a, b) { return (b.dateBorrowed || '') > (a.dateBorrowed || '') ? 1 : -1; });
    listEl.textContent = '';
    if (!ready) return;
    renderHome(buildCard);
    var dl = $('lenders'); dl.textContent = '';
    var seen = {}; loans.forEach(function (x) { var n = (x.lender || '').trim(); if (n && !seen[n]) { seen[n] = 1; var o = document.createElement('option'); o.value = n; dl.appendChild(o); } });
    if (!rows.length) {
      var e = el('div', 'empty');
      e.appendChild(el('div', null, loans.length ? 'ไม่พบรายการที่ตรงกับการค้นหา' : 'ยังไม่มีรายการยืม'));
      e.appendChild(el('div', null, canEdit ? 'กด "+ เพิ่มรายการ" เพื่อบันทึกการยืมครั้งแรก' : 'รอเจ้าของสินค้าเพิ่มรายการ'));
      listEl.appendChild(e); return;
    }
    function buildCard(r) {
      var c = el('div', 'item' + (r.status === 'returned' ? ' returned' : ''));
      var top = el('div', 'top');
      if (r.image) {
        var th = el('img', 'thumb'); th.alt = r.item; th.loading = 'lazy';
        th.onclick = function () { $('viewer-img').src = th.src; viewer.showModal(); };
        loadImg(th, r.image); top.appendChild(th);
      }
      top.appendChild(el('h3', 'name', r.item));
      top.appendChild(el('div', 'stamp', r.status === 'returned' ? 'คืนแล้ว' : 'ยืมอยู่'));
      c.appendChild(top);
      var m = el('div', 'meta');
      m.appendChild(field('จำนวน', r.qty + ' ' + (r.unit || 'ชิ้น')));
      m.appendChild(field('ผู้ยืม', r.borrower));
      if (r.lender) m.appendChild(field('ผู้ให้ยืม', r.lender));
      if (r.batchId) { var nb = loans.filter(function (x) { return x.batchId === r.batchId; }).length; if (nb > 1) m.appendChild(field('ยืมพร้อมกัน', nb + ' รายการ')); }
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
      $('add').hidden = false; $('backup').hidden = false; $('auth').textContent = 'ออกจากระบบ';
      $('hint').textContent = 'ส่งลิงก์หน้านี้ให้ผู้ยืม เขาจะเห็นแบบดูอย่างเดียวโดยไม่ต้องล็อกอิน';
    } else {
      b.className = 'role'; b.textContent = 'โหมดผู้ยืม (ดูอย่างเดียว)';
      $('pilltxt').textContent = 'โหมดดูอย่างเดียว';
      $('add').hidden = true; $('backup').hidden = true; $('auth').textContent = 'เข้าสู่ระบบเจ้าของสินค้า';
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
    try { await mutate(function (l) { return l.filter(function (x) { return x.id !== r.id; }); }); deleteImage(r.image); } catch (e) { fail(); }
  }

  var UNITS = ['กล่อง', 'ขวด', 'กระปุก', 'ซอง', 'ชิ้น'], rows = [];
  function renumber() {
    rows.forEach(function (s, i) { s.title.textContent = 'สินค้ารายการที่ ' + (i + 1); s.del.hidden = rows.length < 2; });
  }
  function makeRow(r) {
    var s = { pending: null, remove: false, current: r && r.image ? r.image : null };
    var box = el('div', 'itemrow'); s.box = box;
    var head = el('div', 'ihead'); s.title = el('b'); s.del = el('button', 'danger', 'ลบรายการนี้'); s.del.type = 'button';
    s.del.onclick = function () { box.remove(); rows.splice(rows.indexOf(s), 1); renumber(); };
    head.appendChild(s.title); head.appendChild(s.del); box.appendChild(head);
    box.appendChild(el('label', null, 'ชื่อสินค้า'));
    s.name = document.createElement('input'); s.name.placeholder = 'เช่น คอลลาเจน 30 ซอง'; s.name.value = r ? r.item : ''; box.appendChild(s.name);
    var row = el('div', 'row'), d1 = el('div'), d2 = el('div');
    d1.appendChild(el('label', null, 'จำนวน')); s.qty = document.createElement('input'); s.qty.type = 'number'; s.qty.min = 1; s.qty.value = r ? r.qty : 1; d1.appendChild(s.qty);
    d2.appendChild(el('label', null, 'หน่วย')); s.unit = document.createElement('select');
    var us = UNITS.slice(); if (r && r.unit && us.indexOf(r.unit) < 0) us.push(r.unit);
    us.forEach(function (u) { var o = document.createElement('option'); o.textContent = u; s.unit.appendChild(o); });
    s.unit.value = r && r.unit ? r.unit : 'กล่อง'; d2.appendChild(s.unit);
    row.appendChild(d1); row.appendChild(d2); box.appendChild(row);
    box.appendChild(el('label', null, 'รูปสินค้า (ถ้ามี)'));
    var ph = el('div', 'photo'), btns = el('div', 'btns');
    s.prev = document.createElement('img'); s.prev.alt = ''; s.prev.hidden = true;
    s.btn = el('button', 'ghost', '📷 ถ่ายรูป / เลือกรูป'); s.btn.type = 'button';
    s.rm = el('button', 'danger', 'ลบรูป'); s.rm.type = 'button'; s.rm.hidden = true;
    s.file = document.createElement('input'); s.file.type = 'file'; s.file.accept = 'image/*'; s.file.hidden = true;
    btns.appendChild(s.btn); btns.appendChild(s.rm); ph.appendChild(s.prev); ph.appendChild(btns); ph.appendChild(s.file); box.appendChild(ph);
    function showPrev(src, path) {
      s.prev.hidden = !src; s.rm.hidden = !src;
      s.btn.textContent = src ? '📷 เปลี่ยนรูป' : '📷 ถ่ายรูป / เลือกรูป';
      if (!src) { s.prev.removeAttribute('src'); return; }
      if (path) loadImg(s.prev, path); else { s.prev.onerror = null; s.prev.src = src; }
    }
    s.btn.onclick = function () { s.file.click(); };
    s.file.onchange = async function () {
      var f = s.file.files && s.file.files[0]; if (!f) return;
      try { s.pending = await compress(f); s.remove = false; showPrev(s.pending); $('err').textContent = ''; }
      catch (e) { $('err').textContent = 'เปิดรูปนี้ไม่ได้ ลองเลือกรูปอื่น'; }
    };
    s.rm.onclick = function () { s.pending = null; s.remove = true; s.file.value = ''; showPrev(null); };
    if (s.current) showPrev(imgSrc(s.current), s.current);
    rows.push(s); $('items').appendChild(box); renumber();
    return s;
  }

  function openForm(r) {
    editingId = r ? r.id : null;
    $('dtitle').textContent = r ? 'แก้ไขรายการยืม' : 'เพิ่มรายการยืม';
    $('items').textContent = ''; rows = [];
    makeRow(r || null);
    $('add-row').hidden = !!r;
    $('f-who').value = r ? r.borrower : ''; $('f-lender').value = r && r.lender ? r.lender : '';
    $('f-date').value = r ? r.dateBorrowed : today(); $('f-due').value = r && r.dueDate ? r.dueDate : ''; $('f-note').value = r ? (r.note || '') : '';
    $('err').textContent = ''; dlg.showModal();
  }
  $('add-row').onclick = function () { var s = makeRow(null); s.box.scrollIntoView({ block: 'center' }); s.name.focus(); };
  $('add').onclick = function () { openForm(null); };
  $('cancel').onclick = function () { dlg.close(); };
  viewer.onclick = function () { viewer.close(); };

  $('save').onclick = async function () {
    var who = $('f-who').value.trim(), date = $('f-date').value;
    if (!who || !date) { $('err').textContent = 'กรอกผู้ยืม และวันที่ยืมให้ครบ'; return; }
    for (var k = 0; k < rows.length; k++) {
      if (!rows[k].name.value.trim()) { $('err').textContent = 'กรอกชื่อสินค้าให้ครบทุกรายการ (รายการที่ ' + (k + 1) + ')'; return; }
    }
    var shared = { borrower: who, lender: $('f-lender').value.trim() || null, dateBorrowed: date, dueDate: $('f-due').value || null, note: $('f-note').value.trim() || null };
    var btn = $('save'), uploaded = [], recs = [];
    btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
    try {
      for (var i = 0; i < rows.length; i++) {
        var s = rows[i];
        var rec = Object.assign({ item: s.name.value.trim(), qty: Math.max(1, parseInt(s.qty.value, 10) || 1), unit: s.unit.value }, shared);
        if (s.pending) { var p = await uploadImage(s.pending); uploaded.push(p); rec.image = p; }
        else if (s.remove) rec.image = null;
        recs.push(rec);
      }
      if (editingId) {
        await mutate(function (l) { return l.map(function (x) { return x.id === editingId ? Object.assign({}, x, recs[0]) : x; }); });
        if ((rows[0].pending || rows[0].remove) && rows[0].current) deleteImage(rows[0].current);
      } else {
        var bid = recs.length > 1 ? newId() : null;
        recs.forEach(function (rc) { rc.id = newId(); rc.status = 'borrowed'; rc.dateReturned = null; if (bid) rc.batchId = bid; });
        await mutate(function (l) { return l.concat(recs); });
      }
    } catch (e) {
      uploaded.forEach(deleteImage);
      $('err').textContent = 'บันทึกไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตหรือสิทธิ์ของ token';
      btn.disabled = false; btn.textContent = 'บันทึก'; return;
    }
    btn.disabled = false; btn.textContent = 'บันทึก';
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
  function sortedLoans() { return loans.slice().sort(function (x, y) { return (y.dateBorrowed || '') > (x.dateBorrowed || '') ? 1 : -1; }); }
  var HEAD = ['สินค้า', 'จำนวน', 'หน่วย', 'ผู้ยืม', 'ผู้ให้ยืม', 'วันที่ยืม', 'กำหนดคืน', 'สถานะ', 'วันที่คืน', 'หมายเหตุ'];
  function rowOf(r) { return [r.item || '', r.qty || '', r.unit || '', r.borrower || '', r.lender || '', r.dateBorrowed || '', r.dueDate || '', r.status === 'returned' ? 'คืนแล้ว' : 'ยืมอยู่', r.dateReturned || '', r.note || '']; }
  function download(blob, name) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  $('export').onclick = function () {
    download(new Blob([JSON.stringify({ loans: loans }, null, 2)], { type: 'application/json' }), 'loans-backup-' + today() + '.json');
  };

  $('export-xlsx').onclick = function () {
    var data = [HEAD].concat(sortedLoans().map(rowOf));
    if (window.XLSX) {
      var ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [{ wch: 28 }, { wch: 8 }, { wch: 8 }, { wch: 16 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 28 }];
      var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'รายการยืม');
      XLSX.writeFile(wb, 'loans-backup-' + today() + '.xlsx');
    } else { // โหลดไลบรารีไม่ได้ (ออฟไลน์) → สำรองเป็น CSV ที่ Excel เปิดได้
      var csv = data.map(function (row) { return row.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
      download(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), 'loans-backup-' + today() + '.csv');
      alert('โหลดตัวสร้างไฟล์ Excel ไม่ได้ (อาจออฟไลน์) จึงสำรองเป็นไฟล์ .csv แทน ซึ่งเปิดใน Excel ได้');
    }
  };

  // PDF: เปิดหน้ารายงานแล้วสั่งพิมพ์ → เลือก "บันทึกเป็น PDF" (แสดงภาษาไทยและรูปได้ครบ)
  $('export-pdf').onclick = function () {
    var w = window.open('', '_blank');
    if (!w) { alert('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาต pop-up แล้วลองอีกครั้ง'); return; }
    var rows = sortedLoans().map(function (r) {
      var img = r.image ? '<img src="' + esc(r.image.indexOf('data:') === 0 ? r.image : (localImg[r.image] || new URL(r.image, location.href).href)) + '">' : '';
      return '<tr><td class="c">' + img + '</td>' + rowOf(r).map(function (v, i) { return '<td' + (i === 1 ? ' class="c"' : '') + '>' + esc(v) + '</td>'; }).join('') + '</tr>';
    }).join('');
    var open = loans.filter(function (r) { return r.status !== 'returned'; }).length;
    w.document.write('<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>loans-backup-' + today() + '</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;600&display=swap" rel="stylesheet">' +
      '<style>@page{size:A4 landscape;margin:10mm}body{font-family:"Noto Sans Thai",system-ui,sans-serif;font-size:11px;color:#111}' +
      'h1{font-size:18px;margin:0 0 2px}p{margin:0 0 10px;color:#555}table{width:100%;border-collapse:collapse}' +
      'th,td{border:1px solid #bbb;padding:4px 6px;vertical-align:middle;text-align:left}th{background:#14302B;color:#E2C98A}' +
      'tr{page-break-inside:avoid}.c{text-align:center}img{width:44px;height:44px;object-fit:cover;border-radius:6px}</style></head><body>' +
      '<h1>MIES TRADING – รายการยืม-คืนสินค้า</h1><p>สำรองข้อมูล ณ ' + esc(fmt(today())) + ' · ทั้งหมด ' + loans.length + ' รายการ · ยืมอยู่ ' + open + ' รายการ</p>' +
      '<table><thead><tr><th>รูป</th>' + HEAD.map(function (x) { return '<th>' + x + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></body></html>');
    w.document.close();
    var done = false;
    function go() { if (done) return; done = true; w.focus(); w.print(); }
    var imgs = Array.prototype.slice.call(w.document.images), pending = imgs.length;
    function one() { if (--pending <= 0) setTimeout(go, 700); }
    if (!pending) setTimeout(go, 700);
    imgs.forEach(function (i) { if (i.complete) one(); else { i.onload = one; i.onerror = one; } });
    setTimeout(go, 6000);
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
