"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, Check, ChevronDown, ChevronRight,
  CircleHelp, Clock3, Download, ExternalLink, Filter, Gauge, Globe2, HardDrive, LayoutDashboard,
  MapPin, Menu, MoreHorizontal, Network, Plus, RefreshCw, Search, Settings2, ShieldCheck,
  Siren, Wifi, X, Zap, Server, Building2, CheckCircle2, RadioTower, History, Wrench
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { demoDevices, demoHistory, demoIncidents, demoLocations } from "@/lib/demo-data";
import { getSupabase } from "@/lib/supabase";
import type { Device, Location, Status, TargetType } from "@/lib/types";

type Page = "Overview" | "Devices" | "Locations" | "Agents" | "Incidents" | "Reports" | "Maintenance" | "Settings";
const nav: { label: Page; icon: typeof LayoutDashboard }[] = [
  { label: "Overview", icon: LayoutDashboard }, { label: "Devices", icon: Server }, { label: "Locations", icon: MapPin },
  { label: "Agents", icon: RadioTower }, { label: "Incidents", icon: Siren }, { label: "Reports", icon: Activity },
  { label: "Maintenance", icon: Wrench }, { label: "Settings", icon: Settings2 }
];
const statusLabel: Record<Status, string> = { up: "Online", down: "Down", unknown: "Unknown", maintenance: "Maintenance" };
const fmtTime = (value: string | null) => value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Never";
const duration = (value: string) => { const m = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000)); return m < 60 ? `${m}m ago` : `${Math.floor(m/60)}h ${m%60}m ago`; };

function StatusPill({ status }: { status: Status }) {
  const cls = status === "up" ? "status-up" : status === "down" ? "status-down" : status === "maintenance" ? "status-maintenance" : "status-unknown";
  const Icon = status === "up" ? CheckCircle2 : status === "down" ? AlertTriangle : status === "maintenance" ? Wrench : CircleHelp;
  return <span className={`status-pill ${cls}`}><Icon size={12}/>{statusLabel[status]}</span>;
}

function StatCard({ title, value, detail, icon: Icon, tone = "mint" }: { title: string; value: string; detail: string; icon: typeof Activity; tone?: string }) {
  return <div className="stat-card"><div className="stat-top"><span>{title}</span><span className={`stat-icon ${tone}`}><Icon size={17}/></span></div><div className="stat-value">{value}</div><div className="stat-detail">{detail}</div></div>;
}

