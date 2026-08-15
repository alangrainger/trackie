import express from 'express';

import { validateSessionMiddleware } from '#util/middlewares';

const app = express();
export { app as handlers };

app.use(validateSessionMiddleware);

/*
GET /trackie-config

Trackie deployment config for the client. Requires a valid session; the
values are only ever shown inside the app, so nothing is served to anonymous
visitors.

Currently:
- supportEmail: shown in the Help menu. Deployment config
  (TRACKIE_SUPPORT_EMAIL in the server .env), served at runtime rather than
  baked into the public source or the built client bundle; the client hides
  its menu entry when unset.
*/
app.get('/', (_req, res) => {
  res
    .set('Cache-Control', 'no-store')
    .json({ supportEmail: process.env.TRACKIE_SUPPORT_EMAIL || null });
});
