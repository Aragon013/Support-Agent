Host Agent (Windows service mode)

What this adds:
- Config file support via --config <path>
- Windows service install/start/stop/uninstall scripts
- Service runs as LocalService and starts automatically with Windows

Prerequisites:
- Windows
- Node.js installed and available in PATH
- Build completed (dist/agent.js exists)
- Elevated PowerShell (Run as Administrator) for service install/uninstall

Build:
- npm run build

Run in console mode (manual):
- set CONTROL_PLANE_URL=http://localhost:3000
- set TENANT_ID=tenant-1
- set ENDPOINT_ID=endpoint-local
- npm start

Run in config mode (manual):
- npm run start:config -- "C:\path\to\agent-config.json"

Install Windows service:
- npm run service:install -- -ControlPlaneUrl "http://localhost:3000" -TenantId "tenant-1" -EndpointId "endpoint-local"

Optional install flags:
- -ServiceName "RemoteSupportProHostAgent-endpoint-local"
- -DisplayName "RemoteSupportPro Host Agent (endpoint-local)"
- -MaxConcurrent 3
- -TimeoutMs 30000

Start/stop service:
- npm run service:start -- -ServiceName "RemoteSupportProHostAgent-endpoint-local"
- npm run service:stop -- -ServiceName "RemoteSupportProHostAgent-endpoint-local"

Uninstall service:
- npm run service:uninstall -- -ServiceName "RemoteSupportProHostAgent-endpoint-local" -DeleteConfig

Config file location:
- %ProgramData%\RemoteSupportPro\host-agent\<ServiceName>.json
