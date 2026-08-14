param(
  [string]$ProjectRef = ''
)

$ErrorActionPreference = 'Stop'

$supabaseCli = Get-Command supabase.exe -ErrorAction Stop
if ([string]::IsNullOrWhiteSpace($ProjectRef)) {
  $projectRefPath = Join-Path $PSScriptRoot '..\supabase\.temp\project-ref'
  if (-not (Test-Path -LiteralPath $projectRefPath)) {
    throw 'Link this workspace with supabase.exe link --project-ref <ref> before configuring AI secrets.'
  }
  $ProjectRef = (Get-Content -LiteralPath $projectRefPath -Raw).Trim()
}

if ($ProjectRef -notmatch '^[a-z]{20}$') {
  throw 'The Supabase project ref is invalid.'
}

$secureKey = Read-Host 'Groq API key' -AsSecureString
$keyPointer = [IntPtr]::Zero
$plainKey = $null

try {
  $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
  if (-not $plainKey.StartsWith('gsk_') -or $plainKey.Length -lt 30) {
    throw 'The Groq API key does not have a valid shape.'
  }

  $secretArguments = @(
    'secrets', 'set',
    "GROQ_API_KEY=$plainKey",
    'GROQ_PRIMARY_MODEL=openai/gpt-oss-120b',
    'GROQ_FALLBACK_MODEL=openai/gpt-oss-20b',
    'GROQ_FAST_MODEL=llama-3.1-8b-instant',
    'GROQ_VISION_MODEL=qwen/qwen3.6-27b',
    'GROQ_TRANSCRIPTION_MODEL=whisper-large-v3-turbo',
    'GROQ_SPEECH_MODEL=canopylabs/orpheus-v1-english',
    '--project-ref', $ProjectRef
  )
  & $supabaseCli.Source @secretArguments
  if ($LASTEXITCODE -ne 0) {
    throw 'Supabase rejected the AI secret update.'
  }
  Write-Output "Supabase AI secrets updated for project $ProjectRef."
} finally {
  $plainKey = $null
  $secureKey = $null
  if ($keyPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
  }
}
