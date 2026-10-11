"""NetPulse public-target ping worker and small health/API service.

This process is intentionally explicit about ICMP scope. A web service on a
free/sleeping plan is not suitable for reliable continuous monitoring.
"""
from __future__ import annotations

import asyncio
import ipaddress
import os
import platform
import re
import socket
import subprocess
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="NetPulse Worker", version="0.1.0")
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
WORKER_TOKEN = os.getenv("WORKER_TOKEN", "")
INTERVAL = max(15, int(os.getenv("CHECK_INTERVAL_SECONDS", "60")))
ATTEMPTS = max(1, min(5, int(os.getenv("PING_ATTEMPTS", "3"))))
TIMEOUT = max(1, min(5, int(os.getenv("PING_TIMEOUT_SECONDS", "2"))))
PORT = int(os.getenv("PORT", "10000"))
scheduler_task: asyncio.Task | None = None
last_scheduler_run: str | None = None

class PingRequest(BaseModel):
    host: str = Field(min_length=1, max_length=253)
    target_type: str = "public"

class AgentResult(BaseModel):
    agent_id: str
    device_id: str
    success: bool
    latency_ms: float | None = None
    packet_loss: int = Field(ge=0, le=100)
    error: str | None = None
    checked_at: datetime | None = None

def validate_public_target(host: str) -> str:
    """Reject dangerous/non-public literals; DNS results are checked as well."""
    host = host.strip().rstrip(".")
    if not host or any(c in host for c in "/\\@?#") or host.lower() in {"localhost", "metadata.google.internal"}:
        raise ValueError("Enter a valid public IP address or hostname.")
    try:
        ip = ipaddress.ip_address(host)
        if not ip.is_global:
            raise ValueError("Public checks only accept globally routable IP addresses.")
        return str(ip)
    except ValueError as exc:
        if "globally routable" in str(exc):
            raise
    if not re.fullmatch(r"(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*", host):
        raise ValueError("Enter a valid hostname.")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)}
    except socket.gaierror as exc:
        raise ValueError("Hostname could not be resolved.") from exc
    for address in addresses:
        if not ipaddress.ip_address(address).is_global:
            raise ValueError("Public hostname resolves to a non-public address.")
    return host

def ping(host: str, attempts: int = ATTEMPTS, timeout: int = TIMEOUT) -> dict[str, Any]:
    """Run the platform ping binary with bounded arguments and parse average RTT."""
    host = validate_public_target(host)
    is_windows = platform.system().lower() == "windows"
    if is_windows:
        command = ["ping", "-n", str(attempts), "-w", str(timeout * 1000), host]
    else:
        command = ["ping", "-n", "-c", str(attempts), "-W", str(timeout), host]
    start = time.monotonic()
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=attempts * timeout + 3, check=False)
        output = result.stdout + "\n" + result.stderr
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        return {"success": False, "latency_ms": None, "packet_loss": 100, "error": "ping timed out" if isinstance(exc, subprocess.TimeoutExpired) else "ping binary is not installed"}
    match = re.search(r"(?:rtt|round-trip).*?=\s*([\d.]+)/([\d.]+)/([\d.]+)", output, re.I)
    if not match:
        match = re.search(r"Average =\s*(\d+)ms", output, re.I)
        latency = float(match.group(1)) if match else None
    else:
        latency = float(match.group(2))
    loss_match = re.search(r"(\d+(?:\.\d+)?)%\s*packet loss", output, re.I)
    loss = int(round(float(loss_match.group(1)))) if loss_match else (0 if result.returncode == 0 else 100)
    success = result.returncode == 0 and latency is not None
    return {"success": success, "latency_ms": round(latency, 2) if success else None, "packet_loss": loss, "error": None if success else "No ICMP echo reply"}
    
async def sb_request(method: str, table: str, *, params: dict[str, str] | None = None, body: Any = None) -> Any:
    if not SUPABASE_URL or not SERVICE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
    headers = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}", "Content-Type": "application/json", "Prefer": "return=representation"}
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.request(method, f"{SUPABASE_URL}/rest/v1/{table}", headers=headers, params=params, json=body)
        response.raise_for_status()
        return response.json() if response.content else None

async def authorize(x_worker_token: str | None = Header(default=None)):
    if not WORKER_TOKEN or not x_worker_token or x_worker_token != WORKER_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid worker token.")

@app.get("/health")
async def health():
    return {"status": "ok", "service": "netpulse-worker", "time": datetime.now(timezone.utc).isoformat(), "last_scheduler_run": last_scheduler_run}

@app.post("/api/ping")
async def ping_preview(request: PingRequest, _=Depends(authorize)):
    if request.target_type != "public":
        raise HTTPException(status_code=400, detail="Private targets must be checked by a local agent.")
    try:
        host = validate_public_target(request.host)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**ping(host), "host": host, "checked_at": datetime.now(timezone.utc).isoformat()}

@app.post("/api/agent-results")
async def agent_results(result: AgentResult, _=Depends(authorize)):
    checked_at = (result.checked_at or datetime.now(timezone.utc)).isoformat()
    await sb_request("POST", "ping_results", body={"device_id": result.device_id, "checked_at": checked_at, "success": result.success, "latency_ms": result.latency_ms, "packet_loss": result.packet_loss, "error": result.error, "source": "agent", "agent_id": result.agent_id})
    return {"accepted": True}

async def check_due_devices():
    global last_scheduler_run
    while True:
        try:
            rows = await sb_request("GET", "devices", params={"select": "id,host,enabled,target_type,interval_seconds,last_checked_at", "enabled": "eq.true", "target_type": "eq.public"})
            now = datetime.now(timezone.utc)
            for device in rows or []:
                last = device.get("last_checked_at")
                if last:
                    try:
                        elapsed = (now - datetime.fromisoformat(last.replace("Z", "+00:00"))).total_seconds()
                        if elapsed < int(device.get("interval_seconds") or INTERVAL):
                            continue
                    except (ValueError, TypeError):
                        pass
                try:
                    result = await asyncio.to_thread(ping, device["host"])
                except ValueError as exc:
                    result = {"success": False, "latency_ms": None, "packet_loss": 100, "error": str(exc)}
                checked = datetime.now(timezone.utc).isoformat()
                await sb_request("POST", "ping_results", body={"device_id": device["id"], "checked_at": checked, **result, "source": "render"})
                await sb_request("PATCH", "devices", params={"id": f"eq.{device['id']}"}, body={"last_checked_at": checked, "current_status": "up" if result["success"] else "down", "current_latency_ms": result["latency_ms"], "current_packet_loss": result["packet_loss"]})
            last_scheduler_run = now.isoformat()
        except Exception as exc:  # keep the scheduler alive; do not leak secrets
            print(f"NetPulse scheduler error: {type(exc).__name__}: {exc}")
        await asyncio.sleep(INTERVAL)

@app.on_event("startup")
async def startup():
    global scheduler_task
    if SUPABASE_URL and SERVICE_KEY:
        scheduler_task = asyncio.create_task(check_due_devices())

@app.on_event("shutdown")
async def shutdown():
    if scheduler_task:
        scheduler_task.cancel()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("worker:app", host="0.0.0.0", port=PORT)
