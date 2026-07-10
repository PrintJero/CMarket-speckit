import { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wraps an async Express handler so a rejected promise reaches the error-handling middleware. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
