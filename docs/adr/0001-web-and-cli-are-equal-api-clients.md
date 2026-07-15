# Web and CLI are equal API clients

OpenJob has two first-class clients: web and CLI. Both expose the complete product through the same hosted service and API so behavior and authorization cannot drift; the CLI accepts stdin or files, returns data through stdout or files, and reserves stderr for diagnostics. It deliberately has no local task database or offline mode, trading offline use for one shared source of truth.
