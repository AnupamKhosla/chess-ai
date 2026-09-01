"""Provider adapters for the local chess coach.

The browser talks to one coach API.  This module keeps the model connection
behind that API so a user can choose an API key, a local model, or an already
authenticated CLI subscription without changing the chess UI.

Secrets are intentionally held only in the running process.  The settings
endpoint never returns an API key and this module does not write credentials
to disk.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import subprocess
from dataclasses import asdict, dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProviderPreset:
    id: str
    label: str
    kind: str
    base_url: str
    model: str
    requires_key: bool = False
    cli_command: str | None = None
    help: str = ""
    effort_options: tuple[str, ...] = ("auto", "low", "medium", "high")


PROVIDER_PRESETS: tuple[ProviderPreset, ...] = (
    ProviderPreset(
        "local", "Free local engine-backed player (no key)", "builtin",
        "", "stockfish-local-v1", False,
        help="Instant guest mode: local Stockfish chooses a legal, tactically screened move. No API key, login, or network required. The chat coach remains a lightweight local explainer.",
        effort_options=("auto",),
    ),
    ProviderPreset(
        "opencode-free", "OpenCode Big Pickle · free trial (no key)", "openai-compatible",
        "https://opencode.ai/zen", "big-pickle", False,
        help="Uses OpenCode's currently free Big Pickle route without a key. Availability and limits are controlled by OpenCode; do not send sensitive data.",
        effort_options=("auto",),
    ),
    ProviderPreset(
        "gemini", "Google Gemini free tier (API key)", "gemini",
        "https://generativelanguage.googleapis.com", "gemini-2.5-flash", True,
        help="Google AI Studio offers a free API tier for limited use. Create a Gemini API key and paste it here; the key stays in this process only.",
        effort_options=("auto", "low", "medium", "high"),
    ),
    ProviderPreset(
        "groq", "Groq free tier (API key)", "openai-compatible",
        "https://api.groq.com/openai", "openai/gpt-oss-120b", True,
        help="Fast hosted inference with a free developer allowance. Create a Groq API key and paste it here; provider limits apply.",
        effort_options=("auto", "low", "medium", "high"),
    ),
    ProviderPreset(
        "deepseek", "DeepSeek API key", "openai-compatible",
        "https://api.deepseek.com", "deepseek-v4-flash", True,
        help="Paste a DeepSeek API key. V4 Flash is the fast default; V4 Pro is the deeper option.",
        effort_options=("auto", "low", "high", "max"),
    ),
    ProviderPreset(
        "openai", "OpenAI API key", "openai-compatible",
        "https://api.openai.com", "gpt-5.6-luna", True,
        help="Paste an OpenAI API key. This is separate from a ChatGPT subscription.",
        effort_options=("auto", "none", "minimal", "low", "medium", "high", "xhigh", "max"),
    ),
    ProviderPreset(
        "anthropic", "Anthropic API key", "anthropic",
        "https://api.anthropic.com", "claude-sonnet-4-6", True,
        help="Paste an Anthropic API key.",
        effort_options=("auto", "low", "medium", "high"),
    ),
    ProviderPreset(
        "openrouter", "OpenRouter Free / hosted (API key)", "openai-compatible",
        "https://openrouter.ai/api", "openrouter/free", True,
        help="Use the free-model router with your own OpenRouter key, or enter any hosted model.",
        effort_options=("auto", "low", "medium", "high"),
    ),
    ProviderPreset(
        "ollama", "Ollama (local)", "openai-compatible",
        "http://127.0.0.1:11434", "llama3.2", False,
        help="No cloud key. Start Ollama and enter an installed model name.",
        effort_options=("auto", "low", "medium", "high"),
    ),
    ProviderPreset(
        "lmstudio", "LM Studio (local)", "openai-compatible",
        "http://127.0.0.1:1234", "local-model", False,
        help="No cloud key. Start the LM Studio local server.",
        effort_options=("auto", "low", "medium", "high"),
    ),
    ProviderPreset(
        "codex", "ChatGPT / Codex login", "codex-cli",
        "", "default", False, "codex",
        help="Uses the local Codex login (OAuth/subscription) through read-only Codex CLI.",
        effort_options=("auto", "none", "minimal", "low", "medium", "high", "xhigh"),
    ),
    ProviderPreset(
        "claude", "Claude subscription / Claude Code", "claude-cli",
        "", "sonnet", False, "claude",
        help="Uses the local Claude Code login/subscription when the claude CLI is installed.",
        effort_options=("auto", "low", "medium", "high"),
    ),
)

_PRESETS = {preset.id: preset for preset in PROVIDER_PRESETS}


class ProviderUnavailableError(RuntimeError):
    """A provider request failed without exposing secrets to the UI.

    The caller can use ``user_message`` to report the selected provider and a
    useful status (for example HTTP 429 or timeout) without leaking response
    bodies, request headers, or API keys.
    """

    def __init__(
        self,
        provider: str,
        detail: str,
        status_code: int | None = None,
    ):
        self.provider = provider
        self.status_code = status_code
        preset = preset_for(provider)
        self.label = preset.label if preset else provider
        self.detail = detail
        super().__init__(self.user_message)

    @property
    def user_message(self) -> str:
        return f"{self.label} unavailable ({self.detail})."


@dataclass
class ProviderConfig:
    provider: str = "opencode-free"
    kind: str = "openai-compatible"
    base_url: str = "https://opencode.ai/zen"
    model: str = "big-pickle"
    api_key: str | None = None
    effort: str = "auto"

    def public(self) -> dict[str, Any]:
        """Return UI-safe settings; never expose the secret itself."""
        preset = _PRESETS.get(self.provider)
        installed = None
        authenticated = None
        if preset and preset.cli_command:
            installed = shutil.which(preset.cli_command) is not None
            authenticated = cli_auth_status(self.provider)
        return {
            "provider": self.provider,
            "kind": self.kind,
            "base_url": self.base_url,
            "model": self.model,
            "effort": self.effort,
            "effort_options": list(preset.effort_options) if preset else ["auto", "low", "medium", "high"],
            "has_api_key": bool(self.api_key),
            "installed": installed,
            "authenticated": authenticated,
            "label": preset.label if preset else "Custom provider",
        }


def preset_for(provider: str) -> ProviderPreset | None:
    return _PRESETS.get(provider)


def cli_auth_status(provider: str) -> bool | None:
    """Check local CLI auth without returning account details or tokens."""
    preset = preset_for(provider)
    if not preset or not preset.cli_command or shutil.which(preset.cli_command) is None:
        return None if not preset or not preset.cli_command else False
    command = (
        [preset.cli_command, "login", "status"]
        if provider == "codex"
        else [preset.cli_command, "auth", "status"]
    )
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=5, check=False,
        )
        output = result.stdout.strip()
        if provider == "codex":
            output = f"{output}\n{result.stderr.strip()}"
            return result.returncode == 0 and "logged in" in output.lower()
        data = json.loads(output)
        return bool(data.get("loggedIn")) if isinstance(data, dict) else False
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError, ValueError):
        return False


def start_cli_login(provider: str) -> None:
    """Start an explicit browser login flow for a selected CLI provider."""
    preset = preset_for(provider)
    if not preset or not preset.cli_command:
        raise ValueError("This provider does not have a local login flow")
    if shutil.which(preset.cli_command) is None:
        raise RuntimeError(f"{preset.cli_command} is not installed or not on PATH")
    command = (
        [preset.cli_command, "login"]
        if provider == "codex"
        else [preset.cli_command, "auth", "login"]
    )
    subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def provider_catalog(active: ProviderConfig) -> list[dict[str, Any]]:
    """Return provider choices and local installation status."""
    catalog: list[dict[str, Any]] = []
    for preset in PROVIDER_PRESETS:
        item = asdict(preset)
        item["installed"] = (
            shutil.which(preset.cli_command) is not None
            if preset.cli_command else None
        )
        item["authenticated"] = cli_auth_status(preset.id) if preset.cli_command else None
        item["active"] = preset.id == active.provider
        catalog.append(item)
    return catalog


def _messages_to_prompt(messages: list[dict[str, Any]]) -> str:
    """Flatten chat messages for a CLI provider while retaining roles."""
    parts: list[str] = []
    for message in messages:
        role = str(message.get("role", "user")).upper()
        content = message.get("content", "")
        if isinstance(content, list):
            content = " ".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
        parts.append(f"[{role}]\n{content}")
    return "\n\n".join(parts)


async def _openai_compatible(
    config: ProviderConfig,
    messages: list[dict[str, Any]],
    timeout: float,
) -> str | None:
    headers: dict[str, str] = {}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"
    payload: dict[str, Any] = {"model": config.model, "messages": messages}
    if config.effort != "auto" and config.provider in {"openai", "deepseek", "openrouter"}:
        if config.provider == "openrouter":
            # OpenRouter's unified reasoning object is the compatible form
            # across its routed providers. The dynamic free router chooses
            # the model itself, so leave its effort at the provider default.
            if config.model != "openrouter/free":
                payload["reasoning"] = {"effort": config.effort}
        else:
            payload["reasoning_effort"] = config.effort
            if config.provider == "deepseek":
                payload["thinking"] = {"type": "disabled" if config.effort == "none" else "enabled"}
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{config.base_url.rstrip('/')}/v1/chat/completions",
            json=payload,
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        return content if isinstance(content, str) else str(content)


async def _anthropic(
    config: ProviderConfig,
    messages: list[dict[str, Any]],
    timeout: float,
) -> str | None:
    if not config.api_key:
        return None
    system_parts = [m["content"] for m in messages if m.get("role") == "system"]
    conversation = [m for m in messages if m.get("role") != "system"]
    headers = {
        "x-api-key": config.api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    payload: dict[str, Any] = {
        "model": config.model,
        "max_tokens": 1200,
        "messages": conversation,
    }
    if system_parts:
        payload["system"] = "\n\n".join(system_parts)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{config.base_url.rstrip('/')}/v1/messages",
            json=payload,
            headers=headers,
        )
        response.raise_for_status()
        data = response.json()
        blocks = data.get("content", [])
        text = "\n".join(
            str(block.get("text", ""))
            for block in blocks
            if isinstance(block, dict) and block.get("type") == "text"
        ).strip()
        return text or None


async def _gemini(
    config: ProviderConfig,
    messages: list[dict[str, Any]],
    timeout: float,
) -> str | None:
    """Call Gemini's REST generateContent endpoint without an SDK dependency."""
    if not config.api_key:
        return None
    system_parts = [
        str(message.get("content", ""))
        for message in messages
        if message.get("role") == "system"
    ]
    contents: list[dict[str, Any]] = []
    for message in messages:
        role = message.get("role")
        if role not in {"user", "assistant"}:
            continue
        contents.append({
            "role": "model" if role == "assistant" else "user",
            "parts": [{"text": str(message.get("content", ""))}],
        })
    payload: dict[str, Any] = {
        "contents": contents,
        "generationConfig": {"maxOutputTokens": 1200},
    }
    if system_parts:
        payload["systemInstruction"] = {"parts": [{"text": "\n\n".join(system_parts)}]}
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{config.base_url.rstrip('/')}/v1beta/models/{config.model}:generateContent",
            json=payload,
            headers={"x-goog-api-key": config.api_key, "content-type": "application/json"},
        )
        response.raise_for_status()
        data = response.json()
        candidates = data.get("candidates", [])
        if not candidates:
            return None
        parts = candidates[0].get("content", {}).get("parts", [])
        text = "\n".join(
            str(part.get("text", ""))
            for part in parts
            if isinstance(part, dict) and isinstance(part.get("text"), str)
        ).strip()
        return text or None


