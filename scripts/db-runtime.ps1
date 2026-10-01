param(
  [ValidateSet("start", "status", "stop")]
  [string]$Action = "start"
)

$ErrorActionPreference = "Stop"
$taskRoot = Split-Path -Parent $PSScriptRoot
$containerName = "smiley-dev-postgres"
$volumeName = "smiley-dev-postgres-data"
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
$docker = if ($dockerCommand) { $dockerCommand.Source } else {
  Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"
}
if (-not (Test-Path -LiteralPath $docker)) {
  throw "Docker Desktop is required. Start your installed Docker Desktop, then retry."
}
$composeArguments = @("compose", "--project-directory", $taskRoot, "-f", (Join-Path $taskRoot "compose.yaml"))
& $docker info --format "{{.ServerVersion}}" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker is unavailable. Start your installed Docker Desktop, then retry." }

$existingNames = & $docker ps -a --format "{{.Names}}"
$containerExists = $existingNames -contains $containerName
if ($containerExists) {
  $runtimeLabel = & $docker inspect --format '{{ index .Config.Labels "com.smiley.local-runtime" }}' $containerName
  if ($runtimeLabel -ne "synthetic") { throw "The container name is already in use by an unrelated runtime." }
}

if ($Action -eq "stop") {
  if ($containerExists) {
    & $docker @composeArguments stop postgres
    if ($LASTEXITCODE -ne 0) { throw "Could not stop the local PostgreSQL container." }
  }
  Write-Output "Local PostgreSQL stopped; container, data volume, and credentials retained."
  exit 0
}
if ($Action -eq "status") {
  if (-not $containerExists) { Write-Output "Local PostgreSQL has not been created."; exit 0 }
  & $docker inspect --format 'Status={{.State.Status}} Health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} Image={{.Config.Image}}' $containerName
  & $docker port $containerName 5432
  exit $LASTEXITCODE
}

$runtimeDirectory = Join-Path $taskRoot "tmp\database-runtime"
$bootstrapEnvironment = Join-Path $runtimeDirectory "postgres.env"
$localEnvironment = Join-Path $taskRoot ".env.local"
$testEnvironment = Join-Path $taskRoot ".env.test.local"
$existingVolumes = & $docker volume ls --format "{{.Name}}"
$hasRuntimeData = $containerExists -or ($existingVolumes -contains $volumeName)
$hasAllConfiguration = (Test-Path -LiteralPath $bootstrapEnvironment) -and (Test-Path -LiteralPath $localEnvironment) -and (Test-Path -LiteralPath $testEnvironment)
if (-not $hasAllConfiguration) {
  if ($hasRuntimeData -or (Test-Path -LiteralPath $localEnvironment) -or (Test-Path -LiteralPath $testEnvironment)) {
    throw "Local runtime configuration is incomplete. Preserve existing credentials/data and recover the missing ignored files; this script will not replace them."
  }
  New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
  function New-LocalSecret {
    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return [BitConverter]::ToString($bytes).Replace("-", "").ToLowerInvariant()
  }
  $bootstrapPassword = New-LocalSecret
  $applicationPassword = New-LocalSecret
  $migrationPassword = New-LocalSecret
  $authenticationSecret = New-LocalSecret
  $storageDirectory = (Join-Path $taskRoot "tmp\private-storage").Replace("\", "/")
  New-Item -ItemType Directory -Force -Path $storageDirectory | Out-Null
  $developmentUrl = "postgresql://smiley_app:${applicationPassword}@127.0.0.1:5442/sehospitaldb"
  $testUrl = "postgresql://smiley_app:${applicationPassword}@127.0.0.1:5442/sehospitaldb_test"
  $migrationUrl = "postgresql://smiley_migrator:${migrationPassword}@127.0.0.1:5442/sehospitaldb"
  $testMigrationUrl = "postgresql://smiley_migrator:${migrationPassword}@127.0.0.1:5442/sehospitaldb_test"
  $bootstrapLines = @("POSTGRES_USER=smiley_bootstrap", "POSTGRES_PASSWORD=$bootstrapPassword", "POSTGRES_DB=sehospitaldb", "POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256")
  $localLines = @("DATABASE_URL=$developmentUrl", "TEST_DATABASE_URL=$testUrl", "MIGRATION_DATABASE_URL=$migrationUrl", "TEST_MIGRATION_DATABASE_URL=$testMigrationUrl", "BETTER_AUTH_SECRET=$authenticationSecret", "BETTER_AUTH_URL=http://localhost:3000", ('PRIVATE_STORAGE_DIR="' + $storageDirectory + '"'))
  $testLines = @("DATABASE_URL=$testUrl", "TEST_DATABASE_URL=$testUrl", "MIGRATION_DATABASE_URL=$testMigrationUrl", "TEST_MIGRATION_DATABASE_URL=$testMigrationUrl", "BETTER_AUTH_SECRET=$authenticationSecret", "BETTER_AUTH_URL=http://localhost:3000", ('PRIVATE_STORAGE_DIR="' + $storageDirectory + '-test"'))
  [IO.File]::WriteAllLines($bootstrapEnvironment, $bootstrapLines)
  [IO.File]::WriteAllLines($localEnvironment, $localLines)
  [IO.File]::WriteAllLines($testEnvironment, $testLines)
}

$databaseLine = Get-Content -LiteralPath $localEnvironment | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $databaseLine) { throw ".env.local has no DATABASE_URL." }
$databaseUri = [Uri]$databaseLine.Substring("DATABASE_URL=".Length).Trim('"', "'")
if ($databaseUri.Host -ne "127.0.0.1" -or $databaseUri.Port -ne 5442 -or $databaseUri.AbsolutePath -ne "/sehospitaldb" -or $databaseUri.UserInfo.Split(":")[0] -ne "smiley_app") {
  throw "This script only operates on its own loopback sehospitaldb runtime."
}
$applicationPassword = $databaseUri.UserInfo.Split(":")[1]
if ($applicationPassword -notmatch '^[a-f0-9]{64}$') { throw "Unexpected local credential format; preserve configuration and inspect it privately." }

