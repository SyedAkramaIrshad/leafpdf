import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('community contribution files', () => {
  it('collects privacy-safe, reproducible bug and feature evidence', () => {
    const bug = read('.github/ISSUE_TEMPLATE/bug_report.yml')
    const feature = read('.github/ISSUE_TEMPLATE/feature_request.yml')

    for (const form of [bug, feature]) {
      expect(form).toMatch(/^name:/m)
      expect(form).toMatch(/^description:/m)
      expect(form).toMatch(/^body:/m)
    }
    for (const text of [
      'Affected workflow',
      'Reproduction steps',
      'Browser and operating system',
      'Do not attach a real personal PDF, signature, ID, offer letter, or confidential document',
    ]) expect(bug).toContain(text)
    for (const text of ['Problem to solve', 'Proposed workflow', 'Local-first privacy impact']) {
      expect(feature).toContain(text)
    }
  })

  it('routes contributors through a privacy and evidence review', () => {
    const chooser = read('.github/ISSUE_TEMPLATE/config.yml')
    const pullRequest = read('.github/pull_request_template.md')

    expect(chooser).toContain('blank_issues_enabled: false')
    expect(chooser).toContain('https://github.com/SyedAkramaIrshad/leafpdf/security/advisories/new')
    for (const heading of [
      '## User-visible behavior',
      '## Privacy boundary',
      '## PDF compatibility',
      '## Verification',
      '## Visual evidence',
    ]) expect(pullRequest).toContain(heading)
    expect(pullRequest).toContain('No real personal PDF, signature, ID, offer letter, confidential document, credential, or secret is included')
  })

  it('defines the complete release evidence gate', () => {
    const release = read('RELEASING.md')

    expect(release).toMatch(/not published to npm/i)
    for (const command of [
      'npm ci',
      'npm run lint',
      'npm test -- --run',
      'npm run build',
      'npm run verify:self-test',
      'python3 scripts/create-fixture.py',
      'python3 scripts/create-edge-fixtures.py',
      'npm run test:e2e',
      'LEAFPDF_E2E_SERVER=preview npm run test:e2e',
      'LEAFPDF_SCREENSHOTS=1 npm run test:e2e -- screenshots',
      'npm run test:e2e:large',
    ]) expect(release).toContain(command)
  })

  it('keeps the PR visual preview current and locally executable', () => {
    const capture = read('scripts/capture-preview.mjs')
    const workflow = read('.github/workflows/preview-screenshots.yml')
    const ignore = read('.gitignore')

    for (const name of ['More tools', 'Review comments', 'Privacy check', 'Help & shortcuts']) {
      expect(capture).toContain(name)
    }
    for (const file of [
      '01-landing-desktop.png',
      '02-workbench-desktop.png',
      '03-review-panel.png',
      '04-help-panel.png',
      '05-privacy-panel.png',
    ]) expect(capture).toContain(file)
    expect(workflow).toContain('node scripts/capture-preview.mjs')
    expect(workflow).not.toContain('name: /^Review/')
    expect(workflow).not.toContain("name: 'Privacy'")
    expect(ignore).toMatch(/^preview\/$/m)
  })

  it('documents provider-neutral static hosting and verifies a nested offline build in CI', () => {
    const hosting = read('HOSTING.md')
    const readme = read('README.md')
    const releasing = read('RELEASING.md')
    const ci = read('.github/workflows/ci.yml')

    for (const text of [
      'No hosting provider is selected or configured by this repository.',
      'npm run build',
      'LEAFPDF_BASE_PATH=/leafpdf/ npm run build',
      'dist/',
      'HTTPS',
      'SPA fallback',
      'application/javascript',
      'application/manifest+json',
      'index.html',
      'sw.js',
      'immutable',
      'Content-Security-Policy',
      'LEAFPDF_HOSTING_TEST=1',
    ]) expect(hosting).toContain(text)

    expect(readme).toContain('[HOSTING.md](HOSTING.md)')
    expect(releasing).toContain('[HOSTING.md](HOSTING.md)')
    expect(ci).toContain('LEAFPDF_BASE_PATH: /leafpdf/')
    expect(ci).toContain("LEAFPDF_HOSTING_TEST: '1'")
    expect(ci).toContain('npx playwright test e2e/hosting.spec.ts')
  })
})
