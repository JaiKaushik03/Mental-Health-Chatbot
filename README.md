# Mental Health Chatbot — Still

The completed project is provided as [Mental-Health-Chatbot-complete.zip](Mental-Health-Chatbot-complete.zip).

Download and extract the ZIP, then open the included `README.md` for full setup instructions. The archive contains source code, the built frontend, backend, database setup, tests, and documentation.

## Run locally

Requires Node.js 24.14 or newer. From the extracted `Mental-Health-Chatbot-main` folder:

```sh
npm ci
npm run dev
```

Open http://localhost:5173. Demo mode works without an API key; real AI replies require a server-side OpenAI API key.

Includes login, guest sessions, persistent conversations, archive/delete/export, a responsive interface, and optional OpenAI integration. Verification included 28 backend/browser tests and a production build. This is a local reflection companion, not a clinically validated service.

