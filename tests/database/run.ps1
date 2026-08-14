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
  $bootstrap = @'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable
as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
'@
  Invoke-PostgresTool 'psql.exe' ($connection + @('-c', $bootstrap))
  Invoke-PostgresTool 'psql.exe' ($connection + @('-f', (Join-Path $workspaceRoot 'supabase\migrations\20260814002553_create_notebook_workspace.sql')))
  Invoke-PostgresTool 'psql.exe' ($connection + @('-f', (Join-Path $PSScriptRoot 'workspace_rls_smoke.sql')))

  $advisors = @'
do $$
begin
  if exists (
    select 1
    from pg_constraint constraint_row
    join pg_attribute attribute_row
      on attribute_row.attrelid = constraint_row.conrelid
      and attribute_row.attnum = any(constraint_row.conkey)
    where constraint_row.contype = 'f'
      and constraint_row.connamespace = 'public'::regnamespace
      and not exists (
        select 1 from pg_index index_row
        where index_row.indrelid = constraint_row.conrelid
          and attribute_row.attnum = any(index_row.indkey)
      )
  ) then raise exception 'A public foreign key column has no supporting index'; end if;
  if exists (
    select 1 from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity
  ) then raise exception 'A public table does not have RLS enabled'; end if;
  if exists (
    select 1 from pg_proc where pronamespace = 'public'::regnamespace and prosecdef
  ) then raise exception 'A public function unexpectedly uses SECURITY DEFINER'; end if;
end;
$$;
'@
  Invoke-PostgresTool 'psql.exe' ($connection + @('-c', $advisors))
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
