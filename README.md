# AI 官网侧边栏助手

一个基于 Chrome/Edge Manifest V3 的浏览器扩展。

它通过“伪侧边栏窗口”的方式，在浏览器右侧或左侧常驻打开 `DeepSeek`、`ChatGPT`、`Gemini` 官网聊天页面，并支持网页划词、右键菜单、悬浮快捷菜单、自定义模板、自动填入与自动发送。

这个项目的核心目标是：
- 直接使用 AI 官网网页
- 复用你自己在官网的登录状态
- 不依赖 API Key
- 不走官方 API 计费

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
- 支持设置默认 AI、侧栏位置、侧栏宽度
- 支持主窗口与侧栏联动：
  - 主窗口重新获得焦点时，侧栏自动重新贴边
  - 关闭主窗口时自动关闭侧栏

## 设计说明

这个扩展不是使用浏览器原生 `sidePanel`，而是使用一个独立的 `popup` 窗口模拟侧边栏。

这样做的原因是：
- AI 官网通常不适合直接嵌入扩展页面
- 登录态和 Cookie 在普通浏览器窗口里更稳定
- 多个 AI 官网兼容性更好

当前方案的取舍：
- 优点：稳定、兼容 AI 官网、无需 API
- 限制：本质上仍然是一个独立窗口，不是系统级“永远置顶”

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
- `src/background/service-worker.js`：后台逻辑、窗口管理、菜单和消息调度
- `src/background/providers.js`：DeepSeek / ChatGPT / Gemini 注入逻辑
- `src/content/content-script.js`：划词悬浮快捷菜单
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

## 使用说明

### 1. 首次使用

1. 先分别登录你要使用的 AI 官网
2. 打开扩展设置页
3. 配置默认 AI、发送方式、侧栏位置和模板

### 2. 打开侧栏

- 点击浏览器工具栏中的扩展图标

### 3. 划词触发

在任意网页中选中文本后，可以：
- 使用右键菜单“发送到 AI 官网侧边栏”
- 使用悬浮快捷菜单中的模板按钮

### 4. 模板变量

模板中支持以下变量：

- `{text}`：当前选中的文字
- `{pageUrl}`：当前网页地址
- `{pageTitle}`：当前网页标题

## 当前已知限制

- 由于依赖官网页面结构，官网 DOM 改版后，自动填入或自动发送可能需要重新适配
- 不能保证系统级别的“始终置顶”
- 不同浏览器和不同窗口边框样式下，侧栏贴边视觉可能略有差异

## 安全与隐私

当前仓库只包含扩展源码和设计文档，不包含：
- API Key
- Cookie
- 本地登录会话
- 账号密码
- 个人聊天记录

扩展本身的设计也是直接复用你当前浏览器中的官网登录状态，不会把账号数据导出到仓库里。

## 后续可扩展方向

- 增加更多 AI 官网支持
- 增加模板导入导出
- 增加快捷键触发
- 提高官网 DOM 变更时的兼容性
- 增加更丰富的窗口联动行为

## 设计文档

- [技术设计](./docs/technical-design.md)
- [文件结构草案](./docs/file-structure.md)
