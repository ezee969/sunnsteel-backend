import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/passport-jwt.guard';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: UsersService;

  const mockUser = {
    id: '1',
    email: 'test@example.com',
    name: 'Test User',
    weightUnit: 'KG' as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRequest = {
    user: {
      sub: '1',
      email: 'test@example.com',
    },
  };

  beforeEach(async () => {
    const mockUsersService = {
      findByEmail: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<UsersController>(UsersController);
    usersService = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getProfile', () => {
    it('should return user profile', async () => {
      jest.spyOn(usersService, 'findByEmail').mockResolvedValue(mockUser);

      const result = await controller.getProfile(mockRequest as any);

      expect(usersService.findByEmail).toHaveBeenCalledWith(mockRequest.user.email);
      expect(result).toEqual(mockUser);
    });

    it('should handle user not found', async () => {
      jest.spyOn(usersService, 'findByEmail').mockResolvedValue(null);

      const result = await controller.getProfile(mockRequest as any);

      expect(usersService.findByEmail).toHaveBeenCalledWith(mockRequest.user.email);
      expect(result).toBeNull();
    });
  });
});
