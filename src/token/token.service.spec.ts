import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { TokenService } from './token.service';
import { DatabaseService } from '../database/database.service';

describe('TokenService', () => {
  let service: TokenService;
  let jwtService: JwtService;
  let databaseService: DatabaseService;

  const mockUser = {
    id: '1',
    email: 'test@example.com',
    name: 'Test User',
    password: 'hashed-password',
    supabaseUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    weightUnit: 'KG' as const,
  };

  const mockTokens = {
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
  };

  const mockJwtPayload = {
    sub: '1',
    email: 'test@example.com',
    iat: 1234567890,
    exp: 1234567890,
  };

  const mockStoredToken = {
    id: '1',
    token: 'mock-refresh-token',
    userId: '1',
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    user: mockUser,
  };

  beforeEach(async () => {
    const mockJwtService = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
      decode: jest.fn(),
    };

    const mockDatabaseService = {
      user: {
        findUnique: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        findUnique: jest.fn(),
      },
      blacklistedToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: DatabaseService,
          useValue: mockDatabaseService,
        },
      ],
    }).compile();

    service = module.get<TokenService>(TokenService);
    jwtService = module.get<JwtService>(JwtService);
    databaseService = module.get<DatabaseService>(DatabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateTokens', () => {
    it('should generate access and refresh tokens', async () => {
      jest
        .spyOn(jwtService, 'signAsync')
        .mockResolvedValueOnce(mockTokens.accessToken)
        .mockResolvedValueOnce(mockTokens.refreshToken);
      jest
        .spyOn(databaseService.user, 'findUnique')
        .mockResolvedValue(mockUser);
      jest
        .spyOn(databaseService.refreshToken, 'create')
        .mockResolvedValue(mockStoredToken);

      const result = await service.generateTokens(mockUser.id, mockUser.email);

      expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
      expect(jwtService.signAsync).toHaveBeenNthCalledWith(
        1,
        { sub: mockUser.id, email: mockUser.email },
        { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
      );
      expect(jwtService.signAsync).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          sub: mockUser.id,
          email: mockUser.email,
          jti: expect.any(String),
        }),
        { secret: process.env.JWT_REFRESH_SECRET, expiresIn: '7d' },
      );
      expect(databaseService.refreshToken.create).toHaveBeenCalled();
      expect(result).toEqual(mockTokens);
    });
  });

  describe('revokeRefreshToken', () => {
    it('should delete refresh token from database', async () => {
      jest
        .spyOn(databaseService.refreshToken, 'delete')
        .mockResolvedValue(mockStoredToken);

      await service.revokeRefreshToken('mock-refresh-token');

      expect(databaseService.refreshToken.delete).toHaveBeenCalledWith({
        where: { token: 'mock-refresh-token' },
      });
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify valid refresh token and return payload', async () => {
      jest
        .spyOn(databaseService.refreshToken, 'findUnique')
        .mockResolvedValue(mockStoredToken);
      jest.spyOn(jwtService, 'verifyAsync').mockResolvedValue(mockJwtPayload);

      const result = await service.verifyRefreshToken('mock-refresh-token');

      expect(databaseService.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { token: 'mock-refresh-token' },
        include: { user: true },
      });
      expect(jwtService.verifyAsync).toHaveBeenCalledWith(
        'mock-refresh-token',
        {
          secret: process.env.JWT_REFRESH_SECRET,
        },
      );
      expect(result).toEqual({
        sub: mockJwtPayload.sub,
        email: mockJwtPayload.email,
      });
    });

    it('should throw UnauthorizedException if token not found in database', async () => {
      jest
        .spyOn(databaseService.refreshToken, 'findUnique')
        .mockResolvedValue(null);

      await expect(service.verifyRefreshToken('invalid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if token is expired', async () => {
      const expiredToken = {
        ...mockStoredToken,
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      };
      jest
        .spyOn(databaseService.refreshToken, 'findUnique')
        .mockResolvedValue(expiredToken);
      jest
        .spyOn(databaseService.refreshToken, 'delete')
        .mockResolvedValue(expiredToken);

      await expect(service.verifyRefreshToken('expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(databaseService.refreshToken.delete).toHaveBeenCalledWith({
        where: { token: 'expired-token' },
      });
    });

    it('should throw UnauthorizedException if token belongs to different user', async () => {
      const differentUserPayload = { ...mockJwtPayload, sub: '2' };
      jest
        .spyOn(databaseService.refreshToken, 'findUnique')
        .mockResolvedValue(mockStoredToken);
      jest
        .spyOn(jwtService, 'verifyAsync')
        .mockResolvedValue(differentUserPayload);

      await expect(
        service.verifyRefreshToken('mock-refresh-token'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if JWT verification fails', async () => {
      jest
        .spyOn(databaseService.refreshToken, 'findUnique')
        .mockResolvedValue(mockStoredToken);
      jest
        .spyOn(jwtService, 'verifyAsync')
        .mockRejectedValue(new Error('Invalid JWT'));

      await expect(
        service.verifyRefreshToken('mock-refresh-token'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('revokeAllUserTokens', () => {
    it('should delete all refresh tokens for a user', async () => {
      jest
        .spyOn(databaseService.refreshToken, 'deleteMany')
        .mockResolvedValue({ count: 3 });

      await service.revokeAllUserTokens(mockUser.id);

      expect(databaseService.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
      });
    });
  });

  describe('blacklistAccessToken', () => {
    it('should blacklist access token', async () => {
      const mockDecodedToken = {
        sub: mockUser.id,
        email: mockUser.email,
        exp: Math.floor(Date.now() / 1000) + 900, // 15 minutes from now
      };
      jest.spyOn(jwtService, 'decode').mockReturnValue(mockDecodedToken);
      jest.spyOn(databaseService.blacklistedToken, 'create').mockResolvedValue({
        id: '1',
        token: 'mock-access-token',
        issuedAt: new Date(),
        expiresAt: new Date(mockDecodedToken.exp * 1000),
      });

      await service.blacklistAccessToken('mock-access-token');

      expect(jwtService.decode).toHaveBeenCalledWith('mock-access-token');
      expect(databaseService.blacklistedToken.create).toHaveBeenCalledWith({
        data: {
          token: 'mock-access-token',
          expiresAt: new Date(mockDecodedToken.exp * 1000),
        },
      });
    });

    it('should throw error for invalid token payload', async () => {
      jest.spyOn(jwtService, 'decode').mockReturnValue(null);

      await expect(
        service.blacklistAccessToken('invalid-token'),
      ).rejects.toThrow('Invalid token payload');
    });

    it('should throw error for token without expiration', async () => {
      jest
        .spyOn(jwtService, 'decode')
        .mockReturnValue({ sub: '1', email: 'test@example.com' });

      await expect(
        service.blacklistAccessToken('token-without-exp'),
      ).rejects.toThrow('Invalid token payload');
    });
  });

  describe('isTokenBlacklisted', () => {
    it('should return true if token is blacklisted', async () => {
      jest
        .spyOn(databaseService.blacklistedToken, 'findUnique')
        .mockResolvedValue({
          id: '1',
          token: 'blacklisted-token',
          issuedAt: new Date(),
          expiresAt: new Date(),
        });

      const result = await service.isTokenBlacklisted('blacklisted-token');

      expect(result).toBe(true);
    });

    it('should return false if token is not blacklisted', async () => {
      jest
        .spyOn(databaseService.blacklistedToken, 'findUnique')
        .mockResolvedValue(null);

      const result = await service.isTokenBlacklisted('valid-token');

      expect(result).toBe(false);
    });
  });

  describe('cleanupBlacklistedTokens', () => {
    it('should delete expired blacklisted tokens', async () => {
      jest
        .spyOn(databaseService.blacklistedToken, 'deleteMany')
        .mockResolvedValue({ count: 5 });

      await service.cleanupBlacklistedTokens();

      expect(databaseService.blacklistedToken.deleteMany).toHaveBeenCalledWith({
        where: {
          expiresAt: {
            lt: expect.any(Date),
          },
        },
      });
    });
  });
});