$migrationLine = Get-Content -LiteralPath $localEnvironment | Where-Object { $_ -match '^MIGRATION_DATABASE_URL=' } | Select-Object -First 1
if (-not $migrationLine) { throw ".env.local has no MIGRATION_DATABASE_URL; recover the ignored migration credentials." }
$migrationUri = [Uri]$migrationLine.Substring("MIGRATION_DATABASE_URL=".Length).Trim('"', "'")
if ($migrationUri.Host -ne "127.0.0.1" -or $migrationUri.Port -ne 5442 -or $migrationUri.AbsolutePath -ne "/sehospitaldb" -or $migrationUri.UserInfo.Split(":")[0] -ne "smiley_migrator") {
  throw "The migration connection must reference this script's local migration role/database."
}
$migrationPassword = $migrationUri.UserInfo.Split(":")[1]
if ($migrationPassword -notmatch '^[a-f0-9]{64}$') { throw "Unexpected migration credential format; inspect it privately." }
& $docker @composeArguments up -d postgres
if ($LASTEXITCODE -ne 0) { throw "Local PostgreSQL container creation failed." }
$isReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  $health = & $docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' $containerName
  if ($health -eq "healthy") { $isReady = $true; break }
  Start-Sleep -Milliseconds 500
}
if (-not $isReady) { throw "Local PostgreSQL did not become healthy. Inspect only this project's container logs." }

# Create only local infrastructure identities/databases; application migrations own all schemas.
$initializationSql = @"
SELECT 'CREATE ROLE smiley_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ''$applicationPassword'''
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smiley_app')
\gexec
SELECT 'CREATE ROLE smiley_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ''$migrationPassword'''
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smiley_migrator')
\gexec
ALTER ROLE smiley_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DATABASE sehospitaldb OWNER TO smiley_migrator;
SELECT 'CREATE DATABASE sehospitaldb_test OWNER smiley_migrator'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'sehospitaldb_test')
\gexec
ALTER DATABASE sehospitaldb_test OWNER TO smiley_migrator;
SELECT datname, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname IN ('sehospitaldb', 'sehospitaldb_test') ORDER BY datname;
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname IN ('smiley_app', 'smiley_migrator');
"@
$initializationSql | & $docker exec -i $containerName psql -X -v ON_ERROR_STOP=1 -U smiley_bootstrap -d postgres
if ($LASTEXITCODE -ne 0) { throw "Local database initialization failed; no database was dropped." }
& $docker exec $containerName psql -X -U smiley_bootstrap -d sehospitaldb -Atc "SELECT version();"
Write-Output "Healthy local PostgreSQL: 127.0.0.1:5442; databases sehospitaldb / sehospitaldb_test; application role smiley_app."
Write-Output "Generated/reused credentials remain in ignored .env.local, .env.test.local, and tmp/database-runtime/postgres.env."
