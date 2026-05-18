import { FastifyRequest } from 'fastify';

export type AuthenticatedRequest = FastifyRequest & {
  users: Auth.UserPayload;
};
