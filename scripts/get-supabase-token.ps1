Param(
  [Parameter(Mandatory = $false)] [string] $Email,
  [Parameter(Mandatory = $false)] [string] $Password,
  [Parameter(Mandatory = $false)] [string] $SupabaseUrl,
  [Parameter(Mandatory = $false)] [string] $AnonKey,
  [Parameter(Mandatory = $false)] [string] $HttpFilePath = "test/api-manual-tests.http",
  [Parameter(Mandatory = $false)] [string] $EnvFilePath
)

function Import-EnvFile {
  param([string] $Path)
  if (-not (Test-Path $Path)) { return }
  try {
    $lines = Get-Content -Path $Path
    foreach ($line in $lines) {
      $trim = $line.Trim()
      if ($trim.Length -eq 0 -or $trim.StartsWith('#')) { continue }
      if ($trim -notmatch '=') { continue }
      $idx = $trim.IndexOf('=')
      $key = $trim.Substring(0, $idx).Trim()
      $val = $trim.Substring($idx + 1).Trim()
      # Remove surrounding quotes if present
      if ($val.StartsWith('"') -and $val.EndsWith('"')) { $val = $val.Trim('"'.ToCharArray()) }
      if ($val.StartsWith("'") -and $val.EndsWith("'")) { $val = $val.Trim("'".ToCharArray()) }
      [System.Environment]::SetEnvironmentVariable($key, $val, 'Process') | Out-Null
    }
    Write-Host "Loaded environment variables from $Path" -ForegroundColor DarkGray
  } catch {
    Write-Warning "Failed to parse $($Path): $($_.Exception.Message)"
  }
}

# Try importing .env if needed
$defaultEnvPath = Join-Path $PSScriptRoot '..\.env'
if (-not $EnvFilePath) { $EnvFilePath = $defaultEnvPath }

# Initially read provided or existing env
if (-not $Email)      { $Email       = $env:TEST_USER_EMAIL }
if (-not $Password)   { $Password    = $env:TEST_USER_PASSWORD }
if (-not $SupabaseUrl){ $SupabaseUrl = $env:SUPABASE_URL }
if (-not $AnonKey)    { $AnonKey     = $env:NEXT_PUBLIC_SUPABASE_ANON_KEY }
if (-not $AnonKey)    { $AnonKey     = $env:SUPABASE_ANON_KEY }

# If any required var is missing, import from .env then re-read
if (-not $Email -or -not $Password -or -not $SupabaseUrl -or -not $AnonKey) {
  Import-EnvFile -Path $EnvFilePath
  if (-not $Email)      { $Email       = $env:TEST_USER_EMAIL }
  if (-not $Password)   { $Password    = $env:TEST_USER_PASSWORD }
  if (-not $SupabaseUrl){ $SupabaseUrl = $env:SUPABASE_URL }
  if (-not $AnonKey)    { $AnonKey     = $env:NEXT_PUBLIC_SUPABASE_ANON_KEY }
  if (-not $AnonKey)    { $AnonKey     = $env:SUPABASE_ANON_KEY }
}

if (-not $Email -or -not $Password -or -not $SupabaseUrl -or -not $AnonKey) {
  Write-Error "Missing required inputs. Provide -Email, -Password, -SupabaseUrl, -AnonKey or ensure .env defines TEST_USER_EMAIL, TEST_USER_PASSWORD, SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY)."
  Write-Host "Checked: Email=$([string]::IsNullOrEmpty($Email) -eq $false), Password=$([string]::IsNullOrEmpty($Password) -eq $false), SupabaseUrl=$([string]::IsNullOrEmpty($SupabaseUrl) -eq $false), AnonKey=$([string]::IsNullOrEmpty($AnonKey) -eq $false)" -ForegroundColor Yellow
  Write-Host "Tip: npm run token:supabase -- -Email you@example.com -Password 'your-pass' -SupabaseUrl https://<ref>.supabase.co -AnonKey '<anon-key>'" -ForegroundColor Yellow
  exit 1
}

$uri = "$SupabaseUrl/auth/v1/token?grant_type=password"
$headers = @{ 
  "apikey" = $AnonKey
  "Content-Type" = "application/json"
}
$body = @{ email = $Email; password = $Password } | ConvertTo-Json

try {
  $resp = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body
} catch {
  Write-Error "Failed to fetch token from Supabase: $($_.Exception.Message)"
  exit 1
}

if (-not $resp.access_token) {
  Write-Error "No access_token returned. Check credentials and Supabase URL/key."
  exit 1
}

$token = $resp.access_token
Write-Host "Supabase access_token fetched successfully." -ForegroundColor Green
Write-Output $token

# Try to update the manual test file's @supabaseToken line if the file exists
if (Test-Path $HttpFilePath) {
  try {
    $content = Get-Content -Raw -Path $HttpFilePath
    $newContent = [System.Text.RegularExpressions.Regex]::Replace(
      $content,
      "(?m)^@supabaseToken\s*=\s*.*$",
      "@supabaseToken = $token"
    )
    Set-Content -Path $HttpFilePath -Value $newContent -Encoding UTF8
    Write-Host "Updated $HttpFilePath with new @supabaseToken." -ForegroundColor Cyan
  } catch {
    Write-Warning "Could not update $HttpFilePath automatically: $($_.Exception.Message)"
  }
} else {
  Write-Warning "HTTP file not found at $HttpFilePath. Skipping auto-update."
}