import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { TokenService } from '../token/token.service';
import { RegisterDto } from './dto/auth.dto';
import * as bcrypt from 'bcrypt';

// Mock bcrypt
jest.mock('bcrypt');
const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('AuthService', () => {
  let service: AuthService;
  let usersService: UsersService;
  let tokenService: TokenService;

  const mockUser = {
    id: '1',
    email: 'test@example.com',
    name: 'Test User',
    password: 'hashedPassword',
    weightUnit: 'KG' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUserIdentification = {
    id: '1',
    email: 'test@example.com',
    name: 'Test User',
  };

  const mockTokens = {
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
  };

  const mockTokenPayload = {
    sub: '1',
    email: 'test@example.com',
    iat: 1234567890,
    exp: 1234567890,
  };

  beforeEach(async () => {
    const mockUsersService = {
      findByEmail: jest.fn(),
      findByEmailWithPassword: jest.fn(),
      create: jest.fn(),
    };

    const mockTokenService = {
      generateTokens: jest.fn(),
      verifyRefreshToken: jest.fn(),
      revokeRefreshToken: jest.fn(),
      blacklistAccessToken: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: TokenService,
          useValue: mockTokenService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get<UsersService>(UsersService);
    tokenService = module.get<TokenService>(TokenService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    const registerDto: RegisterDto = {
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    };

    it('should successfully register a new user', async () => {
      jest.spyOn(usersService, 'findByEmail').mockResolvedValue(null);
      jest.spyOn(usersService, 'create').mockResolvedValue(mockUser);
      jest.spyOn(tokenService, 'generateTokens').mockResolvedValue(mockTokens);

      const result = await service.register(registerDto);

      expect(usersService.findByEmail).toHaveBeenCalledWith(registerDto.email);
      expect(usersService.create).toHaveBeenCalledWith(registerDto);
      expect(tokenService.generateTokens).toHaveBeenCalledWith(
        mockUser.id,
        mockUser.email,
      );
      expect(result).toEqual({
        user: {
          id: mockUser.id,
          email: mockUser.email,
          name: mockUser.name,
        },
        tokens: mockTokens,
      });
    });

    it('should throw ConflictException if email already exists', async () => {
      jest.spyOn(usersService, 'findByEmail').mockResolvedValue(mockUser);

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
      expect(usersService.findByEmail).toHaveBeenCalledWith(registerDto.email);
      expect(usersService.create).not.toHaveBeenCalled();
    });
  });

  describe('validateUser', () => {
    const email = 'test@example.com';
    const password = 'password123';

    it('should return user identification for valid credentials', async () => {
      jest
        .spyOn(usersService, 'findByEmailWithPassword')
        .mockResolvedValue(mockUser);
      mockedBcrypt.compare.mockResolvedValue(true as never);

      const result = await service.validateUser(email, password);

      expect(usersService.findByEmailWithPassword).toHaveBeenCalledWith(email);
      expect(bcrypt.compare).toHaveBeenCalledWith(password, mockUser.password);
      expect(result).toEqual(mockUserIdentification);
    });

    it('should throw UnauthorizedException if user not found', async () => {
      jest
        .spyOn(usersService, 'findByEmailWithPassword')
        .mockResolvedValue(null);

      await expect(service.validateUser(email, password)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(usersService.findByEmailWithPassword).toHaveBeenCalledWith(email);
    });

    it('should throw UnauthorizedException if password is invalid', async () => {
      jest
        .spyOn(usersService, 'findByEmailWithPassword')
        .mockResolvedValue(mockUser);
      mockedBcrypt.compare.mockResolvedValue(false as never);

      await expect(service.validateUser(email, password)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(bcrypt.compare).toHaveBeenCalledWith(password, mockUser.password);
    });
  });

  describe('login', () => {
    it('should return user and tokens for successful login', async () => {
      jest.spyOn(tokenService, 'generateTokens').mockResolvedValue(mockTokens);

      const result = await service.login(mockUserIdentification);

      expect(tokenService.generateTokens).toHaveBeenCalledWith(
        mockUserIdentification.id,
        mockUserIdentification.email,
      );
      expect(result).toEqual({
        user: mockUserIdentification,
        tokens: mockTokens,
      });
    });
  });

  describe('logout', () => {
    it('should revoke refresh token and blacklist access token', async () => {
      const refreshToken = 'mock-refresh-token';
      const accessToken = 'mock-access-token';

      jest.spyOn(tokenService, 'revokeRefreshToken').mockResolvedValue();
      jest.spyOn(tokenService, 'blacklistAccessToken').mockResolvedValue();

      await service.logout(refreshToken, accessToken);

      expect(tokenService.revokeRefreshToken).toHaveBeenCalledWith(
        refreshToken,
      );
      expect(tokenService.blacklistAccessToken).toHaveBeenCalledWith(
        accessToken,
      );
    });
  });

  describe('refreshTokens', () => {
    const refreshToken = 'mock-refresh-token';

    it('should return new tokens for valid refresh token', async () => {
      jest
        .spyOn(tokenService, 'verifyRefreshToken')
        .mockResolvedValue(mockTokenPayload);
      jest.spyOn(usersService, 'findByEmail').mockResolvedValue(mockUser);
      jest.spyOn(tokenService, 'generateTokens').mockResolvedValue(mockTokens);

      const result = await service.refreshTokens(refreshToken);

      expect(tokenService.verifyRefreshToken).toHaveBeenCalledWith(
        refreshToken,
      );
      expect(usersService.findByEmail).toHaveBeenCalledWith(
        mockTokenPayload.email,
      );
      expect(tokenService.generateTokens).toHaveBeenCalledWith(
        mockUser.id,
        mockUser.email,
      );
      expect(result).toEqual(mockTokens);
    });

    it('should throw UnauthorizedException if user not found', async () => {
      jest
        .spyOn(tokenService, 'verifyRefreshToken')
        .mockResolvedValue(mockTokenPayload);
      jest.spyOn(usersService, 'findByEmail').mockResolvedValue(null);

      await expect(service.refreshTokens(refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if refresh token is invalid', async () => {
      jest
        .spyOn(tokenService, 'verifyRefreshToken')
        .mockRejectedValue(new Error('Invalid token'));

      await expect(service.refreshTokens(refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
