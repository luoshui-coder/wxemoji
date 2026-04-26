import os

import yaml
from dotenv import load_dotenv

# ── Hardcoded defaults ────────────────────────────────────────────────────────
_DEFAULTS = {
    "OPENAI_API_KEY": "your-api-key-here",
    "OPENAI_BASE_URL": "https://api.openai.com/v1",
    "GATEWAY_API_KEY": "",
    "HOST": "0.0.0.0",
    "PORT": 5000,
    "REQUEST_TIMEOUT": 180.0,
}

# ── Internal helpers ──────────────────────────────────────────────────────────


def _load_yaml(path: str = "config.yaml") -> dict:
    """Load a YAML config file. Returns empty dict if not found or invalid."""
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        return data
    except Exception as exc:
        print(f"[config] Warning: could not parse {path}: {exc}")
        return {}


def _yaml_key(env_key: str) -> str:
    """Convert ENV_KEY style to yaml_key style (lower-case)."""
    return env_key.lower()


def _build_config() -> dict:
    """
    Build the final config dict following this priority order
    (highest → lowest):
      1. config.yaml (if present)
      2. .env file   (loaded via python-dotenv)
      3. real environment variables
      4. hardcoded defaults
    """
    # Load .env into os.environ (won't overwrite already-set vars)
    load_dotenv(override=False)

    # Load config.yaml
    yaml_cfg = _load_yaml("config.yaml")

    cfg: dict = {}

    for key, default in _DEFAULTS.items():
        yaml_val = yaml_cfg.get(_yaml_key(key))  # config.yaml wins first
        env_val = os.environ.get(key)  # then env / .env

        if yaml_val is not None and str(yaml_val).strip() != "":
            raw = yaml_val
        elif env_val is not None and str(env_val).strip() != "":
            raw = env_val
        else:
            raw = default

        # Type-coerce to match the default type
        if isinstance(default, int):
            try:
                cfg[key] = int(raw)
            except (ValueError, TypeError):
                cfg[key] = default
        elif isinstance(default, float):
            try:
                cfg[key] = float(raw)
            except (ValueError, TypeError):
                cfg[key] = default
        else:
            cfg[key] = str(raw)

    return cfg


# ── Public config object ──────────────────────────────────────────────────────

_cfg = _build_config()

OPENAI_API_KEY: str = _cfg["OPENAI_API_KEY"]
OPENAI_BASE_URL: str = _cfg["OPENAI_BASE_URL"].rstrip("/")
GATEWAY_API_KEY: str = _cfg["GATEWAY_API_KEY"]
HOST: str = _cfg["HOST"]
PORT: int = int(_cfg["PORT"])
REQUEST_TIMEOUT: float = float(_cfg["REQUEST_TIMEOUT"])


def reload() -> None:
    """Re-read config from disk (useful in tests or after file changes)."""
    global OPENAI_API_KEY, OPENAI_BASE_URL, GATEWAY_API_KEY
    global HOST, PORT, REQUEST_TIMEOUT, _cfg
    _cfg = _build_config()
    OPENAI_API_KEY = _cfg["OPENAI_API_KEY"]
    OPENAI_BASE_URL = _cfg["OPENAI_BASE_URL"].rstrip("/")
    GATEWAY_API_KEY = _cfg["GATEWAY_API_KEY"]
    HOST = _cfg["HOST"]
    PORT = int(_cfg["PORT"])
    REQUEST_TIMEOUT = float(_cfg["REQUEST_TIMEOUT"])


def as_dict() -> dict:
    """Return a sanitised copy of the current config (no secret values)."""
    return {
        "OPENAI_BASE_URL": OPENAI_BASE_URL,
        "HOST": HOST,
        "PORT": PORT,
        "REQUEST_TIMEOUT": REQUEST_TIMEOUT,
        "GATEWAY_ENABLED": bool(GATEWAY_API_KEY),
    }
