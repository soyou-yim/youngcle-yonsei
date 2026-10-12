/* =====================================================================
   엔보임(nvoimp.com) → youngcle 피드백 가져오기
   ---------------------------------------------------------------------
   사용법: nvoimp.com "원스톱 관리" 화면에서 북마크 버튼을 누르면 이 파일이 실행됩니다.
     1) 지금 화면에 보이는 날짜의 학생들 중 피드백(view)이 있는 학생만 골라
        문장교정(SentenceCorrection) / 발음교정(MispronouncedWord)을 읽어옵니다.
     2) 화면 위에 미리보기 창을 띄우고, "youngcle로 보내기"를 누르면
        youngcle 관리자 페이지(admin.html)를 새 창으로 열어 데이터를 넘겨줍니다.
   nvoimp 비밀번호는 어디에도 저장하지 않습니다(이미 로그인된 브라우저에서만 동작).
   ===================================================================== */
(function () {
  'use strict';

  // 이 스크립트를 불러온 youngcle 사이트 주소(예: https://youngcle.kr)를 자동으로 알아냅니다.
  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || 'https://youngcle.kr/js/nvoim-import.js';
  var YOUNGCLE_ORIGIN = new URL(SCRIPT_SRC).origin;
  var PANEL_ID = 'youngcle-import-panel';

  if (!/nvoimp\.com$/i.test(location.hostname)) {
    alert('엔보임 플래너(nvoimp.com)의 "원스톱 관리" 화면에서 눌러주세요.');
    return;
  }
  if (!window.jQuery || !document.querySelector('#OneStopList')) {
    alert('"원스톱 관리" 화면(학생 목록이 보이는 페이지)에서 눌러주세요.');
    return;
  }
  var $ = window.jQuery;

  var old = document.getElementById(PANEL_ID);
  if (old) old.remove();

  /* ---------- 미리보기 창 ---------- */
  var panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.innerHTML =
    '<style>' +
    '#' + PANEL_ID + '{position:fixed;inset:0;z-index:2147483000;background:rgba(15,20,35,.55);display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;}' +
    '#' + PANEL_ID + ' .yc-box{background:#fff;width:min(720px,94vw);max-height:86vh;display:flex;flex-direction:column;border-radius:14px;border-top:4px solid #C9A227;box-shadow:0 20px 50px rgba(0,0,0,.3);}' +
    '#' + PANEL_ID + ' .yc-head{padding:16px 20px;border-bottom:1px solid #EAE1C8;display:flex;justify-content:space-between;align-items:center;gap:10px;}' +
    '#' + PANEL_ID + ' .yc-head b{font-size:17px;color:#1B2A4E;}' +
    '#' + PANEL_ID + ' .yc-body{padding:12px 20px;overflow:auto;flex:1;font-size:14px;color:#3C4257;}' +
    '#' + PANEL_ID + ' .yc-foot{padding:14px 20px;border-top:1px solid #EAE1C8;display:flex;justify-content:flex-end;gap:8px;}' +
    '#' + PANEL_ID + ' button{border:0;border-radius:9px;padding:9px 16px;font-size:14px;font-weight:700;cursor:pointer;}' +
    '#' + PANEL_ID + ' .yc-primary{background:#C9A227;color:#1B1503;}' +
    '#' + PANEL_ID + ' .yc-primary:disabled{opacity:.45;cursor:default;}' +
    '#' + PANEL_ID + ' .yc-ghost{background:#fff;color:#1B2A4E;border:1px solid #EAE1C8;}' +
    '#' + PANEL_ID + ' .yc-row{border:1px solid #EAE1C8;background:#FBF9F2;border-radius:10px;padding:10px 12px;margin:8px 0;}' +
    '#' + PANEL_ID + ' .yc-row .yc-name{font-weight:800;color:#1B2A4E;}' +
    '#' + PANEL_ID + ' .yc-row .yc-meta{font-size:12px;color:#7C7566;margin-top:2px;}' +
    '#' + PANEL_ID + ' .yc-row pre{white-space:pre-wrap;font:12px/1.5 inherit;font-family:inherit;margin:8px 0 0;color:#3C4257;max-height:140px;overflow:auto;}' +
    '#' + PANEL_ID + ' .yc-err{color:#C4453A;font-weight:700;}' +
    '</style>' +
    '<div class="yc-box">' +
    '  <div class="yc-head"><b>📥 youngcle로 피드백 보내기</b><button class="yc-ghost yc-close">닫기</button></div>' +
    '  <div class="yc-body"><div class="yc-status">피드백을 읽어오는 중...</div><div class="yc-list"></div></div>' +
    '  <div class="yc-foot"><button class="yc-ghost yc-close">취소</button><button class="yc-primary yc-send" disabled>youngcle로 보내기</button></div>' +
    '</div>';
  document.body.appendChild(panel);

  var statusEl = panel.querySelector('.yc-status');
  var listEl = panel.querySelector('.yc-list');
  var sendBtn = panel.querySelector('.yc-send');
  panel.querySelectorAll('.yc-close').forEach(function (b) { b.addEventListener('click', function () { panel.remove(); }); });

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ---------- 데이터 수집 ---------- */
  function getDate() {
    var input = document.querySelector('input[name="SearchDate"], #SearchDate');
    var v = input && input.value;
    if (!v) v = new URLSearchParams(location.search).get('SearchDate');
    return v || new Date().toISOString().slice(0, 10);
  }

  function field($df, name) { return $df.find('[ColumnName="' + name + '"]').attr('Columnvalue') || ''; }

  function fetchFeedback(params) {
    return new Promise(function (resolve, reject) {
      $.ajax({
        url: '/Lecture/Process/LectureEvaluationProc.asp',
        type: 'POST',
        dataType: 'xml',
        data: Object.assign({ ActionType: 'getLectureAttendanceList' }, params),
        success: function (xml) {
          var $list = $(xml).find('List').first();
          if (!$list.length) return reject(new Error('피드백 데이터를 읽지 못했어요 (로그인이 풀렸을 수 있어요).'));
          resolve({
            sentenceCorrection: $list.children('SentenceCorrection').text() || '',
            mispronouncedWord: $list.children('MispronouncedWord').text() || '',
            teacher: $list.children('TeacherID').text() || '',
          });
        },
        error: function () { reject(new Error('엔보임 서버 응답 오류')); },
      });
    });
  }

  async function collect() {
    var date = getDate();
    var rows = Array.prototype.filter.call(document.querySelectorAll('#OneStopList tbody tr'), function (tr) {
      return tr.querySelector('.btnTeacherNote');
    });
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var $df = $(rows[i]).find('div.DataField');
      var params = {
        F_STDT_ID: field($df, 'F_STDT_ID'),
        F_PICEDUCCLS_SEQ_PROGRESS: field($df, 'F_PICEDUCCLS_SEQ_PROGRESS'),
        EvaluationSeq: field($df, 'EvaluationSeq'),
        F_PICEDUCCLS_SEQ: field($df, 'F_PICEDUCCLS_SEQ'),
        F_PICEDUCATDC_SEQ: field($df, 'F_PICEDUCATDC_SEQ'),
      };
      var item = { nvoimId: params.F_STDT_ID, name: field($df, 'F_STDT_NM'), lessonKey: params.F_PICEDUCATDC_SEQ, date: date };
      statusEl.textContent = '피드백을 읽어오는 중... (' + (i + 1) + '/' + rows.length + ') ' + item.name;
      try {
        Object.assign(item, await fetchFeedback(params));
      } catch (e) {
        item.error = e.message;
      }
      out.push(item);
    }
    return { date: date, students: out };
  }

  /* ---------- youngcle 관리자 페이지로 넘기기 ---------- */
  function sendToYoungcle(payload) {
    var win = window.open(YOUNGCLE_ORIGIN + '/admin.html?import=nvoim', 'youngcle_import');
    if (!win) { alert('팝업이 차단됐어요. 주소창 오른쪽의 팝업 차단 아이콘에서 허용해주세요.'); return; }
    var sent = false;
    function onMsg(ev) {
      if (ev.origin !== YOUNGCLE_ORIGIN || ev.source !== win) return;
      if (ev.data && ev.data.type === 'youngcle-import-ready' && !sent) {
        sent = true;
        win.postMessage({ type: 'youngcle-import-data', payload: payload }, YOUNGCLE_ORIGIN);
      }
      if (ev.data && ev.data.type === 'youngcle-import-received') {
        window.removeEventListener('message', onMsg);
        statusEl.innerHTML = '✅ youngcle 관리자 창으로 보냈어요. 그 창에서 확인 후 저장해주세요.';
        sendBtn.disabled = true;
      }
    }
    window.addEventListener('message', onMsg);
  }

  collect().then(function (payload) {
    var withContent = payload.students.filter(function (s) { return !s.error && (s.sentenceCorrection.trim() || s.mispronouncedWord.trim()); });
    if (!payload.students.length) {
      statusEl.innerHTML = '<span class="yc-err">' + esc(payload.date) + ' — 피드백(view)이 있는 학생이 없어요.</span>';
      return;
    }
    statusEl.innerHTML = '<b>' + esc(payload.date) + '</b> · 피드백 ' + withContent.length + '명 (전체 ' + payload.students.length + '명)';
    listEl.innerHTML = payload.students.map(function (s) {
      var body = s.error
        ? '<div class="yc-err">⚠️ ' + esc(s.error) + '</div>'
        : '<pre>' + esc(s.sentenceCorrection.trim() || '(문장교정 없음)') + '</pre>' +
          '<div class="yc-meta">발음교정: ' + esc(s.mispronouncedWord.trim().replace(/\s*\n\s*/g, ', ') || '없음') + '</div>';
      return '<div class="yc-row"><div class="yc-name">' + esc(s.name) + ' <span class="yc-meta">(' + esc(s.nvoimId) + ')</span></div>' + body + '</div>';
    }).join('');
    payload.students = withContent;
    if (withContent.length) {
      sendBtn.disabled = false;
      sendBtn.addEventListener('click', function () { sendToYoungcle(payload); });
    }
  }).catch(function (e) {
    statusEl.innerHTML = '<span class="yc-err">⚠️ ' + esc(e.message) + '</span>';
  });
})();
