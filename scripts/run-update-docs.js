#!/usr/bin/env node
const { spawnSync } = require('child_process')

const base = process.argv[2] || 'HEAD~1'

function run(cmd, args) {
	const res = spawnSync(cmd, args, { stdio: 'inherit', shell: false })
	if (res.error) {
		console.error(res.error.message)
		process.exit(1)
	}
	process.exit(res.status ?? 0)
}

if (process.platform === 'win32') {
	// Try Git Bash first if available
	const detect = spawnSync('where', ['bash'], { stdio: 'pipe', shell: false })
	if (detect.status === 0) {
		return run('bash', ['scripts/update-docs.sh', base])
	}
	// Fallback to PowerShell script
	return run('powershell', ['-ExecutionPolicy', 'Bypass', '-File', 'scripts/update-docs.ps1', base])
} else {
	return run('bash', ['scripts/update-docs.sh', base])
}
