import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireCommunityAdmin } from '../middleware/communityScope';
import { asyncHandler } from '../utils/asyncHandler';
import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  declineInvitation,
  listCommunityInvitations,
  listMyInvitations,
  serializeInvitation,
} from '../services/invitationService';
import { serializeMembership } from '../services/membershipService';

export const invitationsRouter = Router();

invitationsRouter.post(
  '/communities/:communityId/invitations',
  requireAuth,
  requireCommunityAdmin,
  asyncHandler(async (req, res) => {
    const invitation = await createInvitation({
      communityId: req.params.communityId,
      invitedByMembershipId: req.membership!.id,
      invitedByUserId: req.user!.id,
      inviteeEmail: req.body?.inviteeEmail,
      inviteePhone: req.body?.inviteePhone,
    });
    res.status(201).json(serializeInvitation(invitation));
  }),
);

invitationsRouter.get(
  '/communities/:communityId/invitations',
  requireAuth,
  requireCommunityAdmin,
  asyncHandler(async (req, res) => {
    const invitations = await listCommunityInvitations(req.params.communityId);
    res.status(200).json(invitations.map(serializeInvitation));
  }),
);

invitationsRouter.delete(
  '/communities/:communityId/invitations/:invitationId',
  requireAuth,
  requireCommunityAdmin,
  asyncHandler(async (req, res) => {
    await cancelInvitation(req.params.communityId, req.params.invitationId);
    res.status(204).send();
  }),
);

invitationsRouter.get(
  '/users/me/invitations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const invitations = await listMyInvitations(req.user!);
    res.status(200).json(invitations.map(serializeInvitation));
  }),
);

invitationsRouter.post(
  '/invitations/:invitationId/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { invitation, membership } = await acceptInvitation(req.params.invitationId, req.user!);
    res.status(200).json({
      invitation: serializeInvitation(invitation),
      membership: serializeMembership(membership),
    });
  }),
);

invitationsRouter.post(
  '/invitations/:invitationId/decline',
  requireAuth,
  asyncHandler(async (req, res) => {
    const invitation = await declineInvitation(req.params.invitationId, req.user!);
    res.status(200).json(serializeInvitation(invitation));
  }),
);
