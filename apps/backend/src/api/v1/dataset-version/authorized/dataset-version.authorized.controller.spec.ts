import { DatasetVersionAuthorizedController } from './dataset-version.authorized.controller';
import type { DatasetVersionAuthorizedService } from './dataset-version.authorized.service';

/**
 * DS-LAKE-005B-A-T05 (rescoped: server-side Arrow transport only).
 *
 * Everything either side of the controller was already proven: the Python
 * service returns real Arrow bytes + X-* headers (test_artifact_service.py),
 * and the NestJS service correctly branches to postBinaryToPython and
 * returns {format, buffer, contentType, headers} (dataset-draft.authorized.
 * service.spec.ts). This file exists because the ONE piece with no test
 * anywhere is the piece that actually writes the HTTP response:
 * `reply.headers(...).type(...).status(200).send(buffer)`. tsc cannot prove
 * a Fastify reply call sequence actually serializes correctly — plain
 * unit-level assertions on a hand-rolled reply double are the cheapest way
 * to prove it ran, without building an e2e harness this repo doesn't have
 * (no existing controller.spec.ts precedent for this controller at all).
 *
 * Instantiated directly (`new DatasetVersionAuthorizedController(...)`),
 * not through Nest's TestingModule — a controller is a plain class, and DI
 * machinery would only be needed if @Res()/@Query()'s decorators required
 * runtime resolution, which they don't outside an actual HTTP server.
 */

function replyDouble() {
  const reply = {
    headers: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  return reply as unknown as import('fastify').FastifyReply & typeof reply;
}

const USER: Auth.UserPayload = {
  id: 'u1',
  email: 'u@test.com',
} as Auth.UserPayload;

describe('DatasetVersionAuthorizedController — rows format passthrough (T05)', () => {
  it('arrow branch: types the reply as the Arrow content type and sends the raw buffer', async () => {
    const buffer = Buffer.from([1, 2, 3, 4]);
    const service = {
      listRowsService: jest.fn().mockResolvedValue({
        format: 'arrow' as const,
        buffer,
        contentType: 'application/vnd.apache.arrow.stream',
        headers: {
          'X-Total-Row-Count': '6',
          'X-Offset': '0',
          'X-Filtered': 'false',
        },
      }),
    } as unknown as DatasetVersionAuthorizedService;
    const controller = new DatasetVersionAuthorizedController(service);
    const reply = replyDouble();

    await controller.listArtifactRowsController(
      USER,
      'ds-1',
      'artifact-1',
      { offset: 0, limit: 1000, format: 'arrow' } as never,
      reply,
    );

    expect(reply.headers).toHaveBeenCalledWith({
      'X-Total-Row-Count': '6',
      'X-Offset': '0',
      'X-Filtered': 'false',
    });
    expect(reply.type).toHaveBeenCalledWith(
      'application/vnd.apache.arrow.stream',
    );
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith(buffer);
  });

  it('json branch: sends the envelope body, not the buffer path', async () => {
    const body = {
      format: 'json' as const,
      statusCode: 200,
      message: 'Rows fetched successfully',
      type: 'SUCCESS' as const,
      data: { totalRowCount: 6, offset: 0, tags: ['TI-101'], rows: [] },
    };
    const service = {
      listRowsService: jest.fn().mockResolvedValue(body),
    } as unknown as DatasetVersionAuthorizedService;
    const controller = new DatasetVersionAuthorizedController(service);
    const reply = replyDouble();

    await controller.listArtifactRowsController(
      USER,
      'ds-1',
      'artifact-1',
      { offset: 0, limit: 1000, format: 'json' } as never,
      reply,
    );

    expect(reply.headers).not.toHaveBeenCalled();
    expect(reply.type).not.toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith(body);
  });

  it('legacy compat route (listRowsController) shares the same passthrough', async () => {
    const buffer = Buffer.from([9]);
    const service = {
      listRowsService: jest.fn().mockResolvedValue({
        format: 'arrow' as const,
        buffer,
        contentType: 'application/vnd.apache.arrow.stream',
        headers: {},
      }),
    } as unknown as DatasetVersionAuthorizedService;
    const controller = new DatasetVersionAuthorizedController(service);
    const reply = replyDouble();

    await controller.listRowsController(
      USER,
      'ds-1',
      'version-or-artifact-1',
      { offset: 0, limit: 1000, format: 'arrow' } as never,
      reply,
    );

    expect(reply.type).toHaveBeenCalledWith(
      'application/vnd.apache.arrow.stream',
    );
    expect(reply.send).toHaveBeenCalledWith(buffer);
  });
});
