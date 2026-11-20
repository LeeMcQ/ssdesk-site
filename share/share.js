// Share page helpers: Copy link, Share... (phones) and Print this.
// The page works without this file: the share buttons are plain links.
(function () {
  'use strict';
  var BASE = 'https://ssdesk.online/';
  var PITCH = 'Sabbath Service Desk: a free church presenter for Bible, hymns, slides and video. It works with no internet.';
  function tagged(source) { return BASE + '?utm_source=' + source + '&utm_medium=share'; }
  function $(id) { return document.getElementById(id); }
  var statusEl = $('status');
  var timer = 0;
  function say(msg) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    clearTimeout(timer);
    timer = setTimeout(function () { statusEl.textContent = ''; }, 4000);
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  var copyBtn = $('copy');
  if (copyBtn) {
    copyBtn.hidden = false;
    copyBtn.addEventListener('click', function () {
      var url = tagged('copy');
      copy(url).then(function (ok) {
        if (ok) say('Link copied. Now paste it in a message.');
        else {
          var line = $('linkline');
          if (line && window.getSelection) {
            var r = document.createRange(); r.selectNodeContents(line);
            var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
          }
          say('Could not copy by itself. The link is selected: press and hold, then Copy.');
        }
      });
    });
  }

  var nativeBtn = $('native');
  if (nativeBtn && typeof navigator.share === 'function') {
    nativeBtn.hidden = false;
    nativeBtn.addEventListener('click', function () {
      navigator.share({ title: 'Sabbath Service Desk', text: PITCH, url: tagged('native') }).catch(function (e) {
        if (e && e.name !== 'AbortError') say('Sharing did not work. Try one of the buttons above.');
      });
    });
  }

  var printBtn = $('print');
  if (printBtn && typeof window.print === 'function') {
    printBtn.hidden = false;
    printBtn.addEventListener('click', function () { window.print(); });
  }
})();
