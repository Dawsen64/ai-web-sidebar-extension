# AI 官网侧边栏助手

一个基于 Chrome / Edge Manifest V3 的浏览器扩展。

它通过浏览器原生 `sidePanel` 打开 `DeepSeek`、`ChatGPT`、`Gemini` 官网聊天页面，并支持网页划词、右键菜单、悬浮快捷菜单、自定义模板、自动填入与自动发送。

这个项目适合这样一类需求：
- 希望直接使用 AI 官网网页
- 希望复用自己已经登录的官网账号
- 不想接 API Key
- 不想走官方 API 计费

## 截图建议

如果你后面准备公开展示项目，建议补几张截图放到 `docs/` 或 `assets/` 目录：
- 设置页
- 网页划词后的悬浮快捷菜单
- 浏览器原生 sidePanel 效果
- DeepSeek / ChatGPT / Gemini 实际使用界面

## 当前状态

- 已可用
- 核心功能已跑通
- 适合本地加载和个人使用
- 由于依赖官网页面结构，后续仍可能需要针对站点改版做兼容调整
- 当前主线路线为 `原生 sidePanel`

## 功能特性

- 支持 `DeepSeek`、`ChatGPT`、`Gemini`
- 支持网页划词后通过悬浮快捷菜单发送到 AI
- 支持右键菜单快速调用模板
- 支持自定义模板
- 支持模板变量：
  - `{text}`
  - `{pageUrl}`
  - `{pageTitle}`
- 支持每个模板单独配置：
  - 自动填入并自动发送
  - 只自动填入，不自动发送
- 支持设置默认 AI
- 支持当前 sidePanel 站点作为“跟随默认 AI”模板的实际目标站点

## 支持的 AI

- DeepSeek
- ChatGPT
- Gemini

## 设计说明

这个扩展当前主线路线是浏览器原生 `sidePanel`：
- sidePanel 页面承载 AI 官网 iframe
- 通过站点桥接脚本把模板 prompt 注入官网输入框
- 复用你已经登录的官网账号和网页额度

当前方案的取舍：
- 优点：更接近浏览器原生侧边栏体验、无需 API
- 限制：依赖官网页面结构，且 sidePanel 打开受浏览器用户手势限制约束

## 工作原理

扩展大致分成 4 部分：

1. 后台服务
负责 sidePanel 打开、右键菜单和消息调度。

2. 网页内容脚本
负责监听网页选区并显示悬浮快捷菜单。

3. 设置页
负责模板管理、默认 AI 和发送方式配置。

4. sidePanel 与 AI 站点适配层
负责 sidePanel iframe、bridge 通信，以及 DeepSeek / ChatGPT / Gemini 官网页面中的输入框和发送按钮适配。
sidePanel 内还提供了一个可拖动的悬浮站点切换器。

## 项目结构

```txt
ai-web-sidebar-extension/
├── manifest.json
├── src/
│   ├── background/
│   ├── content/
│   ├── options/
│   └── shared/
├── docs/
│   ├── technical-design.md
│   └── file-structure.md
└── README.md
```

主要文件：
- `manifest.json`：扩展声明
- `src/background/service-worker.js`：后台逻辑、菜单和 sidePanel 消息调度
- `src/content/provider-bridge.js`：sidePanel 内官网页面桥接与注入逻辑
- `src/content/content-script.js`：划词悬浮快捷菜单
- `src/sidepanel/sidepanel.html`：原生 sidePanel 页面
- `src/sidepanel/sidepanel.js`：sidePanel provider 切换和注入状态机
- `src/options/options.html`：中文设置页
- `src/options/options.js`：设置页保存逻辑
- `src/shared/defaults.js`：默认配置和默认模板

## 安装方式

### Chrome / Edge 加载已解压扩展

1. 打开扩展管理页
   - Chrome：`chrome://extensions`
   - Edge：`edge://extensions`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择项目目录：

```txt
/home/zqiusen/ai-web-sidebar-extension
```

## 开发调试

### 修改后重载扩展

每次修改代码后，需要到扩展管理页手动点一次“重新加载”。

### 调试入口

- 后台脚本：扩展管理页中打开 Service Worker 检查视图
- 网页脚本：在普通网页中打开开发者工具
- sidePanel 页面：在扩展管理页里打开 sidePanel 检查视图
- AI 官网页面：在 sidePanel iframe 对应页面里查看输入框或发送按钮问题

## 使用说明

### 1. 首次使用

1. 先分别登录你要使用的 AI 官网
2. 打开扩展设置页
3. 配置默认 AI、发送方式和模板

### 2. 打开侧栏

- 点击浏览器工具栏中的扩展图标
- 当前版本只使用浏览器原生 sidePanel
- 第一次使用时，建议先点击扩展图标打开 sidePanel，再在普通网页中划词触发模板
- sidePanel 内置一个半透明的悬浮站点切换器，鼠标移上去会变清晰，也可以拖动位置

### 3. 划词触发

在任意网页中选中文本后，可以：
- 使用右键菜单“发送到 AI 官网侧边栏”
- 使用悬浮快捷菜单中的模板按钮

### 4. 模板变量

模板中支持以下变量：

- `{text}`：当前选中的文字
- `{pageUrl}`：当前网页地址
- `{pageTitle}`：当前网页标题

## 常见问题

### 1. 为什么不用浏览器原生 sidePanel？

当前版本已经使用浏览器原生 sidePanel。为了让 AI 官网页面能在 sidePanel 中工作，扩展内部做了 iframe 与站点桥接层。

### 2. 为什么有时需要先手动打开 sidePanel？

因为 `chrome.sidePanel.open()` 受到浏览器的用户手势限制。最稳的用法是先点击扩展图标打开 sidePanel，再从网页划词触发模板。

### 3. 如果官网改版后自动填入失效怎么办？

需要更新站点适配逻辑，通常是调整输入框和发送按钮的选择器。

## 当前已知限制

- 由于依赖官网页面结构，官网 DOM 改版后，自动填入或自动发送可能需要重新适配
- `chrome.sidePanel.open()` 受浏览器用户手势限制，模板触发时如果 sidePanel 尚未打开，需要先手动打开
- DeepSeek、ChatGPT、Gemini 都可能因官网改版而需要重新适配

## 安全与隐私

当前仓库只包含扩展源码和设计文档，不包含：
- API Key
- Cookie
- 本地登录会话
- 账号密码
- 个人聊天记录

扩展本身的设计也是直接复用你当前浏览器中的官网登录状态，不会把账号数据导出到仓库里。

## 许可证

本项目采用 [MIT License](./LICENSE)。

## 后续可扩展方向

- 增加更多 AI 官网支持
- 增加模板导入导出
- 增加快捷键触发
- 提高官网 DOM 变更时的兼容性
- 打磨 sidePanel 内悬浮控件和交互细节

## 设计文档

- [技术设计](./docs/technical-design.md)
- [文件结构草案](./docs/file-structure.md)
