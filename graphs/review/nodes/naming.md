# Principle

Software is written for *people* to understand; variable names should be chosen accordingly. People need to comb through your code and understand its *intent* in order to extend or fix it. Too often, variable names waste space and hinder comprehension. Even well-intentioned engineers often choose names that are, at best, only superficially useful. This document is meant to help engineers choose good variable names. It artificially focuses on code reviews because they expose most of the issues with bad variable names. There are, of course, other reasons to choose good variable names (such as improving code maintenance).

There are two taxes on code reviewers' mental endurance: *distance* and *boilerplate*. Distance, in the case of variables, refers to how far away a reviewer has to scan, visually, in order to remind themselves what a variable does. Reviewers lack the *context* that coders had in mind when they wrote the code; reviewers must reconstruct that context on the fly. Reviewers need to do this quickly; it isn't worth spending as much time reviewing code as it took to write it2. Good variable names eliminate the problem of distance because they remind the reviewer of their purpose. That way they don't have to scan back to an earlier part of the code.

The other tax is *boilerplate*. Code is often doing something complicated; it was written by someone else; reviewers are often context-switching from their own code; they review a lot of code, every day, and may have been reviewing code for many years. Given all this, reviewers struggle to maintain *focus* during code reviews. Thus, every useless character drains the effectiveness of code reviewing. In any one small example, it's not a big deal for code to be unclear. Code reviewers can figure out what almost any code does, given enough time and energy (perhaps with some follow-up questions to the coder). But they can't afford to do that over and over again, year in and year out. It's death by 1,000 cuts.

# Avoid Cognitive Tax

Every obscure name is a transaction cost levied on every developer who encounters it. When you see "libsodium," you must context-switch from problem-solving mode to detective mode: "What does this do? Let me check the README. Ah, it's a crypto library. Why is it called sodium? Because chemistry? Because NaCl? Clever, I suppose." Now, multiply this by dozens of dependencies in a modern project. Each one demands tribute: a few seconds of mental processing to decode the semantic cipher. Those seconds accumulate into minutes and effort, then career-spanning mountains of wasted cognitive effort.

Imagine that you are to explain to a new engineer how is your codebase structured, and the general architecture of some project, and go through the dependencies you use to delegate some certain tasks to and explain how they orchestrate together. Actually let me put my friend's statement again instead: "We're using Viper for configuration management, which feeds into Cobra for the CLI, and then Melody handles our WebSocket connections, Casbin manages permissions, all through Asynq for our job queue".

Now pause and actually process that sentence. there's a snake, another snake, music, a mysterious proper noun, and… async-with-a-q? A portion of you mental RAM is busy pattern-matching these arbitrary tokens to their actual functions instead of focusing on the architectural decisions being discussed. This is like a cardiologist saying "we'll install a Butterfly in your Whisper to improve your Thunderbeat" instead of "we'll place a stent in your artery to improve your cardiac output." Compare this to reading a scientific paper in materials science. When you encounter "high-entropy alloys" or "shape-memory polymers," the name itself conveys information. You can make educated guesses about properties and applications before reading a single word of description.

## Rules 

### 1. Don't Put the Type in the Name

### 2. Use Teutonic Names Most of The Time

### 3. Move Simple Comments Into Variable Names

### 4. Avoid Over-used Cliches

### 5. Use Idioms Where Meaning is Obvious

### 6. May Use Short Names Over Short Distances When Obvious

### 7. Remove Thoughtless One-Time Variables

### 8. Use Short OTVs to Break Long Lines

### 9. Use Short OTVs to Break up Complicated Expressions

### 10. Use Longer OTVs to Explain Confusing Code

# Look at the following in the diff:

1. App names
2. Directory names
3. File names 
4. Class names
5. Method names 