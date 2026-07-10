import express, { Express, NextFunction, Request, Response } from 'express';
import { invitationsRouter } from './api/invitations';
import { membersRouter } from './api/members';
import { ApiError } from './services/errors';

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.use('/api/v1', invitationsRouter);
  app.use('/api/v1', membersRouter);

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Centralized error handler: any thrown/rejected error from a route
  // handler lands here so failures are always surfaced, never silently
  // swallowed.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.httpStatus).json({ code: err.code, message: err.message });
      return;
    }
    // eslint-disable-next-line no-console
    console.error(err);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Unexpected server error' });
  });

  return app;
}
