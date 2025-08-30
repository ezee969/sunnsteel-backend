import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/auth.dto';
import { UnauthorizedException } from '@nestjs/common';
import { Response, Request } from 'express';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;
  let mockResponse: Partial<Response>;
  let mockRequest: Partial<Request>;

  const mockUser = {
    id: '1',
    email: 'test@example.com',
    name: 'Test User',
  };

  const mockTokens = {
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
  };

  const mockAuthResult = {
    user: mockUser,
    tokens: mockTokens,
  };

  beforeEach(async () => {
    const mockAuthService = {
      register: jest.fn(),
      login: jest.fn(),
      logout: jest.fn(),
      refreshTokens: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);

    mockResponse = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    };

    mockRequest = {
      user: mockUser,
      cookies: {},
      headers: {},
    };
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('register', () => {
    it('should register a user and set refresh token cookie', async () => {
      const registerDto: RegisterDto = {
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
      };

      jest.spyOn(authService, 'register').mockResolvedValue(mockAuthResult);

      const result = await controller.register(
        registerDto,
        mockResponse as Response,
      );

      expect(authService.register).toHaveBeenCalledWith(registerDto);
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'refresh_token',
        mockTokens.refreshToken,
        {
          httpOnly: true,
          secure: false, // NODE_ENV !== 'production'
          sameSite: 'strict',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        },
      );
      expect(result).toEqual({
        user: mockUser,
        accessToken: mockTokens.accessToken,
      });
    });
  });

  describe('login', () => {
    it('should login a user and set refresh token cookie', async () => {
      const requestWithUser = {
        ...mockRequest,
        user: mockUser,
      };

      jest.spyOn(authService, 'login').mockResolvedValue(mockAuthResult);

      const result = await controller.login(
        requestWithUser as any,
        mockResponse as Response,
      );

      expect(authService.login).toHaveBeenCalledWith(mockUser);
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'refresh_token',
        mockTokens.refreshToken,
        {
          httpOnly: true,
          secure: false,
          sameSite: 'strict',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        },
      );
      expect(result).toEqual({
        user: mockUser,
        accessToken: mockTokens.accessToken,
      });
    });

    it('should throw UnauthorizedException if user not found', async () => {
      const requestWithoutUser = {
        ...mockRequest,
        user: undefined,
      };

      await expect(
        controller.login(requestWithoutUser as any, mockResponse as Response),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should logout user and clear refresh token cookie', async () => {
      const requestWithTokens = {
        ...mockRequest,
        cookies: { refresh_token: 'mock-refresh-token' },
        headers: { authorization: 'Bearer mock-access-token' },
      };

      jest.spyOn(authService, 'logout').mockResolvedValue();

      const result = await controller.logout(
        requestWithTokens as any,
        mockResponse as Response,
      );

      expect(authService.logout).toHaveBeenCalledWith(
        'mock-refresh-token',
        'mock-access-token',
      );
      expect(mockResponse.clearCookie).toHaveBeenCalledWith('refresh_token');
      expect(result).toEqual({ message: 'Logged out successfully' });
    });

    it('should handle logout without tokens', async () => {
      const requestWithoutTokens = {
        ...mockRequest,
        cookies: {},
        headers: {},
      };

      const result = await controller.logout(
        requestWithoutTokens as any,
        mockResponse as Response,
      );

      expect(authService.logout).not.toHaveBeenCalled();
      expect(mockResponse.clearCookie).toHaveBeenCalledWith('refresh_token');
      expect(result).toEqual({ message: 'Logged out successfully' });
    });
  });

  describe('refresh', () => {
    it('should refresh tokens and set new refresh token cookie', async () => {
      const requestWithRefreshToken = {
        ...mockRequest,
        cookies: { refresh_token: 'mock-refresh-token' },
      };

      jest.spyOn(authService, 'refreshTokens').mockResolvedValue(mockTokens);

      const result = await controller.refresh(
        requestWithRefreshToken as any,
        mockResponse as Response,
      );

      expect(authService.refreshTokens).toHaveBeenCalledWith(
        'mock-refresh-token',
      );
      expect(mockResponse.cookie).toHaveBeenCalledWith(
        'refresh_token',
        mockTokens.refreshToken,
        {
          httpOnly: true,
          secure: false,
          sameSite: 'strict',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        },
      );
      expect(result).toEqual({
        accessToken: mockTokens.accessToken,
      });
    });

    it('should throw UnauthorizedException if refresh token not found', async () => {
      const requestWithoutRefreshToken = {
        ...mockRequest,
        cookies: {},
      };

      await expect(
        controller.refresh(
          requestWithoutRefreshToken as any,
          mockResponse as Response,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
