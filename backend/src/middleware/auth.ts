import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../models/prismaClient';

interface AccessTokenPayload {
  sub: string;
}

function getAccessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error('JWT_ACCESS_SECRET is not configured');
  }
  return secret;
}

/**
 * Verifies the bearer JWT access token and attaches the authenticated user
 * to req.user. Rejects with 401 if the token is missing, invalid, expired,
 * or no longer corresponds to an existing user.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Missing bearer token' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();

  let payload: AccessTokenPayload;
  try {
    payload = jwt.verify(token, getAccessSecret()) as AccessTokenPayload;
  } catch {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Invalid or expired token' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'User no longer exists' });
    return;
  }

  req.user = { id: user.id, email: user.email, phone: user.phone };
  next();
}
