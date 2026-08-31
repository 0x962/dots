Runs when: The diff adds or changes any comment or docstring in any language. When that misses, return SKIP with the file that decided it.

Rules:
1. The reader has this file open and nothing else. They did not read the pull request, the review, or the chat. Assume no shared context.
2. Run the zero-context test on every noun phrase in every comment the diff adds or changes. Ask three questions of each one.
3. Question 1, which one? 'The check', 'the callback', 'the cleanup', 'the race' name nothing. Name the exact symbol, for example `close_stale_agent_shift`.
4. Question 2, defined where? A term is legal only when it is a code identifier spelled as the code spells it, or the same comment defines it, or the module or class docstring defines it once.
5. Question 3, would a new hire say it? If the word comes from the team's head and not from the code on screen, use plain words instead.
6. Do not use these words unless the same sentence defines them with a real identifier: liveness, watermark, demote, dangling, stale, close-check, health-check, poison, touch, self-heal, routable, grace period.
7. Write instead: 'proof that the agent is still here', 'the last time we saw X (`last_seen_at`)', 'set the status to offline', 'left over from a crash', 'the delayed check (`close_stale_agent_shift`)', 'break the whole outer transaction', 'update `last_seen_at`', 'open a shift again so the report shows the agent', 'still receives new calls'.
8. A system that needs a short name for a mechanism defines that name once, in the module or class docstring, bound to the real identifier. Never coin a term in an inline comment.
9. A mechanism word such as savepoint, on_commit, select_for_update, or IntegrityError may appear only beside a plain sentence that states the consequence for the reader.
10. Delete a comment that restates what the code already says.
11. Keep a comment shorter than the code it describes.
12. Explain why, not what. Explain what only when the syntax itself is hard to read.
13. Delete a comment that describes a change: 'now always on', 'no longer does X', 'kept because Y still uses it', 'instead of the old path'. The reader has one version of the file and no diff.
14. Delete a comment that describes an absence. The reader cannot see what is not there.
15. Write every comment in ASD-STE100 Simplified Technical English: one topic per sentence, the active voice, the simple present, the articles kept, no gerund used as a verb or a noun, and 20 words or less.
16. Keep quoted material verbatim. An error string, a log line, or a quotation from a person is not yours to rewrite.
17. The final test on each sentence: would a reader who has never seen another version of this file ask the question this sentence answers? If not, delete the sentence.
