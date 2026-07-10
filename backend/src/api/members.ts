import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireCommunityAdmin, requireCommunityMembership } from '../middleware/communityScope';
import { asyncHandler } from '../utils/asyncHandler';
import { listCommunityMembers, revokeMembership, serializeMembership } from '../services/membershipService';

export const membersRouter = Router();

membersRouter.get(
  '/communities/:communityId/members',
  requireAuth,
  requireCommunityMembership,
  asyncHandler(async (req, res) => {
    const members = await listCommunityMembers(req.params.communityId);
    res.status(200).json(members.map(serializeMembership));
  }),
);

membersRouter.delete(
  '/communities/:communityId/members/:userId',
  requireAuth,
  requireCommunityAdmin,
  asyncHandler(async (req, res) => {
    await revokeMembership(req.params.communityId, req.params.userId);
    res.status(204).send();
  }),
);
