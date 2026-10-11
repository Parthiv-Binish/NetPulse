# NetPulse

NetPulse is a single-organization, ICMP-first network availability monitor for public targets and private LAN devices. The application is designed for environments with flexible location trees such as hospital → building → floor → department → room.

## Stack

- **Web:** Next.js App Router, TypeScript, Tailwind CSS; deploy on Vercel.
- **Data and auth:** Supabase PostgreSQL, Auth, and Row Level Security.
- **Public checks:** Python worker service; deploy on Render or another always-on worker host.
- **Private checks:** Python agent deployed inside the target LAN. It makes outbound HTTPS requests only.
- **Tests:** Python unittest for target validation and ping parsing.

## Repository layout

- `app/`: responsive NetPulse UI.
- `lib/`: shared types and Supabase browser client.
- `supabase/migrations/`: schema, indexes, RLS, and helper functions.
- `worker.py`: public target checker and health endpoint.
- `agent.py`: private-network agent.
- `tests/`: automated unit tests.

## Local setup

1. Install Node.js 20+ and Python 3.11+.
2. Copy `.env.example` to `.env.local` and configure Supabase values.
3. Install dependencies: `npm install`.
4. Run the web app: `npm run dev`.
5. Apply both migrations in order (`001_initial_schema.sql`, then `002_security_and_dynamic_setup.sql`) to a **dedicated NetPulse Supabase project** using the Supabase SQL editor or CLI.
6. For the public worker, install `requirements.txt` and set its required environment variables.
7. For a private LAN, install the agent on a machine that can route to the monitored subnets and configure its agent token.

NetPulse does not seed sample inventory or hardcoded master data. A fresh install starts with zero locations, devices, agents, incidents, ping results, and settings rows. Add organization settings and inventory through your authorized setup flow after provisioning; without Supabase configured, the UI remains in an empty setup state.

## Environment variables

### Web (Vercel)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Public worker (Render)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side secret only)
- `WORKER_TOKEN` (random secret used to authorize worker endpoints if enabled)
- `CHECK_INTERVAL_SECONDS` (default 60)
- `PING_ATTEMPTS` (default 3)
- `PING_TIMEOUT_SECONDS` (default 2)
- `PORT` (provided by Render)

### Private agent
- `NETPULSE_API_URL` (base URL of the worker API)
- `NETPULSE_AGENT_ID`
- `NETPULSE_AGENT_TOKEN`
- `NETPULSE_LOCATION_ID` (optional default location)
- `NETPULSE_POLL_SECONDS` (default 30)

## Security and network notes

- ICMP failure is not proof that an application is down; firewalls and rate limits can block echo replies.
- Only add targets you are authorized to monitor. Target validation rejects loopback, link-local, multicast, unspecified, and metadata-service addresses for public checks.
- Private IP checks should run on the local agent inside the relevant network; do not expose private networks to the internet.
- Never put a Supabase service-role key or agent token in browser code.
- Review the migration and adapt access policies to the organization’s operational requirements before production use.
- Use an always-on worker for reliable scheduling. Free web-service plans may sleep and are not appropriate for continuous monitoring.
- V1 records ICMP reachability, latency, and packet loss. It does not claim application health, SNMP monitoring, or medical-device safety.

## Tests

```bash
python -m unittest discover -s tests -v
```

## Deployment overview

1. Create a dedicated Supabase project and apply both SQL migrations in order. No operational master data is seeded.
2. Import this repository into Vercel; configure the two public Supabase variables.
3. Create a Render Python web service using the repository root, build command `pip install -r requirements.txt`, and start command `python worker.py`. Configure server-side secrets. For high reliability, move the scheduler to a Render Background Worker or other always-on process.
4. Install `agent.py` inside each private network that needs monitoring. Allow outbound HTTPS to the configured API and ICMP from the agent to authorized targets.
5. Test a known reachable target, a blocked-ICMP target, agent disconnect, and recovery before enabling notifications.

The schema is provisioned in the NetPulse Supabase project. Production rollout still requires configuring server-side secrets, adding the first trusted Auth user to `organization_members`, disabling public sign-ups, connecting the Vercel frontend, and testing from the actual target networks.


## Private agent enrollment

1. Create a trusted Supabase Auth user and add the user UUID to `organization_members` with role `admin` using the SQL editor. Example: `insert into public.organization_members(user_id, role) values ('YOUR_AUTH_USER_UUID', 'admin');`. Replace the placeholder with the real Auth UUID.
2. Disable public sign-ups in Supabase Auth for this single-organization deployment.
3. Generate a random agent token, for example with `openssl rand -hex 32`. Store only its SHA-256 hash in `monitoring_agents.token_hash`: `insert into public.monitoring_agents(name, token_hash) values ('LAN Agent', encode(digest('PASTE_RANDOM_TOKEN_HERE', 'sha256'), 'hex')) returning id;`.
4. Configure `NETPULSE_AGENT_ID` with the returned UUID and `NETPULSE_AGENT_TOKEN` with the original random token. Assign each private device to that agent using `devices.agent_id`.
5. Install the agent on a machine inside the relevant network and allow outbound HTTPS to the worker URL plus ICMP to the approved target devices.
