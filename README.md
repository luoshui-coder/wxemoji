# 表情包工坊 (Meme Studio)

一款基于 Flask 的 AI 表情包生成 Web 应用，一键生成专属表情包套装，包含 24 个表情包单图、横幅图、App 图标及配套文案。

---

## ✨ 功能特性

- **24 格表情包网格**：自动生成 4 行 × 6 列的表情包大图，统一角色形象、多种表情姿势
- **横幅图（Banner）**：生成 16:9 宽幅横幅，适合网站或社交媒体封面
- **App 图标（Logo）**：生成 1:1 正方形图标，矢量简洁风格
- **标题 + 简介**：自动生成吸引人的中文标题和套装简介
- **参考图上传**：支持上传角色参考图，保留人物原型特征
- **智能自动切片**：像素级分析网格分割线，精准裁切 24 个单图
- **裁切工坊**：可视化拖拽调整裁切线，实时预览切割效果，支持精确重新裁切
- **一键打包下载**：将所有资源打包成 ZIP 文件（含 `stickers/` 目录、banner、logo、info.txt）
- **SSE 实时进度**：生成过程中实时显示步骤进度，无需等待页面刷新
- **多优先级配置**：支持 `config.yaml` / `.env` / 环境变量灵活配置
- **前端 API 覆盖**：浏览器端可独立设置 API Key 和 Base URL（保存于 localStorage）

---

## 📋 系统要求

- Python 3.10+
- pip

---

## 🚀 快速开始

### 1. 克隆 / 下载项目

```bash
cd /path/to/wxemoji
```

### 2. 安装依赖

```bash
pip install -r requirements.txt
```

### 3. 配置 API

选择以下任意一种方式进行配置（优先级从高到低）：

#### 方式一：config.yaml（推荐）

```bash
cp config.yaml.example config.yaml
```

编辑 `config.yaml`：

```yaml
openai_api_key: "sk-your-actual-key"
openai_base_url: "https://your-api-endpoint.com/v1"
host: "0.0.0.0"
port: 5000
request_timeout: 180
```

#### 方式二：.env 文件

```bash
cp .env.example .env
```

编辑 `.env`：

```
OPENAI_API_KEY=sk-your-actual-key
OPENAI_BASE_URL=https://your-api-endpoint.com/v1
PORT=5000
```

#### 方式三：环境变量

```bash
export OPENAI_API_KEY="sk-your-actual-key"
export OPENAI_BASE_URL="https://your-api-endpoint.com/v1"
```

### 4. 启动服务

```bash
python app.py
```

浏览器访问：[http://localhost:5000](http://localhost:5000)

---

## ⚙️ 配置说明

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `openai_api_key` / `OPENAI_API_KEY` | OpenAI 兼容 API 的密钥 | `your-api-key-here` |
| `openai_base_url` / `OPENAI_BASE_URL` | API 基础地址（不含结尾斜杠） | `https://api.openai.com/v1` |
| `gateway_api_key` / `GATEWAY_API_KEY` | 可选，用于保护本服务的访问密钥 | 空（不启用） |
| `host` / `HOST` | 监听地址 | `0.0.0.0` |
| `port` / `PORT` | 监听端口 | `5000` |
| `request_timeout` / `REQUEST_TIMEOUT` | 单次 API 请求超时（秒） | `180` |

### 配置优先级

```
config.yaml  >  .env 文件  >  环境变量  >  内置默认值
```

### 网关鉴权（可选）

如果设置了 `gateway_api_key`，所有 API 请求必须携带请求头：

```
X-Gateway-Key: <your-gateway-key>
```

### 前端 API 覆盖

点击页面右上角 ⚙ 图标，可在浏览器端单独设置 API Key 和 Base URL。设置仅存储于本地 `localStorage`，每次请求通过 `X-Api-Key` / `X-Base-Url` 请求头发送到服务端，优先级高于服务端配置。

---

## 🎨 使用说明

### 生成表情包

1. 在左侧文本框中输入角色描述（例如：一只慵懒的橘猫，圆眼睛，穿着睡衣）
2. 可选：上传参考图片，AI 将以此为原型重绘角色
3. 点击「开始生成」或按 `Ctrl+Enter`
4. 等待进度条完成（约 2-5 分钟，取决于 API 速度）

### 调整裁切线

1. 生成完成后，点击「✂ 裁切工坊」标签页（或网格图卡片中的「调整裁切」按钮）
2. 拖动红色横线调整行分割位置，拖动蓝色竖线调整列分割位置
3. 右侧实时预览区展示当前裁切效果
4. 确认满意后点击「✂ 确认裁切」，切好的图片将更新到生成结果页

### 下载资源

- 点击「⬇ 下载全套资源」或「⬇ 下载 ZIP」下载完整 ZIP 包
- ZIP 包含：
  ```
  stickers/
    meme_01_01.png  …  meme_04_06.png   (24 个单图)
  banner.png
  logo.png
  info.txt
  ```
- 横幅和图标也可单独保存（点击对应卡片右上角的保存按钮）

---

## 🔌 API 接口

### `POST /api/generate`

SSE 流式接口，返回生成进度事件和最终结果。

**请求体：**
```json
{
  "prompt": "一只可爱的橘猫",
  "reference_image_base64": "<base64>",
  "reference_image_mime": "image/png"
}
```

**SSE 事件：**
- `progress` – `{ step, message, pct }`
- `error`    – `{ message }`
- `done`     – `{ grid_image, banner_image, logo_image, title, description, slices, x_cuts, y_cuts }`

---

### `POST /api/slice`

对网格图进行自动像素分析切片。

**请求体：** `{ image_base64: string }`

**响应：** `{ x_cuts: number[], y_cuts: number[], slices: string[] }`

---

### `POST /api/crop`

使用精确像素坐标重新裁切（不进行任何自动检测）。

**请求体：**
```json
{
  "image_base64": "<base64>",
  "x_cuts": [0, x1, x2, x3, x4, x5, width],
  "y_cuts": [0, y1, y2, y3, height]
}
```

**响应：** `{ slices: string[] }`

---

### `POST /api/download-zip`

打包所有资源返回 ZIP 文件。

**请求体：**
```json
{
  "slices": ["<base64>", ...],
  "banner_image": "<base64>",
  "logo_image": "<base64>",
  "title": "标题",
  "description": "简介"
}
```

**响应：** `application/zip` 二进制流

---

## 🛠 本地开发

```bash
# 开启 Flask 调试模式
FLASK_ENV=development python app.py
```

调试模式下代码修改后自动重载，但 SSE 流式响应需配合 `threaded=True`（默认已启用）。

---

## 📦 依赖说明

| 包 | 用途 |
|----|------|
| `flask>=3.0.0` | Web 框架，路由 + SSE 流 |
| `pillow>=10.0.0` | 图像处理，自动切片 + 精确裁切 |
| `httpx>=0.27.0` | HTTP 客户端，调用 OpenAI 兼容 API |
| `python-dotenv>=1.0.0` | 读取 `.env` 配置文件 |
| `pyyaml>=6.0` | 读取 `config.yaml` 配置文件 |

---

## 📄 许可证

MIT License

---

## 🙏 致谢

本项目基于 OpenAI 兼容图像生成 API（Mako 系列模型）构建，感谢所有开源社区贡献者。