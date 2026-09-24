/*
 * ticket_war engine
 * 対象サイト上で実行され、指定時刻(対象サーバー時刻基準)にボタンを最速でクリックする。
 * 設定 C:
 *   at       : 発火時刻 (epoch ms, サーバー時刻基準)
 *   sel      : CSSセレクタ (空なら text で探す)
 *   text     : ボタンの文字列 (部分一致)
 *   lead     : 何ms早く発火するか (通信遅延の先取り)
 *   sync     : true なら対象サーバーの Date ヘッダで時計合わせ
 *   mode     : "click" = その場でクリック / "reload" = 時刻にリロード→出現したら即クリック
 *   window   : 時刻後、要素を探し続ける最大ms
 *   repeat   : クリック回数 (連打)
 *   gap      : 連打間隔ms
 *   url      : reload モードで開くURL (空なら同じページをリロード)
 *   key      : userscript の状態保存キー
 */
window.TW_ENGINE = function (C) {
  var now = function () { return performance.timeOrigin + performance.now(); };
  var box = document.getElementById("__tw_box");
  if (!box) {
    box = document.createElement("div");
    box.id = "__tw_box";
    box.style.cssText = "position:fixed;z-index:2147483647;right:8px;bottom:8px;max-width:360px;font:12px/1.5 ui-monospace,monospace;background:rgba(10,10,20,.92);color:#9f9;padding:8px 10px;border-radius:8px;pointer-events:none;white-space:pre-wrap";
    (document.body || document.documentElement).appendChild(box);
  }
  var lines = [], clockText = "";
  var paint = function () { box.textContent = "⚡ticket_war  " + clockText + "\n" + lines.join("\n"); };
  var log = function (s) { lines.push(s); if (lines.length > 12) lines.shift(); paint(); };

  var offset = 0;
  var fmt = function (t) { var d = new Date(t); return d.toLocaleTimeString("ja-JP", { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0"); };

  function sync() {
    var url = location.origin + "/";
    var lo = -Infinity, hi = Infinity, mids = [], n = 0, N = 14;
    return new Promise(function (resolve) {
      function one() {
        var t0 = now();
        fetch(location.href, { method: "HEAD", cache: "no-store", credentials: "include" }).catch(function () {
          return fetch(url, { method: "HEAD", cache: "no-store", credentials: "include" });
        }).then(function (r) {
          var t1 = now(), d = r.headers.get("date");
          if (d) {
            var S = Date.parse(d);
            lo = Math.max(lo, S - t1);
            hi = Math.min(hi, S + 1000 - t0);
            mids.push(S + 500 - (t0 + t1) / 2);
          }
        }).catch(function () {}).then(function () {
          n++;
          if (n >= N) return done();
          setTimeout(one, 70 + ((n * 618) % 1000) / 3);
        });
      }
      function done() {
        if (!mids.length) { log("時計合わせ失敗 → PCの時計を使用"); return resolve(0); }
        var o;
        if (lo <= hi) { o = (lo + hi) / 2; log("サーバー時差 " + Math.round(o) + "ms (誤差±" + Math.round((hi - lo) / 2) + "ms)"); }
        else { mids.sort(function (a, b) { return a - b; }); o = mids[mids.length >> 1]; log("サーバー時差 " + Math.round(o) + "ms (推定)"); }
        resolve(o);
      }
      one();
    });
  }

  function visible(el) { return el.offsetParent !== null || el.getClientRects().length > 0; }
  function find() {
    if (C.sel) {
      var list = document.querySelectorAll(C.sel);
      for (var i = 0; i < list.length; i++) if (visible(list[i]) && !list[i].disabled) return list[i];
      return null;
    }
    if (C.text) {
      var c = document.querySelectorAll("button,a,input[type=submit],input[type=button],[role=button],label");
      for (var j = 0; j < c.length; j++) {
        var t = (c[j].innerText || c[j].value || "").trim();
        if (t.indexOf(C.text) >= 0 && visible(c[j]) && !c[j].disabled) return c[j];
      }
    }
    return null;
  }

  function hit(el) {
    var t = now();
    for (var k = 0; k < (C.repeat || 1); k++) {
      (function (k) {
        var f = function () {
          try { el.focus && el.focus({ preventScroll: true }); } catch (e) {}
          el.click();
        };
        if (k === 0) f(); else setTimeout(f, k * (C.gap || 30));
      })(k);
    }
    var diff = t + offset - C.at;
    log("CLICK! " + fmt(t + offset) + " (目標比 " + (diff >= 0 ? "+" : "") + diff.toFixed(1) + "ms)");
    return diff;
  }

  function hunt(deadline, cb) {
    var el = find();
    if (el) return cb(hit(el));
    log("ボタン待機中…");
    var fired = false;
    var mo = new MutationObserver(function () {
      if (fired) return;
      var e = find();
      if (e) { fired = true; mo.disconnect(); cb(hit(e)); }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "class", "style", "hidden"] });
    (function poll() {
      if (fired) return;
      var e = find();
      if (e) { fired = true; mo.disconnect(); return cb(hit(e)); }
      if (now() + offset > deadline) { mo.disconnect(); log("時間切れ: ボタンが見つかりません"); return cb(null); }
      setTimeout(poll, 4);
    })();
  }

  function store(v) { if (!C.key) return; try { v === null ? localStorage.removeItem(C.key) : localStorage.setItem(C.key, v); } catch (e) {} }
  function stored() { if (!C.key) return null; try { return localStorage.getItem(C.key); } catch (e) { return null; } }

  return new Promise(function (resolve) {
    var tick = setInterval(function () {
      var r = C.at - (now() + offset);
      clockText = fmt(now() + offset) + (r > 0 ? "  残り " + (r / 1000).toFixed(r < 10000 ? 2 : 0) + "s" : "");
      paint();
    }, 33);

    var server = now() + offset;
    if (C.mode === "reload" && stored() === String(C.at) && server >= C.at - 1000 && server < C.at + (C.window || 30000)) {
      // リロード後: 即座にボタンを狙う
      store(null);
      log("リロード完了 → ボタン探索");
      return hunt(C.at + (C.window || 30000), resolve);
    }

    (C.sync ? sync() : Promise.resolve(0)).then(function (o) {
      offset = o;
      var fireLocal = C.at - offset - (C.lead || 0);
      if (fireLocal < now() - (C.window || 30000)) { log("目標時刻を過ぎています"); return resolve(null); }
      log("目標 " + fmt(C.at) + " / " + (C.mode === "reload" ? "リロード" : "クリック") + " / 先行 " + (C.lead || 0) + "ms");

      // 直前に接続を温める (TCP/TLS keep-alive)
      var warm = fireLocal - 2500 - now();
      if (warm > 0) setTimeout(function () { fetch(location.href, { method: "HEAD", cache: "no-store", credentials: "include" }).catch(function () {}); }, warm);

      function go() {
        while (now() < fireLocal) {} // 最後の数十msはビジーウェイトで精度を出す
        if (C.mode === "reload") {
          store(String(C.at));
          log("RELOAD! " + fmt(now() + offset));
          if (C.url) location.href = C.url; else location.reload();
          return;
        }
        hunt(C.at + (C.window || 30000), resolve);
      }
      // 長い待ちは段階的に再スケジュール (タイマーのズレ対策)
      (function arm() {
        var w = fireLocal - now();
        if (w > 1500) setTimeout(arm, Math.min(w - 1000, 60000));
        else if (w > 40) setTimeout(arm, w - 40);
        else go();
      })();
    });
  });
};
