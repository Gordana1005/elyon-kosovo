# Elyon CRM - Grok Memory Seeding Helper
# Run this from the repo root in PowerShell to ensure memory is set up.

Write-Host "Elyon CRM Grok Memory Setup" -ForegroundColor Cyan

$memoryBase = "C:\Users\Mile\.grok\memory"
$projectMem = "$memoryBase\elyoncrm-elyon"

# Ensure directories
New-Item -ItemType Directory -Force -Path $memoryBase | Out-Null
New-Item -ItemType Directory -Force -Path $projectMem | Out-Null

# Copy latest seed if available
$seedFile = ".grok\memory\INITIAL_PROJECT_MEMORY_SEED.md"
if (Test-Path $seedFile) {
    Copy-Item $seedFile "$projectMem\MEMORY.md" -Force
    Write-Host "Seeded MEMORY.md from project seed." -ForegroundColor Green
} else {
    Write-Host "No local seed found. Using existing memory." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Memory is now enabled in your global config." -ForegroundColor Green
Write-Host "Next time you start Grok (with memory on), it will use this workspace memory." -ForegroundColor Green
Write-Host ""
Write-Host "Useful commands inside Grok TUI:" -ForegroundColor Cyan
Write-Host "  /memory          - Browse and edit memory"
Write-Host "  /flush           - Save important session learnings"
Write-Host "  /dream           - Consolidate memory"
Write-Host ""
Write-Host "Tip: After big sessions on warehouse, stock, phones, or currency, run /flush."