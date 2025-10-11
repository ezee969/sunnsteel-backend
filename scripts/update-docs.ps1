param(
	[string]$Base = "HEAD~1"
)

$ErrorActionPreference = 'Stop'

Write-Host "🔍 Detecting project structure changes..."

Write-Host "📡 Checking for changed endpoints since $Base..."
$changedControllers = & git diff --name-only $Base -- 'src/**/*.controller.ts' 2>$null

Write-Host "📦 Checking for changed modules since $Base..."
$changedModules = & git diff --name-only $Base -- 'src/**/*.module.ts' 2>$null

Write-Host "🗄️ Checking for Prisma schema changes since $Base..."
$schemaChanges = & git diff --name-only $Base -- prisma/schema.prisma 2>$null

Write-Host "📝 Checking for changed DTOs since $Base..."
$changedDtos = & git diff --name-only $Base -- 'src/**/*.dto.ts' 2>$null

Write-Host "🛡️ Checking for changed guards since $Base..."
$changedGuards = & git diff --name-only $Base -- 'src/**/*guard*.ts' 2>$null

Write-Host "📦 Checking for package.json changes since $Base..."
$packageChanges = & git diff --name-only $Base -- package.json 2>$null

Write-Host ""
Write-Host "📋 SUMMARY OF DETECTED CHANGES (vs $Base):"
Write-Host "================================"

if ($changedControllers) {
	Write-Host "🆕 Controllers changed:"
	$changedControllers | ForEach-Object { Write-Host $_ }
	Write-Host ""
	Write-Host "🔖 Endpoint decorators in changed controllers:"
	$changedControllers | ForEach-Object {
		Write-Host "• $_"
		if (Test-Path $_) {
			Select-String -Path $_ -Pattern '@(Get|Post|Put|Patch|Delete)' | ForEach-Object {
				Write-Host ("$($_.LineNumber): $($_.Line)")
			}
		}
		Write-Host ""
	}
}

if ($changedModules) {
	Write-Host "🆕 Modules changed:"
	$changedModules | ForEach-Object { Write-Host $_ }
	Write-Host ""
}

if ($schemaChanges) {
	Write-Host "🔄 Prisma schema changes detected!"
	Write-Host ""
}

if ($changedDtos) {
	Write-Host "🆕 DTOs changed:"
	$changedDtos | ForEach-Object { Write-Host $_ }
	Write-Host ""
}

if ($changedGuards) {
	Write-Host "🆕 Guards changed:"
	$changedGuards | ForEach-Object { Write-Host $_ }
	Write-Host ""
}

if ($packageChanges) {
	Write-Host "📦 Package.json changes detected!"
	Write-Host ""
}

Write-Host "⚠️  REMINDER: Update documentation files:"
Write-Host "   - .cursor/rules/sunnsteel-backend.mdc"
Write-Host "   - README.md"
Write-Host ""
Write-Host "💡 Run this script after making changes to detect what needs documentation updates."
