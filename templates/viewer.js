/* ============================================================
 * PRD 查看器逻辑（自包含 IIFE，无外部依赖，不污染全局）
 * 接入步骤：
 *   1. 页面已包含 viewer-dom.html 的 DOM 与 viewer.css 的样式
 *   2. 修改下方「配置区」「数据区」
 *   3. 多文件原型：本文件内容追加到主 JS 末尾
 *      单文件原型：放入 </body> 前的 <script> 块内
 * 内容格式：PRD 章节 body 一律为 Markdown（由项目作者在 PRD_SECTIONS 中
 * 维护，或用户经页内编辑器写入 localStorage），由内置 prdMd() 渲染为受控
 * HTML；文本先转义再解析，Markdown 中的 < > & 不会生成标签，故不构成注入面。
 * 导入/导出：头部 ⬇⬆ 收发的是一份 Markdown 文档（与项目 PRD.md 同构），不用 JSON；
 * 导出为覆盖层合并后的快照，导入按「## 编号 标题」只取章节正文。
 * 搜索：抽屉顶部 #prdSearch 检索章节标题与当前生效正文（含本地修改），结果浮层
 * 点击定位、正文与标题命中高亮（只包文本节点、不改 innerHTML），Esc 先收浮层再清空。
 * 目录：左侧目录支持本地新增（组标题 ＋）／删除（目录项 ✕）／改名（目录项 ✎），
 * 结构改动存在独立的结构覆盖层，与正文覆盖层分开，可「恢复默认目录」整体撤销。
 * 兼容：整段以块级 HTML 标签开头的 body 按旧版 HTML 直出（仅用于升级前的历史数据）。
 * ============================================================ */
