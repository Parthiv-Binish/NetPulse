"""NetPulse public-target ping worker and small health/API service.

This process is intentionally explicit about ICMP scope. A web service on a
free/sleeping plan is not suitable for reliable continuous monitoring.
"""
from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import os
import re
import socket
import time
import hmac
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from icmplib import ping as icmp_ping

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
    job_id: str | None = None
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
    """Probe with icmplib's unprivileged ICMP datagram sockets (no system ping binary)."""
    host = validate_public_target(host)
    try:
        result = icmp_ping(
            host,
            count=attempts,
            interval=0.2,
            timeout=timeout,
            privileged=False,
        )
    except (OSError, TimeoutError, ValueError) as exc:
        return {
            "success": False,
            "latency_ms": None,
            "packet_loss": 100,
            "error": f"ICMP probe failed: {type(exc).__name__}",
        }
    received = int(getattr(result, "packets_received", 0) or 0)
    loss = int(round(float(getattr(result, "packet_loss", 100) or 0)))
    success = bool(getattr(result, "is_alive", False)) and received > 0
    avg = float(getattr(result, "avg_rtt", 0) or 0)
    return {
        "success": success,
        "latency_ms": round(avg, 2) if success else None,
        "packet_loss": max(0, min(100, loss)),
        "error": None if success else "No ICMP echo reply",
    }

async def sb_request(method: str, table: str, *, params: dict[str, str] | None = None, body: Any = None) -> Any:
    if not SUPABASE_URL or not SERVICE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.")
    headers = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}", "Content-Type": "application/json", "Prefer": "return=representation"}
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.request(method, f"{SUPABASE_URL}/rest/v1/{table}", headers=headers, params=params, json=body)
        response.raise_for_status()
        return response.json() if response.content else None

