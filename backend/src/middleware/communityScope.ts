import { NextFunction, Request, Response } from 'express';
import { prisma } from '../models/prismaClient';

/**
 * Loads the caller's ACTIVE membership for the community identified by
 * req.params.communityId and attaches it as req.membership. Rejects with
 * 404 (not 403) when the community doesn't exist OR the caller has no
 * active membership in it — the two cases are made indistinguishable so a
 * non-member cannot learn whether a given community exists (Constitution
 * Principle II: Community Isolation).
 */
export async function requireCommunityMembership(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { communityId } = req.params;
  const userId = req.user?.id;

  if (!communityId || !userId) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Community not found' });
    return;
  }

  const membership = await prisma.membership.findUnique({
    where: { communityId_userId: { communityId, userId } },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Community not found' });
    return;
  }

  req.membership = membership;
  next();
}

/**
 * Same as requireCommunityMembership, but additionally requires the
 * caller's membership to have the ADMIN role (Constitution Principle III).
 */
export async function requireCommunityAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requireCommunityMembership(req, res, () => {
    if (!req.membership) {
      return;
    }
    if (req.membership.role !== 'ADMIN') {
      res.status(403).json({ code: 'FORBIDDEN', message: 'Administrator role required' });
      return;
    }
    next();
  });
}