(function () {
    'use strict';

    /* ---------- 配置区（按项目修改） ---------- */
    var PRD_STORAGE_KEY = 'protoPrdOverrides_v1'; // localStorage key：带项目标识 + 版本后缀，避免跨项目串数据
    var PRD_APP_NAME = 'proto-prd';               // 项目名：写入导出 Markdown 的文档标题「项目名 产品需求文档（PRD）」
    var PRD_HOME_SECTION = 'XX-01';               // 首次打开默认定位的章节 id
    var PRD_EXPORT_NAME = '原型PRD';               // 导出 Markdown 文件名前缀（最终 <前缀>-YYYYMMDD-HHmm.md）
    var PRD_DRAWER_MIN_W = 420;                    // 抽屉拖动最小宽度 px
    var PRD_DRAWER_MAX_W = 1200;                   // 抽屉拖动最大宽度 px（同时受 CSS max-width: 94vw 限制）
    var PRD_DRAWER_WIDTH_KEY = 'protoPrdWidth_v1'; // 抽屉宽度本地记忆 key：带项目标识 + 版本后缀，避免跨项目串数据
    var PRD_FAB_POS_KEY = 'protoPrdFabPos_v1';     // 悬浮按钮位置记忆 key：带项目标识 + 版本后缀，避免跨项目串数据
    var PRD_BADGE_POS_KEY = 'protoPrdBadgePos_v1'; // 编号徽章拖动位置记忆 key：带项目标识 + 版本后缀，避免跨项目串数据
    var PRD_STRUCT_KEY = 'protoPrdStruct_v1';      // 目录结构（新增/删除/改名）记忆 key：带项目标识 + 版本后缀，避免跨项目串数据
    // 视图形态（两形态共用一个抽屉，差别只在「抽屉与页面的关系」）：
    //   'demo' 演示版——抽屉悬浮于页面之上，收起后页面完全恢复（面向汇报演示）
    //   'dev'  开发版——抽屉停靠在右侧、页面让出同宽空间并排显示（面向开发对照）
    // 交付时的三种版式由用户选定（见 SKILL.md「三种交付版式」）：
    //   演示版         → PRD_VIEW_MODE='demo' + PRD_MODE_SWITCH=false
    //   开发版         → PRD_VIEW_MODE='dev'  + PRD_MODE_SWITCH=false
    //   两版可切换     → PRD_VIEW_MODE 按主场景取 'demo'/'dev' + PRD_MODE_SWITCH=true
    // 下面两个默认值即「两版可切换」；固定版式把 PRD_MODE_SWITCH 改 false 隐藏胶囊。
    var PRD_VIEW_MODE = 'demo';                    // 首次打开用的形态；用户点头部胶囊后以本地记忆为准
    var PRD_MODE_KEY = 'protoPrdMode_v1';          // 形态记忆 key：带项目标识 + 版本后缀
    var PRD_MODE_SWITCH = true;                    // 是否显示头部「演示版/开发版」切换胶囊；固定版式（只交付一种）必须设 false
    var PRD_DRAWER_DEFAULT_W = { demo: 640, dev: 720 }; // 两形态各自的默认宽度（双击手柄恢复到这个值）
    var PRD_DOCK_MIN_PAGE_W = 560;                 // 开发版并排时给页面保留的最小宽度，不足则抽屉退回浮层
    var PRD_FAB_IDLE_FADE = true;                  // 演示版：悬浮按钮闲置 2.6s 后淡出，鼠标移入/键盘聚焦即恢复
    // 有其他浮层打开时 Esc 让行；按原型实际浮层选择器补充
    function prdAnyOverlayOpen() {
        return !!document.querySelector('.modal-overlay.show, .modal.show, .drawer.open:not(#prdDrawer)');
    }

    /* ---------- 数据区：与 PRD.md 章节一一对应（同源维护，新增/删章三处同步） ---------- */
    var PRD_GROUPS = [
        { key: 'XX', name: '一、视图/模块组名' }
        // 多视图示例：{ key: 'YY', name: '二、另一视图' }
    ];

    // body 为 Markdown（唯一格式），由内置 prdMd() 渲染；语法见 SKILL.md「章节正文 Markdown 规范」
    // 写法：数组逐行书写后 join('\n')——行内 `code` 无需转义；勿用模板字符串（反引号要写成 \` ）
    // 精简原则：只保留关键显示/交互/数据/定义/规则/计算方法，单章 ≤ 5 行要点或 1 个表格
    var PRD_SECTIONS = [
        {
            id: 'XX-01', group: 'XX', title: '章节标题（关键DOM id）',
            body: [
                '**功能**：一句话说明模块作用。',
                '',
                '| 项 | 内容 |',
                '| --- | --- |',
                '| 显示 | 组成与展示要点 |',
                '| 交互 | 操作 → 响应（自然语言描述，不写代码） |',
                '| 数据 | 指标 = 口径；演示值：00.0% |',
                '| 规则 | 计算/判定规则（无则删行） |',
                '| 边界 | 限制；【隐藏】功能只标不展开（无则删行） |'
            ].join('\n')
        }
        // 继续添加 XX-02、XX-03……
    ];

    /* ---------- 以下为通用逻辑，无需修改 ---------- */

    /* ---------- Markdown 渲染：极简子集（无依赖，先转义后解析，不执行 HTML） ----------
       支持：# ~ ### 标题（→ h4）、#### 及以上（→ h5）、段落、- / * / + 与 1. 列表
       （行首每多缩进 2 空格即下一层）、GFM 表格与 :--: 对齐、> 提示块（→ .prd-note）、
       --- 分隔线、``` 代码块；行内 **粗体** `code` ~~删除~~ 【隐藏】【演示】。
       不支持：斜体、图片、链接、内联 HTML（文本一律转义后输出）。 */
    var PRD_HTML_HEAD = /^\s*<(p|ul|ol|table|div|section|blockquote|h[1-6])\b/i;

    function prdEsc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // 行内语法：先把 `code` 抽出占位，其余文本已转义，替换只生成白名单标签
    function prdInline(s) {
        var codes = [];
        var out = prdEsc(s)
            .replace(/`([^`]+)`/g, function (m, c) {
                codes.push(c);
                return '\u0000' + (codes.length - 1) + '\u0000';
            })
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/~~([^~]+)~~/g, '<del>$1</del>')
            .replace(/【隐藏】/g, '<span class="prd-hidden-tag">隐藏</span>')
            .replace(/【演示】/g, '<span class="prd-demo-tag">演示</span>');
        return out.replace(/\u0000(\d+)\u0000/g, function (m, i) {
            return '<code>' + codes[+i] + '</code>';
        });
    }

    function prdMdSplitRow(line) {
        var s = String(line).trim();
        if (s.charAt(0) === '|') s = s.slice(1);
        if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
        return s.split('|').map(function (c) { return c.trim(); });
    }

    function prdMdIsTableSep(line) {
        if (String(line).indexOf('|') < 0) return false;
        var cells = prdMdSplitRow(line);
        for (var i = 0; i < cells.length; i++) {
            if (!/^:?-+:?$/.test(cells[i])) return false;
        }
        return cells.length > 0;
    }

    // 段落合并的终止条件：遇到任一新的块级起始行
    function prdMdIsBlockStart(lines, i) {
        var t = String(lines[i]).trim();
        if (!t) return true;
        if (/^#{1,6}\s/.test(t)) return true;
        if (t.charAt(0) === '>') return true;
        if (/^(-{3,}|\*{3,})$/.test(t)) return true;
        if (t.indexOf('```') === 0) return true;
        if (/^([-*+]|\d+\.)\s+/.test(t)) return true;
        if (t.indexOf('|') > -1 && i + 1 < lines.length && prdMdIsTableSep(lines[i + 1])) return true;
        return false;
    }

    // 列表递归：按缩进量切层，返回 { html, next }
    function prdMdList(items, pos, indent) {
        var tag = items[pos].ordered ? 'ol' : 'ul';
        var out = '<' + tag + '>';
        var i = pos;
        while (i < items.length && items[i].indent >= indent) {
            var it = items[i];
            if (it.indent > indent) { // 首项缩进突增：作为同级子表输出
                var sub0 = prdMdList(items, i, it.indent);
                out += sub0.html;
                i = sub0.next;
                continue;
            }
            i++;
            var inner = '';
            if (i < items.length && items[i].indent > indent) {
                var sub = prdMdList(items, i, items[i].indent);
                inner = sub.html;
                i = sub.next;
            }
            out += '<li>' + prdInline(it.text) + inner + '</li>';
        }
        return { html: out + '</' + tag + '>', next: i };
    }

    function prdMd(src) {
        var text = String(src == null ? '' : src).replace(/\r\n?/g, '\n').trim();
        if (!text) return '';
        if (PRD_HTML_HEAD.test(text)) return text; // 兼容旧版 HTML body 直出

        var lines = text.split('\n');
        var out = [];
        var i = 0;
        while (i < lines.length) {
            var line = lines[i];
            var t = line.trim();
            if (!t) { i++; continue; }

            // ``` 代码块
            if (t.indexOf('```') === 0) {
                var buf = [];
                i++;
                while (i < lines.length && lines[i].trim().indexOf('```') !== 0) {
                    buf.push(lines[i]);
                    i++;
                }
                i++; // 跳过结束围栏
                out.push('<pre class="prd-code"><code>' + prdEsc(buf.join('\n')) + '</code></pre>');
                continue;
            }

            // --- 分隔线
            if (/^(-{3,}|\*{3,})$/.test(t)) { out.push('<hr>'); i++; continue; }

            // # 标题
            var hm = /^(#{1,6})\s+(.*)$/.exec(t);
            if (hm) {
                var lv = hm[1].length <= 3 ? '4' : '5';
                out.push('<h' + lv + '>' + prdInline(hm[2]) + '</h' + lv + '>');
                i++;
                continue;
            }

            // > 提示块（连续行合并为一段）
            if (t.charAt(0) === '>') {
                var qs = [];
                while (i < lines.length && lines[i].trim().charAt(0) === '>') {
                    qs.push(lines[i].trim().replace(/^>\s?/, ''));
                    i++;
                }
                out.push('<div class="prd-note">' + prdInline(qs.join(' ')) + '</div>');
                continue;
            }

            // GFM 表格：含 | 且下一行为分隔行
            if (t.indexOf('|') > -1 && i + 1 < lines.length && prdMdIsTableSep(lines[i + 1])) {
                var head = prdMdSplitRow(t);
                var aligns = prdMdSplitRow(lines[i + 1]).map(function (c) {
                    if (/^:.+:$/.test(c)) return 'center';
                    if (/^:/.test(c)) return 'left';
                    if (/:$/.test(c)) return 'right';
                    return '';
                });
                i += 2;
                var rows = [];
                while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') > -1) {
                    rows.push(prdMdSplitRow(lines[i]));
                    i++;
                }
                var th = '<tr>' + head.map(function (c, k) {
                    return '<th' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>'
                        + prdInline(c) + '</th>';
                }).join('') + '</tr>';
                var tb = rows.map(function (r) {
                    var cells = [];
                    for (var k = 0; k < head.length; k++) {
                        cells.push('<td' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>'
                            + prdInline(r[k] || '') + '</td>');
                    }
                    return '<tr>' + cells.join('') + '</tr>';
                }).join('');
                out.push('<table><thead>' + th + '</thead><tbody>' + tb + '</tbody></table>');
                continue;
            }

            // - / 1. 列表（连续列表行整体收集后递归建层）
            if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
                var items = [];
                while (i < lines.length) {
                    var lm = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]);
                    if (!lm) break;
                    items.push({
                        indent: lm[1].replace(/\t/g, '    ').length,
                        ordered: /\d+\./.test(lm[2]),
                        text: lm[3]
                    });
                    i++;
                }
                if (items.length) {
                    out.push(prdMdList(items, 0, items[0].indent).html);
                    continue;
                }
            }

            // 普通段落：连续非块起始行以空格合并
            var para = [t];
            i++;
            while (i < lines.length && !prdMdIsBlockStart(lines, i)) {
                para.push(lines[i].trim());
                i++;
            }
            out.push('<p>' + prdInline(para.join(' ')) + '</p>');
        }
        return out.join('\n');
    }

    var prdFab = document.getElementById('prdFab');
    var prdDrawer = document.getElementById('prdDrawer');
    var prdCloseBtn = document.getElementById('prdClose');
    var prdToc = document.getElementById('prdToc');
    var prdContent = document.getElementById('prdContent');
    if (!prdFab || !prdDrawer || !prdToc || !prdContent) return;

    /* ---------- 视图形态与抽屉宽度：演示版（浮于页面之上）/ 开发版（停靠 + 页面让位并排） ----------
       两种形态共用同一抽屉与同一套交互，差别只在「抽屉与页面的关系」：
         演示版 = 抽屉悬浮，页面不动；收起后页面完全恢复，适合演示与汇报；
         开发版 = 抽屉停靠右侧，页面按 --prd-dock-w 收缩让位，两边并排对照。
       形态存在本地（PRD_MODE_KEY），代码里的 PRD_VIEW_MODE 只是首次打开时的默认值。 */
    var prdModeBtn = document.getElementById('prdModeBtn');
    var prdMode = prdLoadMode();
    var prdWidthMap = prdLoadWidthMap(); // { demo: 640, dev: 720 } 两形态各自记忆的宽度
    var prdModeTimer = null;

    function prdRoot() { return document.documentElement; }

    function prdLoadMode() {
        // 固定版式（PRD_MODE_SWITCH = false）：以配置为准，忽略本地残留的形态记忆，否则改过版式的老页面会加载出旧形态
        if (!PRD_MODE_SWITCH) return PRD_VIEW_MODE === 'dev' ? 'dev' : 'demo';
        try {
            var m = localStorage.getItem(PRD_MODE_KEY);
            if (m === 'demo' || m === 'dev') return m;
        } catch (err) { /* 读取失败静默 */ }
        return PRD_VIEW_MODE === 'dev' ? 'dev' : 'demo';
    }

    function prdLoadWidthMap() {
        var map = {}, raw = null;
        try { raw = localStorage.getItem(PRD_DRAWER_WIDTH_KEY); } catch (err) { /* 读取失败静默 */ }
        if (!raw) return map;
        try {
            var obj = JSON.parse(raw);
            if (obj && typeof obj === 'object') return obj;
        } catch (err) { /* 不是 JSON：按旧版单值处理 */ }
        var n = parseFloat(raw);
        if (isFinite(n)) map.demo = n;
        return map;
    }

    /* ---------- 抽屉宽度拖动调节（左缘手柄：范围钳制 + 按形态分别记忆 + 双击恢复默认） ---------- */
    var prdResizeHandle = document.getElementById('prdResize');
    var prdWidthTip = document.getElementById('prdWidthTip');
    var prdDrag = null;

    function prdMaxWidth() {
        var vw = window.innerWidth;
        var max = Math.min(PRD_DRAWER_MAX_W, vw * 0.94); // 与 CSS max-width: 94vw 保持一致
        // 开发版：抽屉不能让页面窄到不可用，最大值先扣掉页面最小宽度
        if (prdMode === 'dev' && vw - PRD_DOCK_MIN_PAGE_W > PRD_DRAWER_MIN_W) {
            max = Math.min(max, vw - PRD_DOCK_MIN_PAGE_W);
        }
        return max;
    }

    function prdClampWidth(w) {
        var max = prdMaxWidth();
        var min = Math.min(PRD_DRAWER_MIN_W, max);
        return Math.min(max, Math.max(min, w));
    }

    // 页面让位宽度：只有开发版且抽屉展开时才有值；页面放不下最小宽度时返回 0（抽屉退回浮层）
    function prdDockWidth() {
        if (prdMode !== 'dev' || !prdDrawer.classList.contains('open')) return 0;
        var w = prdDrawer.offsetWidth || 0;
        return (window.innerWidth - w) >= PRD_DOCK_MIN_PAGE_W ? w : 0;
    }

    // 页面让位：开发版展开抽屉时给 body 写内联 margin-right（与抽屉同宽），收起时还原 body 原本的内联值。
    // 用 margin 而非 width：不覆盖原型 body 自身的宽度/居中规则，body 自带间距也不会造成溢出。
    // --prd-dock-w 同步写给固定元素（.prd-dock-shrink）与自定义样式引用。
    var prdBodyMR0 = null; // 原型 body 原本的内联 margin-right，收起时还原；首次真正让位时捕获

    function prdSyncDock() {
        var w = prdDockWidth();
        prdRoot().style.setProperty('--prd-dock-w', w + 'px');
        // 只在真的要让位时才捕获原值：初始化阶段 w=0，此时捕获会把原型后改的样式当成原值
        if (w > 0 && prdBodyMR0 === null) prdBodyMR0 = document.body.style.marginRight || '';
        if (prdBodyMR0 !== null) document.body.style.marginRight = w > 0 ? w + 'px' : prdBodyMR0;
    }

    function prdApplyWidth(w) {
        var px = prdClampWidth(w);
        prdDrawer.style.width = px + 'px';
        prdSyncDock(); // 开发版：页面让位宽度跟随抽屉宽度
        if (prdWidthTip) prdWidthTip.textContent = Math.round(px) + 'px';
        return px;
    }

    function prdPersistWidth(px) {
        prdWidthMap[prdMode] = Math.round(px);
        try { localStorage.setItem(PRD_DRAWER_WIDTH_KEY, JSON.stringify(prdWidthMap)); } catch (err) { /* 存储受限时静默 */ }
    }

    // 恢复当前形态记忆的宽度；无记忆用该形态默认宽度（读取失败时保持 CSS 默认）
    function prdRestoreWidth() {
        var w = prdWidthMap[prdMode];
        if (!isFinite(w)) w = PRD_DRAWER_DEFAULT_W[prdMode] || 640;
        return prdApplyWidth(w);
    }

    function prdEndDrag() {
        if (!prdDrag) return;
        prdDrag = null;
        document.body.classList.remove('prd-resizing');
        if (prdWidthTip) prdWidthTip.classList.remove('show');
        prdPersistWidth(prdDrawer.offsetWidth);
    }

    if (prdResizeHandle) {
        prdResizeHandle.addEventListener('pointerdown', function (e) {
            prdDrag = { startX: e.clientX, startW: prdDrawer.offsetWidth };
            document.body.classList.add('prd-resizing');
            if (prdWidthTip) {
                prdWidthTip.textContent = Math.round(prdDrawer.offsetWidth) + 'px';
                prdWidthTip.classList.add('show');
            }
            if (prdResizeHandle.setPointerCapture) prdResizeHandle.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        prdResizeHandle.addEventListener('pointermove', function (e) {
            if (!prdDrag) return;
            // 抽屉右缘固定：新宽 = 起始宽 + (起始X - 当前X)，向左拖加宽
            prdApplyWidth(prdDrag.startW + (prdDrag.startX - e.clientX));
        });
        prdResizeHandle.addEventListener('pointerup', prdEndDrag);
        prdResizeHandle.addEventListener('pointercancel', prdEndDrag);
        // 双击手柄：回到当前形态的默认宽度
        prdResizeHandle.addEventListener('dblclick', function () {
            var px = prdApplyWidth(PRD_DRAWER_DEFAULT_W[prdMode] || 640);
            prdPersistWidth(px);
            prdToast('已恢复' + (prdMode === 'dev' ? '开发版' : '演示版') + '默认宽度 ' + Math.round(px) + 'px');
        });
    }

    /* ---------- 形态切换（演示版 ⇄ 开发版） ---------- */
    function prdApplyMode(persist) {
        var isDev = prdMode === 'dev';
        var root = prdRoot();
        clearTimeout(prdModeTimer);
        prdDrawer.classList.toggle('prd-dev', isDev);
        if (isDev) {
            root.classList.add('prd-dock');
        } else if (root.classList.contains('prd-dock')) {
            // 离开开发版：先把让位变量归零（类还在，宽度过渡生效），过渡结束再摘类
            root.style.setProperty('--prd-dock-w', '0px');
            prdModeTimer = setTimeout(function () { root.classList.remove('prd-dock'); }, 300);
        }
        if (prdModeBtn) {
            prdModeBtn.setAttribute('data-mode', prdMode);
            prdModeBtn.textContent = isDev ? '开发版' : '演示版';
            prdModeBtn.title = isDev
                ? '当前：开发版（抽屉停靠、页面让位并排）。点击切换为演示版'
                : '当前：演示版（抽屉浮于页面之上，收起后不影响页面）。点击切换为开发版';
        }
        prdSyncDock();
        if (persist) {
            try { localStorage.setItem(PRD_MODE_KEY, prdMode); } catch (err) { /* 存储受限时静默 */ }
        }
    }

    function prdSetMode(mode) {
        if ((mode !== 'demo' && mode !== 'dev') || mode === prdMode) return;
        prdPersistWidth(prdDrawer.offsetWidth); // 记住旧形态的宽度，切回来仍是这个宽度
        prdMode = mode;
        prdApplyMode(true);
        prdRestoreWidth();
        prdToast(mode === 'dev'
            ? '已切换到开发版：页面让出抽屉宽度并排显示，拖动左缘可调宽、双击恢复默认'
            : '已切换到演示版：抽屉浮于页面之上，关闭后页面不受影响');
    }

    // 初始化：按记忆/配置落形态，再恢复该形态宽度（首帧即正确，不闪一下）
    (function prdInitMode() {
        if (prdModeBtn && !PRD_MODE_SWITCH) prdModeBtn.style.display = 'none';
        prdApplyMode(false);
        prdRestoreWidth();
    })();

    /* ---------- 悬浮按钮拖拽 + 吸边（任意拖动，松手吸附最近左右边缘，位置本地记忆） ---------- */
    var PRD_FAB_MARGIN = 12;          // 吸边与钳制时距视口边缘的最小间距
    var prdFabDrag = null;            // 拖动会话 { startX, startY, origLeft, origTop, moved }
    var prdFabSuppressClick = false;  // 拖动结束后吞掉浏览器补发的 click，避免拖完顺手开抽屉

    function prdFabPlace(left, top) {
        prdFab.style.right = 'auto';
        prdFab.style.bottom = 'auto';
        prdFab.style.left = left + 'px';
        prdFab.style.top = top + 'px';
    }

    function prdFabReadPos() {
        try {
            var pos = JSON.parse(localStorage.getItem(PRD_FAB_POS_KEY) || 'null');
            if (pos && (pos.side === 'left' || pos.side === 'right') && isFinite(pos.y)) return pos;
        } catch (err) { /* 读取失败静默 */ }
        return null;
    }

    // 按吸边侧 + y 落位（x 由 side 决定），y 钳制在视口内；返回钳制后的 top
    function prdFabApply(side, y) {
        var r = prdFab.getBoundingClientRect();
        var vw = window.innerWidth, vh = window.innerHeight;
        var x = side === 'left' ? PRD_FAB_MARGIN : vw - r.width - PRD_FAB_MARGIN;
        var top = Math.min(vh - r.height - PRD_FAB_MARGIN, Math.max(PRD_FAB_MARGIN, y));
        prdFabPlace(x, top);
        return top;
    }

    // 恢复记忆位置；无记忆保持 CSS 默认右下角
    (function prdFabInit() {
        var pos = prdFabReadPos();
        if (pos) prdFabApply(pos.side, pos.y);
    })();

    // 视口尺寸变化：fab 按记忆重新吸边钳制；抽屉宽度重新钳制并重算让位宽度
    window.addEventListener('resize', function () {
        var pos = prdFabReadPos();
        if (pos) prdFabApply(pos.side, pos.y);
        prdRestoreWidth(); // 视口变窄时抽屉不得吃掉整个页面（按记忆宽度重新钳制）
    });

    prdFab.addEventListener('pointerdown', function (e) {
        if (e.button !== undefined && e.button !== 0) return;
        var r = prdFab.getBoundingClientRect();
        prdFabDrag = { startX: e.clientX, startY: e.clientY, origLeft: r.left, origTop: r.top, moved: false };
        try { if (prdFab.setPointerCapture) prdFab.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件/无活动指针时静默 */ }
    });

    prdFab.addEventListener('pointermove', function (e) {
        if (!prdFabDrag) return;
        var dx = e.clientX - prdFabDrag.startX;
        var dy = e.clientY - prdFabDrag.startY;
        if (!prdFabDrag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return; // 阈值内视为点击
        prdFabDrag.moved = true;
        prdFab.classList.add('prd-fab-drag');
        prdFabPlace(prdFabDrag.origLeft + dx, prdFabDrag.origTop + dy);
    });

    function prdFabEndDrag() {
        if (!prdFabDrag) return;
        var moved = prdFabDrag.moved;
        prdFabDrag = null;
        prdFab.classList.remove('prd-fab-drag');
        if (!moved) return; // 未超阈值：交给 click 事件 toggle
        prdFabSuppressClick = true;
        var r = prdFab.getBoundingClientRect();
        var side = (r.left + r.width / 2) < window.innerWidth / 2 ? 'left' : 'right'; // 吸最近水平边
        var top = prdFabApply(side, r.top);
        try { localStorage.setItem(PRD_FAB_POS_KEY, JSON.stringify({ side: side, y: Math.round(top) })); } catch (err) { /* 存储受限时静默 */ }
    }
    prdFab.addEventListener('pointerup', prdFabEndDrag);
    prdFab.addEventListener('pointercancel', prdFabEndDrag);

    /* ---------- 编号徽章拖动定位（容器内自由拖动，松手固定，位置本地记忆） ----------
       徽章能覆盖的遮挡情况（左侧色块、右上图标、容器 overflow 裁剪）只能靠加 CSS 类
       预先试猜，改一次要改源码；这里允许直接拖：位移超过 4px 判为拖动，松手把位置按
       「相对容器可拖范围的比例」写入 localStorage，容器尺寸或视口变化后按比例重算，
       永远不越出容器——容器 overflow 裁剪与祖先 transform 都不会让徽章错位。
       未超阈值仍是点击（照常打开抽屉并定位）；右键复位到默认角部。
       全程只改徽章的 left/top/right/bottom 与类名，不插删节点、不改文字。 */
    var PRD_BADGE_DRAG_TOLERANCE = 4;  // 位移小于该值视为点击
    var prdBdPos = prdBdLoad();        // { 'XK-04': { x: .62, y: .30 } }  x/y 为可拖范围内的比例
    var prdBdDrag = null;              // 拖动会话 { el, startX, startY, origL, origT, lastL, lastT, moved }
    var prdBdSuppressClick = false;    // 拖动结束后吞掉浏览器补发的 click，避免拖完顺手开抽屉
    var prdBdTick = 0;

    function prdBdLoad() {
        try {
            var obj = JSON.parse(localStorage.getItem(PRD_BADGE_POS_KEY) || '{}');
            return (obj && typeof obj === 'object') ? obj : {};
        } catch (err) {
            return {};
        }
    }

    function prdBdSave() {
        try { localStorage.setItem(PRD_BADGE_POS_KEY, JSON.stringify(prdBdPos)); } catch (err) { /* 存储受限时静默 */ }
    }

    function prdBdId(el) {
        return String(el.getAttribute('data-prd') || '').toUpperCase();
    }

    // 可拖范围 = 徽章定位上下文（容器）的 padding box 减去徽章自身尺寸；容器未定义
    // position: relative（offsetParent 落到 body）或尚未布局（尺寸为 0）时不提供拖动
    function prdBdRange(el) {
        var op = el.offsetParent;
        if (!op || op === document.body || op === document.documentElement) return null;
        var cw = op.clientWidth, ch = op.clientHeight;
        var bw = el.offsetWidth, bh = el.offsetHeight;
        if (!cw || !ch || !bw || !bh) return null;
        return { w: cw, h: ch, maxL: Math.max(0, cw - bw), maxT: Math.max(0, ch - bh) };
    }

    // 徽章当前相对容器 padding box 的 left/top（兼容 right/bottom 定位与已固定过的徽章）
    function prdBdXY(el) {
        var op = el.offsetParent;
        var or = op.getBoundingClientRect();
        var br = el.getBoundingClientRect();
        return { left: br.left - or.left - op.clientLeft, top: br.top - or.top - op.clientTop };
    }

    function prdBdPlace(el, left, top) {
        var r = prdBdRange(el);
        if (!r) return null;
        var l = Math.round(Math.min(r.maxL, Math.max(0, left)));
        var t = Math.round(Math.min(r.maxT, Math.max(0, top)));
        el.style.left = l + 'px';
        el.style.top = t + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.classList.add('prd-badge-pinned');
        return { left: l, top: t };
    }

    // 按记忆比例落位：容器尺寸变化后仍在同一相对位置，且永不越出容器
    function prdBdApply(el) {
        var p = prdBdPos[prdBdId(el)];
        if (!p) return;
        var r = prdBdRange(el);
        if (!r) return;
        prdBdWatch(el);
        prdBdPlace(el, (p.x || 0) * r.maxL, (p.y || 0) * r.maxT);
    }

    /* 容器尺寸变化（侧栏折叠、栅格重排、内容撑高）不会触发 window resize，
       所以对固定过徽章的容器逐个做尺寸观察，变化后按比例重算，避免越界或被裁。 */
    var prdBdResizeObs = window.ResizeObserver ? new ResizeObserver(function () { prdBdSchedule(); }) : null;
    var prdBdWatched = [];

    function prdBdWatch(el) {
        if (!prdBdResizeObs) return;
        var op = el.offsetParent;
        if (!op || op === document.body || op === document.documentElement) return;
        if (prdBdWatched.indexOf(op) > -1) return;
        prdBdWatched.push(op);
        prdBdResizeObs.observe(op);
    }

    // 徽章 title：源码原说明 + 固定状态提示（off/orphan 态另有专门文案）
    function prdBdTitle(el) {
        // 首次同步时留存源码原 title，之后永远基于它拼接，不叠加历史提示
        if (!el.hasAttribute('data-prd-title')) el.setAttribute('data-prd-title', el.getAttribute('title') || '');
        var id = prdBdId(el);
        var keep = el.getAttribute('data-prd-title');
        var st = prdBadgeState(id);
        if (st === 'off') {
            el.setAttribute('title', id + ' 已在本地 PRD 目录删除 · 点击查看恢复方式');
            return;
        }
        if (st === 'orphan') {
            el.setAttribute('title', id + ' 在 PRD 章节定义中不存在 · 请清理该徽章或补写章节');
            return;
        }
        var tip = prdBdPos[id] ? '位置已固定，右键复位默认角部' : '';
        if (keep && tip) el.setAttribute('title', keep + ' · ' + tip);
        else if (keep) el.setAttribute('title', keep);
        else if (tip) el.setAttribute('title', tip);
        else el.removeAttribute('title');
    }

    // 全量应用（页面加载、抽屉重渲、容器尺寸变化、原型重渲出新徽章后都走这里）
    function prdBdSync() {
        var list = document.querySelectorAll('.prd-badge[data-prd]');
        for (var i = 0; i < list.length; i++) {
            var el = list[i];
            if (prdBdDrag && prdBdDrag.el === el) continue; // 拖动中的徽章不打断
            if (!prdBdPos[prdBdId(el)]) continue;
            prdBdApply(el);
            prdBdTitle(el); // 重渲后的新节点也要带上「位置已固定」提示
        }
    }

    function prdBdSchedule() {
        if (prdBdTick) return;
        var run = function () { prdBdTick = 0; prdBdSync(); };
        prdBdTick = window.requestAnimationFrame ? window.requestAnimationFrame(run) : setTimeout(run, 16);
    }

    // 捕获阶段接管按下：原型容器若有自己的拖拽/按下逻辑，拖动徽章时不应同时触发
    document.addEventListener('pointerdown', function (e) {
        if (e.button !== undefined && e.button !== 0) return;
        var el = e.target && e.target.closest ? e.target.closest('.prd-badge[data-prd]') : null;
        if (!el) return;
        var range = prdBdRange(el);
        if (!range) return; // 容器无相对定位或隐藏：只保留点击能力
        e.stopImmediatePropagation(); // 原型的按下/拖拽逻辑（冒泡阶段）不应被徽章拖动带起
        var xy = prdBdXY(el);
        // 已固定过的徽章直接取内联坐标（不受任何过渡动画影响），未固定过的按位置换算
        var sl = parseFloat(el.style.left), st = parseFloat(el.style.top);
        var origL = isFinite(sl) ? sl : xy.left;
        var origT = isFinite(st) ? st : xy.top;
        prdBdDrag = {
            el: el, startX: e.clientX, startY: e.clientY,
            origL: origL, origT: origT, lastL: origL, lastT: origT,
            moved: false
        };
        try { if (el.setPointerCapture) el.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件/无活动指针时静默 */ }
    }, true);

    document.addEventListener('pointermove', function (e) {
        var d = prdBdDrag;
        if (!d) return;
        var dx = e.clientX - d.startX, dy = e.clientY - d.startY;
        if (!d.moved && Math.abs(dx) < PRD_BADGE_DRAG_TOLERANCE && Math.abs(dy) < PRD_BADGE_DRAG_TOLERANCE) return;
        if (!d.moved) {
            d.moved = true;
            d.el.classList.add('prd-badge-drag');
        }
        e.preventDefault();
        e.stopImmediatePropagation(); // 拖动中不让原型的滑动手势跟着动
        var pos = prdBdPlace(d.el, d.origL + dx, d.origT + dy);
        if (pos) { d.lastL = pos.left; d.lastT = pos.top; }
    }, true);

    function prdBdEndDrag(e) {
        var d = prdBdDrag;
        if (!d) return;
        prdBdDrag = null;
        d.el.classList.remove('prd-badge-drag');
        if (!d.moved) return; // 未超阈值：交给 click 照常打开抽屉
        if (e && e.stopImmediatePropagation) e.stopImmediatePropagation();
        prdBdSuppressClick = true;
        setTimeout(function () { prdBdSuppressClick = false; }, 250); // 拖到页面外松手可能没有 click，超时自解
        var r = prdBdRange(d.el);
        if (!r) return;
        // 用拖动会话记录的最后坐标，不用 getBoundingClientRect（可能读到过渡中的旧值）
        var left = isFinite(d.lastL) ? d.lastL : d.origL;
        var top = isFinite(d.lastT) ? d.lastT : d.origT;
        prdBdPos[prdBdId(d.el)] = {
            x: r.maxL ? Math.min(1, Math.max(0, left / r.maxL)) : 0,
            y: r.maxT ? Math.min(1, Math.max(0, top / r.maxT)) : 0
        };
        prdBdSave();
        prdBdApply(d.el);
        prdSyncBadges(); // 刷新 title 提示（已固定）
    }
    document.addEventListener('pointerup', prdBdEndDrag, true);
    document.addEventListener('pointercancel', prdBdEndDrag, true);

    // 拖动后的 click 在捕获阶段拦掉，避免冒泡到原型既有绑定
    // （必须 stopImmediatePropagation：stopPropagation 不会拦住同一 document 上后续注册的监听器）
    document.addEventListener('click', function (e) {
        if (!prdBdSuppressClick) return;
        prdBdSuppressClick = false;
        e.stopImmediatePropagation();
        e.preventDefault();
    }, true);

    // 右键：把该徽章复位到默认角部；没拖过的徽章不拦原型自己的右键菜单
    document.addEventListener('contextmenu', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('.prd-badge[data-prd]') : null;
        if (!el) return;
        var id = prdBdId(el);
        if (!prdBdPos[id]) return;
        e.preventDefault();
        e.stopPropagation();
        delete prdBdPos[id];
        prdBdSave();
        el.classList.remove('prd-badge-pinned');
        el.style.left = '';
        el.style.top = '';
        el.style.right = '';
        el.style.bottom = '';
        prdSyncBadges();
        prdToast(id + ' 徽章位置已复位到模块默认角部');
    }, true);

    // 原型 JS 重渲模块会造出新徽章节点（原节点被 innerHTML 覆盖），位置记忆须重新落到新节点上
    if (window.MutationObserver) {
        new MutationObserver(function (records) {
            for (var i = 0; i < records.length; i++) {
                var added = records[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var n = added[j];
                    if (n.nodeType !== 1) continue;
                    var hit = (n.classList && n.classList.contains('prd-badge'))
                        || (n.querySelector && n.querySelector('.prd-badge[data-prd]'));
                    if (hit) { prdBdSchedule(); return; }
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
    }

    // 兜底：隐藏模块被原型 JS 显示出来时（无节点新增，只有 class/style 变化）鼠标移上去即纠正位置
    document.addEventListener('pointerover', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('.prd-badge[data-prd]') : null;
        if (!el || (prdBdDrag && prdBdDrag.el === el)) return;
        if (prdBdPos[prdBdId(el)]) prdBdApply(el);
    }, true);

    window.addEventListener('resize', prdBdSchedule);

    /* ---------- 手动编辑：localStorage 覆盖层 ---------- */
    // 仅存储与默认内容不同的章节；渲染时覆盖默认 body，默认内容始终可从代码恢复
    var prdOverrides = prdLoadOverrides();
    var prdEditingId = null; // 同一时刻仅允许一个章节处于编辑态

    function prdLoadOverrides() {
        try {
            var raw = localStorage.getItem(PRD_STORAGE_KEY);
            var obj = raw ? JSON.parse(raw) : {};
            return (obj && typeof obj === 'object') ? obj : {};
        } catch (err) {
            return {};
        }
    }

    function prdPersistOverrides() {
        try { localStorage.setItem(PRD_STORAGE_KEY, JSON.stringify(prdOverrides)); } catch (err) { /* 存储受限时静默 */ }
    }

    function prdHasOverride(id) {
        return Object.prototype.hasOwnProperty.call(prdOverrides, id);
    }

    /* ---------- 目录结构覆盖层：本地新增 / 删除 / 改名 ----------
       正文覆盖层（prdOverrides）只改内容，本层只改「目录」，两层独立存储：
       add:    [{ id, group, title }] 本地新增章节（无代码默认正文）
       del:    [id] 本地删除的代码章节（正文覆盖保留，「恢复默认目录」后回来）
       titles: { id: title } 代码章节的改名
       默认结构永远以代码内 PRD_GROUPS / PRD_SECTIONS 为准。 */
    var prdStruct = prdLoadStruct();

    function prdLoadStruct() {
        var out = { add: [], del: [], titles: {} };
        var obj = null;
        try {
            obj = JSON.parse(localStorage.getItem(PRD_STRUCT_KEY) || 'null');
        } catch (err) {
            return out;
        }
        if (!obj || typeof obj !== 'object') return out;
        var seen = {};
        (Object.prototype.toString.call(obj.add) === '[object Array]' ? obj.add : []).forEach(function (a) {
            if (!a || typeof a.id !== 'string') return;
            var id = a.id.toUpperCase();
            if (!/^[A-Z]{2,4}-\d{2}$/.test(id) || seen[id] || prdBaseSecOf(id)) return;
            seen[id] = 1;
            out.add.push({
                id: id,
                group: String(a.group == null ? '' : a.group),
                title: String(a.title == null ? '新章节' : a.title).slice(0, 60)
            });
        });
        (Object.prototype.toString.call(obj.del) === '[object Array]' ? obj.del : []).forEach(function (id) {
            var v = String(id == null ? '' : id).toUpperCase();
            if (prdBaseSecOf(v) && out.del.indexOf(v) < 0) out.del.push(v);
        });
        var titles = (obj.titles && typeof obj.titles === 'object') ? obj.titles : {};
        Object.keys(titles).forEach(function (id) {
            var base = prdBaseSecOf(id);
            var v = String(titles[id] == null ? '' : titles[id]).trim();
            if (base && v && v !== base.title) out.titles[id] = v;
        });
        return out;
    }

    function prdPersistStruct() {
        try { localStorage.setItem(PRD_STRUCT_KEY, JSON.stringify(prdStruct)); } catch (err) { /* 存储受限时静默 */ }
    }

    // 代码默认章节（不受本地结构覆盖影响）
    function prdBaseSecOf(id) {
        for (var i = 0; i < PRD_SECTIONS.length; i++) {
            if (PRD_SECTIONS[i].id === id) return PRD_SECTIONS[i];
        }
        return null;
    }

    // 本地结构改动计数：三项全 0 表示目录与代码默认一致
    function prdStructChanges() {
        return {
            add: prdStruct.add.length,
            del: prdStruct.del.length,
            rename: Object.keys(prdStruct.titles).length
        };
    }

    // 组 key 归一：新编号只用 2~4 位字母前缀（与导入解析规则一致），否则退回首组
    function prdGroupKey(key) {
        var k = String(key == null ? '' : key);
        if (/^[A-Za-z]{2,4}$/.test(k)) return k.toUpperCase();
        var first = PRD_GROUPS.length ? String(PRD_GROUPS[0].key) : '';
        return /^[A-Za-z]{2,4}$/.test(first) ? first.toUpperCase() : 'XX';
    }

    // 组名 → 组 key（导入时按文件里的「# 组名」定位分组），无匹配返回 null
    function prdGroupKeyByName(name) {
        var n = String(name == null ? '' : name).trim();
        if (!n) return null;
        for (var i = 0; i < PRD_GROUPS.length; i++) {
            if (String(PRD_GROUPS[i].name).trim() === n) return PRD_GROUPS[i].key;
        }
        return null;
    }

    // 生效章节列表：代码默认 + 本地新增 - 本地删除，标题应用改名；新增章节插在同组末位
    function prdSections() {
        var out = [];
        var removed = {};
        prdStruct.del.forEach(function (id) { removed[id] = 1; });
        PRD_SECTIONS.forEach(function (s) {
            if (removed[s.id]) return;
            out.push({
                id: s.id,
                group: s.group,
                title: prdStruct.titles[s.id] || s.title,
                body: s.body,
                custom: false
            });
        });
        prdStruct.add.forEach(function (a) {
            if (removed[a.id]) return;
            var item = { id: a.id, group: prdGroupKey(a.group), title: a.title, body: '', custom: true };
            var at = -1;
            for (var i = out.length - 1; i >= 0; i--) {
                if (out[i].group === item.group) { at = i; break; }
            }
            if (at < 0) out.push(item); else out.splice(at + 1, 0, item);
        });
        return out;
    }

    function prdSecOf(id) {
        var list = prdSections();
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) return list[i];
        }
        return null;
    }

    function prdBodyOf(s) {
        return prdHasOverride(s.id) ? prdOverrides[s.id] : (s.body || '');
    }

    // 轻提示（自包含 toast，不依赖原型既有 toast）
    var prdToastTimer = null;
    function prdToast(msg) {
        var t = document.getElementById('prdToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'prdToast';
            t.className = 'prd-toast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(prdToastTimer);
        prdToastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
    }

    /* ---------- 搜索：标题/正文关键词检索 + 点击定位 + 命中高亮 ----------
       检索范围：章节标题 + 当前生效正文（经 prdBodyOf 取覆盖层后的 Markdown，剥语法后比对），
       空格分隔多词按「同时包含」过滤；标题与正文都计命中次数。
       点击结果 → 目录选中 + 滚到该章首个命中（无命中退回章节顶部）+ 标题闪烁 + 命中包 mark；
       点击后浮层自动收起（聚焦输入框或继续输入时重新展开），避免遮挡刚定位的正文；
       ↑↓ 切换结果、回车依次定位、Esc 先收起浮层再清空（搜索为空时让行给抽屉 Esc）。
       高亮只包裹文本节点，不替换 innerHTML，表格/列表/提示块结构不受影响；
       编辑保存、恢复默认、导入触发重渲后由 prdSearchRefresh() 自动恢复结果与高亮。 */
    var prdSearchInput = document.getElementById('prdSearch');
    var prdSearchClear = document.getElementById('prdSearchClear');
    var prdSearchRes = document.getElementById('prdSearchRes');
    var prdSearchTerms = [];      // 当前生效关键词（已去重）
    var prdSearchQ = '';          // 上次检索的原始输入，回车时据此判断是否需先检索
    var prdSearchHits = [];       // 结果 [{ id, title, count, snip }]
    var prdSearchIdx = -1;        // 键盘活动项下标
    var prdSearchActiveId = null; // 已定位章节 id（重渲后据此恢复当前命中样式）
    var prdSearchTimer = null;

    function prdReEsc(s) {
        return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // 关键词拆分：空格分词 + 去重（大小写不敏感）
    function prdSplitTerms(q) {
        var out = [], seen = {};
        String(q == null ? '' : q).trim().split(/\s+/).forEach(function (t) {
            var k = t.toLowerCase();
            if (!t || seen[k]) return;
            seen[k] = 1;
            out.push(t);
        });
        return out;
    }

    // 正文 Markdown → 纯文本：用于计数与结果片段，去掉语法噪声
    function prdPlain(md) {
        return String(md == null ? '' : md)
            .replace(/```[\s\S]*?(?:```|$)/g, ' ')
            .replace(/`([^`]*)`/g, '$1')
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/~~([^~]+)~~/g, '$1')
            .replace(/^\s*#{1,6}\s+/gm, '')
            .replace(/^\s*>\s?/gm, '')
            .replace(/^\s*[-*+]\s+/gm, '')
            .replace(/\|/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // 命中次数（大小写不敏感）
    function prdCountHits(text, terms) {
        var lower = String(text == null ? '' : text).toLowerCase(), n = 0;
        terms.forEach(function (t) {
            var k = t.toLowerCase(), i = 0;
            while (k && (i = lower.indexOf(k, i)) !== -1) { n++; i += k.length; }
        });
        return n;
    }

    // 转义并按关键词包 mark（只生成白名单标签，不引入注入面）
    function prdHl(raw, terms) {
        var s = String(raw == null ? '' : raw);
        if (!terms.length) return prdEsc(s);
        var re = new RegExp('(' + terms.map(prdReEsc).join('|') + ')', 'gi');
        return s.split(re).map(function (part, i) {
            return i % 2 ? '<mark class="prd-hit">' + prdEsc(part) + '</mark>' : prdEsc(part);
        }).join('');
    }

    // 以首个命中为中心截取片段（原文，未转义）
    function prdSnip(plain, terms, span) {
        var s = String(plain == null ? '' : plain), lower = s.toLowerCase();
        var at = -1, len = 0;
        for (var i = 0; i < terms.length && at < 0; i++) {
            at = lower.indexOf(terms[i].toLowerCase());
            len = terms[i].length;
        }
        if (at < 0) return s.slice(0, span * 2) + (s.length > span * 2 ? '…' : '');
        var start = Math.max(0, at - Math.floor(span / 2));
        var end = Math.min(s.length, at + len + span);
        return (start > 0 ? '…' : '') + s.slice(start, end) + (end < s.length ? '…' : '');
    }

    // 清除正文高亮：mark 拆回文本节点并合并相邻文本，保证原文不被破坏
    function prdClearHits() {
        prdContent.querySelectorAll('mark.prd-hit').forEach(function (m) {
            var p = m.parentNode;
            if (!p) return;
            while (m.firstChild) p.insertBefore(m.firstChild, m);
            p.removeChild(m);
            if (p.normalize) p.normalize();
        });
    }

    // 在 root 的文本节点内包 mark；跳过脚本/样式/文本域/既有 mark，保留原有元素结构
    function prdMarkIn(root, terms) {
        if (!root || !terms.length) return;
        var pattern = '(' + terms.map(prdReEsc).join('|') + ')';
        var probe = new RegExp(pattern, 'i');
        var walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, null);
        var nodes = [];
        while (walker.nextNode()) {
            var n = walker.currentNode;
            var tag = n.parentNode ? n.parentNode.nodeName : '';
            if (!n.nodeValue || /^(SCRIPT|STYLE|TEXTAREA|MARK)$/.test(tag)) continue;
            if (probe.test(n.nodeValue)) nodes.push(n);
        }
        nodes.forEach(function (n) {
            var text = n.nodeValue, frag = document.createDocumentFragment(), last = 0;
            var re = new RegExp(pattern, 'gi'), m;
            while ((m = re.exec(text))) {
                if (!m[0]) { re.lastIndex++; continue; }
                if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
                var mk = document.createElement('mark');
                mk.className = 'prd-hit';
                mk.textContent = m[0];
                frag.appendChild(mk);
                last = m.index + m[0].length;
            }
            if (!last) return;
            if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
            n.parentNode.replaceChild(frag, n);
        });
    }

    // 目录反馈：命中项加左杠，未命中项淡化
    function prdMarkToc(on) {
        var hit = {};
        prdSearchHits.forEach(function (r) { hit[r.id] = 1; });
        prdToc.querySelectorAll('.prd-toc-item').forEach(function (el) {
            var m = !!hit[el.getAttribute('data-sec')];
            el.classList.toggle('prd-toc-hit', !!on && m);
            el.classList.toggle('prd-toc-dim', !!on && !m);
        });
    }

    // 检索并渲染结果浮层（不滚动、不改活动项）
    function prdSearchCompute() {
        prdSearchHits = [];
        var total = 0;
        prdSections().forEach(function (s) {
            var plain = prdPlain(prdBodyOf(s));
            var lowerT = String(s.title).toLowerCase(), lowerB = plain.toLowerCase();
            var all = prdSearchTerms.every(function (t) {
                var k = t.toLowerCase();
                return lowerT.indexOf(k) > -1 || lowerB.indexOf(k) > -1;
            });
            if (!all) return;
            var tHit = prdCountHits(s.title, prdSearchTerms);
            var bHit = prdCountHits(plain, prdSearchTerms);
            total += tHit + bHit;
            prdSearchHits.push({
                id: s.id, title: s.title, count: tHit + bHit,
                snip: prdSnip(tHit ? String(s.title) : plain, prdSearchTerms, 26)
            });
        });
        if (!prdSearchRes) return;
        prdSearchRes.hidden = false;
        prdSearchRes.innerHTML = prdSearchHits.length
            ? '<div class="prd-res-sum">' + prdSearchHits.length + ' 个章节 · ' + total + ' 处命中</div>'
                + prdSearchHits.map(function (r, i) {
                    return '<div class="prd-res-item' + (i === prdSearchIdx ? ' active' : '') + '"'
                        + ' data-prd-res="' + r.id + '" data-idx="' + i + '">'
                        + '<span class="prd-res-no">' + r.id + '</span>'
                        + '<span class="prd-res-main"><b>' + prdHl(r.title, prdSearchTerms) + '</b>'
                        + '<span class="prd-res-snip">' + prdHl(r.snip, prdSearchTerms) + '</span></span>'
                        + '<span class="prd-res-count">' + r.count + '</span></div>';
                }).join('')
            : '<div class="prd-res-sum prd-res-empty">无匹配：换个关键词试试（空格分隔多词表示需同时包含）</div>';
        prdMarkToc(true);
    }

    // 高亮正文与标题命中；已定位章节的首个命中加「当前」描边
    function prdSearchPaint() {
        prdClearHits();
        if (!prdSearchTerms.length) { prdMarkToc(false); return; }
        prdSections().forEach(function (s) {
            var sec = document.getElementById('prd-sec-' + s.id);
            if (!sec) return;
            prdMarkIn(sec.querySelector('.prd-sec-t'), prdSearchTerms);
            prdMarkIn(sec.querySelector('.prd-sec-body'), prdSearchTerms);
        });
        prdContent.querySelectorAll('mark.prd-hit-cur').forEach(function (m) {
            m.classList.remove('prd-hit-cur');
        });
        var curSec = prdSearchActiveId ? document.getElementById('prd-sec-' + prdSearchActiveId) : null;
        var curHit = curSec ? curSec.querySelector('mark.prd-hit') : null;
        if (curHit) curHit.classList.add('prd-hit-cur');
    }

    // 收起结果浮层（保留关键词、正文高亮与目录标记）
    function prdSearchFold() {
        if (prdSearchRes) prdSearchRes.hidden = true;
    }

    // 定位到第 idx 条结果：目录选中 + 滚到首个命中 + 标题闪烁；fold=true 时定位后收起浮层
    function prdGotoResult(idx, fold) {
        var r = prdSearchHits[idx];
        if (!r) return;
        prdSearchIdx = idx;
        prdSearchActiveId = r.id;
        if (prdSearchRes) {
            prdSearchRes.querySelectorAll('.prd-res-item').forEach(function (el) {
                var on = el.getAttribute('data-idx') === String(idx);
                el.classList.toggle('active', on);
                if (on && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
            });
        }
        prdToc.querySelectorAll('.prd-toc-item').forEach(function (el) {
            el.classList.toggle('active', el.getAttribute('data-sec') === r.id);
        });
        var tocItem = prdToc.querySelector('.prd-toc-item[data-sec="' + r.id + '"]');
        if (tocItem && tocItem.scrollIntoView) tocItem.scrollIntoView({ block: 'nearest' });

        prdSearchPaint();
        var sec = document.getElementById('prd-sec-' + r.id);
        if (!sec) return;
        var hit = sec.querySelector('mark.prd-hit');
        var prevBehavior = prdContent.style.scrollBehavior;
        prdContent.style.scrollBehavior = 'auto'; // 搜索连续切换不做平滑动画，避免定位漂移
        if (hit) {
            var cr = prdContent.getBoundingClientRect(), hr = hit.getBoundingClientRect();
            prdContent.scrollTop = Math.max(0, prdContent.scrollTop + hr.top - cr.top - 40);
        } else {
            prdContent.scrollTop = Math.max(0, sec.offsetTop - 12);
        }
        prdContent.style.scrollBehavior = prevBehavior;
        sec.classList.remove('prd-flash');
        void sec.offsetWidth;
        sec.classList.add('prd-flash');
        if (fold) prdSearchFold();
    }

    // 执行检索；keepActive=true 时保留当前定位（重渲后恢复用）
    function prdSearchRun(keepActive) {
        prdSearchQ = prdSearchInput ? prdSearchInput.value : '';
        prdSearchTerms = prdSplitTerms(prdSearchQ);
        if (prdSearchClear) prdSearchClear.classList.toggle('show', !!prdSearchQ);
        if (!prdSearchTerms.length) {
            prdSearchHits = [];
            prdSearchIdx = -1;
            prdSearchActiveId = null;
            if (prdSearchRes) { prdSearchRes.hidden = true; prdSearchRes.innerHTML = ''; }
            prdClearHits();
            prdMarkToc(false);
            return;
        }
        if (!keepActive) { prdSearchIdx = -1; prdSearchActiveId = null; }
        prdSearchCompute();
        prdSearchPaint();
    }

    function prdClearSearch() {
        if (prdSearchInput) prdSearchInput.value = '';
        prdSearchRun(false);
        if (prdSearchInput) prdSearchInput.focus();
    }

    // 重渲（编辑保存/恢复默认/导入）后恢复结果与高亮，不改变当前滚动位置
    function prdSearchRefresh() {
        if (!prdSearchTerms.length) { prdMarkToc(false); return; }
        prdSearchCompute();
        prdSearchPaint();
    }

    if (prdSearchInput) {
        prdSearchInput.addEventListener('input', function () {
            clearTimeout(prdSearchTimer);
            prdSearchTimer = setTimeout(function () { prdSearchRun(false); }, 90);
        });
        // 浮层收起后回到输入框：已有结果则重新展开（focus 兼顾 Tab 进入，click 兼顾已聚焦时再点）
        var prdSearchShow = function () {
            if (prdSearchRes && prdSearchTerms.length) prdSearchRes.hidden = false;
        };
        prdSearchInput.addEventListener('focus', prdSearchShow);
        prdSearchInput.addEventListener('click', prdSearchShow);
        prdSearchInput.addEventListener('keydown', function (e) {
            var total = prdSearchHits.length;
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(prdSearchTimer);
                if (prdSearchQ !== prdSearchInput.value) { prdSearchRun(false); prdGotoResult(0); return; }
                if (!total) return;
                var next = e.shiftKey
                    ? (prdSearchIdx <= 0 ? total - 1 : prdSearchIdx - 1)
                    : (prdSearchIdx + 1 >= total ? 0 : prdSearchIdx + 1);
                prdGotoResult(next);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                if (!total) return;
                e.preventDefault();
                var i = prdSearchIdx + (e.key === 'ArrowDown' ? 1 : -1);
                prdGotoResult((i + total) % total);
            } else if (e.key === 'Escape') {
                if (prdSearchInput.value) {
                    e.preventDefault();
                    e.stopPropagation();
                    // 两段式：先收起浮层看正文，再按一次才清空高亮
                    if (prdSearchRes && !prdSearchRes.hidden) prdSearchFold(); else prdClearSearch();
                } else {
                    prdSearchInput.blur(); // 空态让行：交给 document 的 Esc 收起抽屉
                }
            }
        });
    }
    if (prdSearchClear) prdSearchClear.addEventListener('click', prdClearSearch);
    if (prdSearchRes) {
        prdSearchRes.addEventListener('click', function (e) {
            var item = e.target.closest ? e.target.closest('.prd-res-item') : null;
            if (!item) return;
            prdGotoResult(parseInt(item.getAttribute('data-idx'), 10) || 0, true);
        });
    }
    // 点击搜索区域以外：收起浮层（关键词与高亮保留）
    document.addEventListener('mousedown', function (e) {
        if (!prdSearchRes || prdSearchRes.hidden) return;
        if (e.target && e.target.closest && e.target.closest('.prd-search-wrap')) return;
        prdSearchFold();
    }, true);

    // 渲染目录（按组，含新增/删除/改名入口）与全部章节内容；含本地修改的章节带「已修改」标记与目录圆点
    function prdRender() {
        var list = prdSections();
        var byGroup = {};
        list.forEach(function (s) { (byGroup[s.group] || (byGroup[s.group] = [])).push(s); });
        var groups = PRD_GROUPS.map(function (g) {
            return { key: g.key, name: g.name, items: byGroup[g.key] || [] };
        });
        var extra = list.filter(function (s) {
            return !PRD_GROUPS.some(function (g) { return g.key === s.group; });
        });
        if (extra.length) groups.push({ key: null, name: '其他章节', items: extra });

        prdToc.innerHTML = groups.filter(function (g) { return g.items.length || g.key; }).map(function (g) {
            return '<div class="prd-toc-group"><span class="prd-toc-gname">' + prdEsc(g.name) + '</span>'
                + (g.key ? '<i class="prd-toc-add" data-prd-new="' + g.key + '" title="在「' + prdEsc(g.name) + '」新增章节">＋</i>' : '')
                + '</div>'
                + g.items.map(function (s) {
                    return '<div class="prd-toc-item" data-sec="' + s.id + '">'
                        + '<span class="toc-no">' + s.id + '</span>'
                        + '<span class="toc-t">' + prdEsc(s.title) + '</span>'
                        + (s.custom ? '<i class="toc-chip toc-chip-new" title="本地新增章节">新</i>' : '')
                        + (prdHasOverride(s.id) ? '<i class="toc-dot" title="含本地修改"></i>' : '')
                        + '<span class="prd-toc-ops">'
                        + '<i class="prd-toc-op" data-prd-rename="' + s.id + '" title="重命名本章节">✎</i>'
                        + '<i class="prd-toc-op prd-toc-op-del" data-prd-del="' + s.id + '" title="删除本章节（仅本地目录）">✕</i>'
                        + '</span></div>';
                }).join('');
        }).join('');

        var ch = prdStructChanges();
        prdToc.innerHTML += '<div class="prd-toc-foot">'
            + '<span class="prd-toc-btn" data-prd-restore="1" title="撤销本地新增/删除/改名，正文修改保留">恢复默认目录</span>'
            + '<div class="prd-toc-tip">' + (ch.add + ch.del + ch.rename
                ? '本地目录已改：新增 ' + ch.add + ' · 删除 ' + ch.del + ' · 改名 ' + ch.rename + ' 节。'
                : '鼠标移到目录项：✎ 改名 · ✕ 删除；组标题右侧 ＋ 新增。')
            + '<br>结构改动只存本浏览器，可经 ⬇ 导出 Markdown 备份。</div></div>';

        prdContent.innerHTML = list.map(function (s) {
            var bodyHtml = prdMd(prdBodyOf(s));
            return '<section class="prd-sec" id="prd-sec-' + s.id + '">'
                + '<div class="prd-sec-h"><span class="sec-no">' + s.id + '</span><span class="prd-sec-t">' + prdEsc(s.title) + '</span>'
                + (s.custom ? '<span class="prd-tag prd-tag-new">新增</span>' : '')
                + (!s.custom && prdStruct.titles[s.id] ? '<span class="prd-tag prd-tag-renamed">改名</span>' : '')
                + (prdHasOverride(s.id) ? '<span class="prd-modified">已修改</span>' : '')
                + '<span class="prd-sec-edit" data-prd-edit="' + s.id + '" title="编辑本章节">✎</span>'
                + '</div><div class="prd-sec-body">'
                + (bodyHtml || '<p class="prd-note">本章暂无正文：点击标题右侧 ✎ 用 Markdown 补写。</p>')
                + '</div></section>';
        }).join('')
            + '<p class="prd-note">页面各模块悬浮的编号徽章与上述章节一一对应，点击徽章可定位本章；徽章可按住拖到容器内任意位置，松手即固定（位置本机记忆，右键复位默认角部）。顶部搜索框可按标题或正文关键词检索，点击结果定位并高亮命中。章节右侧 ✎ 编辑正文；目录项 ✎ 改名、✕ 删除，组标题右侧 ＋ 新增，底部可恢复默认目录。改动保存在本浏览器（localStorage），可经头部导出/导入 <b>Markdown</b> 文档备份与迁移。</p>';
        prdSearchRefresh();
        prdSyncBadges(); // 页面徽章随本地目录联动：已删/孤儿章节灰显
    }

    // 定位到指定章节：目录选中 + 内容滚动 + 标题闪烁高亮
    function prdLocate(id) {
        var sec = document.getElementById('prd-sec-' + id);
        if (!sec) {
            prdToast('章节 ' + id + ' 已在本地目录删除，可在目录底部「恢复默认目录」找回');
            return;
        }
        prdToc.querySelectorAll('.prd-toc-item').forEach(function (el) {
            el.classList.toggle('active', el.getAttribute('data-sec') === id);
        });
        prdContent.scrollTop = Math.max(0, sec.offsetTop - 12);
        sec.classList.remove('prd-flash');
        void sec.offsetWidth; // 强制 reflow，重启动画
        sec.classList.add('prd-flash');
        var tocItem = prdToc.querySelector('.prd-toc-item[data-sec="' + id + '"]');
        if (tocItem && tocItem.scrollIntoView) tocItem.scrollIntoView({ block: 'nearest' });
    }

    /* ---------- 页面徽章与本地目录的同步 ----------
       原型页面的 .prd-badge[data-prd] 是源码手写锚点，目录增删只存在本浏览器，
       两边天然会脱节。这里按结构层重算每个徽章的状态，让页面侧看得见差异：
         prd-badge-off    本地目录已删除本章（虚线灰显 + 删除线，点击给恢复路径）
         prd-badge-orphan 源码有徽章但 PRD_SECTIONS 里没有这一章（章节定义已被移除）
       每次渲染全量重算，故章节回来后类名自动摘除，无需单独的撤销逻辑。
       只加类名与 title，不插删节点、不改徽章文字，原型自身结构不受影响。 */
    function prdBadgeState(id) {
        var key = String(id == null ? '' : id).toUpperCase();
        if (!key) return '';
        if (prdStruct.del.indexOf(key) > -1) return 'off';
        if (!prdBaseSecOf(key)) return 'orphan'; // 代码默认里已无此章 → 章节定义被移除
        return '';
    }

    function prdSyncBadges() {
        var badges = document.querySelectorAll('.prd-badge[data-prd]');
        for (var i = 0; i < badges.length; i++) {
            var b = badges[i];
            var id = String(b.getAttribute('data-prd') || '').toUpperCase();
            var st = prdBadgeState(id);
            b.classList.toggle('prd-badge-off', st === 'off');
            b.classList.toggle('prd-badge-orphan', st === 'orphan');
            b.classList.toggle('prd-badge-pinned', !!prdBdPos[id] && st !== 'orphan');
            prdBdTitle(b);
        }
        prdBdSync(); // 拖动过的徽章按记忆比例重新落位（重渲会造新节点，须每次重放）
    }

    function prdOpen(id) {
        prdDrawer.classList.add('open');
        prdRoot().classList.add('prd-drawer-open'); // 抽屉展开期间收起浮动入口（css 隐藏）
        prdSyncDock(); // 开发版：页面让出抽屉宽度（并排显示）；演示版：无影响
        if (id) {
            prdLocate(id);
        } else if (!prdToc.querySelector('.prd-toc-item.active')) {
            prdLocate(PRD_HOME_SECTION);
        }
    }

    function prdCloseDrawer() {
        prdDrawer.classList.remove('open');
        prdRoot().classList.remove('prd-drawer-open');
        prdSyncDock(); // 开发版：页面恢复全宽（收起后不影响页面）
        prdSearchFold(); // 抽屉收起时一并收起结果浮层，重开不遮挡正文（关键词与高亮保留）
    }

    /* ---------- 手动编辑：编辑态切换 / 保存 / 恢复 / 导入导出 ---------- */

    // 有未保存修改时确认放弃；返回 true 表示可以继续（编辑态已清理）
    function prdConfirmDiscard() {
        var ta = document.getElementById('prdEditor');
        if (!ta || !prdEditingId) { prdEditingId = null; return true; }
        var sec = prdSecOf(prdEditingId);
        var origin = sec ? prdBodyOf(sec) : '';
        if (ta.value !== origin && !window.confirm('当前章节有未保存的修改，确定放弃吗？')) return false;
        prdEditingId = null;
        return true;
    }

    function prdEnterEdit(id) {
        if (prdEditingId === id) return;
        var sec = prdSecOf(id);
        var secEl = document.getElementById('prd-sec-' + id);
        if (!sec || !secEl) return;
        if (prdEditingId) {
            var prevId = prdEditingId;
            if (!prdConfirmDiscard()) return;
            prdRerenderKeeping(prevId); // 还原上一节的编辑态
        }
        prdEditingId = id;
        secEl.classList.add('prd-editing');
        var bodyBox = secEl.querySelector('.prd-sec-body');
        bodyBox.innerHTML = '<textarea class="prd-editor" id="prdEditor" spellcheck="false"></textarea>'
            + '<div class="prd-editor-actions">'
            + '<button type="button" class="prd-btn prd-btn-primary" data-prd-save="' + id + '">保存</button>'
            + '<button type="button" class="prd-btn prd-btn-ghost" data-prd-cancel="' + id + '">取消</button>'
            + '<button type="button" class="prd-btn prd-btn-danger" data-prd-reset="' + id + '">恢复默认</button>'
            + '<span class="prd-editor-tip">Markdown 编辑：**粗体**　| 表 | 格 |　- 列表　&gt; 提示　【隐藏】标记；正文用自然语言、不写代码；保存在本浏览器，可经头部导出 Markdown 备份</span>'
            + '</div>';
        var ta = bodyBox.querySelector('.prd-editor');
        var current = prdBodyOf(sec);
        ta.value = current;
        ta.rows = Math.min(28, Math.max(10, current.split('\n').length + 2));
        ta.focus();
    }

    function prdSaveEdit(id) {
        var ta = document.getElementById('prdEditor');
        var sec = prdSecOf(id);
        if (!ta || !sec) return;
        var val = ta.value.trim();
        var baseBody = String(sec.body || '').trim();
        if (!val) {
            if (!sec.custom) { prdToast('内容不能为空'); return; }
            delete prdOverrides[id]; // 本地新增章节允许空正文
        } else if (val === baseBody) {
            delete prdOverrides[id]; // 与默认一致视为未修改
        } else {
            prdOverrides[id] = val;
        }
        prdPersistOverrides();
        prdEditingId = null;
        prdRerenderKeeping(id);
        prdToast(prdHasOverride(id) ? '已保存（本地生效，标注「已修改」）' : '已保存（与默认一致）');
    }

    function prdExitEdit(id) {
        if (prdEditingId !== id) return;
        if (!prdConfirmDiscard()) return;
        prdRerenderKeeping(id);
    }

    function prdResetSec(id) {
        if (!prdHasOverride(id)) { prdToast('该章节已是默认内容'); return; }
        if (!window.confirm('恢复为默认内容？本地修改将被丢弃。')) return;
        delete prdOverrides[id];
        prdPersistOverrides();
        prdEditingId = null;
        prdRerenderKeeping(id);
        prdToast('已恢复默认内容');
    }

    // 全量重渲并保持浏览位置（目录选中项 + 滚动位置；传 id 时滚到指定章节）
    function prdRerenderKeeping(id) {
        var active = prdToc.querySelector('.prd-toc-item.active');
        var activeId = active ? active.getAttribute('data-sec') : null;
        var keepTop = prdContent.scrollTop;
        prdRender();
        if (activeId) {
            var item = prdToc.querySelector('.prd-toc-item[data-sec="' + activeId + '"]');
            if (item) item.classList.add('active');
        }
        if (id) {
            var secEl = document.getElementById('prd-sec-' + id);
            if (secEl) prdContent.scrollTop = Math.max(0, secEl.offsetTop - 12);
        } else {
            prdContent.scrollTop = keepTop; // 改名/删除/导入后不跳动，保留阅读位置
        }
    }

    /* ---------- 目录结构编辑：新增 / 删除 / 改名 / 恢复默认目录 ----------
       只改「目录」，正文仍归一 prdOverrides 覆盖层；两者分开存储，互不影响撤销。 */
    var prdRenamingId = null; // 改名中的章节 id：供 Esc 分层与其他点击判断

    // 新编号：取该前缀下最大序号 +1（≤99），避开代码章节与本地新增章节
    function prdNextSectionId(groupKey) {
        var key = prdGroupKey(groupKey);
        var used = {};
        PRD_SECTIONS.forEach(function (s) { if (s.id.indexOf(key + '-') === 0) used[s.id] = 1; });
        prdStruct.add.forEach(function (a) { used[a.id] = 1; });
        var max = 0;
        Object.keys(used).forEach(function (id) {
            var n = parseInt(id.slice(key.length + 1), 10);
            if (isFinite(n) && n > max) max = n;
        });
        for (var n = max + 1; n <= 99; n++) {
            var id = key + '-' + (n < 10 ? '0' + n : String(n));
            if (!used[id]) return id;
        }
        return key + '-99';
    }

    // 在指定组末位新增章节，随即进入改名与正文编辑引导
    function prdNewSection(groupKey) {
        var key = prdGroupKey(groupKey);
        var id = prdNextSectionId(key);
        prdStruct.add.push({ id: id, group: key, title: '新章节' });
        prdPersistStruct();
        prdRerenderKeeping(null);
        prdLocate(id);
        prdRenameStart(id);
        prdToast('已新增 ' + id + '：先在目录里改名，再点正文 ✎ 填写内容');
    }

    function prdDeleteSection(id) {
        var sec = prdSecOf(id);
        if (!sec) return;
        if (!window.confirm('删除「' + id + ' ' + sec.title + '」？\n仅删本地目录条目，不改原型徽章与代码默认章节，可点目录底部「恢复默认目录」找回。')) return;
        if (sec.custom) {
            prdStruct.add = prdStruct.add.filter(function (a) { return a.id !== id; });
            delete prdOverrides[id];
        } else if (prdStruct.del.indexOf(id) < 0) {
            prdStruct.del.push(id); // 正文覆盖层保留，恢复目录后回来
        }
        delete prdStruct.titles[id];
        if (prdEditingId === id) prdEditingId = null;
        if (prdSearchActiveId === id) prdSearchActiveId = null;
        prdPersistStruct();
        prdPersistOverrides();
        prdRerenderKeeping(null);
        prdToast('已删除 ' + id + '（仅本地目录，可在底部恢复）');
    }

    // 目录内联改名：Enter/失焦提交，Esc 放弃（不让行给抽屉 Esc）
    function prdRenameStart(id) {
        var sec = prdSecOf(id);
        var item = prdToc.querySelector('.prd-toc-item[data-sec="' + id + '"]');
        if (!sec || !item) return;
        var t = item.querySelector('.toc-t');
        if (!t || item.querySelector('.toc-rename')) return;
        prdRenamingId = id;
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'toc-rename';
        input.maxLength = 60;
        input.spellcheck = false;
        input.value = sec.title;
        t.parentNode.replaceChild(input, t);
        item.classList.add('prd-toc-renaming');
        if (item.scrollIntoView) item.scrollIntoView({ block: 'nearest' });
        input.focus();
        input.select();
        var settled = false;
        var settle = function (commit) {
            if (settled) return;
            settled = true;
            var v = input.value.trim();
            prdRenamingId = null;
            if (commit && v && v !== sec.title) { prdRenameApply(id, v); return; }
            if (commit && !v) prdToast('标题不能为空，已保留原标题');
            // 未改名：原地还原标题节点，避免整块重渲造成闪烁与点击丢失
            if (input.parentNode) {
                input.parentNode.replaceChild(t, input);
                item.classList.remove('prd-toc-renaming');
            }
        };
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); settle(true); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); settle(false); }
        });
        input.addEventListener('blur', function () { settle(true); });
    }

    // 应用改名：代码章节写 titles 覆盖（与默认相同则删除覆盖），本地新增章节直接改 add 条目
    function prdRenameApply(id, title) {
        var sec = prdSecOf(id);
        if (!sec) return;
        if (sec.custom) {
            prdStruct.add.forEach(function (a) { if (a.id === id) a.title = title; });
        } else {
            var base = prdBaseSecOf(id);
            if (base && title === base.title) delete prdStruct.titles[id];
            else prdStruct.titles[id] = title;
        }
        prdPersistStruct();
        prdRerenderKeeping(null);
        prdToast('已改名为「' + title + '」');
    }

    // 恢复默认目录：撤销新增/删除/改名，代码章节的正文修改保留
    function prdRestoreStruct() {
        var ch = prdStructChanges();
        if (!(ch.add + ch.del + ch.rename)) { prdToast('目录与代码默认已一致'); return; }
        if (!window.confirm('恢复默认目录？\n将撤销本地新增 ' + ch.add + ' 节、删除 ' + ch.del + ' 节、改名 ' + ch.rename + ' 节（代码章节的正文修改保留）。')) return;
        prdStruct.add.forEach(function (a) {
            if (!prdBaseSecOf(a.id)) delete prdOverrides[a.id]; // 本地新增章节的正文无默认可依，一并清除
        });
        prdStruct = { add: [], del: [], titles: {} };
        prdPersistStruct();
        prdPersistOverrides();
        prdRerenderKeeping(null);
        prdToast('目录已恢复默认');
    }

    /* ---------- 导出 / 导入：Markdown 文档（与项目 PRD.md 同构） ----------
       导出结构：# 项目名 产品需求文档（PRD） / > 说明行 / # 组名 / ## 编号 标题 + 正文，
       章节与组之间以 --- 分隔；正文取覆盖层合并后的 Markdown，可直接作为 PRD.md 快照。
       导入：仅认「## 编号 标题」为章节起点，正文到下一个「## 编号」或任意「# 」标题为止，
       故文档头、组标题、验收场景表等非章节内容不会混入；正文首尾的 --- 分隔线剔除；
       标题与分组参与回填：代码章节的标题写入结构覆盖层 titles（与默认同名则视为无变更），
       未知编号按所在「# 组名」重建为本地新增章节。 */

    function prdExportText() {
        var now = new Date();
        var pad = function (n) { return String(n).padStart(2, '0'); };
        var secs = prdSections();
        var modified = 0;
        secs.forEach(function (s) { if (prdHasOverride(s.id)) modified++; });
        var ch = prdStructChanges();
        var structNote = (ch.add + ch.del + ch.rename)
            ? ' · 结构：本地新增 ' + ch.add + ' 节 / 删除 ' + ch.del + ' 节 / 改名 ' + ch.rename + ' 节'
            : '';
        var groupKeys = PRD_GROUPS.map(function (g) { return g.key; });
        var blocks = [];
        // 未登记在 PRD_GROUPS 的章节归入「其他章节」，避免导出丢内容
        PRD_GROUPS.concat([{ key: null, name: '其他章节' }]).forEach(function (g) {
            var groupList = secs.filter(function (s) {
                return g.key ? s.group === g.key : groupKeys.indexOf(s.group) < 0;
            });
            if (!groupList.length) return;
            blocks.push('# ' + g.name + '\n\n' + groupList.map(function (s) {
                return '## ' + s.id + ' ' + s.title + '\n\n' + String(prdBodyOf(s)).trim();
            }).join('\n\n---\n\n'));
        });
        return [
            '# ' + PRD_APP_NAME + ' 产品需求文档（PRD）',
            '',
            '> 导出自原型页内 PRD 查看器，含全部本地修改 · '
                + now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
                + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes())
                + ' · 共 ' + secs.length + ' 章' + (modified ? '（本地修改 ' + modified + ' 章）' : '') + structNote,
            '',
            blocks.join('\n\n---\n\n'),
            ''
        ].join('\n');
    }

    // Markdown → 章节列表 [{ id, title, group, body }]；无章节时返回空数组
    function prdParseMd(text) {
        var lines = String(text == null ? '' : text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
        var list = [];
        var cur = null;
        var curGroup = ''; // 最近一个一级标题（组名），用于给未知编号章节定分组
        var fence = false; // ``` 围栏内的 # / ## 属正文内容，不参与结构识别
        for (var i = 0; i < lines.length; i++) {
            var t = lines[i].trim();
            if (t.indexOf('```') === 0) {
                fence = !fence;
                if (cur) cur.lines.push(lines[i]);
                continue;
            }
            if (fence) { if (cur) cur.lines.push(lines[i]); continue; }
            var m = /^##\s+([A-Za-z]{2,4}-\d{2})(?:\s+(.*))?$/.exec(t);
            if (m) {
                if (cur) list.push(cur);
                cur = { id: m[1].toUpperCase(), title: (m[2] || '').trim(), group: curGroup, lines: [] };
                continue;
            }
            if (/^#\s/.test(t)) {    // 一级标题 = 组/部分标题：本章结束，记录组名供后续分组
                if (cur) { list.push(cur); cur = null; }
                curGroup = t.replace(/^#\s+/, '').trim();
                continue;
            }
            if (!cur) continue;       // 首个章节之前的文档说明行，忽略
            cur.lines.push(lines[i]);
        }
        if (cur) list.push(cur);
        return list.map(function (s) {
            var body = s.lines.join('\n')
                .replace(/^\s*(?:---\s*\n)+/, '') // 章节前的分隔线
                .replace(/(?:\n\s*---)+\s*$/, '') // 章节末尾的分隔线
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            return { id: s.id, title: s.title, group: s.group, body: body };
        });
    }

    // 导出：下载 Markdown 文档（含全部本地修改）
    function prdExport() {
        var now = new Date();
        var pad = function (n) { return String(n).padStart(2, '0'); };
        var blob = new Blob([prdExportText()], { type: 'text/markdown;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = PRD_EXPORT_NAME + '-' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate())
            + '-' + pad(now.getHours()) + pad(now.getMinutes()) + '.md';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 0);
        prdToast('已导出 PRD Markdown（含全部本地修改）');
    }

    // 导入：读取 Markdown 文档，按编号回填正文/标题，并重建本地新增章节
    function prdImport() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
        input.addEventListener('change', function () {
            var file = input.files && input.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
                var list = prdParseMd(reader.result);
                if (!list.length) {
                    window.alert('导入失败：文件中没有「## 编号 标题」形式的章节行（编号需与页面徽章一致，如 XX-01）。');
                    return;
                }
                if (prdEditingId && !prdConfirmDiscard()) return;
                var covered = 0, same = 0, skipped = 0, unknown = 0, added = 0, renamed = 0, restored = 0;
                list.forEach(function (item) {
                    // 文件里出现的章节视为应存在：撤销本地删除
                    if (prdStruct.del.indexOf(item.id) > -1) {
                        prdStruct.del = prdStruct.del.filter(function (x) { return x !== item.id; });
                        restored++;
                    }
                    var sec = prdSecOf(item.id);
                    if (!sec) {
                        // 代码里没有的编号：分组可解析（文件里的「# 组名」）则重建为本地新增章节
                        var gk = prdGroupKeyByName(item.group);
                        if (!gk) { unknown++; return; }
                        prdStruct.add.push({ id: item.id, group: gk, title: item.title || '导入章节' });
                        if (item.body) prdOverrides[item.id] = item.body;
                        added++;
                        return;
                    }
                    if (!item.body) {
                        skipped++; // 空正文不覆盖，避免误清空本地修改
                    } else {
                        var baseBody = String(sec.body || '').trim();
                        if (item.body === baseBody) {
                            if (prdHasOverride(item.id)) delete prdOverrides[item.id];
                            same++;
                        } else {
                            prdOverrides[item.id] = item.body;
                            covered++;
                        }
                    }
                    // 标题：代码章节写改名覆盖（与默认相同则撤销），本地新增章节直接改条目
                    if (!item.title) return;
                    if (sec.custom) {
                        var target = null;
                        prdStruct.add.forEach(function (a) { if (a.id === item.id) target = a; });
                        if (target && target.title !== item.title) { target.title = item.title; renamed++; }
                    } else {
                        var base = prdBaseSecOf(item.id);
                        if (base && item.title === base.title) {
                            if (prdStruct.titles[item.id]) { delete prdStruct.titles[item.id]; renamed++; }
                        } else if (item.title !== sec.title) {
                            prdStruct.titles[item.id] = item.title;
                            renamed++;
                        }
                    }
                });
                prdPersistOverrides();
                prdPersistStruct();
                prdRerenderKeeping(null);
                prdToast('导入完成：' + covered + ' 节覆盖默认' + (same ? '，' + same + ' 节与默认一致' : '')
                    + (added ? '，新增 ' + added + ' 节' : '')
                    + (renamed ? '，标题更新 ' + renamed + ' 节' : '')
                    + (restored ? '，恢复 ' + restored + ' 节' : '')
                    + (skipped ? '，' + skipped + ' 节正文为空已忽略' : '')
                    + (unknown ? '，' + unknown + ' 节编号无法识别已忽略' : ''));
            };
            reader.readAsText(file, 'utf-8');
        });
        input.click();
    }

    /* ---------- 事件绑定 ---------- */

    // 浮动按钮 toggle：点击展开抽屉，再次点击收起（编辑内容保留在 DOM，不丢）
    // 拖动结束会补发一次 click，用 prdFabSuppressClick 吞掉
    prdFab.addEventListener('click', function () {
        if (prdFabSuppressClick) { prdFabSuppressClick = false; return; }
        if (prdDrawer.classList.contains('open')) {
            prdCloseDrawer();
        } else {
            prdOpen();
        }
    });
    if (prdCloseBtn) prdCloseBtn.addEventListener('click', prdCloseDrawer);

    // 形态切换：演示版（抽屉浮于页面之上）⇄ 开发版（页面让位并排）
    if (prdModeBtn) {
        prdModeBtn.addEventListener('click', function () {
            prdSetMode(prdMode === 'dev' ? 'demo' : 'dev');
        });
    }

    // 悬浮按钮闲置淡出：演示时按钮不抢镜头，鼠标移入/键盘聚焦/拖动时立即恢复
    if (PRD_FAB_IDLE_FADE) {
        var prdFabIdleTimer = null;
        var prdFabWake = function () {
            clearTimeout(prdFabIdleTimer);
            prdFab.classList.remove('prd-fab-dim');
        };
        var prdFabSleep = function () {
            clearTimeout(prdFabIdleTimer);
            prdFabIdleTimer = setTimeout(function () {
                if (!prdFabDrag) prdFab.classList.add('prd-fab-dim');
            }, 2600);
        };
        prdFab.addEventListener('pointerenter', prdFabWake);
        prdFab.addEventListener('focus', prdFabWake);
        prdFab.addEventListener('pointerleave', prdFabSleep);
        prdFab.addEventListener('blur', prdFabSleep);
        prdFabSleep();
    }

    // 目录点击（事件委托）：新增 / 删除 / 改名 / 恢复默认目录 / 定位章节
    prdToc.addEventListener('click', function (e) {
        if (!e.target.closest) return;
        var addBtn = e.target.closest('[data-prd-new]');
        if (addBtn) { e.stopPropagation(); prdNewSection(addBtn.getAttribute('data-prd-new')); return; }
        var delBtn = e.target.closest('[data-prd-del]');
        if (delBtn) { e.stopPropagation(); prdDeleteSection(delBtn.getAttribute('data-prd-del')); return; }
        var renBtn = e.target.closest('[data-prd-rename]');
        if (renBtn) { e.stopPropagation(); prdRenameStart(renBtn.getAttribute('data-prd-rename')); return; }
        var restoreBtn = e.target.closest('[data-prd-restore]');
        if (restoreBtn) { prdRestoreStruct(); return; }
        if (prdRenamingId || e.target.closest('.toc-rename')) return; // 改名中不触发定位
        var item = e.target.closest('.prd-toc-item');
        if (item) prdLocate(item.getAttribute('data-sec'));
    });

    // 模块编号徽章点击（事件委托）：展开抽屉并定位；阻止冒泡避免触发卡片下钻等既有绑定
    document.addEventListener('click', function (e) {
        if (prdBdSuppressClick) { // 拖动结束补发的 click：不当点击用
            prdBdSuppressClick = false;
            return;
        }
        var badge = e.target.closest('.prd-badge');
        if (!badge) {
            return;
        }
        e.stopPropagation();
        e.preventDefault();
        var raw = badge.getAttribute('data-prd');
        var st = prdBadgeState(raw);
        if (st === 'off') {
            // 章节已在本地目录删除：展开抽屉让人看见底部的恢复入口，但不定位（正文里已无该章）
            prdOpen();
            prdToast(String(raw || '').toUpperCase() + ' 已在本地 PRD 目录删除，可点目录底部「恢复默认目录」找回');
            return;
        }
        if (st === 'orphan') {
            prdToast(String(raw || '').toUpperCase() + ' 在 PRD 章节定义中不存在，请清理该徽章或补写章节');
            return;
        }
        prdOpen(raw);
    });

    // 章节编辑按钮（事件委托：编辑 / 保存 / 取消 / 恢复默认）
    prdContent.addEventListener('click', function (e) {
        var editBtn = e.target.closest('[data-prd-edit]');
        if (editBtn) { prdEnterEdit(editBtn.getAttribute('data-prd-edit')); return; }
        var saveBtn = e.target.closest('[data-prd-save]');
        if (saveBtn) { prdSaveEdit(saveBtn.getAttribute('data-prd-save')); return; }
        var cancelBtn = e.target.closest('[data-prd-cancel]');
        if (cancelBtn) { prdExitEdit(cancelBtn.getAttribute('data-prd-cancel')); return; }
        var resetBtn = e.target.closest('[data-prd-reset]');
        if (resetBtn) { prdResetSec(resetBtn.getAttribute('data-prd-reset')); }
    });

    var prdExportBtn = document.getElementById('prdExport');
    var prdImportBtn = document.getElementById('prdImport');
    if (prdExportBtn) prdExportBtn.addEventListener('click', prdExport);
    if (prdImportBtn) prdImportBtn.addEventListener('click', prdImport);

    // Esc：改名中由输入框自己处理，其次编辑态取消编辑，再其次其他浮层让行，最后收起抽屉
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (!prdDrawer.classList.contains('open')) return;
        if (prdRenamingId) return;
        if (prdEditingId) {
            var id = prdEditingId;
            if (prdConfirmDiscard()) prdRerenderKeeping(id);
            return;
        }
        // 搜索优先：浮层开着先收起，再按才清空关键词，最后让行给抽屉
        if (prdSearchTerms.length) {
            if (prdSearchRes && !prdSearchRes.hidden) prdSearchFold(); else prdClearSearch();
            return;
        }
        if (prdAnyOverlayOpen()) return;
        prdCloseDrawer();
    });

    prdRender();
})();
