# prototype-prd-viewer（生成prd）

给 HTML 原型一键补上「带序号标签的 PRD」：页面各模块悬浮编号徽章，点徽章在右侧抽屉里打开对应 PRD 章节；抽屉支持关键词搜索、章节正文编辑、目录增删改、Markdown 导出/导入，并能按演示版 / 开发版两种形态与页面并排对照。

将整个文件夹复制给使用者即可，运行时读取 `SKILL.md`；校验脚本只用 Python 标准库，无第三方依赖。

## 三种交付版式（首次接入由助手主动询问）

| 版式 | 抽屉与页面 | 适用场景 |
| --- | --- | --- |
| 演示版 | 悬浮在页面上方，收起后页面零影响 | 汇报、评审、给非技术观众演示 |
| 开发版 | 停靠右侧，页面按同宽让位、两边并排 | 开发对着原型逐条核对实现 |
| 两版可切换 | 头部多一枚形态胶囊，随时互切 | 既要演示又要交付开发 |

三种版式共用同一套徽章 / 搜索 / 编辑 / 目录逻辑，抽屉左缘可拖拽调宽、双击复位，宽度按形态各自记忆；抽屉全程不设全屏遮罩。

## 产物

执行后为原型补齐四件套，缺一不可：

1. `PRD.md`：Markdown 需求文档（权威源），章节编号形如 `XK-01`
2. 编号徽章：模块容器内的 `<span class="prd-badge" data-prd="XK-01">XK-01</span>`，绝对定位悬浮、不占原型布局，可拖动固定、右键复位
3. 查看器 DOM：浮动入口 `#prdFab` + 右侧抽屉 `#prdDrawer`（搜索、目录、正文、拖宽手柄）
4. 查看器 CSS/JS：数据（`PRD_GROUPS` / `PRD_SECTIONS`）+ 交互 + 内置 Markdown 渲染，无外部依赖

章节正文全链路只用 Markdown：`PRD.md` 章节正文、`PRD_SECTIONS[].body`、页内编辑器、导出的 Markdown 文档是同一份原文。

## 文件结构

```text
prototype-prd-viewer/
├── SKILL.md                        # 助手执行入口：版式询问、模块盘点、编号规则、硬规则
├── README.md                       # 本说明
├── LICENSE                         # MIT
├── scripts/
│   └── validate_prd.py             # 三方一致性校验（徽章 / PRD_SECTIONS / PRD.md）
└── templates/
    ├── viewer-dom.html             # 徽章、浮动入口、抽屉 DOM 片段
    ├── viewer.css                  # 徽章与抽屉样式、三种交付版式
    ├── viewer.js                   # 交互、存储、Markdown 渲染、搜索、目录编辑
    └── prd-doc-template.md         # PRD.md 文档骨架
```

## 使用方式

向助手指明原型路径与期望版式即可：

```text
请用 prototype-prd-viewer 给 <原型目录> 生成 PRD 查看器。
版式用开发版（抽屉停靠、页面让位并排）。
```

如果当前助手支持按名称调用 Skill，也可以直接 `$prototype-prd-viewer`。首次接入未表态版式时助手会先问一次；已接入过的原型做增量（加章节、改文案、补徽章）直接沿用现有 `PRD_VIEW_MODE` / `PRD_MODE_SWITCH`，不重复询问。

## 一致性校验

在 Skill 目录下执行，参数为原型目录：

```powershell
python scripts/validate_prd.py "<原型目录>"
```

校验三方一一对应：原型里的徽章 `data-prd`、查看器 `PRD_SECTIONS` 的 `id`、`PRD.md` 的 `## XX-NN` 章节标题。

- `[错误]`：徽章无章节、PRD.md 缺章、重复编号 —— 必须修复，退出码 1
- `[警告]`：章节无徽章、编号断号、正文仍是旧版 HTML —— 逐条确认

## 安装到本机

把整个文件夹放进助手的 Skill 目录后即可按名称调用，例如：

```text
~/.agents/skills/prototype-prd-viewer/        # 或对应客户端的 skills 目录
```

## 边界

- 描述的是「原型当前实现」，不是规划稿；与源码冲突时以源码为准改写 PRD。
- 目录增删改、正文编辑、徽章拖动位置都只存浏览器本地，代码内默认结构永远是 `PRD_GROUPS` / `PRD_SECTIONS`，可一键恢复默认。
- 开发版的页面让位只改 body 一条 `margin-right` 与 `html` 上的抽屉宽度变量；原型中 `position: fixed` 的整宽元素需加 `prd-dock-shrink` 类或改为 `sticky` 才会跟随收缩。

## License

[MIT](LICENSE)
