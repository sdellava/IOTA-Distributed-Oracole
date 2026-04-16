#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

SYSTEM_STATE_REPORT="${SCRIPT_DIR}/oracle_system_state_devnet/devnet_system_state.txt"
TASKS_REPORT="${SCRIPT_DIR}/oracle_tasks_devnet/oracle_task_devnet.txt"
SCHEDULER_REPORT="${SCRIPT_DIR}/iota_task_scheduler_devnet/devnet_scheduler.txt"

python3 - "$REPO_ROOT" "$SYSTEM_STATE_REPORT" "$TASKS_REPORT" "$SCHEDULER_REPORT" <<'PY'
from pathlib import Path
import re
import sys

repo_root = Path(sys.argv[1])
system_report = Path(sys.argv[2])
tasks_report = Path(sys.argv[3])
scheduler_report = Path(sys.argv[4])


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def read_move_toml_published_at(path: Path) -> str | None:
    if not path.exists():
        return None
    text = read(path)
    match = re.search(r'(?m)^published-at = "(0x[a-fA-F0-9]+)"$', text)
    return match.group(1) if match else None


def package_id_from_report(text: str) -> str | None:
    match = re.search(r'PackageID:\s*(0x[a-fA-F0-9]+)', text)
    return match.group(1) if match else None


def object_id_for_type(text: str, suffix: str) -> str | None:
    pattern = re.compile(
        r'ObjectID:\s*(0x[a-fA-F0-9]+).*?ObjectType:\s*(0x[a-fA-F0-9]+::' + re.escape(suffix) + r')',
        re.S,
    )
    match = pattern.search(text)
    return match.group(1) if match else None


def first_env_value(key: str) -> str | None:
    candidate_files = [
        repo_root / "iota_oracle_client" / ".env",
        repo_root / "iota_oracle_client" / ".env.example_devnet",
        repo_root / "iota_oracle_node" / ".env",
        repo_root / "iota_oracle_node" / ".env.example_devnet",
        repo_root / "iota_oracle_webview" / ".env",
        repo_root / "iota_oracle_webview" / ".env.example",
    ]
    patterns = [rf'(?m)^{re.escape(key)}=(0x[a-fA-F0-9]+)$', rf'(?m)^DEVNET_{re.escape(key)}=(0x[a-fA-F0-9]+)$']
    for path in candidate_files:
        if not path.exists():
            continue
        text = read(path)
        for pattern in patterns:
            match = re.search(pattern, text)
            if match:
                return match.group(1)
    return None


def pick(label: str, *candidates: str | None) -> str:
    for candidate in candidates:
        if candidate:
            return candidate
    raise SystemExit(f"Could not resolve required value: {label}")


system_text = read(system_report)
tasks_text = read(tasks_report)
scheduler_text = read(scheduler_report)

