# RepoDoctor — rebuilt production MVP

RepoDoctor scans public GitHub repositories, combines deterministic checks with OpenRouter AI analysis, and provides evidence, prescriptions, an X-Ray view and AI Quick Help.

## Important: existing OpenRouter key

Keep your existing `OPENROUTER_API_KEY` in Vercel. Do not paste the secret into `index.html` or `script.js`.

Vercel Environment Variables:
- `OPENROUTER_API_KEY` = your existing OpenRouter key
- `OPENROUTER_MODEL` = your existing model if you already use one; otherwise `openrouter/free`
- `NEXT_PUBLIC_APP_URL` = `https://repodoctor-five.vercel.app`

OpenRouter uses an OpenAI-compatible chat completions endpoint and authenticates with a Bearer API key.

## Deploy

Replace the files in your existing RepoDoctor GitHub repository, commit and push. Vercel should deploy the new commit automatically.

## What was fixed

- Diagnose button has a direct event handler and Enter-key support.
- GitHub repository parsing and error messages are explicit.
- `/api/analyze` and `/api/chat` are production serverless endpoints.
- Existing OpenRouter secret stays server-side.
- Options drawer has open, close, backdrop and Escape handling.
- Share uses native Web Share when available and clipboard fallback otherwise.
- Report export/copy and rescan are wired.
- Previous local report can be restored.