def _codex_text(stdout: str) -> str | None:
    """Extract the final agent message from Codex JSONL output."""
    final: str | None = None
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        item = event.get("item")
        if isinstance(item, dict) and item.get("type") in {"agent_message", "agentMessage"}:
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                final = text.strip()
        if event.get("type") == "turn.completed":
            turn = event.get("turn")
            if isinstance(turn, dict) and isinstance(turn.get("final_text"), str):
                final = turn["final_text"].strip()
    return final


def _claude_text(stdout: str) -> str | None:
    """Extract Claude Code's result from JSON or JSONL output."""
    try:
        data = json.loads(stdout)
        if isinstance(data, dict):
            for key in ("result", "text", "message"):
                value = data.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
    except json.JSONDecodeError:
        pass
    for line in reversed(stdout.splitlines()):
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict) and isinstance(event.get("result"), str):
            return event["result"].strip()
    return stdout.strip() or None


async def _cli(
    config: ProviderConfig,
    messages: list[dict[str, Any]],
    timeout: float,
) -> str | None:
    preset = preset_for(config.provider)
    if not preset or not preset.cli_command:
        return None
    if shutil.which(preset.cli_command) is None:
        raise RuntimeError(f"{preset.cli_command} is not installed or not on PATH")

    prompt = _messages_to_prompt(messages)
    if config.provider == "codex":
        command = [
            preset.cli_command, "exec", "--json", "--sandbox", "read-only",
            "--ephemeral", "--skip-git-repo-check", "-",
        ]
        if config.model and config.model != "default":
            command[3:3] = ["--model", config.model]
        if config.effort != "auto":
            command[3:3] = ["--config", f"model_reasoning_effort={config.effort}"]
        extract = _codex_text
    else:
        command = [
            preset.cli_command, "-p", "--output-format", "json",
            "--no-session-persistence", "--permission-mode", "plan", "--tools", "",
        ]
        if config.model and config.model != "default":
            command[2:2] = ["--model", config.model]
        extract = _claude_text

    process = await asyncio.create_subprocess_exec(
        *command,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(prompt.encode("utf-8")), timeout=timeout,
        )
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        raise RuntimeError(f"{preset.label} timed out")
    except asyncio.CancelledError:
        # ``asyncio.wait_for`` cancels this coroutine when a request-level
        # timeout fires. Do not leave a Codex/Claude child process running in
        # the background after the browser has already given up.
        if process.returncode is None:
            process.kill()
        await process.wait()
        raise
    if process.returncode != 0:
        detail = stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(detail or f"{preset.label} exited with code {process.returncode}")
    return extract(stdout.decode("utf-8", errors="replace"))


