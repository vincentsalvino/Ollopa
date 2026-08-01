---
name: hello
description: Greet someone by name. Useful as a smoke test.
args:
  - name: who
    required: false
    description: The person's name (defaults to 'world')
---
Greet {{who}} warmly. If the user provided other context in the chat, weave it into a brief, friendly reply. Keep it to one sentence.