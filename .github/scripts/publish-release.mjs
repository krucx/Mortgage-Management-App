import { readFileSync } from 'node:fs'

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const commitPattern = /^[0-9a-f]{40}$/i

export function validateMergedRelease(event, version) {
  if (!versionPattern.test(version ?? '')) throw new Error(`Invalid VERSION: ${version}`)
  const pullRequest = event?.pull_request
  if (event?.action !== 'closed' || !pullRequest?.merged) {
    throw new Error('A release can start only when its pull request is closed as merged')
  }
  if (pullRequest.base?.ref !== 'main') throw new Error('The release pull request must target main')
  if (pullRequest.head?.ref !== `release/${version}`) {
    throw new Error(`Release branch ${pullRequest.head?.ref} does not match VERSION ${version}`)
  }
  const commit = pullRequest.merge_commit_sha
  if (!commitPattern.test(commit ?? '')) throw new Error('The merged release pull request has no valid merge commit SHA')
  const headCommit = pullRequest.head?.sha
  if (!commitPattern.test(headCommit ?? '')) throw new Error('The merged release pull request has no valid head commit SHA')
  if (!Number.isInteger(pullRequest.number) || pullRequest.number < 1) {
    throw new Error('The merged release pull request has no valid number')
  }
  return { version, commit: commit.toLowerCase(), headCommit: headCommit.toLowerCase(), pullRequest: pullRequest.number }
}

