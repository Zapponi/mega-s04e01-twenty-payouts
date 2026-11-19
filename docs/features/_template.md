# <issue> · <what becomes true for the user>

Copy to `docs/features/<issue>-<slug>.md` and commit the ticket before the worker starts. Link the ticket from the issue. In the opening packet (the worker's brief), include `Feature ticket: <path> @ <commit SHA>`. The worker reads the committed ticket with `git show <sha>:<path>` and checks for newer owner decisions before starting. `BRIEF.md` holds the project-wide proof.

## Outcome

<The user can now ... Not "the endpoint exists": what a person or their agent can do that they could not before.>

## Acceptance

- Owner's words: <the owner's criterion, quoted from the issue, message or decision record>
- Source: <link or locator for the owner's wording>
- Receiver: <person, role or service authorized to decide whether the delivery meets the criterion, with the source of that authority>

The owner writes the criterion before work and can rewrite a draft in their own words. The builder asks the owner to supply any missing wording.
An independent reviewer opens the source and confirms that the quoted criterion matches what the owner wrote.

## Done means

| Check | Shown by | Result |
|---|---|---|
| <what must hold> | <the command, screen or number that shows it> | <filled after the run: match / mismatch> |

## Premises

Record each limit that changes a decision. For a timed limit, capture the clock-start event. An independent reviewer opens each cited source and compares its scope, unit and clock with the target run. Record mismatches and unknowns under **Not proven yet** and ask the source owner before relying on them.

| Claim | Source and its scope | Target scope | Unit | Clock starts |
|---|---|---|---|---|
| <value or rule> | <link or locator, short excerpt, and where the source applies> | <where this work would rely on it> | <unit, or none> | <event, or not applicable> |

## Receiver receipt

- State: <pending, accepted or refused>
- Evidence: <receiver's exact words or result, where to open it, and the delivery it refers to>

Keep the receiver's confirmation pending until its own evidence arrives. An independent reviewer checks the receipt's authority and the delivery it refers to. Record a review verdict under **Done means** as review evidence.

## Attempt note

Use this for repeated refusals of the same operation. When two different submissions get the same refusal, record the result and pause resubmission. Keep the original count at `Attempts: 2 of 2`. Before an extra send, record an explicit human decision or a diagnosis that cites new evidence and explains why it changes the next submission. Each release covers one extra send on that operation. Record that send and its result separately.

- Operation: <the action and target>
- Attempts: <N> of 2
- Results and pause: <send and reply references, and when the pause began>
- Extra attempt: <decision or diagnosis reference recorded before the send, then its send and reply references>

An independent reviewer compares the note with the underlying tool log and checks that each extra send had its own release before it happened. Record unapproved sends and missing evidence under **Not proven yet**.

## Easy to miss

- <the edge a builder skips: empty state, old data, a second user, a failed call>

## Not proven yet

- <what nobody ran, and why. Empty only if every row above has a result>