values = {
    "ORACLE_SYSTEM_PACKAGE_ID": pick(
        "ORACLE_SYSTEM_PACKAGE_ID",
        package_id_from_report(system_text),
        read_move_toml_published_at(repo_root / "iota_oracle_move" / "devnet" / "oracle_system_state_devnet" / "Move.toml"),
        first_env_value("ORACLE_SYSTEM_PACKAGE_ID"),
    ),
    "ORACLE_TASKS_PACKAGE_ID": pick(
        "ORACLE_TASKS_PACKAGE_ID",
        package_id_from_report(tasks_text),
        read_move_toml_published_at(repo_root / "iota_oracle_move" / "devnet" / "oracle_tasks_devnet" / "Move.toml"),
        first_env_value("ORACLE_TASKS_PACKAGE_ID"),
    ),
    "ORACLE_SCHEDULER_PACKAGE_ID": pick(
        "ORACLE_SCHEDULER_PACKAGE_ID",
        package_id_from_report(scheduler_text),
        read_move_toml_published_at(repo_root / "iota_oracle_move" / "devnet" / "iota_task_scheduler_devnet" / "Move.toml"),
        first_env_value("ORACLE_SCHEDULER_PACKAGE_ID"),
    ),
    "ORACLE_STATE_ID": pick(
        "ORACLE_STATE_ID",
        object_id_for_type(system_text, "systemState::State"),
        first_env_value("ORACLE_STATE_ID"),
    ),
    "ORACLE_TREASURY_ID": pick(
        "ORACLE_TREASURY_ID",
        object_id_for_type(system_text, "systemState::OracleTreasury"),
        first_env_value("ORACLE_TREASURY_ID"),
    ),
    "CONTROLLER_CAP_ID": pick(
        "CONTROLLER_CAP_ID",
        object_id_for_type(system_text, "systemState::ControllerCap"),
        first_env_value("CONTROLLER_CAP_ID"),
    ),
    "ORACLE_SCHEDULED_TASK_REGISTRY_ID": pick(
        "ORACLE_SCHEDULED_TASK_REGISTRY_ID",
        object_id_for_type(scheduler_text, "oracle_scheduled_tasks::ScheduledTaskRegistry"),
        first_env_value("ORACLE_SCHEDULED_TASK_REGISTRY_ID"),
    ),
    "ORACLE_SCHEDULER_QUEUE_ID": pick(
        "ORACLE_SCHEDULER_QUEUE_ID",
        object_id_for_type(scheduler_text, "oracle_scheduled_tasks::SchedulerQueue"),
        first_env_value("ORACLE_SCHEDULER_QUEUE_ID"),
    ),
}


def upsert_lines(path: Path, pairs: list[tuple[str, str]], append_after: str | None = None) -> None:
    if not path.exists():
        return
    text = read(path)
    lines = text.splitlines()
    changed = False

    for key, value in pairs:
        regex = re.compile(rf'^{re.escape(key)}=.*$')
        for idx, line in enumerate(lines):
            if regex.match(line):
                new_line = f"{key}={value}"
                if lines[idx] != new_line:
                    lines[idx] = new_line
                    changed = True
                break
        else:
            insert_at = len(lines)
            if append_after:
                for idx, line in enumerate(lines):
                    if line.startswith(f"{append_after}="):
                        insert_at = idx + 1
            lines.insert(insert_at, f"{key}={value}")
            changed = True

    if changed:
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"[updated] {path}")
    else:
        print(f"[unchanged] {path}")


client_files = [
    repo_root / "iota_oracle_client" / ".env",
    repo_root / "iota_oracle_client" / ".env.example_devnet",
]
client_pairs = [
    ("ORACLE_TASKS_PACKAGE_ID", values["ORACLE_TASKS_PACKAGE_ID"]),
    ("ORACLE_SYSTEM_PACKAGE_ID", values["ORACLE_SYSTEM_PACKAGE_ID"]),
    ("ORACLE_STATE_ID", values["ORACLE_STATE_ID"]),
    ("ORACLE_TREASURY_ID", values["ORACLE_TREASURY_ID"]),
]

node_files = [
    repo_root / "iota_oracle_node" / ".env",
    repo_root / "iota_oracle_node" / ".env.example_devnet",
]
node_pairs = [
    ("ORACLE_TASKS_PACKAGE_ID", values["ORACLE_TASKS_PACKAGE_ID"]),
    ("ORACLE_SYSTEM_PACKAGE_ID", values["ORACLE_SYSTEM_PACKAGE_ID"]),
    ("ORACLE_STATE_ID", values["ORACLE_STATE_ID"]),
    ("ORACLE_TREASURY_ID", values["ORACLE_TREASURY_ID"]),
    ("CONTROLLER_CAP_ID", values["CONTROLLER_CAP_ID"]),
    ("ORACLE_SCHEDULER_PACKAGE_ID", values["ORACLE_SCHEDULER_PACKAGE_ID"]),
    ("ORACLE_SCHEDULER_QUEUE_ID", values["ORACLE_SCHEDULER_QUEUE_ID"]),
    ("ORACLE_SCHEDULED_TASK_REGISTRY_ID", values["ORACLE_SCHEDULED_TASK_REGISTRY_ID"]),
]