export default function Home() {
  const [page, setPage] = useState<Page>("Overview");
  const [devices, setDevices] = useState<Device[]>(demoDevices);
  const [locations, setLocations] = useState<Location[]>(demoLocations);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [targetFilter, setTargetFilter] = useState("all");
  const [selectedLocation, setSelectedLocation] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(false);
  const [isDemo, setIsDemo] = useState(true);
  const [newDevice, setNewDevice] = useState({ name: "", host: "", target_type: "public" as TargetType, location_id: "loc-campus", category: "Network", interval_seconds: 60 });
  const [newLocation, setNewLocation] = useState({ name: "", type: "department", parent_id: "loc-campus" });
  const [historyDevice, setHistoryDevice] = useState<Device | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    setIsDemo(false);
    let alive = true;
    (async () => {
      const { data: locs, error: le } = await sb.from("locations").select("id,name,location_type,parent_id,description").order("name");
      if (alive && !le && locs?.length) setLocations(locs.map((l: any) => ({ id: l.id, name: l.name, type: l.location_type, parent_id: l.parent_id, description: l.description })));
      const { data, error } = await sb.from("devices").select("id,name,host,target_type,location_id,enabled,interval_seconds,category,agent_id,current_status,current_latency_ms,current_packet_loss,last_checked_at").order("name");
      if (alive && !error && data) setDevices(data.map((d: any) => ({ id: d.id, name: d.name, host: d.host, target_type: d.target_type, location_id: d.location_id, enabled: d.enabled, interval_seconds: d.interval_seconds, category: d.category || "Other", agent_id: d.agent_id, status: d.enabled ? (d.current_status || "unknown") : "maintenance", latency_ms: d.current_latency_ms, packet_loss: d.current_packet_loss ?? 100, last_checked_at: d.last_checked_at })));
      if (alive && (le || error)) setToast("Connected to Supabase, but inventory could not be loaded. Check schema and RLS.");
    })();
    return () => { alive = false; };
  }, []);

  const counts = useMemo(() => ({
    total: devices.length,
    up: devices.filter(d => d.enabled && d.status === "up").length,
    down: devices.filter(d => d.enabled && d.status === "down").length,
    unknown: devices.filter(d => d.enabled && d.status === "unknown").length,
    maintenance: devices.filter(d => !d.enabled || d.status === "maintenance").length
  }), [devices]);
  const availability = counts.total ? Math.round((counts.up / Math.max(1, counts.up + counts.down)) * 1000) / 10 : 100;
  const filteredDevices = useMemo(() => devices.filter(d => {
    const location = locations.find(l => l.id === d.location_id)?.name || "";
    const q = query.toLowerCase();
    return (!q || [d.name, d.host, d.category, location].some(v => v.toLowerCase().includes(q)))
      && (filter === "all" || d.status === filter)
      && (targetFilter === "all" || d.target_type === targetFilter)
      && (selectedLocation === "all" || d.location_id === selectedLocation);
  }), [devices, locations, query, filter, targetFilter, selectedLocation]);
  const downDevices = devices.filter(d => d.status === "down");
  const locationLabel = (id: string) => locations.find(l => l.id === id)?.name || "Unassigned";

  async function addDevice(e: React.FormEvent) {
    e.preventDefault();
    const host = newDevice.host.trim();
    if (!newDevice.name.trim() || !host) { setToast("Device name and target are required."); return; }
    setLoading(true);
    const sb = getSupabase();
    if (sb) {
      const { data, error } = await sb.from("devices").insert({ name: newDevice.name.trim(), host, target_type: newDevice.target_type, location_id: newDevice.location_id, category: newDevice.category, interval_seconds: newDevice.interval_seconds, enabled: true }).select("id,name,host,target_type,location_id,enabled,interval_seconds,category,agent_id,current_status,current_latency_ms,current_packet_loss,last_checked_at").single();
      if (error) { setToast(error.message); setLoading(false); return; }
      if (data) setDevices(prev => [...prev, { id: data.id, name: data.name, host: data.host, target_type: data.target_type, location_id: data.location_id, enabled: data.enabled, interval_seconds: data.interval_seconds, category: data.category || "Other", agent_id: data.agent_id, status: "unknown", latency_ms: null, packet_loss: 100, last_checked_at: null }]);
    } else {
      setDevices(prev => [...prev, { ...newDevice, id: `demo-${Date.now()}`, name: newDevice.name.trim(), host, enabled: true, status: "unknown", latency_ms: null, packet_loss: 100, last_checked_at: null }]);
    }
    setNewDevice({ name: "", host: "", target_type: "public", location_id: locations[0]?.id || "", category: "Network", interval_seconds: 60 });
    setShowAdd(false); setLoading(false); setToast(sb ? "Device saved. Waiting for its first ping check." : "Demo device added locally; connect Supabase to persist it.");
  }

  async function addLocation(e: React.FormEvent) {
    e.preventDefault();
    if (!newLocation.name.trim()) return;
    const sb = getSupabase();
    if (sb) {
      const { data, error } = await sb.from("locations").insert({ name: newLocation.name.trim(), location_type: newLocation.type, parent_id: newLocation.parent_id || null }).select("id,name,location_type,parent_id").single();
      if (error) { setToast(error.message); return; }
      if (data) setLocations(prev => [...prev, { id: data.id, name: data.name, type: data.location_type, parent_id: data.parent_id }]);
    } else {
      setLocations(prev => [...prev, { id: `loc-${Date.now()}`, name: newLocation.name.trim(), type: newLocation.type, parent_id: newLocation.parent_id || null }]);
    }
    setShowLocation(false); setNewLocation({ name: "", type: "department", parent_id: locations[0]?.id || "" });
    setToast(sb ? "Location created." : "Demo location created locally; connect Supabase to persist it.");
  }

  async function pingNow(device: Device) {
    setToast(`Ping requested for ${device.name}. The worker will update status on its next scheduled check.`);
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.from("ping_jobs").insert({ device_id: device.id, requested_by: "dashboard", status: "queued" });
    if (error) setToast("Could not queue manual check: " + error.message);
  }

  async function toggleDevice(device: Device) {
    const enabled = !device.enabled;
    const sb = getSupabase();
    if (sb) {
      const { error } = await sb.from("devices").update({ enabled }).eq("id", device.id);
      if (error) { setToast(error.message); return; }
    }
    setDevices(prev => prev.map(d => d.id === device.id ? { ...d, enabled, status: enabled ? "unknown" : "maintenance" } : d));
    setToast(enabled ? "Monitoring enabled." : "Monitoring paused.");
  }

  function exportCsv() {
    const rows = [["Name","Host","Type","Location","Status","Latency ms","Packet loss %","Last checked"], ...filteredDevices.map(d => [d.name,d.host,d.target_type,locationLabel(d.location_id),d.status,d.latency_ms ?? "",d.packet_loss, d.last_checked_at || ""])];
    const csv = rows.map(row => row.map(v => `"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url; a.download = "netpulse-devices.csv"; a.click(); URL.revokeObjectURL(url);
  }

  const navPage = (p: Page) => { setPage(p); setSidebarOpen(false); };
  const title = page === "Overview" ? "Network overview" : page === "Agents" ? "Monitoring agents" : page;
  const subtitle = page === "Overview" ? "Your infrastructure, at a glance." : page === "Devices" ? "Manage targets and inspect their reachability." : page === "Locations" ? "Organize devices in any hierarchy." : "Monitor health, trends, and operational activity.";

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <div className="brand"><div className="brand-mark"><Activity size={20}/></div><div><strong>netpulse</strong><span>NETWORK OPERATIONS</span></div></div>
      <div className="workspace"><div className="workspace-icon"><Building2 size={17}/></div><div className="workspace-text"><strong>My Organization</strong><span>Single workspace</span></div><ChevronDown size={15} className="muted"/></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{nav.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${page === label ? "active" : ""}`} onClick={() => navPage(label)}><Icon size={17}/><span>{label}</span>{label === "Incidents" && demoIncidents.filter(i=>i.status==="open").length > 0 && <em>{demoIncidents.filter(i=>i.status==="open").length}</em>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="system-card"><span className="pulse-dot"/><div><strong>Monitoring system</strong><span>{isDemo ? "Demo environment" : "Supabase connected"}</span></div></div><button className="profile"><div className="avatar">NP</div><div><strong>Network Admin</strong><span>Administrator</span></div><MoreHorizontal size={18} className="muted"/></button></div>
    </aside>
    {sidebarOpen && <button className="mobile-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"/>}
    <main className="main">
      <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle menu"><Menu size={20}/></button><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14}/><strong>{page}</strong></div><div className="top-actions"><div className="system-live"><span className="pulse-dot"/><span>{isDemo ? "Demo data" : "Connected"}</span></div><button className="icon-button" onClick={() => setToast("Notifications are available when alert delivery is configured.")} aria-label="Notifications"><Bell size={18}/><i/></button><div className="avatar avatar-small">NP</div></div></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>NETWORK INTELLIGENCE</div><h1>{title}</h1><p>{subtitle}</p></div><div className="heading-actions"><button className="button button-secondary" onClick={exportCsv}><Download size={16}/> Export</button><button className="button button-primary" onClick={() => page === "Locations" ? setShowLocation(true) : setShowAdd(true)}><Plus size={17}/>{page === "Locations" ? "Add location" : "Add device"}</button></div></div>
        {isDemo && <div className="demo-banner"><div><Zap size={16}/><span><strong>Interactive demo</strong> — sample inventory is shown. Connect Supabase to persist real devices and ping results.</span></div><button onClick={() => setToast("Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then apply the SQL migration.")}>Setup guide <ExternalLink size={13}/></button></div>}

        {page === "Overview" && <>
          <div className="stats-grid">
            <StatCard title="Monitored devices" value={String(counts.total).padStart(2,"0")} detail={`${counts.maintenance} paused or in maintenance`} icon={Network}/>
            <StatCard title="Online devices" value={String(counts.up).padStart(2,"0")} detail={counts.total ? `${Math.round(counts.up/counts.total*100)}% of inventory` : "No devices yet"} icon={CheckCircle2}/>
            <StatCard title="Active incidents" value={String(counts.down).padStart(2,"0")} detail={counts.down ? "Requires attention" : "No confirmed outages"} icon={Siren} tone="red"/>
            <StatCard title="Availability" value={`${availability.toFixed(1)}%`} detail="Based on current known states" icon={Gauge} tone="blue"/>
          </div>
          <div className="overview-grid">
            <section className="panel latency-panel"><div className="panel-header"><div><h2>Network response</h2><p>Sample latency over the last 24 hours</p></div><button className="range-select" onClick={() => setToast("V1 history range selector: 24 hours")}>Last 24 hours <ChevronDown size={14}/></button></div><div className="chart-legend"><span><i className="legend-dot mint-dot"/>Latency (ms)</span><span className="muted">ICMP · sample data</span></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={demoHistory} margin={{ top: 8, right: 6, left: -24, bottom: 0 }}><defs><linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#62e0ad" stopOpacity={0.24}/><stop offset="100%" stopColor="#62e0ad" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#243043" strokeDasharray="3 5" vertical={false}/><XAxis dataKey="time" tick={{ fill: "#7f8ba0", fontSize: 11 }} axisLine={false} tickLine={false} interval={3}/><Tooltip contentStyle={{ background: "#111925", border: "1px solid #2b374a", borderRadius: 10, color: "#edf2f8" }} formatter={(v) => [v == null ? "No reply" : `${v} ms`, "Latency"]}/><Area type="monotone" dataKey="latency" stroke="#69e2b1" strokeWidth={2} fill="url(#latencyFill)" connectNulls={false} dot={false}/></AreaChart></ResponsiveContainer></div><div className="chart-footer"><span><span className="pulse-dot"/>Monitoring active</span><span>Updated just now in demo</span></div></section>
            <section className="panel health-panel"><div className="panel-header"><div><h2>Fleet health</h2><p>Current device state</p></div><button className="icon-button small" onClick={() => setToast("Status refreshed from the current data source.")} aria-label="Refresh status"><RefreshCw size={15}/></button></div><div className="health-ring-row"><div className="health-ring" style={{ "--ring": `${counts.total ? counts.up/counts.total*100 : 0}%` } as React.CSSProperties}><div><strong>{counts.total ? Math.round(counts.up/counts.total*100) : 0}<small>%</small></strong><span>online</span></div></div><div className="health-legend"><div><i className="legend-dot mint-dot"/><span>Online</span><strong>{counts.up}</strong></div><div><i className="legend-dot red-dot"/><span>Down</span><strong>{counts.down}</strong></div><div><i className="legend-dot gray-dot"/><span>Unknown</span><strong>{counts.unknown}</strong></div><div><i className="legend-dot blue-dot"/><span>Paused</span><strong>{counts.maintenance}</strong></div></div></div><div className="health-note"><ShieldCheck size={15}/><span>ICMP reachability only — not application health.</span></div></section>
          </div>
          <section className="panel table-panel"><div className="panel-header table-panel-heading"><div><h2>Devices needing attention</h2><p>Unreachable or awaiting a first check</p></div><button className="text-button" onClick={() => navPage("Devices")}>View all devices <ArrowUpRight size={14}/></button></div><DeviceTable devices={devices.filter(d => d.status === "down" || d.status === "unknown").slice(0,5)} locations={locations} onPing={pingNow} onHistory={setHistoryDevice} onToggle={toggleDevice} empty="No devices need attention right now."/></section>
          <div className="bottom-grid"><section className="panel location-panel"><div className="panel-header"><div><h2>Locations</h2><p>Infrastructure by area</p></div><button className="text-button" onClick={() => navPage("Locations")}>Manage <ArrowUpRight size={14}/></button></div><div className="location-list">{locations.filter(l=>!l.parent_id).map(root => <LocationBranch key={root.id} location={root} locations={locations} devices={devices} onSelect={(id) => {setSelectedLocation(id);navPage("Devices");}}/>)}</div></section><section className="panel incidents-panel"><div className="panel-header"><div><h2>Recent incidents</h2><p>Latest status changes</p></div><button className="text-button" onClick={() => navPage("Incidents")}>All incidents <ArrowUpRight size={14}/></button></div><div className="incident-list">{demoIncidents.map(inc => {const device=devices.find(d=>d.id===inc.device_id);return <div className="incident-row" key={inc.id}><span className={`incident-icon ${inc.severity}`}><AlertTriangle size={15}/></span><div className="incident-copy"><strong>{device?.name || inc.title}</strong><span>{inc.title}</span><small>{duration(inc.started_at)}</small></div><span className={`incident-state ${inc.status}`}>{inc.status}</span></div>;})}</div></section></div>
        </>}

        {page === "Devices" && <section className="panel full-table"><div className="filters"><div className="search-box"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search devices, IPs, locations…"/></div><select value={filter} onChange={e=>setFilter(e.target.value)} aria-label="Filter by status"><option value="all">All statuses</option><option value="up">Online</option><option value="down">Down</option><option value="unknown">Unknown</option><option value="maintenance">Maintenance</option></select><select value={targetFilter} onChange={e=>setTargetFilter(e.target.value)} aria-label="Filter by target type"><option value="all">All networks</option><option value="public">Public</option><option value="private">Private</option></select><select value={selectedLocation} onChange={e=>setSelectedLocation(e.target.value)} aria-label="Filter by location"><option value="all">All locations</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select><button className="icon-button filter-button" onClick={()=>{setQuery("");setFilter("all");setTargetFilter("all");setSelectedLocation("all");}} aria-label="Clear filters"><Filter size={16}/></button></div><DeviceTable devices={filteredDevices} locations={locations} onPing={pingNow} onHistory={setHistoryDevice} onToggle={toggleDevice} empty="No devices match your filters."/></section>}

        {page === "Locations" && <div className="locations-page"><section className="panel location-tree-panel"><div className="panel-header"><div><h2>Location hierarchy</h2><p>Build any depth of site and room structure</p></div><button className="button button-secondary" onClick={()=>setShowLocation(true)}><Plus size={15}/> New location</button></div><div className="location-list roomy">{locations.filter(l=>!l.parent_id).map(root=><LocationBranch key={root.id} location={root} locations={locations} devices={devices} onSelect={id=>{setSelectedLocation(id);navPage("Devices");}}/>)}</div></section><section className="panel location-summary"><h2>Location model</h2><p>Location types are labels, not fixed hierarchy levels. Nest a department inside a floor or a rack inside a room as needed.</p><div className="summary-stat"><span>Total locations</span><strong>{locations.length}</strong></div><div className="summary-stat"><span>Devices assigned</span><strong>{devices.filter(d=>locations.some(l=>l.id===d.location_id)).length}</strong></div><div className="summary-stat"><span>Unassigned devices</span><strong>{devices.filter(d=>!locations.some(l=>l.id===d.location_id)).length}</strong></div></section></div>}

        {page === "Agents" && <div className="agents-grid">{[{id:"agent-1",name:"ICU LAN Agent",location:"Building A / Floor 2 / ICU",status:"online",last:"12 seconds ago",version:"0.1.0",devices:2},{id:"agent-2",name:"Server Room Agent",location:"Building A / Server Room",status:"online",last:"18 seconds ago",version:"0.1.0",devices:1},{id:"agent-3",name:"Admin Office Agent",location:"Building B / Floor 1",status:"offline",last:"42 minutes ago",version:"0.1.0",devices:1}].map(a=><div className="panel agent-card" key={a.id}><div className="agent-card-top"><div className="agent-icon"><RadioTower size={20}/></div><StatusPill status={a.status==="online"?"up":"down"}/></div><h3>{a.name}</h3><p>{a.location}</p><div className="agent-meta"><span>Version</span><strong>{a.version}</strong><span>Assigned devices</span><strong>{a.devices}</strong><span>Last heartbeat</span><strong>{a.last}</strong></div><button className="button button-secondary button-wide" onClick={()=>setToast(`Agent setup guide for ${a.name}: see README.md and configure NETPULSE_AGENT_TOKEN.`)}>Setup instructions <ExternalLink size={14}/></button></div>)}</div>}

        {page === "Incidents" && <section className="panel full-table"><div className="panel-header"><div><h2>Incident queue</h2><p>Network reachability events and recovery status</p></div><button className="button button-secondary" onClick={()=>setToast("Incident export uses the filtered incident list in a future iteration.")}><Download size={15}/> Export incidents</button></div><div className="incident-list incident-list-large">{demoIncidents.map(inc=>{const device=devices.find(d=>d.id===inc.device_id);return <div className="incident-row" key={inc.id}><span className={`incident-icon ${inc.severity}`}><AlertTriangle size={15}/></span><div className="incident-copy"><strong>{device?.name || inc.title}</strong><span>{inc.title}</span><small>Started {new Date(inc.started_at).toLocaleString()}</small></div><span className={`incident-state ${inc.status}`}>{inc.status}</span><button className="button button-secondary button-small" onClick={()=>setToast(`Incident ${inc.id} acknowledgement will be persisted when incident actions are connected.`)}>Acknowledge</button></div>;})}</div></section>}

        {page === "Reports" && <div className="report-grid"><section className="panel report-card"><div className="panel-header"><div><h2>Availability report</h2><p>Current-state estimate across enabled devices</p></div><Activity size={18} className="muted"/></div><div className="report-big">{availability.toFixed(1)}<span>%</span></div><p className="report-note">This is a snapshot, not a time-weighted uptime SLA. Use persisted ping history for accurate reporting.</p><button className="button button-secondary" onClick={exportCsv}><Download size={15}/> Export device snapshot</button></section><section className="panel report-card"><div className="panel-header"><div><h2>Reachability mix</h2><p>Public vs private targets</p></div><Globe2 size={18} className="muted"/></div><div className="mix-row"><span><Globe2 size={15}/> Public targets</span><strong>{devices.filter(d=>d.target_type==="public").length}</strong></div><div className="mix-bar"><i style={{width:`${devices.length?devices.filter(d=>d.target_type==="public").length/devices.length*100:0}%`}}/></div><div className="mix-row"><span><Network size={15}/> Private targets</span><strong>{devices.filter(d=>d.target_type==="private").length}</strong></div><div className="mix-bar private"><i style={{width:`${devices.length?devices.filter(d=>d.target_type==="private").length/devices.length*100:0}%`}}/></div></section></div>}

        {page === "Maintenance" && <section className="panel empty-state"><div className="empty-icon"><Wrench size={24}/></div><h2>Maintenance windows</h2><p>Schedule planned maintenance to suppress expected downtime alerts. The schema supports maintenance windows; scheduling UI and alert suppression rules are next to wire up.</p><button className="button button-primary" onClick={()=>setToast("Maintenance scheduling is scaffolded for V1; no alerts are currently suppressed.")}><Plus size={15}/> Plan maintenance</button></section>}

        {page === "Settings" && <div className="settings-grid"><section className="panel settings-card"><h2>Monitoring defaults</h2><p>Default values used for new targets.</p><label>Check interval<select defaultValue="60"><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="300">5 minutes</option></select></label><label>Ping attempts<select defaultValue="3"><option value="1">1 attempt</option><option value="3">3 attempts</option><option value="5">5 attempts</option></select></label><label>Timeout per attempt<select defaultValue="2"><option value="1">1 second</option><option value="2">2 seconds</option><option value="5">5 seconds</option></select></label><button className="button button-primary" onClick={()=>setToast("Settings UI is a preview; set worker environment variables to change live check behavior.")}>Save settings</button></section><section className="panel settings-card"><h2>Workspace and data</h2><p>Single organization for V1, with flexible nested locations.</p><div className="summary-stat"><span>Data source</span><strong>{isDemo?"Demo data":"Supabase"}</strong></div><div className="summary-stat"><span>Device records</span><strong>{devices.length}</strong></div><div className="summary-stat"><span>Location records</span><strong>{locations.length}</strong></div><button className="button button-secondary" onClick={()=>setToast("Review README.md for environment setup, SQL migration, and deployment steps.")}>Configuration guide <ExternalLink size={14}/></button></section></div>}
      </div>
      <footer className="footer"><span><span className="pulse-dot"/> NetPulse V1</span><span>ICMP reachability · Not application health</span><span>System status <strong className="footer-ok">Operational (demo)</strong></span></footer>
    </main>

    {showAdd && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setShowAdd(false);}}><form className="modal" onSubmit={addDevice}><div className="modal-header"><div><h2>Add device</h2><p>Register an authorized host for ICMP monitoring.</p></div><button type="button" className="icon-button" onClick={()=>setShowAdd(false)} aria-label="Close"><X size={18}/></button></div><label>Device name<input required value={newDevice.name} onChange={e=>setNewDevice({...newDevice,name:e.target.value})} placeholder="e.g. ICU access switch"/></label><label>IP address or hostname<input required value={newDevice.host} onChange={e=>setNewDevice({...newDevice,host:e.target.value})} placeholder="10.10.2.15 or example.com"/></label><label>Network type<select value={newDevice.target_type} onChange={e=>setNewDevice({...newDevice,target_type:e.target.value as TargetType})}><option value="public">Public — checked by worker</option><option value="private">Private — checked by local agent</option></select></label><label>Location<select value={newDevice.location_id} onChange={e=>setNewDevice({...newDevice,location_id:e.target.value})}>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label><div className="form-row"><label>Category<input value={newDevice.category} onChange={e=>setNewDevice({...newDevice,category:e.target.value})}/></label><label>Interval<select value={newDevice.interval_seconds} onChange={e=>setNewDevice({...newDevice,interval_seconds:Number(e.target.value)})}><option value={30}>30 sec</option><option value={60}>60 sec</option><option value={300}>5 min</option></select></label></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={()=>setShowAdd(false)}>Cancel</button><button disabled={loading} className="button button-primary" type="submit"><Plus size={15}/>{loading?"Saving…":"Add device"}</button></div></form></div>}
    {showLocation && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setShowLocation(false);}}><form className="modal" onSubmit={addLocation}><div className="modal-header"><div><h2>Create location</h2><p>Location labels can be nested without a fixed hierarchy.</p></div><button type="button" className="icon-button" onClick={()=>setShowLocation(false)} aria-label="Close"><X size={18}/></button></div><label>Location name<input required value={newLocation.name} onChange={e=>setNewLocation({...newLocation,name:e.target.value})} placeholder="e.g. Floor 3 / ICU / Rack 12"/></label><label>Location type<select value={newLocation.type} onChange={e=>setNewLocation({...newLocation,type:e.target.value})}>{["site","building","block","floor","department","section","room","rack","network-zone","other"].map(t=><option key={t} value={t}>{t.replace("-"," ")}</option>)}</select></label><label>Parent location<select value={newLocation.parent_id} onChange={e=>setNewLocation({...newLocation,parent_id:e.target.value})}><option value="">No parent (top-level)</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label><div className="modal-actions"><button type="button" className="button button-secondary" onClick={()=>setShowLocation(false)}>Cancel</button><button className="button button-primary" type="submit"><Plus size={15}/>Create location</button></div></form></div>}
    {historyDevice && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setHistoryDevice(null);}}><div className="modal history-modal"><div className="modal-header"><div><h2>{historyDevice.name}</h2><p>{historyDevice.host} · ICMP reachability history</p></div><button className="icon-button" onClick={()=>setHistoryDevice(null)} aria-label="Close"><X size={18}/></button></div><div className="history-stats"><div><span>Current status</span><StatusPill status={historyDevice.status}/></div><div><span>Latency</span><strong>{historyDevice.latency_ms == null ? "—" : `${historyDevice.latency_ms} ms`}</strong></div><div><span>Packet loss</span><strong>{historyDevice.packet_loss}%</strong></div><div><span>Last checked</span><strong>{fmtTime(historyDevice.last_checked_at)}</strong></div></div><div className="history-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={demoHistory}><CartesianGrid stroke="#243043" strokeDasharray="3 5"/><XAxis dataKey="time" tick={{fill:"#7f8ba0",fontSize:10}} interval={5}/><Tooltip contentStyle={{background:"#111925",border:"1px solid #2b374a",borderRadius:10}}/><Area dataKey="latency" stroke="#69e2b1" fill="#69e2b1" fillOpacity={.1} connectNulls={false}/></AreaChart></ResponsiveContainer></div><p className="muted tiny">Sample chart in demo mode. Persisted ping history is available after worker and database setup.</p></div></div>}
    {toast && <div className="toast"><Check size={16}/><span>{toast}</span><button onClick={()=>setToast("")} aria-label="Dismiss"><X size={14}/></button></div>}
  </div>;
}

