# J.A.R.V.I.S. installer for Windows (PowerShell 5+).
#   irm https://raw.githubusercontent.com/antoniodifranco79-lab/jarvis/HEAD/scripts/install.ps1 | iex
$ErrorActionPreference = "Stop"
$Repo   = "https://github.com/antoniodifranco79-lab/jarvis.git"
$Branch = $env:JARVIS_BRANCH
if (-not $Branch) {
  $head = git ls-remote --symref $Repo HEAD 2>$null | Select-String '^ref: refs/heads/(\S+)'
  $Branch = if ($head) { $head.Matches[0].Groups[1].Value } else { "main" }
}
$Dir    = if ($env:JARVIS_HOME)   { $env:JARVIS_HOME }   else { Join-Path $HOME "jarvis" }
$Extras = if ($env:JARVIS_EXTRAS) { $env:JARVIS_EXTRAS } else { "server,voice,vision,local,app" }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git is required: https://git-scm.com/download/win" }
$py = Get-Command py -ErrorAction SilentlyContinue
if ($py) { $PyCmd = @("py", "-3") } else { $PyCmd = @("python") }
& $PyCmd[0] $PyCmd[1..($PyCmd.Length)] -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)"
if ($LASTEXITCODE -ne 0) { throw "Python 3.10+ is required: https://www.python.org/downloads/" }

if (Test-Path (Join-Path $Dir ".git")) {
  Write-Host "[jarvis] updating $Dir"
  git -C $Dir fetch -q origin $Branch; git -C $Dir checkout -q $Branch; git -C $Dir pull -q --ff-only origin $Branch
} else {
  Write-Host "[jarvis] cloning into $Dir"
  git clone -q --branch $Branch $Repo $Dir
}
Set-Location $Dir
if (-not (Test-Path ".venv")) { & $PyCmd[0] $PyCmd[1..($PyCmd.Length)] -m venv .venv }
& ".\.venv\Scripts\python.exe" -m pip install -q --upgrade pip wheel
Write-Host "[jarvis] installing jarvis-ai[$Extras]"
try { & ".\.venv\Scripts\pip.exe" install -q -e ".[$Extras]" }
catch { Write-Warning "full install failed; installing core + HUD only"; & ".\.venv\Scripts\pip.exe" install -q -e ".[server]" }
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  $key = Read-Host "Anthropic API key (sk-ant-..., leave empty to add later)"
  if ($key) { (Get-Content .env) -replace '^ANTHROPIC_API_KEY=.*', "ANTHROPIC_API_KEY=$key" | Set-Content .env }
  else {
    Write-Host "[jarvis] no API key: Jarvis will use a free local model through Ollama."
    if (Get-Command ollama -ErrorAction SilentlyContinue) { ollama pull qwen3:8b }
    else { Write-Warning "Install Ollama from https://ollama.com/download then run: ollama pull qwen3:8b" }
  }
}
try { & ".\.venv\Scripts\jarvis.exe" app --install-shortcut | Out-Null; Write-Host "[jarvis] shortcut added to the Desktop and Start menu" } catch { Write-Warning "could not add a shortcut (run 'jarvis app --install-shortcut' later)" }
Write-Host "[jarvis] installed. Next:"
Write-Host "    double-click JARVIS on the Desktop, or: .\.venv\Scripts\jarvis.exe app"
Write-Host "    cd $Dir; .\.venv\Scripts\jarvis.exe doctor"
Write-Host "    .\.venv\Scripts\jarvis.exe serve     # HUD at http://127.0.0.1:8765"
Write-Host "    .\.venv\Scripts\jarvis.exe voice     # hands-free"