webview_direct_files = [
    repo_root / "iota_oracle_webview" / ".env",
]
webview_direct_pairs = [
    ("ORACLE_TASKS_PACKAGE_ID", values["ORACLE_TASKS_PACKAGE_ID"]),
    ("ORACLE_SYSTEM_PACKAGE_ID", values["ORACLE_SYSTEM_PACKAGE_ID"]),
    ("ORACLE_STATE_ID", values["ORACLE_STATE_ID"]),
    ("ORACLE_TREASURY_ID", values["ORACLE_TREASURY_ID"]),
    ("ORACLE_SCHEDULER_PACKAGE_ID", values["ORACLE_SCHEDULER_PACKAGE_ID"]),
    ("ORACLE_SCHEDULER_QUEUE_ID", values["ORACLE_SCHEDULER_QUEUE_ID"]),
    ("ORACLE_SCHEDULED_TASK_REGISTRY_ID", values["ORACLE_SCHEDULED_TASK_REGISTRY_ID"]),
    ("DEVNET_ORACLE_TASKS_PACKAGE_ID", values["ORACLE_TASKS_PACKAGE_ID"]),
    ("DEVNET_ORACLE_SYSTEM_PACKAGE_ID", values["ORACLE_SYSTEM_PACKAGE_ID"]),
    ("DEVNET_ORACLE_STATE_ID", values["ORACLE_STATE_ID"]),
    ("DEVNET_ORACLE_TREASURY_ID", values["ORACLE_TREASURY_ID"]),
    ("DEVNET_ORACLE_SCHEDULER_PACKAGE_ID", values["ORACLE_SCHEDULER_PACKAGE_ID"]),
    ("DEVNET_ORACLE_SCHEDULER_QUEUE_ID", values["ORACLE_SCHEDULER_QUEUE_ID"]),
    ("DEVNET_ORACLE_SCHEDULED_TASK_REGISTRY_ID", values["ORACLE_SCHEDULED_TASK_REGISTRY_ID"]),
]

webview_example_files = [
    repo_root / "iota_oracle_webview" / ".env.example",
]
webview_example_pairs = [
    ("DEVNET_ORACLE_TASKS_PACKAGE_ID", values["ORACLE_TASKS_PACKAGE_ID"]),
    ("DEVNET_ORACLE_SYSTEM_PACKAGE_ID", values["ORACLE_SYSTEM_PACKAGE_ID"]),
    ("DEVNET_ORACLE_STATE_ID", values["ORACLE_STATE_ID"]),
    ("DEVNET_ORACLE_TREASURY_ID", values["ORACLE_TREASURY_ID"]),
    ("DEVNET_ORACLE_SCHEDULER_PACKAGE_ID", values["ORACLE_SCHEDULER_PACKAGE_ID"]),
    ("DEVNET_ORACLE_SCHEDULER_QUEUE_ID", values["ORACLE_SCHEDULER_QUEUE_ID"]),
    ("DEVNET_ORACLE_SCHEDULED_TASK_REGISTRY_ID", values["ORACLE_SCHEDULED_TASK_REGISTRY_ID"]),
]

for file in client_files:
    upsert_lines(file, client_pairs, append_after="ORACLE_TREASURY_ID")

for file in node_files:
    upsert_lines(file, node_pairs, append_after="CONTROLLER_CAP_ID")

for file in webview_direct_files:
    upsert_lines(file, webview_direct_pairs, append_after="ORACLE_TREASURY_ID")

for file in webview_example_files:
    upsert_lines(file, webview_example_pairs, append_after="DEVNET_ORACLE_TREASURY_ID")

print("")
print("[values]")
for key, value in values.items():
    print(f"{key}={value}")
PY
