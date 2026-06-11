<#
打包(並安裝)Super Mermaid VS Code extension。

用法:
  .\pack.ps1              # build + 打包 + 安裝到 VS Code
  .\pack.ps1 -Bump        # patch 版號自動 +1,再 build + 打包 + 安裝
  .\pack.ps1 -PackageOnly # 只打包,不安裝
#>
param(
    [switch]$Bump,
    [switch]$PackageOnly
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules'))) {
    Write-Host '[pack] node_modules 不存在,先執行 npm install...' -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install 失敗' }
}

$pkgPath = Join-Path $PSScriptRoot 'package.json'
$pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json

if ($Bump) {
    $parts = $pkg.version.Split('.')
    $parts[2] = [string]([int]$parts[2] + 1)
    $newVersion = $parts -join '.'
    # 只做字串替換,避免 ConvertTo-Json 重排整份 package.json
    # 必須指定 UTF8:PS 5.1 預設用 ANSI 讀無 BOM 的 UTF-8,會把 — 等非 ASCII 字元變成 ??
    $raw = Get-Content $pkgPath -Raw -Encoding UTF8
    $raw = $raw -replace ('"version":\s*"' + [regex]::Escape($pkg.version) + '"'), ('"version": "' + $newVersion + '"')
    [System.IO.File]::WriteAllText($pkgPath, $raw)   # UTF-8 無 BOM
    Write-Host ("[pack] 版號 {0} -> {1}" -f $pkg.version, $newVersion) -ForegroundColor Cyan
    $pkg.version = $newVersion
}

Write-Host '[pack] vsce package(會自動先 npm run build)...' -ForegroundColor Cyan
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository
if ($LASTEXITCODE -ne 0) { throw 'vsce package 失敗' }

$vsix = Join-Path $PSScriptRoot ("{0}-{1}.vsix" -f $pkg.name, $pkg.version)
if (-not (Test-Path $vsix)) { throw "找不到輸出檔:$vsix" }
Write-Host ("[pack] 已產出 {0}" -f (Split-Path $vsix -Leaf)) -ForegroundColor Green

if ($PackageOnly) {
    Write-Host '[pack] 完成(僅打包,未安裝)。' -ForegroundColor Green
}
else {
    Write-Host '[pack] 安裝到 VS Code...' -ForegroundColor Cyan
    code --install-extension $vsix
    if ($LASTEXITCODE -ne 0) { throw 'code --install-extension 失敗' }
    Write-Host '[pack] 完成!請在 VS Code 執行 Developer: Reload Window 讓新版生效。' -ForegroundColor Green
}
