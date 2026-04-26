"""
表情包工坊 – Flask application
"""

from __future__ import annotations

import base64
import io
import json
import time
import zipfile
from typing import Generator
from urllib.parse import quote

import httpx
from flask import (
    Flask,
    Response,
    jsonify,
    render_template,
    request,
    stream_with_context,
)
from PIL import Image

import config

# ── Flask app ─────────────────────────────────────────────────────────────────

app = Flask(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

COLS, ROWS = 6, 4
GRID_SEARCH_RATIO = 0.12

# ── Prompt templates ──────────────────────────────────────────────────────────

GRID_SYSTEM_DIRECTIVE = """
任务：生成一张包含 24 个表情包的 4x6 网格图。

关键布局要求 (非常重要)：
1. **严格填满画布**：4x6 网格必须完全覆盖整张图片，**绝对不要有任何外部边框、留白或边缘填充**。
2. **平均分布**：必须是标准的 6 列 x 4 行，每个格子的宽高完全一致。
3. **背景统一**：所有 24 个格子必须使用完全相同的纯色背景颜色，不要使用多种颜色，不要渐变。
4. **安全边距**：文字和主要图案必须居中，**远离格子的四条边缘**，至少保留 15% 的内部边距，防止切割时文字、头部或身体被截断。
5. 每格主体只能出现在自己的格子里，不要跨越到相邻格子。

内容要求：
1. 涵盖各种常用聊天语句或娱乐梗。
2. 不要原图复制，需进行创意重绘，保持统一的角色形象和画风。
3. 如果用户没有指定风格，则使用可爱、夸张、幽默、简洁手绘风。
4. 所有标注必须为清晰的手写简体中文。
5. 文字只能是聊天短句或情绪表达，禁止出现序号、编号、数字标签。
6. 分割线处理：尽量让分割线极细或与背景融合，确保在切割时不会留下明显的粗线条。

角色要求：根据用户描述创建同一个清晰可识别的角色，并在 24 格中保持身份、画风、线条、上色和比例一致。每格只改变表情、姿势、道具或情绪，不要换成不同角色。

技术参数：分辨率：4K。比例：适合 6 列 x 4 行切片的网格总图。
"""

GRID_REF_IMAGE_DIRECTIVE = """
参考图要求：以参考图中的人物作为同一角色原型，尽量保留原形象、五官气质、发型、服饰、配色和标志性细节。不要照抄参考图构图或姿势，要在保留角色识别度的前提下创意重绘成 24 个不同表情动作。
"""

BANNER_PROMPT_TEMPLATE = (
    "创建一个网站横幅图（Banner）。内容：{user_prompt}。"
    "风格：必须与参考图（如果有）或描述主题一致。"
    "要求：背景不能是白色，整体具有吸引力，适合作为网站或社交媒体封面。"
)

LOGO_PROMPT_TEMPLATE = (
    "设计一个 App 图标（Logo）。内容：{user_prompt}。"
    "风格：简洁、图标化、矢量感。比例：1:1 正方形。"
)

METADATA_PROMPT_TEMPLATE = (
    "你是一个表情包素材专家。请根据用户描述，为这套表情包生成一个吸引人的标题和一段简介。"
    "用户描述：{user_prompt}。"
    "要求：1. 标题中文，20字以内。2. 简介中文，100字以内。3. 只返回 JSON。"
)

# ── Auth helper ───────────────────────────────────────────────────────────────


def _check_gateway_auth() -> Response | None:
    """Return 401 Response if gateway key is configured and request fails auth."""
    gw_key = config.GATEWAY_API_KEY
    if not gw_key:
        return None
    provided = request.headers.get("X-Gateway-Key", "")
    if provided != gw_key:
        return jsonify({"error": "未授权访问"}), 401
    return None


def _get_api_credentials() -> tuple[str, str]:
    """
    Return (api_key, base_url) honoring per-request header overrides.
    Headers X-Api-Key and X-Base-Url take precedence over config defaults.
    """
    api_key = request.headers.get("X-Api-Key", "").strip() or config.OPENAI_API_KEY
    base_url = (
        request.headers.get("X-Base-Url", "").strip().rstrip("/")
        or config.OPENAI_BASE_URL
    )
    return api_key, base_url


# ── API call helpers ──────────────────────────────────────────────────────────


def _is_tool_choice_error(resp_body: dict) -> bool:
    """Detect the intermittent 'Tool choice image_generation not found' upstream error."""
    msg = resp_body.get("error", {}).get("message", "")
    return "Tool choice" in msg and "image_generation" in msg


def _http_post_with_retry(
    url: str,
    *,
    headers: dict,
    json_body: dict | None = None,
    data: dict | None = None,
    files: dict | None = None,
    timeout: float | None = None,
    max_retries: int = 5,
) -> dict:
    """Generic POST with exponential-backoff retry. Returns parsed JSON."""
    if timeout is None:
        timeout = config.REQUEST_TIMEOUT

    last_exc: Exception | None = None
    for attempt in range(max_retries):
        try:
            with httpx.Client(timeout=timeout) as client:
                if files is not None:
                    resp = client.post(url, headers=headers, data=data, files=files)
                else:
                    resp = client.post(url, headers=headers, json=json_body)

            if resp.status_code == 200:
                return resp.json()

            # Parse body once for error inspection
            try:
                body = resp.json()
            except Exception:
                body = {}

            # Intermittent upstream "Tool choice" error – always retry
            if resp.status_code == 400 and _is_tool_choice_error(body):
                wait = 1.0 * (attempt + 1)
                time.sleep(wait)
                last_exc = RuntimeError(
                    f"上游 Tool-choice 错误，重试中… (第 {attempt + 1} 次)"
                )
                continue

            # Retryable server errors
            if resp.status_code in (429, 500, 502, 503, 504):
                wait = 2**attempt
                time.sleep(wait)
                last_exc = RuntimeError(
                    f"API 返回 {resp.status_code}，重试中… (第 {attempt + 1} 次)"
                )
                continue

            # Non-retryable client errors – raise immediately
            detail = body.get("error", {}).get("message", resp.text[:300])
            raise RuntimeError(f"API 错误 {resp.status_code}: {detail}")

        except httpx.TimeoutException as exc:
            wait = 2**attempt
            time.sleep(wait)
            last_exc = RuntimeError(f"请求超时，重试中… (第 {attempt + 1} 次): {exc}")
        except httpx.RequestError as exc:
            wait = 2**attempt
            time.sleep(wait)
            last_exc = RuntimeError(f"网络错误，重试中… (第 {attempt + 1} 次): {exc}")

    raise RuntimeError(f"API 调用失败（已重试 {max_retries} 次）: {last_exc}")


def _auth_headers(api_key: str) -> dict:
    return {"Authorization": f"Bearer {api_key}"}


# ── Image generation: /v1/images/generations ─────────────────────────────────


def _extract_b64_from_image_response(resp: dict) -> str:
    """
    Extract base64 PNG from /v1/images/generations response.
    Handles both b64_json and url variants; downloads URL if needed.
    """
    items = resp.get("data") or []
    if not items:
        raise RuntimeError(f"图片生成响应中无 data 字段: {str(resp)[:300]}")
    item = items[0]

    # Preferred: b64_json returned directly
    b64 = item.get("b64_json")
    if b64:
        return b64

    # Fallback: download from url
    img_url = item.get("url")
    if img_url:
        try:
            with httpx.Client(timeout=60.0) as client:
                r = client.get(img_url)
            r.raise_for_status()
            return base64.b64encode(r.content).decode()
        except Exception as exc:
            raise RuntimeError(f"下载图片 URL 失败: {exc}") from exc

    raise RuntimeError(f"图片响应中既无 b64_json 也无 url: {str(item)[:200]}")


def _call_image_generation(
    prompt: str,
    model: str,
    size: str,
    api_key: str,
    base_url: str,
) -> str:
    """Call /v1/images/generations. Returns base64 PNG string."""
    url = f"{base_url}/images/generations"
    headers = {**_auth_headers(api_key), "Content-Type": "application/json"}
    body = {
        "model": model,
        "prompt": prompt,
        "size": size,
        "n": 1,
        "response_format": "b64_json",
    }
    resp = _http_post_with_retry(url, headers=headers, json_body=body)
    return _extract_b64_from_image_response(resp)


# ── Image editing: /v1/images/edits (multipart) ──────────────────────────────


def _call_image_edit(
    prompt: str,
    model: str,
    size: str,
    ref_image_b64: str,
    ref_mime: str,
    api_key: str,
    base_url: str,
) -> str:
    """Call /v1/images/edits with reference image. Returns base64 PNG string."""
    url = f"{base_url}/images/edits"
    headers = _auth_headers(api_key)  # No Content-Type – httpx sets multipart boundary
    img_bytes = base64.b64decode(ref_image_b64)
    ext = ref_mime.split("/")[-1] if "/" in ref_mime else "png"
    files = {"image": (f"reference.{ext}", img_bytes, ref_mime)}
    data = {
        "model": model,
        "prompt": prompt,
        "size": size,
        "n": "1",
        "response_format": "b64_json",
    }
    resp = _http_post_with_retry(url, headers=headers, data=data, files=files)
    return _extract_b64_from_image_response(resp)


# ── Text generation: /v1/chat/completions ────────────────────────────────────


def _call_chat_completion(
    messages: list[dict],
    model: str,
    api_key: str,
    base_url: str,
) -> str:
    """Call /v1/chat/completions. Returns the assistant message content string."""
    url = f"{base_url}/chat/completions"
    headers = {**_auth_headers(api_key), "Content-Type": "application/json"}
    body = {"model": model, "messages": messages}
    resp = _http_post_with_retry(url, headers=headers, json_body=body)
    try:
        return resp["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"无法从文字生成响应中提取内容: {resp}") from exc


# ── Shared helpers ────────────────────────────────────────────────────────────


def _generate_image_asset(
    prompt: str,
    model: str,
    size: str,
    ref_image_b64: str | None,
    ref_mime: str,
    api_key: str,
    base_url: str,
) -> str:
    """Route to generations or edits depending on whether a reference image exists."""
    if ref_image_b64:
        return _call_image_edit(
            prompt, model, size, ref_image_b64, ref_mime, api_key, base_url
        )
    return _call_image_generation(prompt, model, size, api_key, base_url)


# ── Generation pipeline ───────────────────────────────────────────────────────


def _generate_grid(
    user_prompt: str,
    ref_image_b64: str | None,
    ref_mime: str,
    api_key: str,
    base_url: str,
) -> str:
    """Generate the 4×6 meme grid. Returns base64 PNG."""
    directive = GRID_SYSTEM_DIRECTIVE
    if ref_image_b64:
        directive = directive.rstrip() + "\n" + GRID_REF_IMAGE_DIRECTIVE
    full_prompt = f"{user_prompt}\n\n{directive}"

    return _generate_image_asset(
        full_prompt,
        "gpt-image-2",
        "1536x1024",
        ref_image_b64,
        ref_mime,
        api_key,
        base_url,
    )


def _generate_banner(
    user_prompt: str,
    ref_image_b64: str | None,
    ref_mime: str,
    api_key: str,
    base_url: str,
) -> str:
    """Generate the banner image. Returns base64 PNG."""
    prompt = BANNER_PROMPT_TEMPLATE.format(user_prompt=user_prompt)
    return _generate_image_asset(
        prompt,
        "gpt-image-2",
        "1536x1024",
        ref_image_b64,
        ref_mime,
        api_key,
        base_url,
    )


def _generate_logo(
    user_prompt: str,
    ref_image_b64: str | None,
    ref_mime: str,
    api_key: str,
    base_url: str,
) -> str:
    """Generate the logo image. Returns base64 PNG."""
    prompt = LOGO_PROMPT_TEMPLATE.format(user_prompt=user_prompt)
    return _generate_image_asset(
        prompt,
        "gpt-image-2",
        "1024x1024",
        ref_image_b64,
        ref_mime,
        api_key,
        base_url,
    )


PROMPTS_GENERATION_TEMPLATE = """
你是一名专业的 AI 绘图提示词工程师，擅长为图像生成模型撰写高质量英文提示词。
请根据用户对表情包的描述，生成如下五项内容，以 JSON 格式返回：

1. grid_prompt：用于生成 4×6（24格）表情包网格图的详细英文提示词。
   要求：同一角色不同表情/姿势组成 24 个格子，纯色背景，角色居中留有安全边距，中文短句标注，极细分割线，4K画质。

2. banner_prompt：用于生成网站横幅（16:9，1536×1024）的英文提示词。
   要求：主题与表情包角色一致、具有吸引力、背景非白色，适合社媒封面。

3. logo_prompt：用于生成 App 图标（1:1 正方形，1024×1024）的英文提示词。
   要求：简洁图标风格、矢量感、与角色主题相关。

4. title：表情包套装的中文名称（20字以内）。

5. description：表情包套装的中文简介（100字以内）。

用户描述：{user_prompt}

只返回合法 JSON，不要有任何多余说明或代码块标记，格式：
{{"grid_prompt": "...", "banner_prompt": "...", "logo_prompt": "...", "title": "...", "description": "..."}}
"""


def _generate_prompts_only(user_prompt: str, api_key: str, base_url: str) -> dict:
    """Generate drawing prompts + metadata without calling image APIs."""
    prompt = PROMPTS_GENERATION_TEMPLATE.format(user_prompt=user_prompt)
    messages = [{"role": "user", "content": prompt}]
    raw = _call_chat_completion(messages, "gpt-5.5", api_key, base_url)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(raw[start:end])
            except json.JSONDecodeError:
                pass
    return {
        "grid_prompt": raw[:600] if raw else "生成失败",
        "banner_prompt": "",
        "logo_prompt": "",
        "title": user_prompt[:20],
        "description": "",
    }


def _generate_metadata(
    user_prompt: str,
    api_key: str,
    base_url: str,
) -> dict:
    """Generate title + description via chat/completions. Returns dict with 'title' and 'description'."""
    prompt = METADATA_PROMPT_TEMPLATE.format(user_prompt=user_prompt)
    messages = [{"role": "user", "content": prompt}]
    raw = _call_chat_completion(messages, "gpt-5.5", api_key, base_url)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Try to extract JSON substring
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                return json.loads(raw[start:end])
            except json.JSONDecodeError:
                pass
        return {"title": user_prompt[:20], "description": raw[:100]}


# ── Auto-slice algorithm ──────────────────────────────────────────────────────


def line_foreground_score(
    pixels,
    width: int,
    height: int,
    position: int,
    axis: str,
) -> float:
    """Compute mean 'foreground activity' score for a scan line."""
    band_radius = 2
    score = 0.0
    samples = 0
    if axis == "y":
        for y in range(
            max(0, position - band_radius),
            min(height, position + band_radius + 1),
        ):
            for x in range(0, width, 3):
                r, g, b = pixels[x, y][:3]
                darkness = 255 - (r + g + b) / 3
                color_variance = max(r, g, b) - min(r, g, b)
                score += darkness + color_variance * 0.5
                samples += 1
    else:
        for x in range(
            max(0, position - band_radius),
            min(width, position + band_radius + 1),
        ):
            for y in range(0, height, 3):
                r, g, b = pixels[x, y][:3]
                darkness = 255 - (r + g + b) / 3
                color_variance = max(r, g, b) - min(r, g, b)
                score += darkness + color_variance * 0.5
                samples += 1
    return score / samples if samples else float("inf")


def find_grid_cuts(
    pixels,
    width: int,
    height: int,
    count: int,
    axis: str,
) -> list[int]:
    """
    Find `count` interior cut positions along `axis` ('x' or 'y').
    Returns a list of length count+1 including 0 and total length.
    """
    length = width if axis == "x" else height
    expected_cell = length / count
    search_radius = max(8, round(expected_cell * GRID_SEARCH_RATIO))
    cuts = [0]
    for i in range(1, count):
        expected = round(expected_cell * i)
        start = max(cuts[-1] + 1, expected - search_radius)
        end = min(length - 2, expected + search_radius)
        best_pos = expected
        best_score = float("inf")
        for pos in range(start, end + 1):
            score = line_foreground_score(pixels, width, height, pos, axis)
            if score < best_score:
                best_score = score
                best_pos = pos
        cuts.append(best_pos)
    cuts.append(length)
    return cuts


def slice_image(image_b64: str) -> dict:
    """
    Auto-detect grid lines and slice the image into 24 cells.
    Returns dict with x_cuts, y_cuts, and slices (list of base64 PNGs).
    """
    img_bytes = base64.b64decode(image_b64)
    img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
    width, height = img.size

    pixels = img.load()
    x_cuts = find_grid_cuts(pixels, width, height, COLS, "x")
    y_cuts = find_grid_cuts(pixels, width, height, ROWS, "y")

    slices = _crop_slices(img, x_cuts, y_cuts)
    return {"x_cuts": x_cuts, "y_cuts": y_cuts, "slices": slices}


def _crop_slices(img: Image.Image, x_cuts: list[int], y_cuts: list[int]) -> list[str]:
    """Crop image cells based on exact pixel cut positions. Returns list of base64 PNGs."""
    slices: list[str] = []
    for row in range(ROWS):
        for col in range(COLS):
            x0 = x_cuts[col]
            x1 = x_cuts[col + 1]
            y0 = y_cuts[row]
            y1 = y_cuts[row + 1]
            cell = img.crop((x0, y0, x1, y1))
            buf = io.BytesIO()
            cell.save(buf, format="PNG")
            slices.append(base64.b64encode(buf.getvalue()).decode("utf-8"))
    return slices


def _image_ext_from_mime(mime: str) -> str:
    """Return a safe image file extension for packaged uploads."""
    mime = (mime or "").lower().split(";")[0].strip()
    return {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
    }.get(mime, "png")


# ── SSE generation pipeline ───────────────────────────────────────────────────


def _sse_event(event: str, data: dict | str) -> str:
    if isinstance(data, dict):
        data = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {data}\n\n"


def _run_generation_pipeline(
    user_prompt: str,
    ref_image_b64: str | None,
    ref_mime: str,
    api_key: str,
    base_url: str,
) -> Generator[str, None, None]:
    """Generator that yields SSE events for the generation pipeline."""

    result: dict = {}

    # Step 1: Grid
    yield _sse_event(
        "progress", {"step": "grid", "message": "正在生成表情包网格图…", "pct": 10}
    )
    try:
        grid_b64 = _generate_grid(
            user_prompt, ref_image_b64, ref_mime, api_key, base_url
        )
        result["grid_image"] = grid_b64
        yield _sse_event(
            "progress",
            {
                "step": "grid_done",
                "message": "网格图生成完成，正在自动切片…",
                "pct": 35,
            },
        )
    except Exception as exc:
        yield _sse_event("error", {"message": f"网格图生成失败: {exc}"})
        return

    # Auto-slice
    try:
        slice_result = slice_image(grid_b64)
        result["x_cuts"] = slice_result["x_cuts"]
        result["y_cuts"] = slice_result["y_cuts"]
        result["slices"] = slice_result["slices"]
        yield _sse_event(
            "progress",
            {"step": "slice_done", "message": "切片完成，正在生成横幅…", "pct": 45},
        )
    except Exception as exc:
        yield _sse_event("error", {"message": f"自动切片失败: {exc}"})
        return

    # Step 2: Banner
    try:
        banner_b64 = _generate_banner(
            user_prompt, ref_image_b64, ref_mime, api_key, base_url
        )
        result["banner_image"] = banner_b64
        yield _sse_event(
            "progress",
            {
                "step": "banner_done",
                "message": "横幅生成完成，正在生成图标…",
                "pct": 65,
            },
        )
    except Exception as exc:
        yield _sse_event("error", {"message": f"横幅生成失败: {exc}"})
        return

    # Step 3: Logo
    try:
        logo_b64 = _generate_logo(
            user_prompt, ref_image_b64, ref_mime, api_key, base_url
        )
        result["logo_image"] = logo_b64
        yield _sse_event(
            "progress",
            {"step": "logo_done", "message": "图标生成完成，正在生成文案…", "pct": 85},
        )
    except Exception as exc:
        yield _sse_event("error", {"message": f"图标生成失败: {exc}"})
        return

    # Step 4: Metadata
    try:
        meta = _generate_metadata(user_prompt, api_key, base_url)
        result["title"] = meta.get("title", "")
        result["description"] = meta.get("description", "")
        yield _sse_event(
            "progress", {"step": "meta_done", "message": "全部生成完成！", "pct": 100}
        )
    except Exception as exc:
        # Non-fatal: use fallback
        result["title"] = user_prompt[:20]
        result["description"] = ""
        yield _sse_event(
            "progress",
            {
                "step": "meta_done",
                "message": f"文案生成失败，已使用默认值: {exc}",
                "pct": 100,
            },
        )

    yield _sse_event("done", result)


# ── Flask routes ──────────────────────────────────────────────────────────────


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/generate-prompts", methods=["POST"])
def api_generate_prompts():
    """
    Generate drawing prompts + title/description via text model only.
    No image generation is performed.
    Body: {prompt: str}
    Returns: {grid_prompt, banner_prompt, logo_prompt, title, description}
    """
    auth_err = _check_gateway_auth()
    if auth_err:
        return auth_err

    body = request.get_json(force=True, silent=True) or {}
    user_prompt: str = (body.get("prompt") or "").strip()
    if not user_prompt:
        return jsonify({"error": "请输入提示词"}), 400

    api_key, base_url = _get_api_credentials()
    try:
        result = _generate_prompts_only(user_prompt, api_key, base_url)
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": f"提示词生成失败: {exc}"}), 500


@app.route("/api/generate", methods=["POST"])
def api_generate():
    """
    SSE endpoint.  Streams progress events then a final 'done' event
    containing all generated assets as base64.
    """
    auth_err = _check_gateway_auth()
    if auth_err:
        return auth_err

    body = request.get_json(force=True, silent=True) or {}
    user_prompt: str = (body.get("prompt") or "").strip()
    if not user_prompt:
        return jsonify({"error": "请输入提示词"}), 400

    ref_image_b64: str | None = body.get("reference_image_base64") or None
    ref_mime: str = body.get("reference_image_mime") or "image/png"

    api_key, base_url = _get_api_credentials()

    def event_stream():
        yield from _run_generation_pipeline(
            user_prompt, ref_image_b64, ref_mime, api_key, base_url
        )

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/api/slice", methods=["POST"])
def api_slice():
    """
    Auto-detect grid cut lines and return sliced cells.
    Body: {image_base64: str}
    Returns: {x_cuts, y_cuts, slices}
    """
    auth_err = _check_gateway_auth()
    if auth_err:
        return auth_err

    body = request.get_json(force=True, silent=True) or {}
    image_b64: str = body.get("image_base64", "")
    if not image_b64:
        return jsonify({"error": "缺少 image_base64 字段"}), 400

    try:
        result = slice_image(image_b64)
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": f"切片失败: {exc}"}), 500


@app.route("/api/crop", methods=["POST"])
def api_crop():
    """
    Crop image using EXACT user-provided pixel coordinates.
    Body: {image_base64, x_cuts: [0,x1,x2,x3,x4,x5,width], y_cuts: [0,y1,y2,y3,height]}
    Returns: {slices: [...base64...]}
    """
    auth_err = _check_gateway_auth()
    if auth_err:
        return auth_err

    body = request.get_json(force=True, silent=True) or {}
    image_b64: str = body.get("image_base64", "")
    x_cuts: list[int] = body.get("x_cuts", [])
    y_cuts: list[int] = body.get("y_cuts", [])

    if not image_b64:
        return jsonify({"error": "缺少 image_base64 字段"}), 400
    if len(x_cuts) != COLS + 1:
        return jsonify({"error": f"x_cuts 长度应为 {COLS + 1}"}), 400
    if len(y_cuts) != ROWS + 1:
        return jsonify({"error": f"y_cuts 长度应为 {ROWS + 1}"}), 400

    try:
        img_bytes = base64.b64decode(image_b64)
        img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
        slices = _crop_slices(img, [int(v) for v in x_cuts], [int(v) for v in y_cuts])
        return jsonify({"slices": slices})
    except Exception as exc:
        return jsonify({"error": f"精确裁切失败: {exc}"}), 500


@app.route("/api/download-zip", methods=["POST"])
def api_download_zip():
    """
    Build and return a ZIP archive with:
      stickers/  – 24 individual meme PNGs
      banner.png
      logo.png
      info.txt   – title + description
    Body: {slices, banner_image, logo_image, title, description}
    """
    auth_err = _check_gateway_auth()
    if auth_err:
        return auth_err

    body = request.get_json(force=True, silent=True) or {}
    slices: list[str] = body.get("slices", [])
    banner_b64: str = body.get("banner_image", "")
    banner_mime: str = body.get("banner_mime", "image/png")
    logo_b64: str = body.get("logo_image", "")
    logo_mime: str = body.get("logo_mime", "image/png")
    title: str = body.get("title", "表情包")
    description: str = body.get("description", "")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        # Stickers
        for idx, s_b64 in enumerate(slices):
            row = idx // COLS + 1
            col = idx % COLS + 1
            name = f"stickers/meme_{row:02d}_{col:02d}.png"
            zf.writestr(name, base64.b64decode(s_b64))

        # Banner
        if banner_b64:
            zf.writestr(
                f"banner.{_image_ext_from_mime(banner_mime)}",
                base64.b64decode(banner_b64),
            )

        # Logo
        if logo_b64:
            zf.writestr(
                f"logo.{_image_ext_from_mime(logo_mime)}",
                base64.b64decode(logo_b64),
            )

        # Info text
        info_lines = [
            f"标题：{title}",
            "",
            f"简介：{description}",
            "",
            f"包含表情包：{len(slices)} 个",
            f"网格：{ROWS} 行 × {COLS} 列",
        ]
        zf.writestr("info.txt", "\n".join(info_lines))

    buf.seek(0)
    safe_title = (
        "".join(c for c in title if c.isascii() and (c.isalnum() or c in ("-", "_", " ")))[:40].strip()
        or "wxemoji"
    )
    filename = f"{safe_title}.zip"
    utf8_filename = quote(f"{title or 'wxemoji'}.zip")

    return Response(
        buf.read(),
        mimetype="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{filename}"; filename*=UTF-8\'\'{utf8_filename}'
            ),
        },
    )


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    import os as _os

    parser = argparse.ArgumentParser(description="表情包工坊 Flask 服务")
    parser.add_argument("--host", default=None, help="监听地址 (默认读取配置)")
    parser.add_argument(
        "--port", type=int, default=None, help="监听端口 (默认读取配置)"
    )
    args = parser.parse_args()

    # 优先级: 命令行参数 > 运行时 PORT/HOST 环境变量 > config 模块
    host = args.host or _os.environ.get("HOST") or config.HOST
    port = args.port or int(_os.environ.get("PORT", 0)) or config.PORT

    print(f"[wxemoji] 启动服务 http://{host}:{port}")
    print(f"[wxemoji] API Base URL: {config.OPENAI_BASE_URL}")
    app.run(
        host=host,
        port=port,
        debug=False,
        threaded=True,
    )
