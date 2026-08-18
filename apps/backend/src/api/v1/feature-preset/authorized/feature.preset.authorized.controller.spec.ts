import { Test, TestingModule } from '@nestjs/testing';
import { FeaturePresetAuthorizedController } from './feature.preset.authorized.controller';
import { FeaturePresetAuthorizedService } from './feature.preset.authorized.service';

jest.mock('@softsensor/prisma', () => ({
  PrismaService: class {},
}));

const USER = { id: 'user-1', role: 'USER' } as Auth.UserPayload;

describe('FeaturePresetAuthorizedController', () => {
  let controller: FeaturePresetAuthorizedController;
  let service: {
    importWorkbook: jest.Mock;
    listPresets: jest.Mock;
    getPresetDocument: jest.Mock;
    deleteImport: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      importWorkbook: jest.fn().mockResolvedValue({ statusCode: 201 }),
      listPresets: jest.fn().mockResolvedValue({ statusCode: 200 }),
      getPresetDocument: jest.fn().mockResolvedValue({ statusCode: 200 }),
      deleteImport: jest.fn().mockResolvedValue({ statusCode: 200 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeaturePresetAuthorizedController],
      providers: [
        { provide: FeaturePresetAuthorizedService, useValue: service },
      ],
    }).compile();

    controller = module.get(FeaturePresetAuthorizedController);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('hands the raw request to the service so Fastify owns the multipart read', () => {
    // Not @UploadedFile(): FileInterceptor is platform-express and never sees a
    // request under the FastifyAdapter this app runs.
    const req = { file: jest.fn() } as never;

    void controller.importWorkbook('ws-1', USER, req);

    expect(service.importWorkbook).toHaveBeenCalledWith('ws-1', USER, req);
  });

  it('passes the optional importId through when listing', () => {
    void controller.listPresets('ws-1', USER, 'imp-1');

    expect(service.listPresets).toHaveBeenCalledWith('ws-1', USER, 'imp-1');
  });

  it('delegates document reads and deletes', () => {
    void controller.getPresetDocument('preset-1', USER);
    void controller.deleteImport('imp-1', USER);

    expect(service.getPresetDocument).toHaveBeenCalledWith('preset-1', USER);
    expect(service.deleteImport).toHaveBeenCalledWith('imp-1', USER);
  });
});
