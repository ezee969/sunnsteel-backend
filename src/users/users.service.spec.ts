import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { DatabaseService } from '../database/database.service';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');
const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('UsersService', () => {
  let service: UsersService;
  let databaseService: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    userFollow: {
      findUnique: jest.Mock;
      create: jest.Mock;
      deleteMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    const mockDatabaseService = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      userFollow: {
        findUnique: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: DatabaseService,
          useValue: mockDatabaseService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    databaseService = module.get(DatabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByEmail', () => {
    it('should return profile with follower/following counts', async () => {
      const rawUser = {
        id: '1',
        email: 'test@example.com',
        name: 'Test User',
        lastName: null,
        avatarUrl: null,
        age: null,
        sex: null,
        weight: null,
        height: null,
        supabaseUserId: null,
        weightUnit: 'KG',
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: {
          followers: 7,
          following: 3,
        },
      };

      databaseService.user.findUnique.mockResolvedValue(rawUser);

      const result = await service.findByEmail('test@example.com');

      expect(databaseService.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: 'test@example.com' },
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: '1',
          followerCount: 7,
          followingCount: 3,
        }),
      );
    });

    it('should return null when not found', async () => {
      databaseService.user.findUnique.mockResolvedValue(null);
      const result = await service.findByEmail('unknown@example.com');
      expect(result).toBeNull();
    });
  });

  describe('findByEmailWithPassword', () => {
    it('should request password fields', async () => {
      databaseService.user.findUnique.mockResolvedValue({
        id: '1',
        email: 'test@example.com',
        password: 'hashed',
        name: 'Test',
      });

      const result = await service.findByEmailWithPassword('test@example.com');

      expect(databaseService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        select: {
          id: true,
          email: true,
          password: true,
          name: true,
        },
      });
      expect(result).toBeTruthy();
    });
  });

  describe('create', () => {
    it('should hash password and return profile with counts', async () => {
      mockedBcrypt.hash.mockResolvedValue('hashed-password' as never);

      databaseService.user.create.mockResolvedValue({
        id: '1',
        email: 'new@example.com',
        name: 'New User',
        lastName: null,
        avatarUrl: null,
        age: null,
        sex: null,
        weight: null,
        height: null,
        supabaseUserId: null,
        weightUnit: 'KG',
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { followers: 0, following: 0 },
      });

      const result = await service.create({
        email: 'new@example.com',
        password: 'plain-password',
        name: 'New User',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('plain-password', 10);
      expect(databaseService.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'new@example.com',
            password: 'hashed-password',
            name: 'New User',
          }),
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          followerCount: 0,
          followingCount: 0,
        }),
      );
    });
  });

  describe('getPublicProfileById', () => {
    it('should return public profile with follow status', async () => {
      databaseService.user.findUnique.mockResolvedValue({
        id: 'target-id',
        name: 'Target',
        lastName: 'User',
        avatarUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { followers: 9, following: 2 },
      });
      databaseService.userFollow.findUnique.mockResolvedValue({
        followerId: 'viewer-id',
      });

      const result = await service.getPublicProfileById('viewer-id', 'target-id');

      expect(result).toEqual(
        expect.objectContaining({
          id: 'target-id',
          followerCount: 9,
          followingCount: 2,
          isFollowedByMe: true,
        }),
      );
    });

    it('should throw when target does not exist', async () => {
      databaseService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.getPublicProfileById('viewer-id', 'missing-id'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('followUser', () => {
    it('should block self-follow', async () => {
      await expect(service.followUser('same-id', 'same-id')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('should throw when target user does not exist', async () => {
      databaseService.user.findUnique.mockResolvedValue(null);

      await expect(
        service.followUser('viewer-id', 'missing-id'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('should be idempotent if follow already exists', async () => {
      databaseService.user.findUnique.mockResolvedValue({ id: 'target-id' });
      databaseService.userFollow.create.mockRejectedValue({
        code: 'P2002',
      });
      jest.spyOn(service, 'getPublicProfileById').mockResolvedValue({
        id: 'target-id',
        name: 'Target',
        lastName: null,
        avatarUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        followerCount: 1,
        followingCount: 2,
        isFollowedByMe: true,
      });

      const result = await service.followUser('viewer-id', 'target-id');

      expect(databaseService.userFollow.create).toHaveBeenCalledWith({
        data: {
          followerId: 'viewer-id',
          followingId: 'target-id',
        },
      });
      expect(result.isFollowedByMe).toBe(true);
    });
  });

  describe('unfollowUser', () => {
    it('should be idempotent and return profile', async () => {
      databaseService.user.findUnique.mockResolvedValue({ id: 'target-id' });
      databaseService.userFollow.deleteMany.mockResolvedValue({ count: 0 });
      jest.spyOn(service, 'getPublicProfileById').mockResolvedValue({
        id: 'target-id',
        name: 'Target',
        lastName: null,
        avatarUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        followerCount: 0,
        followingCount: 2,
        isFollowedByMe: false,
      });

      const result = await service.unfollowUser('viewer-id', 'target-id');

      expect(databaseService.userFollow.deleteMany).toHaveBeenCalledWith({
        where: {
          followerId: 'viewer-id',
          followingId: 'target-id',
        },
      });
      expect(result.isFollowedByMe).toBe(false);
    });
  });
});
