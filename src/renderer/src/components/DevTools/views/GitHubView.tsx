import { Github } from 'lucide-react'

/**
 * GitHub integration is not built.
 *
 * This states that plainly rather than rendering an empty repo list that
 * implies a sync failure. The schema (github_repos / github_issues /
 * github_commits / github_etags, migration 7) is in place and the local half
 * of the join — `projects.remote_url` — is already populated by the scanner,
 * so the remaining work is auth, sync and this view. See
 * docs/CAPABILITIES.md.
 */
export function GitHubView() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 select-none text-center px-6">
      <Github size={28} style={{ color: 'var(--text-muted)', opacity: 0.6 }} />
      <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
        GitHub integration isn't built yet
      </span>
      <span className="font-mono text-xs max-w-md" style={{ color: 'var(--text-muted)' }}>
        The database tables and the local side of the repo↔project join are in place — the scanner already
        records each project's remote URL. Device-flow auth, sync and this view are the remaining work.
      </span>
    </div>
  )
}
