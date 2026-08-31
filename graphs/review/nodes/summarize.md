1. Run `gh pr view {PR_NUMBER} --json title,body,baseRefName,headRefName,headRefOid,files` and `gh pr diff {PR_NUMBER}`.
2. Note the base branch, the head branch, every changed file, and `headRefOid`. Call that SHA REVIEW_HEAD; every later line number belongs to it.
3. Put this checkout on the PR head so later fixes land on the right branch: `git fetch origin <headRefName> && git checkout -B review/pr-{PR_NUMBER} FETCH_HEAD`. The working tree must be clean first; never run bare `git stash`, the stash stack is shared with every other worktree on this machine.
4. Record the repository root: `git rev-parse --show-toplevel`. Call it REPO_ROOT.
5. Return as OUTPUT a tight summary every later node reads: what changed, where, the endpoints and tables touched, and the risk areas. Two paragraphs at most.