async def chat_with_provider(
    config: ProviderConfig,
    messages: list[dict[str, Any]],
    timeout: float = 30.0,
) -> str | None:
    """Send a chat request through the selected provider.

    Built-in local mode returns ``None`` because it has no chat endpoint.
    Transport and provider failures raise ``ProviderUnavailableError`` so the
    caller can distinguish an unavailable selected AI from an intentional
    local-player mode.
    """
    try:
        if config.kind == "builtin":
            return None
        if config.kind == "anthropic":
            return await _anthropic(config, messages, timeout)
        if config.kind == "gemini":
            return await _gemini(config, messages, timeout)
        if config.kind in {"codex-cli", "claude-cli"}:
            return await _cli(config, messages, timeout)
        return await _openai_compatible(config, messages, timeout)
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code if exc.response is not None else None
        detail = f"HTTP {status_code}" if status_code is not None else "HTTP error"
        logger.warning("Coach provider %s unavailable: %s", config.provider, detail)
        raise ProviderUnavailableError(config.provider, detail, status_code) from exc
    except httpx.TimeoutException as exc:
        logger.warning("Coach provider %s timed out", config.provider)
        raise ProviderUnavailableError(config.provider, "timed out") from exc
    except httpx.RequestError as exc:
        logger.warning("Coach provider %s network failure: %s", config.provider, exc)
        raise ProviderUnavailableError(config.provider, "network error") from exc
    except httpx.HTTPError as exc:
        logger.warning("Coach provider %s request failed: %s", config.provider, exc)
        raise ProviderUnavailableError(config.provider, "request failed") from exc
    except (KeyError, ValueError, TypeError, IndexError) as exc:
        logger.warning("Coach provider %s returned an invalid response: %s", config.provider, exc)
        raise ProviderUnavailableError(config.provider, "invalid response") from exc
    except RuntimeError as exc:
        logger.warning("Coach provider %s unavailable: %s", config.provider, exc)
        raise ProviderUnavailableError(config.provider, str(exc) or "request failed") from exc