export function validateReviewAndChecks(reviews, checks, pullRequestAuthor, currentHead) {
  if (!Array.isArray(reviews)) throw new Error('The release pull request has no review history')
  const latestByReviewer = new Map()
  for (const review of reviews) {
    const login = review.user?.login
    if (!login || review.commit_id?.toLowerCase() !== String(currentHead ?? '').toLowerCase()) continue
    if (!['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) continue
    const previous = latestByReviewer.get(login)
    const submittedAt = Date.parse(review.submitted_at ?? '') || 0
    const previousSubmittedAt = Date.parse(previous?.submitted_at ?? '') || 0
    if (!previous || submittedAt >= previousSubmittedAt) {
      latestByReviewer.set(login, review)
    }
  }
  const hasHumanApproval = [...latestByReviewer.entries()].some(([login, review]) => (
    login.toLowerCase() !== String(pullRequestAuthor ?? '').toLowerCase() &&
    review.user?.type !== 'Bot' && !login.toLowerCase().endsWith('[bot]') &&
    review.state === 'APPROVED'
  ))
  if (!hasHumanApproval) throw new Error('The release pull request has no current human approval from someone other than its author')
  const prePublishChecks = Array.isArray(checks)
    ? checks.filter((check) => {
      const name = String(check.name ?? check.context ?? '')
      return !['release-publish', 'Publish merged release candidate / release-publish'].includes(name)
    })
    : []
  if (prePublishChecks.length === 0) throw new Error('The release pull request has no completed checks')
  const failures = prePublishChecks.filter((check) => {
    const conclusion = String(check.conclusion ?? check.state ?? '').toUpperCase()
    return !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion)
  })
  if (failures.length) {
    const failed = failures.map(({ name, context, conclusion, state }) => `${name ?? context ?? 'unnamed check'}: ${conclusion ?? state ?? 'incomplete'}`)
    throw new Error(`The release pull request has checks that did not pass: ${failed.join(', ')}`)
  }
}

export function planReleaseTag(targetCommit, existingTagCommit) {
  if (!commitPattern.test(targetCommit ?? '')) throw new Error('The target merge commit SHA is invalid')
  if (!existingTagCommit) return 'create'
  if (!commitPattern.test(existingTagCommit)) throw new Error('The existing release tag SHA is invalid')
  if (existingTagCommit.toLowerCase() !== targetCommit.toLowerCase()) {
    throw new Error(`The existing version tag points at ${existingTagCommit}, not the merged commit ${targetCommit}`)
  }
  return 'reuse'
}

export function extractReleaseNotes(changelog, version) {
  if (!versionPattern.test(version ?? '')) throw new Error(`Invalid release version: ${version}`)
  const heading = new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}[ \\t]*\\r?\\n`, 'm')
  const match = heading.exec(changelog)
  if (!match) throw new Error(`CHANGELOG.md has no dated changelog section for ${version}`)
  const remainder = changelog.slice(match.index + match[0].length)
  const nextSection = /^## \[/m.exec(remainder)
  const notes = remainder.slice(0, nextSection?.index ?? remainder.length).trim()
  if (!notes || !notes.replace(/^#{1,6}[^\n]*$/gm, '').trim()) {
    throw new Error(`CHANGELOG.md has no release notes for ${version}`)
  }
  return notes
}

function hasManifest(image) {
  return Boolean(
    image && image.schemaVersion === 2 &&
    ((Array.isArray(image.manifests) && image.manifests.length > 0) || image.config?.digest),
  )
}

function manifestSignature(image) {
  if (Array.isArray(image?.manifests)) {
    return image.manifests.map((manifest) => manifest.digest).filter(Boolean).sort().join(',')
  }
  return image?.config?.digest ?? ''
}

export function verifyPublishedRelease({ version, expectedNotes, release, image, latestImage, expectedLatest }) {
  if (!release || release.tagName !== version) throw new Error(`GitHub release tag does not match ${version}`)
  if (String(release.body ?? '').trim() !== String(expectedNotes ?? '').trim()) {
    throw new Error(`GitHub release notes do not match the ${version} changelog section`)
  }
  const expectedAsset = `mortgage-management-${version}.zip`
  if (!release.assets?.some((asset) => asset.name === expectedAsset && Number(asset.size) > 0)) {
    throw new Error(`GitHub release is missing the downloadable ZIP ${expectedAsset}`)
  }
  if (!hasManifest(image)) throw new Error(`The versioned container image ${version} is not available or has no manifest`)
  if (Boolean(release.isLatest) !== Boolean(expectedLatest)) {
    throw new Error(`GitHub release latest-release flag does not match expected ${Boolean(expectedLatest)}`)
  }
  if (expectedLatest) {
    if (!hasManifest(latestImage)) throw new Error('The latest container image is not available or has no manifest')
    if (manifestSignature(image) !== manifestSignature(latestImage)) {
      throw new Error('The latest container image does not point at the published version image')
    }
  }
}

function option(args, name) {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  return args[index + 1]
}

function readJson(path, label) {
  if (!path) throw new Error(`Missing path for ${label}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function runCli(args) {
  const command = args[0]
  if (command === 'validate-merged') {
    const result = validateMergedRelease(readJson(option(args, '--event'), 'event'), option(args, '--version'))
    console.log(JSON.stringify(result))
    return
  }
  if (command === 'validate-review') {
    const result = readJson(option(args, '--input'), 'review and check data')
    validateReviewAndChecks(result.reviews, result.statusCheckRollup, result.author, result.headCommit)
    console.log('Release pull request has an approved human review and passing checks')
    return
  }
  if (command === 'plan-tag') {
    const action = planReleaseTag(option(args, '--commit'), option(args, '--existing-tag-sha'))
    console.log(action)
    return
  }
  if (command === 'release-notes') {
    console.log(extractReleaseNotes(readFileSync(option(args, '--changelog'), 'utf8'), option(args, '--version')))
    return
  }
  if (command === 'verify-published') {
    const version = option(args, '--version')
    const changelog = readFileSync(option(args, '--changelog'), 'utf8')
    const expectedLatest = option(args, '--expected-latest') === 'true'
    verifyPublishedRelease({
      version,
      expectedNotes: extractReleaseNotes(changelog, version),
      release: readJson(option(args, '--release'), 'release metadata'),
      image: readJson(option(args, '--image'), 'versioned image manifest'),
      latestImage: option(args, '--latest-image') ? readJson(option(args, '--latest-image'), 'latest image manifest') : undefined,
      expectedLatest,
    })
    console.log(`Verified published release ${version}, notes, download, and container image`)
    return
  }
  throw new Error('Usage: publish-release.mjs <validate-merged|validate-review|plan-tag|release-notes|verify-published> [options]')
}

if (process.argv[1] && process.argv[1].endsWith('/publish-release.mjs')) runCli(process.argv.slice(2))
