/*
 * ticket_war engine
 * 対象サイト上で実行され、指定時刻(対象サーバー時刻基準)にボタンを最速でクリックする。
 * 設定 C:
 *   at       : 発火時刻 (epoch ms, サーバー時刻基準)
 *   sel      : CSSセレクタ (空なら text で探す)
 *   text     : ボタンの文字列 (部分一致, "|" 区切りで複数候補・左が優先)
 *   lead     : 何ms早く発火するか (通信遅延の先取り)
 *   sync     : true なら対象サーバーの Date ヘッダで時計合わせ
 *   mode     : "click" = その場でクリック / "reload" = 時刻にリロード→出現したら即クリック
 *   window   : 時刻後、要素を探し続ける最大ms
 *   exclude  : text 検索で除外する語の正規表現 (空なら既定: 方法|について|規約…)
 *   repeat   : クリック回数 (連打)
 *   gap      : 連打間隔ms
 *   retry    : reload モードでボタンが出ない時、再リロードまでの待ちms
 *   maxReload: 再リロードの最大回数
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

  // Date ヘッダは秒単位なので「秒が切り替わる瞬間」を狙って何度も測り、時差の範囲 [lo, hi] を絞り込む
  function sync() {
    var url = location.origin + "/";
    var lo = -Infinity, hi = Infinity, rtt = 200, n = 0, N = 16;
    function probe() {
      var t0 = now();
      return fetch(location.href, { method: "HEAD", cache: "no-store", credentials: "include" }).catch(function () {
        return fetch(url, { method: "HEAD", cache: "no-store", credentials: "include" });
      }).then(function (r) {
        var t1 = now(), S = Date.parse(r.headers.get("date"));
        if (isNaN(S)) return;
        rtt = Math.min(rtt, t1 - t0);
        lo = Math.max(lo, S - t1);
        hi = Math.min(hi, S + 1000 - t0);
      }).catch(function () {});
    }
    return new Promise(function (resolve) {
      (function next() {
        if (n++ >= N || (hi - lo < rtt + 4 && n > 6)) return done();
        var delay = 50 + ((n * 618) % 1000) / 2;
        if (isFinite(lo) && lo <= hi) {
          // 推定される次の「秒の切り替わり」に、リクエストの中間点が重なるよう送信
          var guess = (lo + hi) / 2, t = now() + 30;
          var boundary = Math.ceil((t + guess + rtt / 2) / 1000) * 1000;
          delay = Math.max(0, boundary - guess - rtt / 2 - now());
        }
        setTimeout(function () { probe().then(next); }, delay);
      })();
      function done() {
        if (!isFinite(lo) || lo > hi) { log("時計合わせ失敗 → PCの時計を使用"); return resolve(0); }
        // 早すぎる発火を避けるため「最も遅い側」(lo) を採用。早めたい時は先行発火msで調整
        log("サーバー時差 " + Math.round(lo) + "〜" + Math.round(hi) + "ms (遅い側に合わせる, rtt " + Math.round(rtt) + "ms)");
        resolve(lo);
      }
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
      var words = C.text.split("|").map(function (w) { return w.trim(); }).filter(Boolean);
      var c = document.querySelectorAll("button,input[type=submit],input[type=button],input[type=image],a,[role=button]");
      var ng = new RegExp(C.exclude || "方法|について|案内|ガイド|注意|規約|よくある|FAQ|履歴|変更|取消|キャンセル|ログイン|会員|登録|ヘルプ|問い合わせ|終了|発売前|予定");
      var best = null, bestScore = Infinity;
      for (var j = 0; j < c.length; j++) {
        var el = c[j], t = (el.innerText || el.value || el.alt || el.title || "").replace(/\s+/g, "");
        if (!t || t.length > 12 || ng.test(t) || el.disabled || !visible(el)) continue;
        for (var w = 0; w < words.length; w++) {
          if (t.indexOf(words[w]) < 0) continue;
          // 候補の優先度: 先に書いた語 > 本物のボタン > 短いラベル
          var score = w * 1000 + (/^(BUTTON|INPUT)$/.test(el.tagName) ? 0 : 100) + t.length;
          if (score < bestScore) { bestScore = score; best = el; }
          break;
        }
      }
      return best;
    }
    return null;
  }

  function hit(el) {
    var t = now();
    store("done");
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
      if (now() > deadline) { mo.disconnect(); log("時間切れ: ボタンが見つかりません"); return cb(null); }
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

    var W = C.window || 30000, st = stored(), local = now();
    if (st === "done") { log("クリック済み（このページでは何もしません）"); return resolve(null); }
    if (C.mode === "reload" && st === String(C.at) && local > C.at - 120000 && local < C.at + W + 120000) {
      // リロード後: 即座にボタンを狙い、無ければ再リロード
      log("リロード完了 → ボタン探索");
      var found = false, retry = C.retry || 1000;
      hunt(local + retry, function (r) {
        if (r !== null) { found = true; return resolve(r); }
        if (now() < C.at + W + 60000 && Number(localStorage.getItem(C.key + "_n") || 0) < (C.maxReload || 20)) {
          try { localStorage.setItem(C.key + "_n", Number(localStorage.getItem(C.key + "_n") || 0) + 1); } catch (e) {}
          log("ボタン未出現 → 再リロード");
          if (C.url) location.href = C.url; else location.reload();
        } else { store(null); log("諦めました（再リロード上限）"); resolve(null); }
      });
      return;
    }

    (C.sync ? sync() : Promise.resolve(0)).then(function (o) {
      offset = o;
      var fireLocal = C.at - offset - (C.lead || 0);
      if (fireLocal < now() - W) { log("目標時刻を過ぎています"); return resolve(null); }
      log("目標 " + fmt(C.at) + " / " + (C.mode === "reload" ? "リロード" : "クリック") + " / 先行 " + (C.lead || 0) + "ms");

      // 直前に接続を温める (TCP/TLS keep-alive)
      var warm = fireLocal - 2500 - now();
      if (warm > 0) setTimeout(function () { fetch(location.href, { method: "HEAD", cache: "no-store", credentials: "include" }).catch(function () {}); }, warm);

      function go() {
        while (now() < fireLocal) {} // 最後の数十msはビジーウェイトで精度を出す
        if (C.mode === "reload") {
          store(String(C.at));
          try { localStorage.setItem(C.key + "_n", "0"); } catch (e) {}
          log("RELOAD! " + fmt(now() + offset));
          if (C.url) location.href = C.url; else location.reload();
          return;
        }
        hunt(now() + W, resolve);
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
