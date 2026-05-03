# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

表情包工坊 (Meme Studio) — AI 表情包生成 Web 应用。用户输入角色描述（可选上传参考图），自动生成 24 格表情包网格、横幅图、App 图标及中文文案，支持裁切调整和 ZIP 打包下载。

## 系统要求

- Python 3.10+

## 常用命令

```bash
# 安装依赖
pip install -r requirements.txt

# 启动服务（默认 http://localhost:5000）
python app.py

# 开发模式（自动重载）
FLASK_ENV=development python app.py

# 指定端口
python app.py --port 8080
```

## 配置

首次使用需配置 API 密钥：

```bash
cp config.yaml.example config.yaml
# 编辑 config.yaml 填入 openai_api_key 和 openai_base_url
```

配置优先级：`config.yaml` > `.env` > 环境变量 > 内置默认值。详见 `config.py`。

可选配置项：
- `gateway_api_key` — 网关鉴权密钥，设置后所有 API 请求需携带 `X-Gateway-Key` 请求头

## 架构

单文件 Flask 单体应用，无数据库、无后台任务队列。

- **`app.py`** — 全部后端逻辑：路由定义、AI API 调用（httpx）、图像处理（Pillow 自动切片/裁切）、SSE 流式响应、ZIP 打包
- **`config.py`** — 配置加载模块，按优先级从 config.yaml / .env / 环境变量读取配置
- **`templates/index.html`** — 单页 Jinja2 模板（~1374 行）
- **`static/js/app.js`** — 原生 JS 前端逻辑（~1430 行），通过 EventSource 接收 SSE 进度
- **`static/css/style.css`** — Apple Design 风格 CSS（~1753 行），使用 CSS 自定义属性

### 核心流程 (POST /api/generate)

SSE 流式端点，依次执行：生成 24 格网格图 → 自动切片 → 生成横幅图 → 生成图标 → 生成标题/简介文案 → 返回结果。每步通过 `progress` 事件推送进度。

### API 端点

- `POST /api/generate` — SSE 流式生成表情包套装
- `POST /api/slice` — 对网格图进行像素分析自动切片
- `POST /api/crop` — 使用精确像素坐标重新裁切
- `POST /api/download-zip` — 打包所有资源返回 ZIP 文件

### AI API 调用

使用 OpenAI 兼容接口，通过 httpx 同步调用（带指数退避重试，最多 5 次）：
- 图像生成：`/v1/images/generations` 和 `/v1/images/edits`（模型 `gpt-image-2`）
- 文本生成：`/v1/chat/completions`（模型 `gpt-5.5`）

### 前端 API 覆盖

用户可在浏览器端通过设置面板（⚙ 图标）覆盖 API Key 和 Base URL，存储于 localStorage，通过 `X-Api-Key` / `X-Base-Url` 请求头发送，优先级高于服务端配置。

## 注意事项

- 项目无测试、无 lint 配置，修改后需手动验证
- 所有 AI 调用为同步阻塞，SSE 需配合 Flask 的 `threaded=True`（已默认启用）
- `config.yaml` 已在 `.gitignore` 中，不要提交包含真实密钥的配置文件
- 前端为纯原生 JS，无构建步骤、无 npm
