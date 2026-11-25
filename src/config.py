"""Central config.yaml loader (config-first convention — see .cursorrules).

Previously duplicated as a private `_load_config()` inside `api.py`. Pulled
out to its own module so `src/services/analysis_service.py` and
`src/workers/job_worker.py` can read config.yaml without importing api.py
(which would reintroduce the circular-import problem the async job queue
was meant to remove).

Reloads config.yaml fresh on every call rather than caching, so an operator
editing config.yaml takes effect without restarting the process.
"""

from __future__ import annotations

import os

import yaml

_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config.yaml"
)


def load_config() -> dict:
    with open(_CONFIG_PATH, "r") as f:
        return yaml.safe_load(f) or {}
