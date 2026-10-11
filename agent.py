"""NetPulse local agent for authorized private LAN targets.

Install on a host inside the monitored network. It checks only devices explicitly
assigned to its agent ID and reports results outbound over HTTPS.
"""
from __future__ import annotations
import ipaddress, os, platform, re, socket, subprocess, time
from datetime import datetime, timezone
from urllib.parse import urlparse
import httpx

API_URL = os.getenv("NETPULSE_API_URL", "").rstrip("/")
AGENT_ID = os.getenv("NETPULSE_AGENT_ID", "")
AGENT_TOKEN = os.getenv("NETPULSE_AGENT_TOKEN", "")
POLL_SECONDS = max(10, int(os.getenv("NETPULSE_POLL_SECONDS", "30")))

def validate_private_target(host: str) -> str:
    host = host.strip().rstrip(".")
    if not host or any(c in host for c in "/\\@?#"):
        raise ValueError("Invalid target.")
    try:
        ip = ipaddress.ip_address(host)
        if not (ip.is_private and not ip.is_loopback and not ip.is_link_local and not ip.is_multicast):
            raise ValueError("Agent accepts private unicast IP addresses only.")
        return str(ip)
    except ValueError as exc:
        if "private unicast" in str(exc):
            raise
    if not re.fullmatch(r"(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*", host):
        raise ValueError("Invalid hostname.")
    addresses = {r[4][0] for r in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)}
    if not addresses or any((lambda ip: not ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified)(ipaddress.ip_address(a)) for a in addresses):
        raise ValueError("Private hostnames must resolve only to private addresses.")
    return host

def do_ping(host: str) -> dict:
    host = validate_private_target(host)
    windows = platform.system().lower() == "windows"
    cmd = ["ping", "-n", "3", "-w", "2000", host] if windows else ["ping", "-n", "-c", "3", "-W", "2", host]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=9, check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        return {"success": False, "latency_ms": None, "packet_loss": 100, "error": type(exc).__name__}
    out = proc.stdout + "\n" + proc.stderr
    avg = re.search(r"(?:rtt|round-trip).*?=\s*[\d.]+/([\d.]+)/[\d.]+", out, re.I)
    if not avg:
        avg = re.search(r"Average =\s*(\d+)ms", out, re.I)
    loss = re.search(r"(\d+(?:\.\d+)?)%\s*packet loss", out, re.I)
    success = proc.returncode == 0 and avg is not None
    return {"success": success, "latency_ms": float(avg.group(1)) if success else None, "packet_loss": int(round(float(loss.group(1)))) if loss else (0 if success else 100), "error": None if success else "No ICMP echo reply"}

def main():
    if not API_URL or not AGENT_ID or not AGENT_TOKEN:
        raise SystemExit("Set NETPULSE_API_URL, NETPULSE_AGENT_ID, and NETPULSE_AGENT_TOKEN.")
    print(f"NetPulse agent {AGENT_ID} starting; interval={POLL_SECONDS}s")
    headers = {"Authorization": f"Bearer {AGENT_TOKEN}", "X-Agent-ID": AGENT_ID}
    with httpx.Client(timeout=15) as client:
        while True:
            started = time.monotonic()
            try:
                # Endpoint is intentionally explicit; server-side agent task leasing must be enabled before production use.
                response = client.get(f"{API_URL}/api/agents/{AGENT_ID}/tasks", headers=headers)
                if response.status_code == 404:
                    print("Agent task endpoint is not configured yet; see deployment docs.")
                else:
                    response.raise_for_status()
                    for task in response.json().get("tasks", []):
                        try:
                            result = do_ping(task["host"])
                        except (ValueError, socket.gaierror) as exc:
                            result = {"success": False, "latency_ms": None, "packet_loss": 100, "error": str(exc)}
                        client.post(f"{API_URL}/api/agent-results", headers=headers, json={"agent_id": AGENT_ID, "device_id": task["device_id"], "job_id": task.get("job_id"), **result, "checked_at": datetime.now(timezone.utc).isoformat()}).raise_for_status()
            except Exception as exc:
                print(f"Agent cycle failed: {type(exc).__name__}: {exc}")
            time.sleep(max(1, POLL_SECONDS - (time.monotonic() - started)))

if __name__ == "__main__":
    main()