function DeviceTable({ devices, locations, onPing, onHistory, onToggle, empty }: { devices: Device[]; locations: Location[]; onPing: (d: Device)=>void; onHistory: (d: Device)=>void; onToggle: (d: Device)=>void; empty: string }) {
  const locationName = (id: string) => locations.find(l=>l.id===id)?.name || "Unassigned";
  return <div className="table-scroll"><table className="device-table"><thead><tr><th>DEVICE</th><th>LOCATION</th><th>NETWORK</th><th>STATUS</th><th>LATENCY</th><th>LAST CHECK</th><th/></tr></thead><tbody>{devices.map(d=><tr key={d.id}><td><div className="device-name"><span className={`device-icon ${d.target_type}`}>{d.target_type==="public"?<Globe2 size={15}/>:<Network size={15}/>}</span><div><strong>{d.name}</strong><span>{d.host}</span></div></div></td><td><span className="table-location"><MapPin size={13}/>{locationName(d.location_id)}</span></td><td><span className={`network-tag ${d.target_type}`}>{d.target_type}</span></td><td><StatusPill status={d.enabled?d.status:"maintenance"}/></td><td><span className={d.latency_ms===null?"muted":d.latency_ms>100?"latency-high":"latency-normal"}>{d.latency_ms===null?"—":`${d.latency_ms.toFixed(1)} ms`}</span></td><td><span className="last-check">{fmtTime(d.last_checked_at)}</span></td><td><div className="row-actions"><button title="Check now" onClick={()=>onPing(d)}><RefreshCw size={14}/></button><button title="View history" onClick={()=>onHistory(d)}><History size={14}/></button><button title={d.enabled?"Pause monitoring":"Enable monitoring"} onClick={()=>onToggle(d)}>{d.enabled?<Wrench size={14}/>:<Check size={14}/>}</button></div></td></tr>)}</tbody></table>{devices.length===0&&<div className="empty-table"><div className="empty-icon"><Search size={20}/></div><strong>{empty}</strong><span>Try changing the filters or add a new device.</span></div>}</div>;
}

