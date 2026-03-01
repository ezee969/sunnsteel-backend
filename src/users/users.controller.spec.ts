import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: UsersService;

  const mockUserProfile = {
    id: '1',
    email: 'test@example.com',
    name: 'Test User',
    supabaseUserId: null,
    weightUnit: 'KG' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    followerCount: 0,
    followingCount: 0,
  };

  const mockPublicProfile = {
    id: 'target-user-id',
    name: 'Target',
    lastName: 'User',
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    followerCount: 12,
    followingCount: 4,
    isFollowedByMe: true,
  };

  const mockRequest = {
    user: {
      id: 'viewer-user-id',
      email: 'test@example.com',
    },
  };

  beforeEach(async () => {
    const mockUsersService = {
      findByEmail: jest.fn(),
      getPublicProfileById: jest.fn(),
      followUser: jest.fn(),
      unfollowUser: jest.fn(),
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
      .overrideGuard(SupabaseJwtGuard)
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
      jest.spyOn(usersService, 'findByEmail').mockResolvedValue(mockUserProfile as any);

      const result = await controller.getProfile(mockRequest as any);

      expect(usersService.findByEmail).toHaveBeenCalledWith(mockRequest.user.email);
      expect(result).toEqual(mockUserProfile);
    });
  });

  describe('getPublicProfile', () => {
    it('should return public user profile', async () => {
      jest
        .spyOn(usersService, 'getPublicProfileById')
        .mockResolvedValue(mockPublicProfile as any);

      const result = await controller.getPublicProfile(mockRequest as any, 'target-user-id');

      expect(usersService.getPublicProfileById).toHaveBeenCalledWith(
        mockRequest.user.id,
        'target-user-id',
      );
      expect(result).toEqual(mockPublicProfile);
    });
  });

  describe('followUser', () => {
    it('should follow and return updated public profile', async () => {
      jest.spyOn(usersService, 'followUser').mockResolvedValue(mockPublicProfile as any);

      const result = await controller.followUser(mockRequest as any, 'target-user-id');

      expect(usersService.followUser).toHaveBeenCalledWith(
        mockRequest.user.id,
        'target-user-id',
      );
      expect(result).toEqual(mockPublicProfile);
    });
  });

  describe('unfollowUser', () => {
    it('should unfollow and return updated public profile', async () => {
      const unfollowedProfile = { ...mockPublicProfile, isFollowedByMe: false };
      jest.spyOn(usersService, 'unfollowUser').mockResolvedValue(unfollowedProfile as any);

      const result = await controller.unfollowUser(mockRequest as any, 'target-user-id');

      expect(usersService.unfollowUser).toHaveBeenCalledWith(
        mockRequest.user.id,
        'target-user-id',
      );
      expect(result).toEqual(unfollowedProfile);
    });
  });
});
