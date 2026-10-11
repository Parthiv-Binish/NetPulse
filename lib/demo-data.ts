import type { Device, Incident, Location, PingPoint } from "./types";

export const demoLocations: Location[] = [
  { id: "loc-campus", name: "Main Campus", type: "site", parent_id: null },
  { id: "loc-a", name: "Building A", type: "building", parent_id: "loc-campus" },
  { id: "loc-floor2", name: "Floor 2", type: "floor", parent_id: "loc-a" },
  { id: "loc-icu", name: "ICU", type: "department", parent_id: "loc-floor2" },
  { id: "loc-b", name: "Building B", type: "building", parent_id: "loc-campus" },
  { id: "loc-b1", name: "Floor 1", type: "floor", parent_id: "loc-b" },
  { id: "loc-office", name: "Admin Office", type: "department", parent_id: "loc-b1" },
  { id: "loc-dc", name: "Server Room", type: "room", parent_id: "loc-a" }
];

export const demoDevices: Device[] = [
  { id: "dev-1", name: "Core Router", host: "1.1.1.1", target_type: "public", location_id: "loc-campus", enabled: true, interval_seconds: 60, status: "up", latency_ms: 14.2, packet_loss: 0, last_checked_at: new Date(Date.now()-12000).toISOString(), category: "Network" },
  { id: "dev-2", name: "Primary DNS", host: "8.8.8.8", target_type: "public", location_id: "loc-campus", enabled: true, interval_seconds: 60, status: "up", latency_ms: 18.7, packet_loss: 0, last_checked_at: new Date(Date.now()-18000).toISOString(), category: "Network" },
  { id: "dev-3", name: "ICU Access Switch", host: "10.10.2.15", target_type: "private", location_id: "loc-icu", enabled: true, interval_seconds: 60, status: "down", latency_ms: null, packet_loss: 100, last_checked_at: new Date(Date.now()-35000).toISOString(), category: "Switch", agent_id: "agent-1" },
  { id: "dev-4", name: "Nurse Station 02", host: "10.10.2.42", target_type: "private", location_id: "loc-icu", enabled: true, interval_seconds: 60, status: "up", latency_ms: 2.1, packet_loss: 0, last_checked_at: new Date(Date.now()-21000).toISOString(), category: "Endpoint", agent_id: "agent-1" },
  { id: "dev-5", name: "Application Gateway", host: "192.168.10.10", target_type: "private", location_id: "loc-dc", enabled: true, interval_seconds: 60, status: "up", latency_ms: 0.8, packet_loss: 0, last_checked_at: new Date(Date.now()-16000).toISOString(), category: "Server", agent_id: "agent-2" },
  { id: "dev-6", name: "Backup NAS", host: "192.168.10.22", target_type: "private", location_id: "loc-dc", enabled: true, interval_seconds: 60, status: "unknown", latency_ms: null, packet_loss: 100, last_checked_at: null, category: "Storage", agent_id: "agent-2" },
  { id: "dev-7", name: "Public Portal", host: "example.com", target_type: "public", location_id: "loc-office", enabled: true, interval_seconds: 60, status: "up", latency_ms: 31.4, packet_loss: 0, last_checked_at: new Date(Date.now()-9000).toISOString(), category: "Application" },
  { id: "dev-8", name: "Print Server", host: "192.168.20.12", target_type: "private", location_id: "loc-office", enabled: false, interval_seconds: 120, status: "maintenance", latency_ms: 3.8, packet_loss: 0, last_checked_at: new Date(Date.now()-3600000).toISOString(), category: "Server", agent_id: "agent-3" }
];

export const demoIncidents: Incident[] = [
  { id: "inc-1", device_id: "dev-3", title: "ICU Access Switch unreachable", severity: "critical", status: "open", started_at: new Date(Date.now()-1000*60*14).toISOString() },
  { id: "inc-2", device_id: "dev-6", title: "Backup NAS has no recent result", severity: "warning", status: "open", started_at: new Date(Date.now()-1000*60*6).toISOString() }
];

export const demoHistory: PingPoint[] = Array.from({ length: 24 }, (_, i) => {
  const latency = i === 17 || i === 18 ? null : Math.round(12 + Math.sin(i * .72) * 4 + (i % 5) * 1.2);
  return { time: `${String(i).padStart(2, "0")}:00`, latency, loss: latency === null ? 100 : 0 };
});