function LocationBranch({ location, locations, devices, onSelect, depth = 0 }: { location: Location; locations: Location[]; devices: Device[]; onSelect: (id:string)=>void; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  const children = locations.filter(l=>l.parent_id===location.id);
  const total = devices.filter(d=>d.location_id===location.id || descendants(l=>l.id===location.id, locations, d.location_id)).length;
  return <div className="location-branch"><div className="location-tree-row" style={{paddingLeft:depth*18}}><button className="tree-toggle" onClick={()=>setOpen(!open)} aria-label={open?"Collapse location":"Expand location"}>{children.length ? open?<ChevronDown size={14}/>:<ChevronRight size={14}/>:<span className="tree-spacer"/>}</button><span className="tree-icon">{location.type==="site"?<Building2 size={16}/>:location.type==="building"?<Building2 size={15}/>:location.type==="floor"?<HardDrive size={15}/>:<MapPin size={15}/>}</span><button className="tree-name" onClick={()=>onSelect(location.id)}><strong>{location.name}</strong><span>{location.type}</span></button><span className="tree-count">{total} devices</span><button className="tree-open" onClick={()=>onSelect(location.id)} aria-label={`View devices at ${location.name}`}><ArrowUpRight size={14}/></button></div>{open&&children.map(c=><LocationBranch key={c.id} location={c} locations={locations} devices={devices} onSelect={onSelect} depth={depth+1}/>)}</div>;
}
function descendants(_predicate: (l: Location)=>boolean, locations: Location[], locationId: string) {
  const byParent = new Map<string, string[]>();
  locations.forEach(l=>{if(l.parent_id)byParent.set(l.parent_id,[...(byParent.get(l.parent_id)||[]),l.id]);});
  const seen = new Set<string>(); const stack=[locationId];
  while(stack.length){const id=stack.pop()!;if(seen.has(id))continue;seen.add(id);stack.push(...(byParent.get(id)||[]));}
  return seen;
}
