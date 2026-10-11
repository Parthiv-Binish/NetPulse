export type Status = "up" | "down" | "unknown" | "maintenance";
export type TargetType = "public" | "private";
export type Location = { id: string; name: string; type: string; parent_id: string | null; description?: string };
export type Device = {
  id: string; name: string; host: string; target_type: TargetType; location_id: string;
  enabled: boolean; interval_seconds: number; status: Status; latency_ms: number | null;
  packet_loss: number; last_checked_at: string | null; category: string; agent_id?: string | null;
};
export type Incident = { id: string; device_id: string; title: string; severity: "critical" | "warning"; status: "open" | "acknowledged" | "resolved"; started_at: string; resolved_at?: string | null };
export type PingPoint = { time: string; latency: number | null; loss: number };
