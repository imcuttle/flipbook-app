/* Self-contained static flipbook viewer.
 *
 * Classic (non-module) script so it runs from file:// with zero network
 * access. All data is provided by data.js as window.__FLIPBOOK__ =
 * { topic, root, orientation, nodes: { hash: node }, tree: {nodes} }.
 * Images are plain relative <img src="images/<hash>.png"> files in the zip.
 *
 * Mirrors the live app's read-only preview: image stage, leader-lined
 * hotspot cards (click to drill in), selectable OCR text overlay, caption
 * (inline markdown), breadcrumb, catalog (目录) and sources popovers.
 */
(function () {
  'use strict';
  var DATA = window.__FLIPBOOK__ || { nodes: {}, tree: { nodes: {} } };
  var NODES = DATA.nodes || {};
  var TREE = DATA.tree || { nodes: {} };
  var IS_PORTRAIT = DATA.orientation === 'portrait';

  // Mutable UI state (top-bar controls). LANG starts from the export's
  // language but is switchable; showLabels toggles hotspot cards + leaders.
  var state = {
    lang: (DATA.lang === 'en') ? 'en' : 'zh',
    showLabels: true,
    fullscreen: false,
  };

  var STRINGS = {
    zh: { catalog: '目录', sources: '参考资料', lang: 'English', labelsOn: '隐藏热点', labelsOff: '显示热点',
      fsEnter: '全屏', fsExit: '退出全屏', github: 'GitHub' },
    en: { catalog: 'Catalog', sources: 'Sources', lang: '中文', labelsOn: 'Hide labels', labelsOff: 'Show labels',
      fsEnter: 'Fullscreen', fsExit: 'Exit fullscreen', github: 'GitHub' },
  };
  function T() { return STRINGS[state.lang]; }

  var GITHUB_URL = 'https://github.com/imcuttle/flipbook-app';
  var root = document.getElementById('root');
  var current = DATA.root;
  // Tracks the previous node so a navigation can pick the right transition
  // (drill in to a child, pull up to an ancestor, fade otherwise).
  var prevHash = null;
  var enterMode = 'none';
  // Hash of the node the stage currently shows. Lets a re-render for the SAME
  // node (label / fullscreen toggle) skip the blur-up animation.
  var lastRenderedHash = null;

  // ---- helpers ----
  function clamp01(n) { n = Number(n) || 0; return n < 0 ? 0 : n > 1 ? 1 : n; }
  function pct(n) { return (clamp01(n) * 100).toFixed(2) + '%'; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Inline-only markdown → HTML (bold/italic/strike/code/links). Mirrors the
  // app's CaptionMarkdown allowed set. Text is escaped first so this is
  // XSS-safe even though the data is trusted (locally exported).
  function inlineMarkdown(src) {
    var s = esc(src);
    // links [text](url)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      function (_, t, u) { return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>'; });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    return s;
  }

  // ---- hotspot layout (ported from web/src/lib/layout.ts) ----
  // Resolve label-card collisions while (1) keeping each card as close as
  // possible to its OWN dot and (2) avoiding leader-line crossings. We search
  // candidate positions on rings around the dot and pick the lowest-cost
  // non-overlapping one (crossings heavily penalised).
  var CARD_W = 0.18, CARD_H = 0.06, PADDING = 0.012, MIN_DIST = 0.05, CROSS_PENALTY = 10;
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function rectAtCenter(cx, cy) { return { x: cx - CARD_W / 2, y: cy - CARD_H / 2, w: CARD_W, h: CARD_H }; }
  function overlaps(a, b) {
    return !(a.x + a.w + PADDING <= b.x || b.x + b.w + PADDING <= a.x ||
             a.y + a.h + PADDING <= b.y || b.y + b.h + PADDING <= a.y);
  }
  function attachEdge(r, lx, ly) {
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    var dx = lx - cx, dy = ly - cy;
    if (dx === 0 && dy === 0) return [cx, cy];
    var tx = dx === 0 ? Infinity : (r.w / 2) / Math.abs(dx);
    var ty = dy === 0 ? Infinity : (r.h / 2) / Math.abs(dy);
    var t = Math.min(tx, ty);
    return [cx + dx * t, cy + dy * t];
  }
  function segmentsCross(a, b, c, d) {
    function o(p, q, r) { return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]); }
    var o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
    return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
  }
  function layOutHotspots(hotspots) {
    var placed = [], out = [];
    var cxLo = 0.01 + CARD_W / 2, cxHi = 0.99 - CARD_W / 2;
    var cyLo = 0.01 + CARD_H / 2, cyHi = 0.99 - CARD_H / 2;
    hotspots.forEach(function (h, idx) {
      var lx = clamp((h.leader_xy && h.leader_xy[0] != null) ? h.leader_xy[0] : ((h.anchor_xy && h.anchor_xy[0]) || 0.5), 0, 1);
      var ly = clamp((h.leader_xy && h.leader_xy[1] != null) ? h.leader_xy[1] : ((h.anchor_xy && h.anchor_xy[1]) || 0.5), 0, 1);
      var hintCx = ((h.anchor_xy && h.anchor_xy[0] != null) ? h.anchor_xy[0] : lx) + CARD_W / 2;
      var hintCy = ((h.anchor_xy && h.anchor_xy[1] != null) ? h.anchor_xy[1] : ly) + CARD_H / 2;
      var baseAngle = Math.atan2(hintCy - ly, hintCx - lx);
      if (!isFinite(baseAngle)) baseAngle = -Math.PI / 4;

      var candidates = [[hintCx, hintCy]];
      var ANGLE_STEPS = 16;
      for (var r = MIN_DIST; r <= 0.36; r += 0.03) {
        for (var i = 0; i < ANGLE_STEPS; i++) {
          var k = Math.ceil(i / 2) * (i % 2 === 0 ? 1 : -1);
          var ang = baseAngle + k * ((2 * Math.PI) / ANGLE_STEPS);
          candidates.push([lx + r * Math.cos(ang), ly + r * Math.sin(ang)]);
        }
      }

      var best = null, bestCost = Infinity;
      for (var ci = 0; ci < candidates.length; ci++) {
        var cx = clamp(candidates[ci][0], cxLo, cxHi);
        var cy = clamp(candidates[ci][1], cyLo, cyHi);
        var rc = rectAtCenter(cx, cy);
        var hit = false;
        for (var pi = 0; pi < placed.length; pi++) { if (overlaps(rc, placed[pi].rect)) { hit = true; break; } }
        if (hit) continue;
        var attach = attachEdge(rc, lx, ly);
        var crossings = 0;
        for (var pj = 0; pj < placed.length; pj++) {
          if (segmentsCross([lx, ly], attach, placed[pj].dot, placed[pj].attach)) crossings++;
        }
        var dist = Math.hypot(cx - lx, cy - ly);
        var cost = crossings * CROSS_PENALTY + dist;
        if (cost < bestCost) { bestCost = cost; best = { rect: rc, attach: attach }; }
      }
      if (!best) {
        var fcx = clamp(hintCx, cxLo, cxHi), fcy = clamp(hintCy, cyLo, cyHi);
        var fr = rectAtCenter(fcx, fcy);
        best = { rect: fr, attach: attachEdge(fr, lx, ly) };
      }
      placed.push({ rect: best.rect, dot: [lx, ly], attach: best.attach });
      out.push({ anchor: [best.rect.x, best.rect.y], leader: [lx, ly], idx: idx });
    });
    return out;
  }

  // Compute where the leader line touches the card box edge.
  function attachPoint(card, lx, ly) {
    var cx = card.l + card.w / 2, cy = card.t + card.h / 2;
    var dx = lx - cx, dy = ly - cy;
    if (dx === 0 && dy === 0) return [cx, cy];
    var tx = dx === 0 ? Infinity : (card.w / 2) / Math.abs(dx);
    var ty = dy === 0 ? Infinity : (card.h / 2) / Math.abs(dy);
    var t = Math.min(tx, ty);
    return [cx + dx * t, cy + dy * t];
  }

  // ---- breadcrumb (uses node.path or walks tree) ----
  function pathOf(hash) {
    var node = NODES[hash];
    if (node && Array.isArray(node.path) && node.path.length) return node.path;
    // Fallback: walk tree parents.
    var chain = [], h = hash;
    while (h && TREE.nodes[h]) {
      chain.unshift({ hash: h, title: TREE.nodes[h].title || '' });
      h = TREE.nodes[h].parent;
    }
    return chain;
  }

  // ---- flatten tree for catalog (DFS, guide lines) ----
  function flattenTree(currentHash) {
    var rows = [];
    if (!TREE.nodes || !DATA.root) return rows;
    var onPath = {};
    var h = currentHash;
    while (h && TREE.nodes[h]) { onPath[h] = true; h = TREE.nodes[h].parent; }
    function walk(hash, depth, parentLast, isLast) {
      var n = TREE.nodes[hash];
      if (!n) return;
      var lastArr = parentLast.concat([isLast]);
      rows.push({ hash: hash, title: n.title || '', isLast: lastArr,
        isCurrent: hash === currentHash, onPath: !!onPath[hash] });
      var kids = n.children || [];
      kids.forEach(function (c, i) { walk(c, depth + 1, lastArr, i === kids.length - 1); });
    }
    walk(DATA.root, 0, [], true);
    return rows;
  }

  // ---- popovers ----
  function openOverlay(buildPanel) {
    var ov = el('div', 'overlay');
    var panel = buildPanel();
    ov.appendChild(panel);
    ov.addEventListener('click', function (e) { if (e.target === ov) document.body.removeChild(ov); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { if (ov.parentNode) document.body.removeChild(ov); document.removeEventListener('keydown', onKey); }
    });
    document.body.appendChild(ov);
    return ov;
  }

  function openCatalog() {
    openOverlay(function () {
      var rows = flattenTree(current);
      var panel = el('div', 'panel');
      var head = el('div', 'panelHead');
      head.appendChild(el('span', null, T().catalog + ' (' + rows.length + ')'));
      var close = el('button', 'panelClose', '×');
      head.appendChild(close);
      panel.appendChild(head);
      var list = el('div', 'list');
      rows.forEach(function (r) {
        var btn = el('button', 'row' + (r.isCurrent ? ' current' : '') + (r.onPath ? ' onPath' : ''));
        var guide = el('span', 'guide');
        guide.textContent = r.isLast.slice(1).map(function (last, i, arr) {
          var joint = i === arr.length - 1;
          if (joint) return last ? '└─ ' : '├─ ';
          return last ? '   ' : '│  ';
        }).join('');
        btn.appendChild(guide);
        btn.appendChild(el('span', 'rowTitle', r.title || '(untitled)'));
        btn.addEventListener('click', function () { navigate(r.hash); closeAllOverlays(); });
        list.appendChild(btn);
      });
      panel.appendChild(list);
      close.addEventListener('click', closeAllOverlays);
      return panel;
    });
  }

  function hostnameOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

  function openSources(sources) {
    openOverlay(function () {
      var panel = el('div', 'panel');
      var head = el('div', 'panelHead');
      head.appendChild(el('span', null, T().sources + ' (' + sources.length + ')'));
      var close = el('button', 'panelClose', '×');
      head.appendChild(close);
      panel.appendChild(head);
      var list = el('div', 'list');
      sources.slice(0, 30).forEach(function (s) {
        var a = el('a', 'srcItem');
        a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.appendChild(el('span', 'srcTitle', s.title || s.url));
        a.appendChild(el('span', 'srcMeta', s.source || hostnameOf(s.url)));
        if (s.snippet) a.appendChild(el('span', 'srcSnippet', s.snippet));
        list.appendChild(a);
      });
      panel.appendChild(list);
      close.addEventListener('click', closeAllOverlays);
      return panel;
    });
  }

  function closeAllOverlays() {
    var all = document.querySelectorAll('.overlay');
    for (var i = 0; i < all.length; i++) all[i].parentNode.removeChild(all[i]);
  }

  // ---- text layer alignment (matches Canvas/TextLayer) ----
  function placeTextLayer(layer, spans, imgEl, stageEl) {
    function measure() {
      var sr = stageEl.getBoundingClientRect();
      if (!sr.width || !sr.height) return;
      var iw = imgEl.naturalWidth, ih = imgEl.naturalHeight;
      var leftPct = 0, topPct = 0, wPct = 100, hPct = 100;
      if (iw && ih) {
        var stageAspect = sr.width / sr.height, imgAspect = iw / ih;
        if (imgAspect > stageAspect) { wPct = 100; hPct = (stageAspect / imgAspect) * 100; topPct = (100 - hPct) / 2; }
        else if (imgAspect < stageAspect) { hPct = 100; wPct = (imgAspect / stageAspect) * 100; leftPct = (100 - wPct) / 2; }
      }
      var stageHpx = sr.height;
      layer.innerHTML = '';
      spans.forEach(function (s) {
        var b = s.bbox; if (!b) return;
        var left = leftPct + b[0] * wPct, top = topPct + b[1] * hPct;
        var width = b[2] * wPct, height = b[3] * hPct;
        var fontPx = Math.max(6, (height / 100) * stageHpx);
        var sp = el('span', 'textSpan', s.text);
        sp.setAttribute('data-textspan', '1');
        sp.style.left = left + '%'; sp.style.top = top + '%';
        sp.style.width = width + '%'; sp.style.height = height + '%';
        sp.style.fontSize = fontPx.toFixed(2) + 'px';
        layer.appendChild(sp);
      });
      // Horizontal scale to fit bbox width (selection box hugs painted text).
      var els = layer.querySelectorAll('span[data-textspan="1"]');
      for (var i = 0; i < els.length; i++) {
        var e = els[i]; e.style.transform = '';
        var natural = e.scrollWidth, target = e.clientWidth;
        if (natural > 0 && target > 0) {
          var sx = target / natural;
          if (sx > 0.05 && sx < 20) e.style.transform = 'scaleX(' + sx.toFixed(4) + ')';
        }
      }
    }
    if (imgEl.complete && imgEl.naturalWidth) measure();
    else imgEl.addEventListener('load', measure);
    window.addEventListener('resize', measure);
  }

  // ---- main render ----
  function render() {
    var node = NODES[current];
    closeAllOverlays();
    root.innerHTML = '';
    var shell = el('div', 'shell');
    var win = el('div', 'window');

    // Top bar: breadcrumb (left) + control cluster (right)
    var topbar = el('div', 'topbar');
    var address = el('div', 'address');
    var crumbs = el('div', 'breadcrumb');
    var path = pathOf(current);
    path.forEach(function (p, i) {
      var last = i === path.length - 1;
      if (i > 0) crumbs.appendChild(el('span', 'crumbSep', '›'));
      var c = el('button', 'crumb' + (last ? ' current' : ''), p.title || '…');
      c.title = p.title || '';
      if (!last) c.addEventListener('click', function () { navigate(p.hash); });
      crumbs.appendChild(c);
    });
    address.appendChild(crumbs);
    topbar.appendChild(address);

    // Right-side control cluster: labels toggle, fullscreen, language, GitHub.
    var cluster = el('div', 'rightCluster');

    var labelsBtn = el('button', 'miniBtn' + (state.showLabels ? ' on' : ''));
    labelsBtn.innerHTML = svgIcon(state.showLabels ? 'tag-on' : 'tag-off');
    labelsBtn.title = state.showLabels ? T().labelsOn : T().labelsOff;
    labelsBtn.addEventListener('click', function () { state.showLabels = !state.showLabels; render(); });
    cluster.appendChild(labelsBtn);

    var fsBtn = el('button', 'miniBtn');
    fsBtn.innerHTML = svgIcon(state.fullscreen ? 'fs-exit' : 'fs-enter');
    fsBtn.title = state.fullscreen ? T().fsExit : T().fsEnter;
    fsBtn.addEventListener('click', toggleFullscreen);
    cluster.appendChild(fsBtn);

    var gh = el('a', 'miniBtn');
    gh.href = GITHUB_URL; gh.target = '_blank'; gh.rel = 'noopener noreferrer';
    gh.title = T().github;
    gh.innerHTML = svgIcon('github');
    cluster.appendChild(gh);

    topbar.appendChild(cluster);
    win.appendChild(topbar);

    if (!node) { win.appendChild(el('p', 'caption', '(missing node)')); shell.appendChild(win); root.appendChild(shell); return; }

    // Title row + catalog/sources badges
    var titleRow = el('div', 'titleRow');
    titleRow.appendChild(el('h2', 'title', node.title || ''));
    if (node.sources && node.sources.length) {
      var sb = el('button', 'badge');
      sb.innerHTML = svgIcon('sources') + '<span>' + node.sources.length + '</span>';
      sb.addEventListener('click', function () { openSources(node.sources); });
      titleRow.appendChild(sb);
    }
    var rowsCount = Object.keys(TREE.nodes || {}).length;
    if (rowsCount > 1) {
      var cb = el('button', 'badge');
      cb.innerHTML = svgIcon('catalog') + '<span>' + rowsCount + '</span>';
      cb.addEventListener('click', openCatalog);
      titleRow.appendChild(cb);
    }
    win.appendChild(titleRow);

    // Stage — apply the entrance-transition class chosen by navigate().
    var stageWrap = el('div', 'stageWrap');
    var stageCls = 'stage' + (IS_PORTRAIT ? ' portrait' : '');
    if (enterMode === 'drill') stageCls += ' enterDrill';
    else if (enterMode === 'up') stageCls += ' enterUp';
    else if (enterMode === 'fade') stageCls += ' enterFade';
    var stage = el('div', stageCls);

    var hasImage = !!node.image;
    var imgEl = null;
    if (hasImage) {
      imgEl = el('img', 'image');
      // Progressive loading chain: blur placeholder → medium → full. The blur
      // variant is a tiny JPG (preloaded at startup, see below) so it paints
      // instantly on drill instead of flashing the empty stage background.
      var full = node.image;
      var placeholder = node.image_blur || node.image_medium || null;
      // Skip the blur-up animation when this is a same-node RE-render (e.g.
      // toggling the labels / fullscreen switch). The picture is already
      // decoded + cached, so re-blurring it would be a pointless flicker —
      // only animate on an actual navigation to a different node.
      var sameNode = current === lastRenderedHash;
      if (placeholder && !sameNode) {
        imgEl.src = placeholder;
        imgEl.className = 'image blurUp';
        // Upgrade through medium first (if present and distinct) for a faster
        // crisp-ish paint, then the full-res image.
        var upgrade = function (toSrc, markLoaded) {
          var hi = new Image();
          hi.onload = function () {
            imgEl.src = toSrc;
            if (markLoaded) imgEl.classList.add('loaded');
          };
          hi.src = toSrc;
        };
        if (node.image_medium && node.image_medium !== placeholder && node.image_medium !== full) {
          var midImg = new Image();
          midImg.onload = function () {
            // Only adopt medium if we haven't already shown full.
            if (!imgEl.classList.contains('loaded')) imgEl.src = node.image_medium;
            upgrade(full, true);
          };
          midImg.onerror = function () { upgrade(full, true); };
          midImg.src = node.image_medium;
        } else {
          upgrade(full, true);
        }
      } else {
        imgEl.src = full;
      }
      imgEl.alt = node.title || '';
      imgEl.draggable = false;
      stage.appendChild(imgEl);
    }

    // Layout hotspots
    var hotspots = node.hotspots || [];
    var layouts = state.showLabels ? layOutHotspots(hotspots) : [];
    var vbH = IS_PORTRAIT ? +(100 * 16 / 9).toFixed(2) : 56.25;

    // Hotspot cards
    var cards = el('div', 'hotspots');
    var cardEls = {};
    layouts.forEach(function (lay) {
      var h = hotspots[lay.idx];
      var linked = !!h.next_hash && NODES[h.next_hash];
      var card = el('button', 'hotspot' + (linked ? '' : ' disabled'));
      card.style.left = pct(lay.anchor[0]);
      card.style.top = pct(lay.anchor[1]);
      card.appendChild(el('span', 'label', h.label || ''));
      if (linked) card.addEventListener('click', function () { navigate(h.next_hash); });
      cards.appendChild(card);
      cardEls[lay.idx] = card;
    });

    // Leader lines (measure card rects after layout)
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'leaderSvg');
    svg.setAttribute('viewBox', '0 0 100 ' + vbH);
    svg.setAttribute('preserveAspectRatio', 'none');

    stage.appendChild(svg);
    if (node.text_layer && node.text_layer.length && imgEl) {
      var tl = el('div', 'textLayer');
      stage.appendChild(tl);
      placeTextLayer(tl, node.text_layer, imgEl, stage);
    }
    stage.appendChild(cards);

    stageWrap.appendChild(stage);
    win.appendChild(stageWrap);

    // Caption
    if (node.caption) {
      var cap = el('p', 'caption');
      cap.innerHTML = inlineMarkdown(node.caption);
      win.appendChild(cap);
    }

    // Footer: copyright line linking back to the project.
    var footer = el('div', 'footer');
    var fa = el('a', 'footerLink', 'Copyright Flipbook Canvas');
    fa.href = GITHUB_URL; fa.target = '_blank'; fa.rel = 'noopener noreferrer';
    footer.appendChild(fa);
    win.appendChild(footer);
    shell.appendChild(win);
    root.appendChild(shell);

    // Keep the browser tab title in sync with the current node's title.
    document.title = node.title || DATA.topic || 'Flipbook';

    // Draw leader lines once cards have measured rects. Lines live in the
    // stretched (preserveAspectRatio="none") SVG, but the endpoint DOT is an
    // HTML element positioned in stage % — drawing it as an SVG <circle> in
    // the stretched viewBox would squash it into an ellipse.
    requestAnimationFrame(function () {
      var sr = stage.getBoundingClientRect();
      if (!sr.width || !sr.height) return;
      layouts.forEach(function (lay) {
        var btn = cardEls[lay.idx];
        if (!btn) return;
        var r = btn.getBoundingClientRect();
        var card = {
          l: ((r.left - sr.left) / sr.width) * 100,
          t: ((r.top - sr.top) / sr.height) * vbH,
          w: (r.width / sr.width) * 100,
          h: (r.height / sr.height) * vbH,
        };
        var tx = lay.leader[0] * 100, ty = lay.leader[1] * vbH;
        var ap = attachPoint(card, tx, ty);
        var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', ap[0]); line.setAttribute('y1', ap[1]);
        line.setAttribute('x2', tx); line.setAttribute('y2', ty);
        svg.appendChild(line);
        // Endpoint dot as a real circle (HTML, fixed px) — stage % left/top
        // maps directly from the SVG user coords (viewBox width 100 == 100%,
        // and ty/vbH == leader[1]).
        var dot = el('div', 'leaderDot');
        dot.style.left = (lay.leader[0] * 100) + '%';
        dot.style.top = (lay.leader[1] * 100) + '%';
        stage.appendChild(dot);
      });
    });

    // Consume the entrance transition so re-renders triggered by toggles
    // (language / labels / fullscreen) don't replay the animation.
    enterMode = 'none';
    lastRenderedHash = current;

    // Prefetch the NEXT layer's full images: every child of the current node
    // (reachable via a hotspot) is likely the user's next drill target, so we
    // warm the browser cache now. The full PNG then paints instantly on drill
    // instead of going blur → decode. Idempotent + cheap (browser dedupes).
    prefetchChildren(node);
  }

  // Kick off background <img> loads for the current node's children's full
  // images (and their blur placeholders, as a cheap fallback). Deduped via a
  // module-level cache so repeat visits don't re-issue loads.
  var _prefetched = {};
  function prefetchChildren(node) {
    if (!node || !node.hotspots) return;
    node.hotspots.forEach(function (h) {
      var child = h && h.next_hash ? NODES[h.next_hash] : null;
      if (!child) return;
      var srcs = [child.image, child.image_medium, child.image_blur];
      for (var i = 0; i < srcs.length; i++) {
        var s = srcs[i];
        if (s && !_prefetched[s]) { _prefetched[s] = 1; var im = new Image(); im.src = s; }
      }
    });
  }

  // Pick a transition: drilling into a descendant zooms in ('drill'); going
  // to an ancestor pulls up ('up'); anything else fades.
  function transitionFor(from, to) {
    if (!from || from === to) return 'fade';
    // Is `to` an ancestor of `from`? → up.
    var h = TREE.nodes[from] ? TREE.nodes[from].parent : null;
    while (h) { if (h === to) return 'up'; h = TREE.nodes[h] ? TREE.nodes[h].parent : null; }
    // Is `to` a descendant of `from`? → drill.
    h = TREE.nodes[to] ? TREE.nodes[to].parent : null;
    while (h) { if (h === from) return 'drill'; h = TREE.nodes[h] ? TREE.nodes[h].parent : null; }
    return 'fade';
  }

  function navigate(hash) {
    if (!NODES[hash]) return;
    enterMode = transitionFor(current, hash);
    prevHash = current;
    current = hash;
    try { history.replaceState(null, '', '#' + hash); } catch (e) {}
    render();
    window.scrollTo(0, 0);
  }

  function toggleFullscreen() {
    var docEl = document.documentElement;
    if (!state.fullscreen) {
      if (docEl.requestFullscreen) { docEl.requestFullscreen().catch(function () {}); }
      state.fullscreen = true;
    } else {
      if (document.exitFullscreen) { document.exitFullscreen().catch(function () {}); }
      state.fullscreen = false;
    }
    render();
  }
  document.addEventListener('fullscreenchange', function () {
    var fs = !!document.fullscreenElement;
    if (fs !== state.fullscreen) { state.fullscreen = fs; render(); }
  });

  // Minimal inline SVG icons matching the app.
  function svgIcon(name) {
    if (name === 'catalog') return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
    if (name === 'sources') return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>';
    if (name === 'tag-on') return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>';
    if (name === 'tag-off') return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/><line x1="3" y1="3" x2="21" y2="21"/></svg>';
    if (name === 'fs-enter') return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>';
    if (name === 'fs-exit') return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>';
    if (name === 'github') return '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
    return '';
  }

  // Deep-link support: open at #hash if present and valid.
  var fromHash = (location.hash || '').replace(/^#/, '');
  if (fromHash && NODES[fromHash]) current = fromHash;
  window.addEventListener('hashchange', function () {
    var h = (location.hash || '').replace(/^#/, '');
    if (h && NODES[h] && h !== current) { current = h; render(); }
  });

  // Preload every node's blur/medium placeholder up-front. These are tiny
  // JPGs, so the browser caches them immediately — when the user drills into
  // a child the placeholder paints on the first frame instead of leaving the
  // stage blank (white flash) while the full PNG decodes.
  (function preloadPlaceholders() {
    var seen = {};
    Object.keys(NODES).forEach(function (h) {
      var n = NODES[h];
      var ph = (n && (n.image_blur || n.image_medium)) || null;
      if (ph && !seen[ph]) { seen[ph] = 1; var im = new Image(); im.src = ph; }
    });
  })();

  render();
})();
