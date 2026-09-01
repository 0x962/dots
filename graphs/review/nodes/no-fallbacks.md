# Context

For some reason AI agents are mortally terrified of exceptions. Exceptions are not bad. Fallbacks and hiding errors are worse. They can make it much harder to investigate issues or may even hide real production issues from the user. 

# Working Style

You must look at every method, class, or file that has been changed in the pull request and then understand the implementation for each of them. You are not allowed to skip any part of the code.

You may spawn sub-agents if necessary.

For every bit of implementation you should look at what fallbacks we have in place. Here are a few examples:

## Examples

1. Returning fake data when an API request fails. 
2. Default values for settings such as environment variables. 
3. Default values for values on the front end. 
4. Defaulting to non-optimal fields, such as using the UUID as the fallback when the name is not available.
5. Lazy implementation such as falling back to polling when webhooks are not available or not working. This is often done when implementing the webhook is more time-consuming or not readily available. The agent, instead of flagging or doing the right thing, implements polling as the fallback, which ends up being the primary code path. 
6. Using fallback values when a database query fails. 

This is not an exhaustive list and there may be other fallbacks. The only real way to catch them is to read every line of the code and to explain to yourself in English what the method does. In those explanations, catch these fallbacks.

# Speed

You may skip files where there is no possibility of fallbacks, such as a package lock file. 