async def authorize(x_worker_token: str | None = Header(default=None)):
    if not WORKER_TOKEN or not x_worker_token or not hmac.compare_digest(x_worker_token, WORKER_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid worker token.")

async def authorize_agent(agent_id: str, authorization: str | None) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Agent token required.")
    token = authorization.removeprefix("Bearer ").strip()
    if len(token) < 24:
        raise HTTPException(status_code=401, detail="Invalid agent token.")
    try:
        rows = await sb_request("GET", "monitoring_agents", params={"select": "id,token_hash", "id": f"eq.{agent_id}", "limit": "1"})
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Agent authentication unavailable.") from exc
    digest = hashlib.sha256(token.encode()).hexdigest()
    if not rows or not __import__("hmac").compare_digest(str(rows[0].get("token_hash", "")), digest):
        raise HTTPException(status_code=401, detail="Invalid agent credentials.")
    return rows[0]

@app.get("/health")
async def health():
    return {"status": "ok", "service": "netpulse-worker", "time": datetime.now(timezone.utc).isoformat(), "database_configured": bool(SUPABASE_URL and SERVICE_KEY), "scheduler_enabled": scheduler_task is not None and not scheduler_task.done(), "last_scheduler_run": last_scheduler_run}

@app.post("/api/ping")
async def ping_preview(request: PingRequest, _=Depends(authorize)):
    if request.target_type != "public":
        raise HTTPException(status_code=400, detail="Private targets must be checked by a local agent.")
    try:
        host = validate_public_target(request.host)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    result = await asyncio.to_thread(ping, host)
    return {**result, "host": host, "checked_at": datetime.now(timezone.utc).isoformat()}

@app.get("/api/agents/{agent_id}/tasks")
async def agent_tasks(agent_id: str, authorization: str | None = Header(default=None)):
    await authorize_agent(agent_id, authorization)
    now = datetime.now(timezone.utc)
    await sb_request("PATCH", "monitoring_agents", params={"id": f"eq.{agent_id}"}, body={"status": "online", "last_seen_at": now.isoformat()})
    rows = await sb_request("GET", "devices", params={"select": "id,host,interval_seconds,last_checked_at", "agent_id": f"eq.{agent_id}", "target_type": "eq.private", "enabled": "eq.true"})
    pending = await sb_request("GET", "ping_jobs", params={"select": "id,device_id", "status": "eq.queued", "order": "created_at.asc", "limit": "100"})
    pending_by_device: dict[str, str] = {row["device_id"]: row["id"] for row in (pending or [])}
    tasks = []
    for device in rows or []:
        last = device.get("last_checked_at")
        due = True
        if last:
            try:
                elapsed = (now - datetime.fromisoformat(last.replace("Z", "+00:00"))).total_seconds()
                due = elapsed >= int(device.get("interval_seconds") or INTERVAL)
            except (ValueError, TypeError):
                pass
        job_id = pending_by_device.get(device["id"])
        if due or job_id:
            task = {"device_id": device["id"], "host": device["host"]}
            if job_id:
                task["job_id"] = job_id
            tasks.append(task)
    return {"tasks": tasks, "server_time": now.isoformat()}

@app.post("/api/agent-results")
async def agent_results(result: AgentResult, authorization: str | None = Header(default=None)):
    await authorize_agent(result.agent_id, authorization)
    checked_at = (result.checked_at or datetime.now(timezone.utc)).isoformat()
    payload = {"device_id": result.device_id, "checked_at": checked_at, "success": result.success, "latency_ms": result.latency_ms, "packet_loss": result.packet_loss, "error": result.error, "source": "agent", "agent_id": result.agent_id}
    await sb_request("POST", "ping_results", body=payload)
    await sb_request("PATCH", "devices", params={"id": f"eq.{result.device_id}", "agent_id": f"eq.{result.agent_id}", "target_type": "eq.private"}, body={"last_checked_at": checked_at, "current_status": "up" if result.success else "down", "current_latency_ms": result.latency_ms, "current_packet_loss": result.packet_loss})
    if result.job_id:
        await sb_request("PATCH", "ping_jobs", params={"id": f"eq.{result.job_id}", "device_id": f"eq.{result.device_id}", "status": "eq.queued"}, body={"status": "complete", "completed_at": checked_at})
    await update_incident_state(result.device_id, result.success, checked_at)
    return {"accepted": True}

async def update_incident_state(device_id: str, success: bool, checked_at: str):
    """Debounce transient packet loss; recover both open and acknowledged incidents."""
    active = await sb_request(
        "GET", "incidents",
        params={"select": "id,status", "device_id": f"eq.{device_id}", "status": "in.(open,acknowledged)", "limit": "1"},
    )
    if success:
        if active:
            await sb_request(
                "PATCH", "incidents",
                params={"device_id": f"eq.{device_id}", "status": "in.(open,acknowledged)"},
                body={"status": "resolved", "resolved_at": checked_at},
            )
        return
    # Require two consecutive failed checks before opening an incident to reduce alert flapping.
    recent = await sb_request(
        "GET", "ping_results",
        params={"select": "success", "device_id": f"eq.{device_id}", "order": "checked_at.desc", "limit": "2"},
    )
    consecutive_failures = len(recent or []) >= 2 and all(row.get("success") is False for row in recent[:2])
    if consecutive_failures and not active:
        await sb_request(
            "POST", "incidents",
            body={"device_id": device_id, "title": "Ping target unreachable", "severity": "critical", "status": "open", "started_at": checked_at},
        )

async def process_public_jobs():
    jobs = await sb_request("GET", "ping_jobs", params={"select": "id,device_id", "status": "eq.queued", "order": "created_at.asc", "limit": "100"})
    for job in jobs or []:
        rows = await sb_request("GET", "devices", params={"select": "id,host,enabled,target_type", "id": f"eq.{job['device_id']}", "limit": "1"})
        if not rows or not rows[0].get("enabled") or rows[0].get("target_type") != "public":
            continue
        device = rows[0]
        await sb_request("PATCH", "ping_jobs", params={"id": f"eq.{job['id']}", "status": "eq.queued"}, body={"status": "running", "claimed_at": datetime.now(timezone.utc).isoformat()})
        try:
            result = await asyncio.to_thread(ping, device["host"])
        except ValueError as exc:
            result = {"success": False, "latency_ms": None, "packet_loss": 100, "error": str(exc)}
        checked = datetime.now(timezone.utc).isoformat()
        await sb_request("POST", "ping_results", body={"device_id": device["id"], "checked_at": checked, **result, "source": "manual"})
        await sb_request("PATCH", "devices", params={"id": f"eq.{device['id']}"}, body={"last_checked_at": checked, "current_status": "up" if result["success"] else "down", "current_latency_ms": result["latency_ms"], "current_packet_loss": result["packet_loss"]})
        await sb_request("PATCH", "ping_jobs", params={"id": f"eq.{job['id']}"}, body={"status": "complete", "completed_at": checked})
        await update_incident_state(device["id"], result["success"], checked)

async def check_due_devices():
    global last_scheduler_run
    while True:
        try:
            await process_public_jobs()
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
                await update_incident_state(device["id"], result["success"], checked)
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
