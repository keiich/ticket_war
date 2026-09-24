/*
 * ticket_war engine
 * 対象サイト上で実行され、指定時刻(対象サーバー時刻基準)にボタンを最速で押す。
 * ボタンは複数ステップ指定できる (例: ①公演一覧で公演を押す → ②次のページで「申込」を押す)。
 * ページが切り替わっても localStorage で「次は何番目のステップか」を引き継ぐ。
 * 設定 C:
 *   at       : 発売時刻 (epoch ms, サーバー時刻基準)
 *   steps    : [{ sel: CSSセレクタ, text: ボタン文字 ("|" 区切りで複数候補・左が優先) }, ...]
 *   lead     : 何ms早く動くか
 *   sync     : true ならサイトの Date ヘッダで時計合わせ
 *   mode     : "reload" = 時刻に再読み込み→ステップ1を押す / "click" = 時刻にその場でステップ1を押す
 *   window   : 各ステップのボタンを探し続ける最大ms
 *   exclude  : 文字検索で除外する語の正規表現 (空なら既定: 方法|について|規約…)
 *   repeat   : 押す回数 / gap: 間隔ms
 *   retry    : reload モードでステップ1のボタンが出ない時、再読み込みまでの待ちms
 *   maxReload: 再読み込みの最大回数
 *   url      : reload モードで開くURL (空なら今のページを再読み込み)
 *   key      : 状態保存キー (空なら保存しない)
 */
window.TW_ENGINE = function (C) {
  var now = function () { return performance.timeOrigin + performance.now(); };
  var steps = C.steps || [{ sel: C.sel, text: C.text }];
  var W = C.window || 30000;
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
  function find(step) {
    if (step.sel) {
      var list = document.querySelectorAll(step.sel);
      for (var i = 0; i < list.length; i++) if (visible(list[i]) && !list[i].disabled) return list[i];
      return null;
    }
    if (!step.text) return null;
    var words = step.text.split("|").map(function (w) { return w.trim(); }).filter(Boolean);
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

  function store(v) { if (!C.key) return; try { v === null ? localStorage.removeItem(C.key) : localStorage.setItem(C.key, v); } catch (e) {} }
  function stored() { if (!C.key) return null; try { return localStorage.getItem(C.key); } catch (e) { return null; } }
  function reloads(v) { try { if (v === undefined) return Number(localStorage.getItem(C.key + "_n") || 0); localStorage.setItem(C.key + "_n", String(v)); } catch (e) { return 0; } }
  function navigate() { if (C.url) location.href = C.url; else location.reload(); }

  // ステップ k のボタンを押し、次のステップへ進める
  function hit(k, el) {
    var t = now();
    var last = k + 1 >= steps.length;
    store(last ? "done" : "s:" + (k + 1)); // 先に保存 (押した直後にページが切り替わるため)
    for (var r = 0; r < (C.repeat || 1); r++) {
      (function (r) {
        var f = function () {
          try { el.focus && el.focus({ preventScroll: true }); } catch (e) {}
          el.click();
        };
        if (r === 0) f(); else setTimeout(f, r * (C.gap || 30));
      })(r);
    }
    var label = "ステップ" + (k + 1) + " CLICK! " + fmt(t + offset);
    if (k === 0) { var diff = t + offset - C.at; label += " (目標比 " + (diff >= 0 ? "+" : "") + diff.toFixed(1) + "ms)"; }
    log(label);
    return t + offset - C.at;
  }

  // ボタンが出るまで待つ (MutationObserver + 4ms ポーリング)。見つからなければ cb(null)
  function hunt(k, deadline, cb) {
    var el = find(steps[k]);
    if (el) return cb(hit(k, el));
    log("ステップ" + (k + 1) + ": ボタン待機中…");
    var fired = false;
    var mo = new MutationObserver(function () {
      if (fired) return;
      var e = find(steps[k]);
      if (e) { fired = true; mo.disconnect(); cb(hit(k, e)); }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "class", "style", "hidden"] });
    (function poll() {
      if (fired) return;
      var e = find(steps[k]);
      if (e) { fired = true; mo.disconnect(); return cb(hit(k, e)); }
      if (now() > deadline) { mo.disconnect(); return cb(null); }
      setTimeout(poll, 4);
    })();
  }

  // ステップ k から最後まで順に押す (同じページ内で次のボタンが出る場合にも対応)
  function chain(k, resolve, first) {
    hunt(k, now() + W, function (r) {
      if (r === null) { log("ステップ" + (k + 1) + ": ボタンが見つかりません（時間切れ）"); return resolve(first === undefined ? null : first); }
      if (first === undefined) first = r;
      if (k + 1 < steps.length) return chain(k + 1, resolve, first);
      log("全ステップ完了 ✓ ここからは手動で操作してください");
      resolve(first);
    });
  }

  return new Promise(function (resolve) {
    setInterval(function () {
      var r = C.at - (now() + offset);
      clockText = fmt(now() + offset) + (r > 0 ? "  残り " + (r / 1000).toFixed(r < 10000 ? 2 : 0) + "s" : "");
      paint();
    }, 33);

    var st = stored(), local = now();
    var inWindow = local > C.at - 120000 && local < C.at + W * steps.length + 120000;
    if (st === "done") { log("完了済み（このページでは何もしません）"); return resolve(null); }
    var m = /^s:(\d+)$/.exec(st || "");
    if (m && inWindow) {
      var k = +m[1];
      if (k === 0 && C.mode === "reload") {
        // 再読み込み後: ステップ1のボタンを狙い、無ければもう一度再読み込み
        log("再読み込み完了 → ステップ1を探索");
        return hunt(0, local + (C.retry || 1000), function (r) {
          if (r !== null) return steps.length > 1 ? chain(1, resolve, r) : (log("全ステップ完了 ✓ ここからは手動で操作してください"), resolve(r));
          if (now() < C.at + W + 60000 && reloads() < (C.maxReload || 20)) {
            reloads(reloads() + 1);
            log("ボタン未出現 → 再読み込み");
            navigate();
          } else { store(null); log("諦めました（再読み込み上限）"); resolve(null); }
        });
      }
      log("ステップ" + (k + 1) + " へ");
      return chain(k, resolve);
    }

    (C.sync ? sync() : Promise.resolve(0)).then(function (o) {
      offset = o;
      var fireLocal = C.at - offset - (C.lead || 0);
      if (fireLocal < now() - W) { log("発売時刻を過ぎています"); return resolve(null); }
      log("目標 " + fmt(C.at) + " / " + (C.mode === "reload" ? "再読み込み" : "その場で押す") + " / ボタン" + steps.length + "段階");

      // 直前に接続を温める (TCP/TLS keep-alive)
      var warm = fireLocal - 2500 - now();
      if (warm > 0) setTimeout(function () { fetch(location.href, { method: "HEAD", cache: "no-store", credentials: "include" }).catch(function () {}); }, warm);

      function go() {
        while (now() < fireLocal) {} // 最後の数十msはビジーウェイトで精度を出す
        if (C.mode === "reload") {
          store("s:0");
          reloads(0);
          log("RELOAD! " + fmt(now() + offset));
          return navigate();
        }
        store("s:0");
        chain(0, resolve);
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
