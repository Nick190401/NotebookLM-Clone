$ErrorActionPreference = 'Stop'

$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$clusterPath = [System.IO.Path]::GetFullPath((Join-Path $workspaceRoot '.postgres-test'))
$expectedPrefix = $workspaceRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $clusterPath.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or [System.IO.Path]::GetFileName($clusterPath) -ne '.postgres-test') {
  throw "Unsafe PostgreSQL test path: $clusterPath"
}
if (Test-Path -LiteralPath $clusterPath) {
  throw "The disposable PostgreSQL test directory already exists: $clusterPath"
}

$postgresBin = 'C:\Program Files\PostgreSQL\18\bin'
foreach ($executable in @('initdb.exe', 'pg_ctl.exe', 'psql.exe')) {
  if (-not (Test-Path -LiteralPath (Join-Path $postgresBin $executable))) {
    throw "PostgreSQL 18 executable not found: $executable"
  }
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$serverStarted = $false
$serverStopped = $false

function Invoke-PostgresTool {
  param([string]$Executable, [string[]]$ToolArguments)
  & (Join-Path $postgresBin $Executable) @ToolArguments
  if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
}

try {
  New-Item -ItemType Directory -Path $clusterPath | Out-Null
  Invoke-PostgresTool 'initdb.exe' @('-D', $clusterPath, '-A', 'trust', '-U', 'postgres', '--no-locale', '--encoding=UTF8')
  Invoke-PostgresTool 'pg_ctl.exe' @('-D', $clusterPath, '-l', (Join-Path $clusterPath 'postgres.log'), '-o', "-p $port -h 127.0.0.1", '-w', 'start')
  $serverStarted = $true

  $connection = @('-h', '127.0.0.1', '-p', [string]$port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1')
  Invoke-PostgresTool 'psql.exe' ($connection + @('-f', (Join-Path $PSScriptRoot 'bootstrap.sql')))
  $migrations = @(Get-ChildItem -LiteralPath (Join-Path $workspaceRoot 'supabase\migrations') -Filter '*.sql' | Sort-Object Name)
  if ($migrations.Count -eq 0) { throw 'No Supabase migrations were found.' }
  foreach ($migration in $migrations) {
    Invoke-PostgresTool 'psql.exe' ($connection + @('-f', $migration.FullName))
  }
  Invoke-PostgresTool 'psql.exe' ($connection + @('-f', (Join-Path $PSScriptRoot 'workspace_rls_smoke.sql')))
  Invoke-PostgresTool 'psql.exe' ($connection + @('-f', (Join-Path $PSScriptRoot 'advisors.sql')))
  Write-Host "Database migration, RLS isolation, RPC grants, and schema advisor checks passed on PostgreSQL 18."
} finally {
  if ($serverStarted) {
    & (Join-Path $postgresBin 'pg_ctl.exe') -D $clusterPath -m fast -w stop
    $serverStopped = $LASTEXITCODE -eq 0
  }
  if ((-not $serverStarted -or $serverStopped) -and [System.IO.Directory]::Exists($clusterPath)) {
    [System.IO.Directory]::Delete($clusterPath, $true)
  }
}
