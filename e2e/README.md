# Browser checks

Run `npm run build` and `npm run start` to serve the production build on
`http://127.0.0.1:3212`, then run `npm run test:e2e` in another terminal.
Tests launch a separate headless Chrome profile. Set `PLAYWRIGHT_CHANNEL=chromium`
to use a locally installed Playwright Chromium browser instead.

`.env.local` must contain this application's Clerk **development** keys; the
setup step refuses production keys and uses Clerk's official testing-token helper.

`public.spec.ts` checks the landing page, that `/onboarding` and `/dashboard`
redirect signed-out visitors to sign-in, and that the workspace API refuses
unauthenticated requests without caching the response.
